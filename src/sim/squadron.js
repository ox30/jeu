// RAF fighter squadrons: scramble, climb, follow the controller's vectors or a list of legs,
// fight, come home to refuel and rearm.

import { FOOT_M, bearing, distance, headingVector, turnToward } from './geo.js';
import { emit } from './events.js';
import { followPlan } from './navigation.js';
import { airfieldDelayFactor, isOperational, nearestOperationalAirfield } from './sites.js';
import { drawAmmo, drawFuel, sortieFuel } from './logistics.js';
import { guidanceHeading } from './control.js';
import { pilotsKilled } from './crews.js';
import { chaseHeading } from './engagement.js';

/** Characteristics of an aircraft type: a fighter, or a patrol aircraft. */
export function aircraftSpec(world, type) {
  return world.rules.fighters[type] || (world.rules.patrols && world.rules.patrols[type]) || null;
}

export function createSquadron(world, def) {
  const field = world.byId.airfield.get(def.airfield);
  const type = aircraftSpec(world, def.type);
  if (!type) throw new Error(`squadron ${def.id}: unknown aircraft ${def.type}`);
  const altFt = def.altitudeFt ?? world.rules.squadron.defaultAltitudeFt;
  return {
    kind: 'squadron',
    id: def.id,
    name: def.name,
    type: def.type,
    typeName: type.name,
    airfield: field.id,
    home: field.id,
    role: def.role || type.role || 'fighter', // fighter | watch (spotters) | coastal (Coastal Command)
    asv: Boolean(def.asv), // air-to-surface radar (patrol aircraft)
    aircraft: def.aircraft,
    aircraftStart: def.aircraft,
    pilots: def.pilots ?? def.aircraft,
    fatigue: def.fatigue ?? 10, // 0 (fresh) to 100 (exhausted)
    alert: def.alert || 'available', // on the ground: rest | thirty | available | cockpit (crews.js)
    alertAt: null, // a recall under way: when the new state holds
    alertFrom: null, // the state it holds until then
    alertLong: false,
    roster: { daily: [], override: null }, // duty roster: alert states by the hour (roster.js)
    alertManual: false, // a state set by hand holds until the player goes back to the plan
    schedule: null, // a take-off ordered for later (timetable.js)
    lateFor: null, // a formation it is catching up with, late at the rendezvous (rally.js)
    rallySlow: null, // a wing's leader slowing for its latecomers: speed factor
    x: field.x,
    y: field.y,
    px: field.x,
    py: field.y,
    alt: 0,
    palt: 0,
    targetAlt: altFt * FOOT_M,
    heading: 90,
    vector: null, // heading ordered by the controller
    route: [], // waypoints drawn by the player: [x, y, altM or null]
    plan: [], // legs: heading until a duration, a time, a square or a position
    endAction: { kind: 'orbit' }, // what to do at the end of the route or of the legs
    legState: null,
    orbit: false,
    cover: null, // id of a convoy to patrol over
    intercept: null, // guided onto a raid by the controller (Arcade): { raidId, p, ok }
    follow: null, // big wing: id of the squadron it flies with
    inFormation: false,
    formation: null, // id of the formation (big wing) it belongs to
    holdForWing: false, // a wing's leader circles while its squadrons gather
    wingSlowest: null, // a wing's leader: speeds of its slowest squadron in formation
    roe: 'attack', // on meeting the enemy: defend | attack | pursue (engagement.js); attack, as in M2.2
    cleared: new Set(), // raids it has leave to attack whatever its order
    letGo: new Set(), // raids the player called it off: left alone until sent back
    clearedBeyond: new Set(), // raids it has leave to follow beyond mid-Channel
    attackRaid: null, // a raid it goes after while it can see it
    breakOff: null, // a raid it must leave (refused leave beyond mid-Channel)
    speedMode: 'cruise', // cruise | max (the boost)
    speedPct: 100, // throttle below the boost: 50 to 100 % of cruising speed
    state: 'ready', // ready | scrambling | airborne | combat | returning | refuelling | lost
    timer: 0,
    fuel: type.enduranceMin, // minutes at cruise power
    ammo: 1,
    engagedRaid: null,
    combatTimer: 0,
    heightAdvantage: false,
    firstPass: true,
    engagement: null, // running tally of the current fight, for the combat report
    lastReport: null,
    returnReason: null,
    nothingSeen: new Set(),
    watch: new Map(), // raids being approached, to tell the player when one is missed
  };
}

export function isFlying(s) {
  return s.state === 'airborne' || s.state === 'combat' || s.state === 'returning';
}

export function feetOf(altM) {
  return altM / FOOT_M;
}

/** Cruise or full speed of a squadron, in km/s. */
/**
 * Throttle of a squadron in the air: its share of cruising speed (50 to 100 %), or the boost
 * (full speed, « Buster »). Going home it flies at cruising speed.
 */
export function throttle(s) {
  if (s.state === 'returning') return { max: false, pct: 100 };
  if (s.speedMode === 'max') return { max: true, pct: 100 };
  return { max: false, pct: Math.max(10, Math.min(100, s.speedPct ?? 100)) };
}

/** Speed (km/h) of an aircraft type at a throttle. */
export function typeKmh(type, th) {
  return th.max ? type.maxKmh : (type.cruiseKmh * th.pct) / 100;
}

export function squadronSpeed(world, s) {
  const type = aircraftSpec(world, s.type);
  const th = throttle(s);
  let kmh = typeKmh(type, th);
  // The leader of a big wing flies at the speed of its slowest squadron (formations.js).
  if (s.wingSlowest) kmh = Math.min(kmh, typeKmh(s.wingSlowest, th));
  // A wing that left its rendezvous without everyone slows down for the latecomers (rally.js).
  if (s.rallySlow) kmh *= s.rallySlow;
  return kmh / 3600;
}

function nearestAirfield(world, x, y) {
  let best = null;
  let bestD = Infinity;
  for (const f of world.airfields) {
    const d = distance(x, y, f.x, f.y);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}

function clearNavigation(s) {
  s.route = [];
  s.plan = [];
  s.legState = null;
  s.vector = null;
  s.orbit = false;
  s.cover = null;
  s.intercept = null;
  s.attackRaid = null;
  s.follow = null;
  s.inFormation = false;
}

/** The leader of a squadron in a big wing, or null when the formation is broken. */
function wingLeader(world, s) {
  const leader = world.squadrons.find((x) => x.id === s.follow);
  if (leader && (leader.state === 'airborne' || leader.state === 'combat' || leader.state === 'scrambling') && !leader.follow) return leader;
  s.follow = null;
  s.inFormation = false;
  s.orbit = true;
  // In a formation of the player's, the next leader is chosen a moment later (formations.js).
  if (!s.formation) emit(world, 'formationBroken', { squadron: s.name, squadronId: s.id });
  return null;
}

/** Station of a squadron in its leader's formation: behind and to the side, one slot each. */
function formationSlot(world, s, leader) {
  const slot = 1 + world.squadrons.filter((x) => x.follow === leader.id && x.id < s.id).length;
  const [hx, hy] = headingVector(leader.heading);
  const side = slot % 2 ? 1 : -1;
  const k = Math.ceil(slot / 2);
  return [leader.x - hx * 1.5 * k + hy * side * 1.2 * k, leader.y - hy * 1.5 * k - hx * side * 1.2 * k];
}

/**
 * Big wing: a squadron flies to its leader at full speed, then keeps station beside it, at
 * its height. Returns the heading to steer while joining, or null.
 */
function joiningHeading(world, s, R) {
  const leader = wingLeader(world, s);
  if (!leader) return null;
  const [tx, ty] = formationSlot(world, s, leader);
  s.targetAlt = leader.targetAlt;
  s.speedMode = 'max';
  // Station is kept only with a leader in the air (one still on the ground is circled over).
  if (leader.state === 'airborne' && distance(s.x, s.y, tx, ty) < R.formationKm) {
    s.inFormation = true;
    emit(world, 'formationJoined', { squadron: s.name, squadronId: s.id, leader: leader.name, leaderId: leader.id });
  }
  return bearing(s.x, s.y, tx, ty);
}

/** Rearming after a sortie draws on the aerodrome's ammunition (when logistics are played). */
function rearm(world, s, field) {
  if (!world.rail.enabled || s.role !== 'fighter') {
    s.ammo = 1;
    return;
  }
  const per = world.rules.logistics.ammoPerAircraft;
  const need = Math.max(0, s.aircraft * (1 - s.ammo) * per);
  if (need <= 1e-6) {
    s.ammo = 1;
    return;
  }
  const got = drawAmmo(world, field, need);
  s.ammo = Math.min(1, s.ammo + got / Math.max(1e-6, s.aircraft * per));
  if (got + 1e-6 < need) emit(world, 'noAmmo', { squadron: s.name, squadronId: s.id, airfield: field.name, n: Math.round(s.ammo * 100) });
}

/** The squadron takes the altitude written on the next point of its route, if any. */
export function applyPointAltitude(s) {
  const p = s.route[0];
  if (p && p[2] !== null && p[2] !== undefined) s.targetAlt = p[2];
}

/** Aerodromes whose bubble contains (x, y): a route ending there can end with a landing. */
export function airfieldsAround(world, x, y) {
  const r = world.rules.squadron.landBubbleKm;
  return world.airfields.filter((f) => distance(f.x, f.y, x, y) <= r);
}

/**
 * At the end of its route or of its legs the squadron orbits (by default), holds its
 * heading, comes home, lands at an aerodrome or covers a convoy.
 */
export function applyEndAction(world, s) {
  const a = s.endAction || { kind: 'orbit' };
  s.vector = null;
  s.orbit = false;
  s.cover = null;
  let done = a.kind;
  if (a.kind === 'hold') {
    s.vector = s.heading;
  } else if (a.kind === 'home' || a.kind === 'land') {
    const field = a.kind === 'land' ? world.byId.airfield.get(a.id) : null;
    startReturn(world, s, 'order', field ? field.id : s.home);
    emit(world, 'returning', { squadron: s.name, squadronId: s.id, airfield: world.byId.airfield.get(s.airfield).name });
  } else if (a.kind === 'cover') {
    const c = world.convoys.find((x) => x.id === a.id);
    if (c && c.state === 'atSea') s.cover = c.id;
    else {
      s.orbit = true;
      done = 'orbit';
    }
  } else {
    s.orbit = true;
  }
  s.endAction = { kind: 'orbit' };
  // At the rendezvous of its big wing: it circles there, waiting for the others.
  const f = s.formation ? world.formations.find((x) => x.id === s.formation) : null;
  if (done === 'orbit' && f && f.rally && f.rally.where === 'point' && ['armed', 'deciding', 'waiting'].includes(f.rally.phase)) {
    emit(world, 'atRendezvous', { squadron: s.name, squadronId: s.id, formation: f.name });
    return;
  }
  emit(world, 'routeEnded', { squadron: s.name, squadronId: s.id, action: done });
}

/** Sends a flying squadron home (or to `fieldId`). */
export function startReturn(world, s, reason, fieldId = s.home) {
  if (s.engagedRaid) {
    const r = world.raids.find((raid) => raid.id === s.engagedRaid);
    if (r) r.engagedBy.delete(s.id);
    s.engagedRaid = null;
  }
  let field = world.byId.airfield.get(fieldId);
  if (!isOperational(world, field)) {
    const other = nearestOperationalAirfield(world, s.x, s.y, field.id);
    if (other) {
      emit(world, 'divertOut', { squadron: s.name, squadronId: s.id, closed: field.name, airfield: other.name });
      field = other;
    }
  }
  s.airfield = field.id;
  s.state = 'returning';
  s.returnReason = reason;
  clearNavigation(s);
  s.speedMode = 'cruise';
}

function land(world, s) {
  const field = world.byId.airfield.get(s.airfield);
  s.x = field.x;
  s.y = field.y;
  s.alt = 0;
  s.state = 'refuelling';
  s.timer = world.rules.squadron.refuelMinutes * 60 * airfieldDelayFactor(world, field);
  s.returnReason = null;
  s.speedMode = 'cruise';
  emit(world, 'landed', { squadron: s.name, squadronId: s.id, airfield: field.name });
}

function updateFuel(world, s, dt) {
  const mode = world.settings.fuel;
  if (mode === 'unlimited') return;
  const R = world.rules.squadron;
  const type = aircraftSpec(world, s.type);
  // Full speed burns much more; slower than cruising, a little less (to 80 % at half speed).
  const th = throttle(s);
  const slow = 1 - ((100 - th.pct) / 50) * (1 - R.slowBurnAt50);
  const burn = (th.max ? R.maxSpeedBurn : slow) * (s.state === 'combat' ? R.combatBurn : 1);
  s.fuel -= (burn * dt) / 60;

  if (s.state === 'airborne' || s.state === 'combat') {
    const home = world.byId.airfield.get(s.home);
    const near = mode === 'realistic' ? nearestOperationalAirfield(world, s.x, s.y) : null;
    const field = near || home;
    const needed = (distance(s.x, s.y, field.x, field.y) / type.cruiseKmh) * 60 + R.fuelReserveMin[mode];
    if (s.fuel <= needed) {
      const divert = field.id !== home.id && distance(s.x, s.y, home.x, home.y) - distance(s.x, s.y, field.x, field.y) > 15;
      const target = divert ? field : home;
      startReturn(world, s, 'fuel', target.id);
      emit(world, divert ? 'divert' : 'bingo', { squadron: s.name, squadronId: s.id, airfield: world.byId.airfield.get(s.airfield).name });
    }
  }

  if (s.fuel <= 0) {
    s.fuel = 0;
    const lost = Math.min(s.aircraft, Math.ceil(s.aircraft / 3));
    s.aircraft -= lost;
    world.stats.rafLost += lost;
    pilotsKilled(world, s, lost, s.x, s.y);
    const field = nearestOperationalAirfield(world, s.x, s.y) || nearestAirfield(world, s.x, s.y);
    s.airfield = field.id;
    emit(world, 'fuelExhausted', { squadron: s.name, squadronId: s.id, lost, airfield: field.name });
    if (s.engagedRaid) {
      const r = world.raids.find((raid) => raid.id === s.engagedRaid);
      if (r) r.engagedBy.delete(s.id);
      s.engagedRaid = null;
    }
    if (s.aircraft <= 0) {
      s.state = 'lost';
      emit(world, 'squadronLost', { squadron: s.name, squadronId: s.id });
    } else {
      land(world, s);
    }
  }
}

/** Heading that keeps the squadron circling over a moving convoy. */
function coverHeading(world, s, R) {
  const convoy = world.convoys.find((c) => c.id === s.cover);
  if (!convoy || convoy.state === 'arrived' || convoy.state === 'lost') {
    s.cover = null;
    s.orbit = true;
    return null;
  }
  const d = distance(s.x, s.y, convoy.x, convoy.y);
  const toward = bearing(s.x, s.y, convoy.x, convoy.y);
  if (d > R.coverRadiusKm * 1.5) return { heading: toward, rate: R.turnRateDegPerSec };
  // On station: fly a circle around the convoy, tangent to the bearing.
  return { heading: toward + 90 - Math.min(60, (R.coverRadiusKm - d) * 12), rate: R.orbitTurnDegPerSec * 1.5 };
}

export function updateSquadron(world, s, dt) {
  s.px = s.x;
  s.py = s.y;
  s.palt = s.alt;
  const R = world.rules.squadron;
  const type = aircraftSpec(world, s.type);

  switch (s.state) {
    case 'ready':
    case 'lost':
      return;
    case 'refuelling':
      s.timer -= dt;
      if (s.timer <= 0) {
        // Refuelling draws on the aerodrome's stock: without fuel the squadron stays down.
        if (s.waitingFuel && world.t % 60 !== 0) return;
        const field = world.byId.airfield.get(s.airfield);
        if (!drawFuel(world, field, sortieFuel(world, s), s.role)) {
          if (!s.waitingFuel) emit(world, 'noFuel', { squadron: s.name, squadronId: s.id, airfield: field.name });
          s.waitingFuel = true;
          s.timer = 0;
          return;
        }
        s.waitingFuel = false;
        s.state = 'ready';
        s.fuel = type.enduranceMin;
        rearm(world, s, field);
        s.nothingSeen.clear();
        s.watch.clear();
        emit(world, 'ready', { squadron: s.name, squadronId: s.id, airfield: world.byId.airfield.get(s.airfield).name });
      }
      return;
    case 'scrambling':
      s.timer -= dt;
      if (s.timer <= 0) {
        s.state = 'airborne';
        s.alt = 150;
        s.firstPass = true;
        s.legState = null;
        if (s.route.length) s.heading = bearing(s.x, s.y, s.route[0][0], s.route[0][1]);
        else if (s.plan.length) s.heading = s.plan[0].heading;
        else if (s.vector !== null) s.heading = s.vector;
        emit(world, 'airborne', { squadron: s.name, squadronId: s.id });
      }
      return;
    default:
  }

  // Flying states: airborne, combat, returning.
  const field = world.byId.airfield.get(s.airfield);
  const raid = s.state === 'combat' ? world.raids.find((r) => r.id === s.engagedRaid) : null;

  // Altitude.
  let wantAlt = s.targetAlt;
  if (raid) wantAlt = raid.alt + (s.heightAdvantage ? 300 : 0);
  if (s.state === 'returning' && distance(s.x, s.y, field.x, field.y) < R.approachDescentKm) wantAlt = 0;
  if (s.alt < wantAlt) s.alt = Math.min(wantAlt, s.alt + (type.climbMpm / 60) * dt);
  else s.alt = Math.max(wantAlt, s.alt - (R.descentMpm / 60) * dt);

  let leader = !raid && s.follow && s.inFormation && s.state === 'airborne' ? wingLeader(world, s) : null;
  if (leader && leader.state !== 'airborne') {
    // The leader is fighting: the wing breaks to engage, and gathers again afterwards.
    s.inFormation = false;
    leader = null;
  }
  if (raid) {
    // In combat the squadron stays with the raid.
    s.x = raid.x;
    s.y = raid.y;
    s.heading = raid.heading;
  } else if (leader) {
    // In formation: the squadron keeps its station with the leader.
    [s.x, s.y] = formationSlot(world, s, leader);
    s.heading = leader.heading;
    s.targetAlt = leader.targetAlt;
    s.speedMode = leader.speedMode;
    s.speedPct = leader.speedPct;
  } else {
    const v = squadronSpeed(world, s);
    let desired = s.heading;
    let turnRate = R.turnRateDegPerSec;
    let chase = null;
    if (s.state === 'returning') {
      desired = bearing(s.x, s.y, field.x, field.y);
    } else if (s.holdForWing) {
      // A wing's leader circles while its squadrons gather.
      desired = s.heading + 90;
      turnRate = R.orbitTurnDegPerSec;
    } else if (s.attackRaid && (chase = chaseHeading(world, s, v)) !== null) {
      // Leave to attack a raid it can see: it goes after it.
      desired = chase;
    } else if (s.route.length) {
      const [wx, wy] = s.route[0];
      if (distance(s.x, s.y, wx, wy) < Math.max(R.waypointReachedKm, v * dt * 2)) {
        s.route.shift();
        if (s.route.length) applyPointAltitude(s);
        else applyEndAction(world, s);
      }
      if (s.route.length) desired = bearing(s.x, s.y, s.route[0][0], s.route[0][1]);
      else if (s.state === 'returning') desired = bearing(s.x, s.y, field.x, field.y);
    } else if (s.plan.length) {
      desired = followPlan(world, s, 'air') ?? s.heading;
      if (s.planJustEnded) {
        s.planJustEnded = false;
        applyEndAction(world, s);
      }
    } else if (s.follow) {
      const h = joiningHeading(world, s, R);
      if (h !== null) desired = h;
    } else if (s.intercept) {
      const h = guidanceHeading(world, s, v);
      if (h !== null) desired = h;
    } else if (s.cover) {
      const c = coverHeading(world, s, R);
      if (c) {
        desired = c.heading;
        turnRate = c.rate;
      }
    } else if (s.orbit) {
      desired = s.heading + 90;
      turnRate = R.orbitTurnDegPerSec;
    } else if (s.vector !== null) {
      desired = s.vector;
    }
    s.heading = turnToward(s.heading, desired, turnRate * dt);
    const [dx, dy] = headingVector(s.heading);
    s.x += dx * v * dt;
    s.y += dy * v * dt;

    if (s.state === 'returning' && distance(s.x, s.y, field.x, field.y) < R.landingRangeKm) {
      const other = isOperational(world, field) ? null : nearestOperationalAirfield(world, s.x, s.y, field.id);
      if (other) {
        startReturn(world, s, s.returnReason || 'order', field.id);
      } else {
        land(world, s);
        return;
      }
    }
  }

  updateFuel(world, s, dt);
}
