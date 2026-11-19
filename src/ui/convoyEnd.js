// What a convoy does once it has nothing left to follow, as the sheet and the map say it:
// the choices of its sheet (« En fin de tracé »), what it does by itself when told nothing,
// and the way the map draws after the end of its line.

import { t } from '../core/i18n.js';
import { admiraltyWay, approachFor, channelWay, convoyEndChoices, editablePoints, routeChannel } from '../sim/convoy.js';
import { pendingOrders, shownPosition } from '../sim/comms.js';
import { planTrack } from '../sim/orders.js';
import { awaited } from './awaited.js';

/** "port:liverpool:Canal Saint-Georges", "hold": an end action as the value of a choice. */
export function endValue(a) {
  return [a.kind, a.id || (a.via ? '' : null), a.via || null].filter((x) => x !== null).join(':');
}

/** « Entrer à Liverpool par : Canal Saint-Georges », « Garder le cap »… */
export function convoyEndText(world, a) {
  if (a.kind === 'port') {
    const port = world.byId.port.get(a.id);
    return t(a.via ? 'orders.convoyEnd.portVia' : 'orders.convoyEnd.port', { port: port ? port.name : '', channel: a.via || '' });
  }
  return t(`orders.convoyEnd.${a.kind}`);
}

const same = (a, b) => Boolean(a && b) && endValue(a) === endValue(b);

/**
 * The end of what a convoy follows, for its sheet:
 *   { mode: 'port', port, channel } — only the channel is left (the pilot's work): nothing
 *     to choose any more;
 *   { mode: 'choose', after: 'route' | 'legs' | 'now', choices, current, auto, waiting } —
 *     a choice: at the end of its line, of its legs, or at once when it follows nothing.
 *     `current` is what it will do: what it was told, or what it does by itself (`auto`
 *     true: a line taken into port by the game, a stop, a course kept); `waiting`, an
 *     order on its way by radio.
 *   null — nothing to say (in port with nothing prepared, arrived, lost).
 */
export function convoyEnd(world, c) {
  if (c.kind !== 'convoy' || !['atSea', 'waiting', 'inPort'].includes(c.state)) return null;
  const wait = awaited(world, c);
  // What it will follow once the orders on their way have reached it: a line on its way,
  // legs on their way (they take the place of its route), or what it follows now.
  const legsToBe = Boolean(wait.legs && wait.legs.length);
  const line = wait.route ? wait.route.points.length > 0 : !legsToBe && c.route.length > 0;
  const legs = !line && (wait.legs ? legsToBe : c.plan.length > 0);
  if (c.state === 'inPort' && !line && !legs) return null;
  if (line && !wait.route && c.destination && c.route.length <= (c.routeLocked || 0)) {
    const port = world.byId.port.get(c.destination);
    return { mode: 'port', port: port ? port.name : '', channel: routeChannel(world, c) };
  }
  const after = line ? 'route' : legs ? 'legs' : 'now';
  const told = pendingOrders(world, c).filter((s) => s.name === 'endAction').pop();
  // What it does by itself, told nothing: a line that passes by the entrance of a channel is
  // taken into port, another ends in a stop; after its legs it keeps its course.
  let own = null;
  if (line && wait.route) {
    const at = shownPosition(world, c);
    const into = approachFor(world, c, [at.x, at.y], wait.route.points);
    own = into ? { kind: 'port', id: into.port.id, via: into.channel || null } : { kind: 'stop' };
  } else if (line) {
    own = c.destination ? { kind: 'port', id: c.destination, via: routeChannel(world, c) || null } : { kind: 'stop' };
  } else if (legs) {
    own = { kind: 'hold' };
  }
  const current = c.endAction || own;
  // With nothing to follow, what it is doing already is no order to give: stopped, it is not
  // told to stop; keeping its course, not to keep it.
  const doing = after === 'now' ? (c.state === 'waiting' ? 'stop' : 'hold') : null;
  const choices = convoyEndChoices(world, c).filter((a) => a.kind !== doing);
  // (A port without a charted channel, a channel the route has almost left: still shown.)
  if (current && !choices.some((a) => same(a, current))) choices.unshift({ ...current });
  return { mode: 'choose', after, choices, current, auto: !c.endAction, waiting: told ? told.args[0] : null };
}

// (The last way worked out for the map: asked at every frame for the convoy in hand.)
let wayMemo = { key: '', points: null };

/**
 * For the map: where the convoy in hand goes after the end of its line or of its legs, as
 * it was told — the way to the entrance of the channel and up it, or the Admiralty's route
 * from the nearest point ahead. { from, points, action, waiting } or null (told nothing: its
 * route says it all; or nothing to follow).
 */
export function endPreview(world, c) {
  const e = convoyEnd(world, c);
  if (!e || e.mode !== 'choose' || e.after === 'now') return null;
  const a = e.waiting || (e.auto ? null : e.current);
  if (!a) return null;
  const from = endPoint(world, c);
  if (!from || (a.kind !== 'port' && a.kind !== 'admiralty')) return { from, points: null, action: a, waiting: Boolean(e.waiting) };
  const key = `${c.id}:${endValue(a)}:${Math.round(from[0])}:${Math.round(from[1])}`;
  if (key !== wayMemo.key) {
    let points = null;
    if (a.kind === 'port') {
      const port = world.byId.port.get(a.id);
      const way = port ? channelWay(world, from, port, a.via || null) : null;
      points = way ? way.route : null;
    } else {
      points = admiraltyWay(world, c, from);
    }
    wayMemo = { key, points };
  }
  return { from, points: wayMemo.points, action: a, waiting: Boolean(e.waiting) };
}

/**
 * Where what the convoy follows ends: the last point of its line (the one on its way first;
 * of a route the game took into port, the last point of the line itself), or of its legs.
 */
function endPoint(world, c) {
  const wait = awaited(world, c);
  const legsToBe = Boolean(wait.legs && wait.legs.length);
  const line = wait.route ? wait.route.points : legsToBe ? [] : c.destination ? editablePoints(c) : c.route;
  if (line.length) return [line[line.length - 1][0], line[line.length - 1][1]];
  const legs = wait.legs || c.plan;
  if (!legs.length) return null;
  const track = planTrack(world, c, legs);
  const last = track[track.length - 1];
  return last.open ? null : [last.x, last.y];
}
