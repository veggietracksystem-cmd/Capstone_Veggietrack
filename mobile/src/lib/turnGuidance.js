// Turn-by-turn guidance from the road route the backend already returns
// (OSRM steps + route geometry). Pure and framework-free so it can be tested
// with plain node. Nothing here invents directions: every instruction comes
// from a real route step, and distances come from the rider's position
// projected onto the route line.
const { coordinate, routeProgress } = require('./trackingGeometry');

const PASSED_METERS = 12;      // a turn this close behind the rider counts as done
const ARRIVAL_METERS = 40;     // this close to the end of the route means arrived
const OFF_ROUTE_METERS = 100;  // further than this from the line means off route
const FAR_METERS = 400;        // beyond this, show "continue straight" first

function stepPoint(step) {
  const loc = step?.location;
  if (Array.isArray(loc)) return coordinate({ longitude: loc[0], latitude: loc[1] });
  return coordinate(loc);
}

function roadName(step) {
  if (step?.name) return String(step.name);
  const match = / onto (.+)$/.exec(step?.instruction || '');
  return match ? match[1] : null;
}

// One of a small fixed set, so the screen can pick an icon and wording for it.
function maneuverKind(step) {
  const type = step?.type, modifier = step?.modifier || '';
  if (type === 'arrive') return modifier === 'left' ? 'arrive-left' : modifier === 'right' ? 'arrive-right' : 'arrive';
  if (['roundabout', 'rotary', 'roundabout turn', 'exit roundabout', 'exit rotary'].includes(type)) return 'roundabout';
  if (type === 'merge') return 'merge';
  if (type === 'fork') return modifier.includes('left') ? 'fork-left' : modifier.includes('right') ? 'fork-right' : 'straight';
  if (modifier === 'uturn') return 'uturn';
  if (modifier === 'sharp left') return 'sharp-left';
  if (modifier === 'sharp right') return 'sharp-right';
  if (modifier === 'slight left') return 'slight-left';
  if (modifier === 'slight right') return 'slight-right';
  if (modifier === 'left') return 'turn-left';
  if (modifier === 'right') return 'turn-right';
  return 'straight';
}

function exitNumber(step) {
  const match = /exit (\d+)/i.exec(step?.instruction || '');
  return match ? Number(match[1]) : null;
}

// Rounds to something a driver can read at a glance: 50 m, 350 m, 1.2 km.
function distanceLabel(metres) {
  if (!Number.isFinite(metres) || metres < 0) return null;
  if (metres < 1000) return `${Math.max(10, Math.round(metres / 10) * 10)} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

/**
 * @param steps     route steps from the backend (type, modifier, location, distance, duration, instruction)
 * @param points    route geometry as [{latitude, longitude}] (see routePoints)
 * @param position  rider's current position
 * @returns {{status, ...}} status is one of: no-route, no-position, off-route, arrived, ok
 */
function guide({ steps, points, position }) {
  if (!Array.isArray(steps) || !steps.length || !Array.isArray(points) || points.length < 2) return { status: 'no-route' };
  const rider = coordinate(position);
  if (!rider) return { status: 'no-position' };
  const progress = routeProgress(points, rider);
  const remainingMeters = progress.remaining;
  if (progress.offRoute != null && progress.offRoute > OFF_ROUTE_METERS) return { status: 'off-route', remainingMeters: null, etaSeconds: null, offRouteMeters: progress.offRoute };

  // Where along the route each manoeuvre happens (never going backwards).
  let last = 0;
  const at = steps.map(step => {
    const p = stepPoint(step);
    const travelled = p ? routeProgress(points, p).travelled : last;
    last = Math.max(last, travelled);
    return last;
  });

  const isCandidate = (step, i) => steps.length === 1 || !(i === 0 && step.type === 'depart');
  let upcoming = steps.findIndex((step, i) => isCandidate(step, i) && at[i] - progress.travelled > PASSED_METERS);
  if (upcoming < 0) upcoming = steps.length - 1;
  const step = steps[upcoming];
  const turnDistance = Math.max(0, at[upcoming] - progress.travelled);
  const arrived = remainingMeters <= ARRIVAL_METERS;

  // Time left: the unfinished part of the current leg plus every leg after it,
  // using OSRM's own duration for each road segment.
  let etaSeconds = 0;
  const leg = upcoming > 0 ? steps[upcoming - 1] : null;
  if (leg && Number.isFinite(leg.duration)) {
    const share = leg.distance > 0 ? Math.min(1, turnDistance / leg.distance) : 1;
    etaSeconds += share * leg.duration;
  }
  for (let i = upcoming; i < steps.length; i++) etaSeconds += Number.isFinite(steps[i].duration) ? steps[i].duration : 0;
  if (arrived) etaSeconds = 0;

  return {
    status: arrived ? 'arrived' : 'ok',
    kind: maneuverKind(step), road: roadName(step), exit: exitNumber(step),
    turnDistance, far: turnDistance > FAR_METERS,
    remainingMeters, etaSeconds: Number.isFinite(etaSeconds) ? etaSeconds : null,
    stepIndex: upcoming, offRouteMeters: progress.offRoute,
    // The route line split at the rider so the part already driven can be greyed out.
    completed: progress.completed,
  };
}

module.exports = { guide, maneuverKind, distanceLabel, roadName, PASSED_METERS, ARRIVAL_METERS, OFF_ROUTE_METERS, FAR_METERS };
