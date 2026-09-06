// Pure geometry shared by the tracker and its regression checks. Distances are metres.
function coordinate(value) {
  if (!value || value.latitude == null || value.longitude == null ||
      value.latitude === '' || value.longitude === '') return null;
  const latitude = Number(value.latitude), longitude = Number(value.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { latitude, longitude } : null;
}
function distanceBetween(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad, dLng = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
function routePoints(geometry) {
  if (geometry?.type !== 'LineString' || !Array.isArray(geometry.coordinates)) return [];
  const points = geometry.coordinates.map(p => Array.isArray(p) ? coordinate({ longitude: p[0], latitude: p[1] }) : null);
  return points.every(Boolean) ? points : [];
}
function routeLength(points) {
  return points.slice(1).reduce((sum, p, i) => sum + distanceBetween(points[i], p), 0);
}
function positionAlong(points, metres) {
  if (!points.length) return null;
  let remaining = Math.max(0, metres);
  for (let i = 1; i < points.length; i++) {
    const length = distanceBetween(points[i - 1], points[i]);
    if (length > 0 && remaining <= length) {
      const t = remaining / length;
      return { latitude: points[i - 1].latitude + t * (points[i].latitude - points[i - 1].latitude),
        longitude: points[i - 1].longitude + t * (points[i].longitude - points[i - 1].longitude) };
    }
    remaining -= length;
  }
  return points[points.length - 1];
}
function routeProgress(points, rider) {
  const total = routeLength(points);
  if (points.length < 2 || !rider) return { total, travelled: 0, remaining: total, offRoute: null, completed: [] };
  let best = { distance: Infinity, travelled: 0, index: 0, point: points[0] }, accumulated = 0;
  const scale = Math.cos(rider.latitude * Math.PI / 180);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const x = (b.longitude - a.longitude) * scale, y = b.latitude - a.latitude;
    const px = (rider.longitude - a.longitude) * scale, py = rider.latitude - a.latitude;
    const t = x * x + y * y ? Math.max(0, Math.min(1, (px * x + py * y) / (x * x + y * y))) : 0;
    const point = { latitude: a.latitude + t * y, longitude: a.longitude + t * (b.longitude - a.longitude) };
    const segmentLength = distanceBetween(a, b), distance = distanceBetween(rider, point);
    if (distance < best.distance) best = { distance, travelled: accumulated + t * segmentLength, index: i, point };
    accumulated += segmentLength;
  }
  return { total, travelled: best.travelled, remaining: Math.max(0, total - best.travelled),
    offRoute: best.distance, completed: [...points.slice(0, best.index), best.point] };
}
// Escaping '<' prevents user-supplied addresses from terminating inline scripts.
function scriptJson(value) { return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'); }
module.exports = { coordinate, distanceBetween, routePoints, routeLength, positionAlong, routeProgress, scriptJson };
