// Formations: units the player commands as one, with a leader and members in order (the
// next one takes over when the leader drops out). There is no limit on the size.
//  - In the air, a big wing: fighter squadrons that scramble together, gather over their
//    leader (the leader circles until they have joined, or a while has passed), then fly
//    at the speed of the slowest. A member short of fuel or ammunition drops out and goes
//    home; the others carry on.
//  - At sea, a support group: escort groups that sail, escort and hunt together. When the
//    shortest of them runs low, the whole group goes home with it.

import { emit } from './events.js';
import { aircraftSpec, isFlying } from './squadron.js';
import { interceptRaid, joinConvoy, leavePort, scramble } from './orders.js';
import { sendEscortHome } from './naval.js';

export function createFormations(world) {
  world.formations = [];
  world.nextFormationId = 1;
}

export function unitOf(world, kind, id) {
  return kind === 'air' ? world.squadrons.find((s) => s.id === id) : world.escorts.find((e) => e.id === id);
}

export function formationById(world, id) {
  return world.formations.find((f) => f.id === id) || null;
}

/** The formation a squadron or an escort group belongs to, or null. */
export function formationOf(world, unit) {
  return unit && unit.formation ? formationById(world, unit.formation) : null;
}

export function membersOf(world, f) {
  return f.members.map((id) => unitOf(world, f.kind, id)).filter(Boolean);
}

export function leaderOf(world, f) {
  return unitOf(world, f.kind, f.members[0]) || null;
}

/** Why a unit cannot be put in a formation of this kind, or null. */
export function joinProblem(world, kind, u) {
  if (!u) return 'missing';
  if (kind === 'air') {
    if (u.kind !== 'squadron' || u.role !== 'fighter') return 'notFighter';
    if (u.state === 'lost') return 'lost';
    if (u.state === 'returning' && (u.returnReason === 'fuel' || u.returnReason === 'ammo')) return 'returning';
    return null;
  }
  if (u.kind !== 'escort') return 'notEscort';
  if (u.state === 'lost') return 'lost';
  return null;
}

/** A follower flies to its leader and keeps station (the big wing mechanics, silently). */
export function linkToLeader(s, leader) {
  s.route = [];
  s.plan = [];
  s.legState = null;
  s.vector = null;
  s.orbit = false;
  s.cover = null;
  s.intercept = null;
  s.follow = leader.id;
  s.inFormation = false;
}

function unlink(s) {
  if (!s.follow) return;
  s.follow = null;
  s.inFormation = false;
  if (s.state === 'airborne') s.orbit = true;
}

/** What a wing's leader is doing, kept so that the next leader carries on with it. */
function missionOf(s) {
  return {
    route: s.route.map((p) => [...p]),
    plan: s.plan.map((l) => ({ ...l })),
    vector: s.vector,
    orbit: s.orbit,
    cover: s.cover,
    intercept: s.intercept ? { ...s.intercept } : null,
    targetAlt: s.targetAlt,
    speedMode: s.speedMode,
    speedPct: s.speedPct ?? 100,
    endAction: { ...s.endAction },
  };
}

function applyMission(s, m) {
  s.route = m.route.map((p) => [...p]);
  s.plan = m.plan.map((l) => ({ ...l }));
  s.legState = null;
  s.vector = m.vector;
  s.orbit = m.orbit;
  s.cover = m.cover;
  s.intercept = m.intercept ? { ...m.intercept } : null;
  s.targetAlt = m.targetAlt;
  s.speedMode = m.speedMode;
  s.speedPct = m.speedPct ?? 100;
  s.endAction = { ...m.endAction };
}

/** A leader flying its mission (not on its way home, not lost). */
function onMission(s) {
  return isFlying(s) && s.state !== 'returning';
}

/** Puts an air member in its place: follows the leader when both can fly together. */
function placeAirMember(world, f, s) {
  const leader = leaderOf(world, f);
  if (!leader || s === leader) return;
  // A squadron with its own take-off time goes at that time (timetable.js).
  if (s.schedule && s.state === 'ready') return;
  const leaderUp = leader.state === 'scrambling' || isFlying(leader);
  if (!leaderUp) {
    unlink(s);
    return;
  }
  if (s.state === 'ready') {
    if (!scramble(world, s, {})) return;
  }
  if (s.state === 'scrambling' || s.state === 'airborne') linkToLeader(s, leader);
}

/** A naval member sails with the group: it joins the convoy the leader escorts or meets. */
function placeNavalMember(world, f, e) {
  const leader = leaderOf(world, f);
  if (!leader || e === leader) return;
  const convoyId = leader.escorting || leader.joinTarget;
  if (convoyId && e.escorting !== convoyId && e.joinTarget !== convoyId) joinConvoy(world, e, convoyId);
  e.behaviour = leader.behaviour;
}

/**
 * Creates a formation led by `leaderId`. Returns it, or null. The name is the player's (the
 * interface proposes one, from the texts); without a name the formation goes by its number.
 */
export function newFormation(world, kind, leaderId, name = null) {
  const leader = unitOf(world, kind, leaderId);
  if (joinProblem(world, kind, leader)) return null;
  const old = formationOf(world, leader);
  if (old) removeMember(world, old, leader.id, true);
  const id = `F${world.nextFormationId}`;
  const f = {
    id,
    kind,
    name: (name && String(name).trim().slice(0, 40)) || id,
    members: [leader.id],
    gatherUntil: null,
    homeward: false,
    mission: null, // last orders of the wing's leader, for the one who takes over
  };
  world.nextFormationId++;
  world.formations.push(f);
  leader.formation = f.id;
  emit(world, 'formationCreated', { formation: f.name, formationId: f.id, kind, leader: leader.name });
  return f;
}

/** Adds a unit at the end of the formation (taking it from another one if needed). */
export function addMember(world, f, unitId) {
  const u = unitOf(world, f.kind, unitId);
  if (joinProblem(world, f.kind, u) || f.members.includes(unitId)) return false;
  const old = formationOf(world, u);
  if (old) removeMember(world, old, u.id, true);
  f.members.push(u.id);
  u.formation = f.id;
  if (f.kind === 'air') placeAirMember(world, f, u);
  else placeNavalMember(world, f, u);
  emit(world, 'formationJoinedBy', { formation: f.name, formationId: f.id, unit: u.name, unitId: u.id, kind: f.kind });
  return true;
}

/** Takes a unit out of its formation; the next member leads if it was the leader. */
export function removeMember(world, f, unitId, silent = false) {
  const i = f.members.indexOf(unitId);
  if (i < 0) return false;
  const u = unitOf(world, f.kind, unitId);
  if (i === 0 && u && f.kind === 'air' && onMission(u)) f.mission = missionOf(u);
  f.members.splice(i, 1);
  if (u) {
    u.formation = null;
    if (f.kind === 'air') {
      unlink(u);
      u.holdForWing = false;
      u.wingSlowest = null;
    } else {
      u.followEscort = null;
      u.waitForGroup = false;
    }
  }
  if (!f.members.length) {
    world.formations = world.formations.filter((x) => x !== f);
    if (!silent) emit(world, 'formationDissolved', { formation: f.name, formationId: f.id });
    return true;
  }
  if (i === 0) handOver(world, f, u);
  if (!silent && u) emit(world, 'formationLeftBy', { formation: f.name, formationId: f.id, unit: u.name, unitId: u.id, reason: 'order' });
  return true;
}

/**
 * A new leader at the head of the list: it keeps the mission of the one before (route, legs,
 * vector, guidance), and the others follow it.
 */
function handOver(world, f, previous) {
  const leader = leaderOf(world, f);
  if (!leader) return;
  if (f.kind === 'air') {
    unlink(leader);
    if (previous && previous !== leader && f.mission && onMission(leader)) {
      // The new leader carries on with the mission of the one before.
      applyMission(leader, f.mission);
    } else if (isFlying(leader) && !leader.route.length && !leader.plan.length && leader.vector === null && !leader.intercept) {
      leader.orbit = true;
    }
    leader.holdForWing = Boolean(previous && previous.holdForWing);
    if (previous) previous.holdForWing = false;
    for (const s of membersOf(world, f).slice(1)) placeAirMember(world, f, s);
  } else {
    for (const e of membersOf(world, f).slice(1)) placeNavalMember(world, f, e);
  }
  emit(world, 'formationLeader', { formation: f.name, formationId: f.id, leader: leader.name });
}

/** Makes `unitId` the leader of the formation. */
export function setLeader(world, f, unitId) {
  const i = f.members.indexOf(unitId);
  if (i <= 0) return i === 0;
  const previous = leaderOf(world, f);
  if (f.kind === 'air' && previous && onMission(previous)) f.mission = missionOf(previous);
  f.members.splice(i, 1);
  f.members.unshift(unitId);
  handOver(world, f, previous);
  return true;
}

/** All the members of `from` join `into` (in their order); `from` is gone. */
export function mergeFormations(world, into, from) {
  if (!into || !from || into === from || into.kind !== from.kind) return false;
  const ids = [...from.members];
  world.formations = world.formations.filter((x) => x !== from);
  for (const id of ids) {
    const u = unitOf(world, from.kind, id);
    if (!u) continue;
    u.formation = null;
    if (joinProblem(world, into.kind, u)) {
      if (into.kind === 'air') unlink(u);
      continue;
    }
    into.members.push(u.id);
    u.formation = into.id;
    if (into.kind === 'air') {
      u.holdForWing = false;
      u.wingSlowest = null;
      unlink(u);
      placeAirMember(world, into, u);
    } else {
      u.waitForGroup = false;
      placeNavalMember(world, into, u);
    }
  }
  emit(world, 'formationMerged', { formation: into.name, formationId: into.id, from: from.name, kind: into.kind });
  return true;
}

/** Moves a member up (-1) or down (+1) the list; the leader keeps the first place. */
export function moveMember(world, f, unitId, delta) {
  const i = f.members.indexOf(unitId);
  const j = i + delta;
  if (i <= 0 || j <= 0 || j >= f.members.length) return false;
  [f.members[i], f.members[j]] = [f.members[j], f.members[i]];
  return true;
}

export function renameFormation(world, f, name) {
  const clean = String(name || '').trim().slice(0, 40);
  if (!clean) return false;
  f.name = clean;
  return true;
}

export function dissolveFormation(world, f) {
  for (const u of membersOf(world, f)) {
    u.formation = null;
    if (f.kind === 'air') {
      unlink(u);
      u.holdForWing = false;
      u.wingSlowest = null;
    } else {
      u.followEscort = null;
      u.waitForGroup = false;
    }
  }
  world.formations = world.formations.filter((x) => x !== f);
  emit(world, 'formationDissolved', { formation: f.name, formationId: f.id });
}

/**
 * A big wing takes off: the leader with its orders (route, vector...), every member ready
 * with it. The leader circles until the wing has gathered. Returns the number airborne.
 */
export function scrambleFormation(world, f, orders = {}) {
  if (f.kind !== 'air') return 0;
  let leader = leaderOf(world, f);
  // A leader that cannot go hands over to the first member ready.
  if (leader.state !== 'ready' && !isFlying(leader) && leader.state !== 'scrambling') {
    const ready = membersOf(world, f).find((s) => s.state === 'ready');
    if (!ready) return 0;
    setLeader(world, f, ready.id);
    leader = ready;
  }
  if (leader.state === 'ready' && !scramble(world, leader, orders)) return 0;
  if (leader.schedule && !leader.schedule.daily) leader.schedule = null;
  let n = 1;
  for (const s of membersOf(world, f).slice(1)) {
    // A squadron with its own take-off time keeps it (timetable.js).
    if (s.state !== 'ready' || s.schedule) continue;
    if (!scramble(world, s, {})) continue;
    linkToLeader(s, leader);
    n++;
  }
  if (n > 1) {
    leader.holdForWing = true;
    f.gatherUntil = world.t + world.rules.formations.gatherMaxS;
  }
  emit(world, 'formationScrambled', { formation: f.name, formationId: f.id, n });
  return n;
}

/**
 * Arcade: the controller guides the wing onto a raid. A wing on the ground takes off
 * together and gathers first. Returns the chance given, or null when refused.
 */
export function interceptFormation(world, f, raidId) {
  if (f.kind !== 'air') return null;
  let leader = leaderOf(world, f);
  if (!leader) return null;
  if (leader.state !== 'ready' && !isFlying(leader) && leader.state !== 'scrambling') {
    const ready = membersOf(world, f).find((s) => s.state === 'ready');
    if (!ready) return null;
    setLeader(world, f, ready.id);
    leader = ready;
  }
  const onGround = leader.state === 'ready';
  const p = interceptRaid(world, leader, raidId);
  if (p === null) return null;
  if (onGround) {
    let n = 1;
    for (const s of membersOf(world, f).slice(1)) {
      if (s.state !== 'ready' || !scramble(world, s, {})) continue;
      linkToLeader(s, leader);
      n++;
    }
    if (n > 1) {
      leader.holdForWing = true;
      f.gatherUntil = world.t + world.rules.formations.gatherMaxS;
    }
    emit(world, 'formationScrambled', { formation: f.name, formationId: f.id, n });
  }
  return p;
}

/** Brings members waiting on the ground into the air to join a wing already flying. */
export function launchWaiting(world, f) {
  const leader = leaderOf(world, f);
  if (!leader || !(isFlying(leader) || leader.state === 'scrambling')) return 0;
  let n = 0;
  for (const s of membersOf(world, f).slice(1)) {
    if (s.state !== 'ready') continue;
    if (scramble(world, s, {})) {
      linkToLeader(s, leader);
      n++;
    }
  }
  return n;
}

/** The whole formation goes home (each squadron to its base, each group to its port). */
export function formationHome(world, f, sendHome) {
  for (const u of membersOf(world, f)) sendHome(u);
}

function slowest(world, list) {
  let cruise = Infinity;
  let max = Infinity;
  for (const s of list) {
    const type = aircraftSpec(world, s.type);
    cruise = Math.min(cruise, type.cruiseKmh);
    max = Math.min(max, type.maxKmh);
  }
  return { cruiseKmh: cruise, maxKmh: max };
}

function updateAir(world, f) {
  let leader = leaderOf(world, f);
  // A leader lost, or going home short of fuel or ammunition: the next member flying leads.
  if (leader && (leader.state === 'lost' || (leader.state === 'returning' && (leader.returnReason === 'fuel' || leader.returnReason === 'ammo')))) {
    const next = membersOf(world, f).slice(1).find((s) => isFlying(s) && s.state !== 'returning');
    if (next) {
      setLeader(world, f, next.id);
      leader = next;
    }
  }
  for (const s of membersOf(world, f).slice(1)) {
    if (s.state === 'lost' || (s.state === 'returning' && (s.returnReason === 'fuel' || s.returnReason === 'ammo'))) {
      const reason = s.state === 'lost' ? 'lost' : s.returnReason;
      removeMember(world, f, s.id, true);
      emit(world, 'formationLeftBy', { formation: f.name, formationId: f.id, unit: s.name, unitId: s.id, reason });
    }
  }
  if (!world.formations.includes(f)) return;
  leader = leaderOf(world, f);
  if (!leader) return;
  if (leader.state === 'lost') {
    removeMember(world, f, leader.id, true);
    return;
  }
  const flying = membersOf(world, f).slice(1).filter((s) => s.follow === leader.id && (isFlying(s) || s.state === 'scrambling'));
  // Gathering: the leader circles until the members flying with it have joined.
  if (leader.holdForWing) {
    const joined = flying.every((s) => s.inFormation);
    if ((joined && flying.length) || (f.gatherUntil !== null && world.t >= f.gatherUntil) || !isFlying(leader)) {
      if (isFlying(leader)) {
        leader.holdForWing = false;
        f.gatherUntil = null;
        emit(world, 'formationGathered', { formation: f.name, formationId: f.id, n: flying.filter((s) => s.inFormation).length + 1, of: flying.length + 1 });
      }
    }
  }
  // The wing flies at the speed of its slowest squadron in formation.
  const together = flying.filter((s) => s.inFormation);
  leader.wingSlowest = together.length ? slowest(world, [leader, ...together]) : null;
  if (onMission(leader)) f.mission = missionOf(leader);
  else if (!isFlying(leader)) f.mission = null;
}

/** Is the leader sailing on its own orders (a route, legs or a course), not with a convoy? */
function sailingFree(e) {
  return e.state === 'atSea' && !e.joinTarget && !e.escorting && !e.homeward;
}

function updateNaval(world, f) {
  const members = membersOf(world, f);
  for (const e of members) {
    if (e.state === 'lost') removeMember(world, f, e.id, true);
  }
  if (!world.formations.includes(f)) return;
  // A rendezvous plan under way moves the groups itself (rally.js).
  if (f.rally && f.rally.phase !== 'plan' && f.rally.phase !== 'gone') return;
  const list = membersOf(world, f);
  const leader = list[0];
  const convoyId = leader.escorting || leader.joinTarget || leader.huntFor || null;
  list.slice(1).forEach((e, i) => {
    e.followSlot = i + 1;
    e.followEscort = null;
    // Busy on its own: a hunt goes on, a refit ends, a group already going home goes on.
    if (e.state === 'hunting' || e.state === 'refit' || e.state === 'lost' || e.homeward) return;
    const atSea = e.state === 'atSea' || e.state === 'escorting' || e.state === 'waiting';
    if (leader.homeward) {
      // The leader is going into port: the whole group goes in.
      if (atSea) sendEscortHome(world, e);
      return;
    }
    if (convoyId && leader.state !== 'inPort' && leader.state !== 'refit') {
      // With a convoy, or on the way to meet one: the same convoy for all.
      if (e.escorting === convoyId || e.joinTarget === convoyId) return;
      if (e.state === 'escorting') {
        e.state = 'atSea';
        e.escorting = null;
      }
      joinConvoy(world, e, convoyId);
      return;
    }
    if (sailingFree(leader)) {
      // The members sail in station astern of a leader on its own orders; one still in port
      // puts to sea by the channel that leads where the leader is going.
      if (e.state === 'escorting' || e.joinTarget) {
        if (e.state === 'escorting') e.leftConvoy = e.escorting;
        e.state = 'atSea';
        e.escorting = null;
        e.joinTarget = null;
      }
      const goal = leader.route.length ? leader.route[leader.route.length - 1] : [leader.x, leader.y];
      if (e.state === 'inPort') leavePort(world, e, goal[0], goal[1]);
      if (e.state === 'waiting') e.state = 'atSea';
      // Its own route (one it had before joining) gives way to the leader's; the channel out
      // of port is kept.
      if (e.state === 'atSea' && e.route.length > (e.routeLocked || 0)) {
        e.route = [];
        e.routeLocked = 0;
      }
      e.plan = [];
      e.legState = null;
      e.followEscort = e.state === 'atSea' ? leader.id : null;
    }
  });
  leader.followEscort = null;
  // The leader eases off while a member is still closing up.
  leader.waitForGroup = sailingFree(leader) && list.slice(1).some((e) => {
    if (e.followEscort !== leader.id || e.route.length) return false;
    return Math.hypot(e.x - leader.x, e.y - leader.y) > 2 * e.followSlot + 3;
  });
  // The shortest of them runs low: they all go home together.
  const low = list.some((e) => e.homeward && e.lowWarned);
  if (low && !f.homeward) {
    f.homeward = true;
    for (const e of list) {
      if (!e.homeward && (e.state === 'atSea' || e.state === 'escorting' || e.state === 'hunting' || e.state === 'waiting')) sendEscortHome(world, e);
    }
    emit(world, 'formationHomeward', { formation: f.name, formationId: f.id });
  }
  if (f.homeward && list.every((e) => e.state === 'inPort' || e.state === 'refit')) f.homeward = false;
}

/** Every few seconds: members dropping out, gathering, speed of the slowest, going home. */
export function updateFormations(world) {
  for (const f of [...world.formations]) {
    if (!world.formations.includes(f)) continue;
    if (f.kind === 'air') updateAir(world, f);
    else updateNaval(world, f);
  }
}
