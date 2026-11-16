// Luftwaffe raids: they assemble over France, fly to their target (an installation, or a
// convoy at sea), bomb it and go home, unless the RAF breaks them up first.

import { FOOT_M, bearing, distance, headingVector, project } from './geo.js';
import { parseGameDate } from '../core/time.js';
import { emit } from './events.js';
import { damageSite, siteRules } from './sites.js';
import { attackConvoyFromAir } from './naval.js';
import { bombStocks } from './logistics.js';

/** "airfield:manston" → the installation, "convoy:cw" → the convoy. */
export function resolveTarget(world, ref) {
  const [kind, id] = ref.split(':');
  if (kind === 'convoy') return world.convoys.find((c) => c.id === id) || null;
  return world.sites.get(ref) || null;
}

export function createRaid(world, def) {
  const target = resolveTarget(world, def.target);
  if (!target) throw new Error(`raid ${def.id}: unknown target ${def.target}`);
  const [ox, oy] = project(def.origin.lon, def.origin.lat);
  return {
    kind: 'raid',
    id: def.id,
    label: def.label,
    phantom: false,
    departure: (parseGameDate(def.time) - world.startMs) / 1000,
    assembly: def.assemblyMin * 60,
    target: def.target,
    targetKind: def.target.split(':')[0],
    tx: target.x,
    ty: target.y,
    ox,
    oy,
    x: ox,
    y: oy,
    px: ox,
    py: oy,
    alt: def.altitudeFt * FOOT_M,
    speed: def.speedKmh / 3600, // km/s
    heading: bearing(ox, oy, target.x, target.y),
    bombers: def.bombers,
    bombersStart: def.bombers,
    bomberType: def.bomberType,
    escort: def.escort,
    escortStart: def.escort,
    escortType: def.escortType,
    phase: 'pending', // pending | assembling | inbound | bombing | outbound | done
    timer: 0,
    orbitAngle: 0,
    engagedBy: new Set(),
    intercepted: false,
    repelled: false,
    bombed: false,
    destroyed: false,
  };
}

/** A false radar echo: it can be plotted, but there is nothing to intercept. */
export function createPhantom(world, def) {
  const [ox, oy] = project(def.origin.lon, def.origin.lat);
  const [dx, dy] = headingVector(def.heading);
  const length = (def.speedKmh / 3600) * def.durationMin * 60;
  return {
    kind: 'raid',
    id: def.id,
    label: def.label,
    phantom: true,
    departure: (parseGameDate(def.time) - world.startMs) / 1000,
    assembly: 0,
    target: null,
    targetKind: null,
    tx: ox + dx * length,
    ty: oy + dy * length,
    ox,
    oy,
    x: ox,
    y: oy,
    px: ox,
    py: oy,
    alt: def.altitudeFt * FOOT_M,
    speed: def.speedKmh / 3600,
    heading: def.heading,
    bombers: def.aircraft,
    bombersStart: def.aircraft,
    bomberType: null,
    escort: 0,
    escortStart: 0,
    escortType: null,
    phase: 'pending',
    timer: 0,
    orbitAngle: 0,
    engagedBy: new Set(),
    intercepted: false,
    repelled: false,
    bombed: false,
    destroyed: false,
  };
}

export function isActive(r) {
  return r.phase === 'assembling' || r.phase === 'inbound' || r.phase === 'bombing' || r.phase === 'outbound';
}

export function raidStrength(r) {
  return r.bombers + r.escort;
}

function moveToward(r, tx, ty, dt, arrival) {
  const d = distance(r.x, r.y, tx, ty);
  r.heading = bearing(r.x, r.y, tx, ty);
  const stepKm = r.speed * dt;
  if (d <= Math.max(stepKm, arrival)) {
    r.x = tx;
    r.y = ty;
    return true;
  }
  r.x += ((tx - r.x) / d) * stepKm;
  r.y += ((ty - r.y) / d) * stepKm;
  return false;
}

/** A raid sent against a convoy follows it; it turns back when the convoy is in port. */
function trackMovingTarget(world, r) {
  if (r.targetKind !== 'convoy') return true;
  const c = resolveTarget(world, r.target);
  if (!c || c.state !== 'atSea') return false;
  r.tx = c.x;
  r.ty = c.y;
  return true;
}

export function updateRaid(world, r, dt) {
  r.px = r.x;
  r.py = r.y;
  const R = world.rules.raid;
  switch (r.phase) {
    case 'pending':
      if (world.t >= r.departure) {
        if (!r.phantom && !trackMovingTarget(world, r)) {
          r.phase = 'done'; // nothing to attack: the raid is cancelled
          return;
        }
        r.phase = r.phantom ? 'inbound' : 'assembling';
        r.timer = r.assembly;
      }
      return;
    case 'assembling': {
      const radius = R.assemblyRadiusKm;
      r.orbitAngle += (r.speed / radius) * dt;
      r.x = r.ox + radius * Math.sin(r.orbitAngle);
      r.y = r.oy + radius * Math.cos(r.orbitAngle);
      r.heading = ((r.orbitAngle * 180) / Math.PI + 90) % 360;
      r.timer -= dt;
      if (r.timer <= 0) r.phase = 'inbound';
      return;
    }
    case 'inbound':
      if (!r.phantom && !trackMovingTarget(world, r)) {
        r.phase = 'outbound';
        return;
      }
      if (moveToward(r, r.tx, r.ty, dt, R.arrivalKm)) {
        if (r.phantom) {
          r.phase = 'done';
        } else {
          r.phase = 'bombing';
          r.timer = R.bombingSeconds;
        }
      }
      return;
    case 'bombing':
      trackMovingTarget(world, r);
      r.x = r.tx;
      r.y = r.ty;
      r.timer -= dt;
      if (r.timer <= 0) {
        dropBombs(world, r);
        r.phase = 'outbound';
      }
      return;
    case 'outbound':
      if (moveToward(r, r.ox, r.oy, dt, R.arrivalKm)) r.phase = 'done';
      return;
    default:
  }
}

function bombAccuracy(world, r) {
  const type = world.rules.bombers[r.bomberType] || { accuracy: 1 };
  return world.rng.range(0.6, 1.0) * (r.engagedBy.size ? 0.7 : 1) * (type.accuracy ?? 1);
}

/** Aircraft caught on the ground of a bombed aerodrome. */
function groundLosses(world, field, added) {
  const k = world.rules.sites.airfield.groundLossPerDamage;
  for (const s of world.squadrons) {
    if (s.airfield !== field.id || s.aircraft <= 0) continue;
    if (s.state !== 'ready' && s.state !== 'refuelling' && s.state !== 'scrambling') continue;
    const p = Math.min(0.45, added * k) * (s.state === 'scrambling' ? 0.5 : 1);
    const lost = world.rng.binomial(s.aircraft, p);
    if (!lost) continue;
    s.aircraft -= lost;
    world.stats.rafLost += lost;
    world.stats.groundLosses += lost;
    emit(world, 'groundLosses', { squadron: s.name, squadronId: s.id, lost, airfield: field.name });
    if (s.aircraft <= 0) {
      s.state = 'lost';
      emit(world, 'squadronLost', { squadron: s.name, squadronId: s.id });
    }
  }
}

function dropBombs(world, r) {
  r.bombed = true;
  if (r.bombers <= 0) return;
  if (r.targetKind === 'convoy') {
    const c = resolveTarget(world, r.target);
    if (c) attackConvoyFromAir(world, c, r, bombAccuracy(world, r));
    world.stats.targetsHit++;
    return;
  }
  const site = resolveTarget(world, r.target);
  const points = r.bombers * bombAccuracy(world, r) * siteRules(world, site).damagePerBomber;
  const added = damageSite(world, site, points, r.label);
  world.stats.targetsHit++;
  bombStocks(world, site, added);
  if (site.kind === 'airfield') groundLosses(world, site, added);
}

/** The raid turns back. Bombs not yet dropped are jettisoned over the sea. */
export function abortRaid(world, r) {
  if (r.phase !== 'assembling' && r.phase !== 'inbound' && r.phase !== 'bombing') return;
  r.phase = 'outbound';
  if (!r.bombed) {
    r.repelled = true;
    world.stats.raidsRepelled++;
    emit(world, 'raidRepelled', { raid: r.label, raidId: r.id, x: r.x, y: r.y });
  }
}
