// An automatic player for « Hiver dans l'Atlantique ». It escorts the convoys as a player
// would, from what the table shows, and counts what interrupts it.
//   node tools/bot/run.mjs hiver-atlantique '{"preset":"standard","behaviour":"hunt","seed":3}'
import {
  createInterruptions, createStepTimer, gameClock, makeWorld, noteInterruptions, orders as O, sim,
} from './game.mjs';

const { distance, project } = sim.geo;

export const SEA_DEFAULTS = {
  scenario: 'hiver-atlantique',
  preset: 'standard',
  seed: null,
  overrides: {},
  rules: null,
  withWorld: false, // the result carries the world too, for a closer look at a game
  idle: false, // give no order at all
  escort: true, // send escort groups
  groups: 1, // groups per convoy
  sendKm: 1800, // a group sails when the convoy is within this distance of an escort base
  behaviour: null, // stay | hunt (null: the group's own default)
  pattern: null, // full | light depth-charge patterns (null: the group's own default)
  rearm: false, // a group whose racks are empty is sent home, and another takes its place
  zigzag: false,
  buy: [], // aircraft bought: [{ id: 'hudson', day: 0 }]
  air: 'none', // none | cover: Coastal Command covers the nearest convoy by day
  airKm: 700,
  route: 'admiralty', // admiralty | north | south
  boost: false, // convoys at their best speed (stragglers)
  days: null,
};

const ROUTES = {
  north: [[-50.0, 48.5], [-40.0, 54.0], [-30.0, 58.0], [-20.0, 59.5], [-12.0, 58.0], [-8.3, 56.1]],
  south: [[-50.0, 44.5], [-40.0, 46.0], [-30.0, 47.0], [-20.0, 48.0], [-12.0, 49.5], [-7.2, 51.2]],
};

export function runSea(cfg = {}) {
  const c = { ...SEA_DEFAULTS, ...cfg };
  const w = makeWorld(c.scenario, { preset: c.preset, overrides: c.overrides, seed: c.seed, rules: c.rules });
  const tally = createInterruptions();
  const timer = createStepTimer();
  const step = timer.step;
  const log = [];
  const bought = new Set();
  const routed = new Set();
  const covering = new Map(); // squadron id → convoy id
  const escortPorts = [...new Set(w.escorts.map((e) => e.portId))].map((id) => w.byId.port.get(id));
  const endT = c.days ? c.days * 86400 : Infinity;

  // What the table shows of a ship (an estimate on the high seas under radio silence), and an
  // order sent by the way that reaches it (at once, by lamp, or by radio at the next relief).
  const shown = (u) => (sim.comms ? sim.comms.shownPosition(w, u) : u);
  const order = (u, name, direct, ...args) => (sim.comms ? sim.comms.sendOrder(w, u, name, ...args) : direct(w, u, ...args));

  function convoyOrders() {
    for (const cv of w.convoys) {
      if (cv.state !== 'atSea' || cv.straggler || routed.has(cv.id)) continue;
      routed.add(cv.id);
      if (c.route !== 'admiralty') {
        const res = order(cv, 'route', O.routeConvoy, ROUTES[c.route].map(([lon, lat]) => project(lon, lat)));
        if (!res.ok) log.push(`${gameClock(w)} route ${c.route} refused for ${cv.name}: ${res.reason || (res.result && res.result.reason)}`);
      }
      if (c.zigzag) order(cv, 'zigzag', O.setZigzag, true);
      if (c.boost) order(cv, 'boost', O.setShipBoost, true);
    }
  }

  function escortOrders() {
    for (const cv of w.convoys) {
      if (cv.state !== 'atSea' || cv.type === 'coastal' || cv.straggler) continue;
      let near = Infinity;
      const at = shown(cv);
      for (const p of escortPorts) near = Math.min(near, distance(at.x, at.y, p.x, p.y));
      if (near > c.sendKm) continue;
      let n = w.escorts.filter((e) => e.escorting === cv.id || e.joinTarget === cv.id || e.huntFor === cv.id).length;
      while (n < c.groups) {
        const free = w.escorts.filter((e) => e.state === 'inPort' && !e.dry)
          .sort((a, b) => distance(a.x, a.y, at.x, at.y) - distance(b.x, b.y, at.x, at.y))[0];
        if (!free) break;
        // In port: its standing orders are given by hand, the order to sail too.
        if (c.behaviour) order(free, 'behaviour', O.setEscortBehaviour, c.behaviour);
        if (c.pattern && O.setEscortPattern) order(free, 'pattern', O.setEscortPattern, c.pattern);
        const sent = order(free, 'join', O.joinConvoy, cv.id);
        if (!(sent === true || (sent && sent.ok))) break;
        n++;
      }
    }
  }

  // Coastal Command: by day, each ready squadron goes and covers the nearest convoy in reach.
  // Daylight where a squadron stands: the player sees the hour and the night's shadow on the map.
  const isDay = (x, y) => (sim.daylight ? sim.daylight.isDaylight(w, x, y) : !sim.naval.isNight(w));
  function airOrders() {
    for (const s of w.squadrons) {
      if (s.role !== 'coastal') continue;
      const field = w.byId.airfield.get(s.airfield);
      if (s.state === 'ready' && isDay(field.x, field.y)) {
        // The patrol flies to where the table shows the convoy; it covers it once in sight.
        const target = w.convoys
          .filter((cv) => cv.state === 'atSea' && !cv.straggler)
          .map((cv) => ({ cv, at: shown(cv) }))
          .filter((x) => distance(x.at.x, x.at.y, field.x, field.y) <= c.airKm)
          .sort((a, b) => distance(a.at.x, a.at.y, field.x, field.y) - distance(b.at.x, b.at.y, field.x, field.y))[0];
        if (target && O.scramble(w, s, { route: [[target.at.x, target.at.y, null]] })) covering.set(s.id, target.cv.id);
      } else if (s.state === 'airborne' && covering.has(s.id) && !s.cover) {
        const cv = w.convoys.find((x) => x.id === covering.get(s.id));
        const seen = cv && cv.state === 'atSea' && (sim.comms ? sim.comms.aircraftInSight(w, cv) === s || !shown(cv).est : distance(s.x, s.y, cv.x, cv.y) < 30);
        if (seen && distance(s.x, s.y, cv.x, cv.y) < 30) O.setCover(w, s, cv.id);
      } else if (s.state === 'ready') {
        covering.delete(s.id);
      }
    }
  }

  // A group whose racks are empty is sent home to rearm (the decision of the watch report).
  function rearmOrders() {
    for (const e of w.escorts) {
      if (e.charges > 0 || e.homeward || e.dry || !['atSea', 'escorting', 'waiting'].includes(e.state)) continue;
      order(e, 'home', O.escortHome, null);
    }
  }

  while (!w.ended && w.t < endT) {
    step(w, 1);
    if (w.events.length) {
      noteInterruptions(w, w.events, tally);
      for (const e of w.events) {
        if (e.type === 'shipsSunk') log.push(`${gameClock(w)} ${e.convoy} -${e.sunk} (${e.cause})`);
        else if (e.type === 'uboatSunk') log.push(`${gameClock(w)} U-boat sunk by ${e.by}`);
      }
      w.events.length = 0;
    }
    if (c.idle || w.t % 60 !== 0) continue;
    for (const b of c.buy) {
      if (!bought.has(b.id) && w.t >= b.day * 86400) {
        bought.add(b.id);
        if (!O.buyOffer(w, b.id)) log.push(`${gameClock(w)} could not buy ${b.id}`);
      }
    }
    convoyOrders();
    if (c.escort) escortOrders();
    if (c.rearm) rearmOrders();
    if (c.air === 'cover') airOrders();
  }
  if (c.returnWorld) return w;
  const losses = sim.objectives.shipLosses(w);
  return {
    ...(c.withWorld ? { world: w } : {}), // for a closer look at a game (not for the report)
    cfg: c,
    outcome: w.outcome,
    reason: w.defeatReason || null,
    days: +(w.t / 86400).toFixed(1),
    objectives: w.objectives.map((o) => ({ type: o.type, done: Boolean(o.done) })),
    sunk: losses.sunk,
    sailed: losses.sailed,
    lossPct: +(losses.share * 100).toFixed(1),
    fuel: Math.round(w.stats.unloaded.fuel),
    materiel: Math.round(w.stats.unloaded.materiel),
    dollarsLeft: Math.round(w.currency.stock),
    uboatsSunk: w.stats.uboatsSunk,
    convoysArrived: w.stats.convoysArrived,
    alerts: tally.alerts,
    totalAlerts: tally.total,
    stops: tally.stops,
    stopTimes: tally.times,
    steps: timer.result(),
    log,
  };
}
