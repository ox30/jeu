// RAF fighter squadrons: scramble, climb, follow the controller's vectors or a list of legs,
// fight, come home to refuel and rearm.

import { FOOT_M, bearing, distance, headingVector, turnToward } from './geo.js';
import { emit } from './events.js';
import { followPlan } from './navigation.js';
import { airfieldDelayFactor, isOperational, nearestOperationalAirfield } from './sites.js';
import { drawFuel, sortieFuel } from './logistics.js';

export function createSquadron(world, def) {
  const field = world.byId.airfield.get(def.airfield);
  const type = world.rules.fighters[def.type];
  const altFt = def.altitudeFt ?? world.rules.squadron.defaultAltitudeFt;
  return {
    kind: 'squadron',
    id: def.id,
    name: def.name,
    type: def.type,
    typeName: type.name,
    airfield: field.id,
    home: field.id,
    aircraft: def.aircraft,
    aircraftStart: def.aircraft,
    x: field.x,
    y: field.y,
    px: field.x,
    py: field.y,
    alt: 0,
    palt: 0,
    targetAlt: altFt * FOOT_M,
    heading: 90,
    vector: null, // heading ordered by the controller
    route: [], // waypoints drawn by the player
    plan: [], // legs: heading until a duration, a time, a square or a position
    legState: null,
    orbit: false,
    cover: null, // id of a convoy to patrol over
    speedMode: 'cruise', // cruise | max
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
export function squadronSpeed(world, s) {
  const type = world.rules.fighters[s.type];
  return (s.speedMode === 'max' && s.state !== 'returning' ? type.maxKmh : type.cruiseKmh) / 3600;
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
  const type = world.rules.fighters[s.type];
  const burn = (s.speedMode === 'max' && s.state !== 'returning' ? R.maxSpeedBurn : 1) * (s.state === 'combat' ? R.combatBurn : 1);
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
  const type = world.rules.fighters[s.type];

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
        if (!drawFuel(world, field, sortieFuel(world, s))) {
          if (!s.waitingFuel) emit(world, 'noFuel', { squadron: s.name, squadronId: s.id, airfield: field.name });
          s.waitingFuel = true;
          s.timer = 0;
          return;
        }
        s.waitingFuel = false;
        s.state = 'ready';
        s.fuel = type.enduranceMin;
        s.ammo = 1;
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

  if (raid) {
    // In combat the squadron stays with the raid.
    s.x = raid.x;
    s.y = raid.y;
    s.heading = raid.heading;
  } else {
    const v = squadronSpeed(world, s);
    let desired = s.heading;
    let turnRate = R.turnRateDegPerSec;
    if (s.state === 'returning') {
      desired = bearing(s.x, s.y, field.x, field.y);
    } else if (s.route.length) {
      const [wx, wy] = s.route[0];
      if (distance(s.x, s.y, wx, wy) < Math.max(R.waypointReachedKm, v * dt * 2)) {
        s.route.shift();
        if (!s.route.length) s.vector = s.heading; // end of the line: keep flying straight
      }
      if (s.route.length) desired = bearing(s.x, s.y, s.route[0][0], s.route[0][1]);
    } else if (s.plan.length) {
      desired = followPlan(world, s, 'air') ?? s.heading;
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
