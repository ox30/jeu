// After-action reports, one per raid: every squadron that fought it and every one that
// missed it, the losses on both sides, what happened to the target and how it ended. They
// are built from the events of each step, and published once the raid has gone home.
// A report keeps the truth (for developer mode) and what the RAF knows: the first plot,
// the force once seen, the targets once bombed. The page shows only the latter.

import { emit } from './events.js';

function newReport(world, r) {
  return {
    raidId: r.id,
    label: r.label,
    phantom: r.phantom,
    target: r.target,
    bomberType: r.bomberType,
    escortType: r.escortType,
    bombersStart: r.bombersStart,
    escortStart: r.escortStart,
    detectedT: null,
    estimate: null, // first plot on the table: { count, approx, altFt }
    seen: null, // first time one of our units saw it: { t, by, bombers, bomberType, escort, escortType }
    startT: world.t,
    endT: null,
    squadrons: [], // { id, name, type, fights, bombersDown, fightersDown, losses, above, missed: [...] }
    hits: [], // { site, siteName, damage (total after the hit), added, kind }
    shipsSunk: 0,
    groundLosses: 0,
    outcome: null, // destroyed | repelled | bombed | unopposed | phantom | gone
    closed: false,
  };
}

function reportFor(world, raidId) {
  let rep = world.reports.get(raidId);
  if (!rep) {
    const r = world.raids.find((x) => x.id === raidId);
    if (!r) return null;
    rep = newReport(world, r);
    world.reports.set(raidId, rep);
  }
  return rep;
}

function squadronEntry(world, rep, squadronId) {
  let e = rep.squadrons.find((x) => x.id === squadronId);
  if (!e) {
    const s = world.squadrons.find((x) => x.id === squadronId);
    e = { id: squadronId, name: s ? s.name : squadronId, type: s ? s.type : '', fights: 0, bombersDown: 0, fightersDown: 0, losses: 0, above: false, missed: [] };
    rep.squadrons.push(e);
  }
  return e;
}

function raidIdByLabel(world, label) {
  const r = world.raids.find((x) => x.label === label);
  return r ? r.id : null;
}

/** Reads the events of the last step (from index `first`) into the reports. */
export function recordReports(world, first) {
  let lastBombing = null;
  for (let i = first; i < world.events.length; i++) {
    const e = world.events[i];
    switch (e.type) {
      case 'raidDetected': {
        const rep = reportFor(world, e.raidId);
        if (rep && rep.detectedT === null) {
          rep.detectedT = e.t;
          rep.estimate = { count: e.count, approx: e.approx, altFt: e.altFt };
        }
        break;
      }
      case 'raidSighted': {
        const rep = reportFor(world, e.raidId);
        if (rep && !rep.seen) {
          rep.seen = { t: e.t, by: e.by, bombers: e.bombers, bomberType: e.bomberType, escort: e.escort, escortType: e.escortType };
        }
        break;
      }
      case 'tallyHo': {
        const rep = reportFor(world, e.raidId);
        if (!rep) break;
        if (!rep.seen) {
          const r = world.raids.find((x) => x.id === e.raidId);
          if (r) rep.seen = { t: e.t, by: e.squadron, bombers: r.bombers, bomberType: r.bomberType, escort: r.escort, escortType: r.escortType };
        }
        const entry = squadronEntry(world, rep, e.squadronId);
        entry.fights++;
        if (e.above) entry.above = true;
        break;
      }
      case 'combatReport': {
        const rep = reportFor(world, e.raidId);
        if (!rep) break;
        const entry = squadronEntry(world, rep, e.squadronId);
        entry.bombersDown += e.bombersDown;
        entry.fightersDown += e.fightersDown;
        entry.losses += e.losses;
        break;
      }
      case 'missed': {
        const rep = reportFor(world, e.raidId);
        if (!rep) break;
        squadronEntry(world, rep, e.squadronId).missed.push({ problem: e.problem, km: e.km, dzM: e.dzM, guided: e.guided ?? null, t: e.t });
        break;
      }
      case 'nothingSeen': {
        const rep = reportFor(world, e.raidId);
        if (rep) squadronEntry(world, rep, e.squadronId).missed.push({ problem: 'nothing', km: 0, dzM: 0, guided: null, t: e.t });
        break;
      }
      case 'raidRepelled': {
        const rep = reportFor(world, e.raidId);
        if (rep && !rep.outcome) rep.outcome = 'repelled';
        break;
      }
      case 'raidDestroyed': {
        const rep = reportFor(world, e.raidId);
        if (rep) rep.outcome = 'destroyed';
        break;
      }
      case 'siteHit': {
        const raidId = raidIdByLabel(world, e.raid);
        const rep = raidId ? reportFor(world, raidId) : null;
        if (!rep) break;
        rep.hits.push({ site: e.site, siteName: e.siteName, kind: e.siteKind, damage: e.damage, severity: e.severity });
        lastBombing = rep;
        break;
      }
      case 'convoyBombed': {
        const raidId = raidIdByLabel(world, e.raid);
        const rep = raidId ? reportFor(world, raidId) : null;
        if (!rep) break;
        rep.shipsSunk += e.sunk;
        rep.hits.push({ convoy: e.convoyId, siteName: e.convoy, kind: 'convoy', sunk: e.sunk });
        lastBombing = rep;
        break;
      }
      case 'groundLosses':
        if (lastBombing) lastBombing.groundLosses += e.lost;
        break;
      default:
    }
  }
  if (world.t % 60 === 0) closeReports(world);
}

/** Total enemy aircraft shot down and RAF aircraft lost in a report. */
export function reportTotals(rep) {
  let down = 0;
  let bombers = 0;
  let fighters = 0;
  let lost = 0;
  for (const s of rep.squadrons) {
    bombers += s.bombersDown;
    fighters += s.fightersDown;
    lost += s.losses;
  }
  down = bombers + fighters;
  return { down, bombers, fighters, lost: lost + rep.groundLosses, airLost: lost };
}

/**
 * How the raid ended as the RAF sees it: a raid nobody saw and that dropped no bombs may
 * have gone home or been a false echo; a fighter sweep is one only if it was seen.
 */
export function knownOutcome(rep, exact = false) {
  if (!rep.closed) return 'ongoing';
  const unseen = !rep.seen && !exact;
  if (rep.outcome === 'phantom' || (unseen && (rep.outcome === 'sweep' || rep.outcome === 'gone'))) return 'unseen';
  return rep.outcome;
}

function closeReports(world) {
  for (const r of world.raids) {
    if (r.phase !== 'done') continue;
    const rep = world.reports.get(r.id);
    if (!rep || rep.closed) continue;
    rep.closed = true;
    rep.endT = world.t;
    if (r.phantom) rep.outcome = 'phantom';
    else if (r.bombersStart === 0 && rep.outcome !== 'destroyed') rep.outcome = 'sweep';
    else if (!rep.outcome) rep.outcome = rep.hits.length ? (rep.squadrons.some((s) => s.fights) ? 'bombed' : 'unopposed') : 'gone';
    const totals = reportTotals(rep);
    emit(world, 'raidReport', {
      raid: rep.label, raidId: rep.raidId, outcome: knownOutcome(rep, world.settings.detection === 'exact'), real: rep.outcome,
      down: totals.down, lost: totals.lost, squadrons: rep.squadrons.filter((s) => s.fights).length,
    });
  }
}
