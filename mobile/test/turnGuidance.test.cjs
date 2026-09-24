const test = require('node:test');
const assert = require('node:assert/strict');
const { guide, distanceLabel, maneuverKind } = require('../src/lib/turnGuidance');
const { routePoints } = require('../src/lib/trackingGeometry');

// ~1 degree of latitude is 111.2 km, so 0.001 deg is about 111 m.
// Route: north 1.0 km, turn right (east) 0.5 km, turn left (north) 0.3 km, arrive.
const lat0 = 14.0, lng0 = 121.0, dLat = 0.001, dLng = 0.001;
const path = [
  [lng0, lat0], [lng0, lat0 + 9 * dLat],                       // north ~1 km
  [lng0, lat0 + 9 * dLat], [lng0 + 5 * dLng, lat0 + 9 * dLat], // east ~0.54 km
  [lng0 + 5 * dLng, lat0 + 9 * dLat], [lng0 + 5 * dLng, lat0 + 12 * dLat], // north ~0.33 km
];
const geometry = { type: 'LineString', coordinates: path };
const points = routePoints(geometry);
const steps = [
  { type: 'depart', modifier: 'north', location: [lng0, lat0], distance: 1000, duration: 120, instruction: 'Head north onto Rizal Avenue' },
  { type: 'turn', modifier: 'right', location: [lng0, lat0 + 9 * dLat], distance: 540, duration: 80, instruction: 'Turn right onto Mabini Street' },
  { type: 'turn', modifier: 'left', location: [lng0 + 5 * dLng, lat0 + 9 * dLat], distance: 330, duration: 50, instruction: 'Turn left onto Luna Road' },
  { type: 'arrive', modifier: 'left', location: [lng0 + 5 * dLng, lat0 + 12 * dLat], distance: 0, duration: 0, instruction: 'Arrive at the retailer' },
];
const at = (latOff, lngOff = 0) => ({ latitude: lat0 + latOff, longitude: lng0 + lngOff });

test('at the start the next instruction is the first real turn, shown from far away', () => {
  const g = guide({ steps, points, position: at(0) });
  assert.equal(g.status, 'ok');
  assert.equal(g.kind, 'turn-right');
  assert.equal(g.road, 'Mabini Street');
  assert.equal(g.far, true);
  assert.ok(Math.abs(g.turnDistance - 1000) < 40, `turn distance ${g.turnDistance}`);
});

test('instruction and distance update as the rider moves', () => {
  const near = guide({ steps, points, position: at(8.5 * dLat) });
  assert.equal(near.kind, 'turn-right');
  assert.ok(near.turnDistance > 40 && near.turnDistance < 70, `turn distance ${near.turnDistance}`);
  assert.equal(near.far, false);
  // Past the first turn, the next instruction advances to the left turn.
  const after = guide({ steps, points, position: at(9 * dLat, 1 * dLng) });
  assert.equal(after.kind, 'turn-left');
  assert.equal(after.road, 'Luna Road');
});

test('remaining distance and ETA shrink along the route and use route durations', () => {
  const start = guide({ steps, points, position: at(0) });
  const mid = guide({ steps, points, position: at(9 * dLat, 2 * dLng) });
  assert.ok(start.remainingMeters > mid.remainingMeters);
  assert.ok(start.etaSeconds > mid.etaSeconds);
  assert.ok(Math.abs(start.etaSeconds - 250) < 15, `eta ${start.etaSeconds}`);
});

test('arrival is reported near the end and the destination side is kept', () => {
  const g = guide({ steps, points, position: at(11.9 * dLat, 5 * dLng) });
  assert.equal(g.status, 'arrived');
  assert.equal(g.kind, 'arrive-left');
  assert.equal(g.etaSeconds, 0);
});

test('leaving the route reports off-route with no ETA or distance', () => {
  const g = guide({ steps, points, position: at(4 * dLat, 3 * dLng) });
  assert.equal(g.status, 'off-route');
  assert.equal(g.etaSeconds, null);
  assert.equal(g.remainingMeters, null);
});

test('missing route or position never throws', () => {
  assert.equal(guide({ steps: [], points, position: at(0) }).status, 'no-route');
  assert.equal(guide({ steps, points: [], position: at(0) }).status, 'no-route');
  assert.equal(guide({ steps, points, position: null }).status, 'no-position');
  assert.equal(guide({ steps, points, position: { latitude: 'x', longitude: null } }).status, 'no-position');
  assert.equal(guide({}).status, 'no-route');
});

test('manoeuvre kinds and distance labels', () => {
  assert.equal(maneuverKind({ type: 'turn', modifier: 'slight left' }), 'slight-left');
  assert.equal(maneuverKind({ type: 'roundabout' }), 'roundabout');
  assert.equal(maneuverKind({ type: 'continue', modifier: 'straight' }), 'straight');
  assert.equal(maneuverKind({ type: 'turn', modifier: 'uturn' }), 'uturn');
  assert.equal(distanceLabel(47), '50 m');
  assert.equal(distanceLabel(3), '10 m');
  assert.equal(distanceLabel(1240), '1.2 km');
  assert.equal(distanceLabel(NaN), null);
});
