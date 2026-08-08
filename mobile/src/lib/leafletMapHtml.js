// Builds self-contained Leaflet/OpenStreetMap HTML pages for react-native-webview.
//
// react-native-maps has no non-Google rendering engine on Android — even with
// an OSM UrlTile overlay, the underlying native MapView is still the Google
// Maps Android SDK and requires a Google Maps API key in AndroidManifest.xml.
// Without one configured (this project intentionally has none), mounting a
// MapView crashes the app immediately on a real device. Rendering the same
// OSM/Leaflet map used by the .web.js screens inside a WebView avoids the
// native Google Maps dependency entirely while keeping the map OSM-based.
const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const ICON_SETUP = `
  var defaultIcon = L.icon({
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
  });
`;

function page(bodyScript) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<link rel="stylesheet" href="${LEAFLET_CSS}" />
<style>html,body,#map{height:100%;margin:0;padding:0;background:#eef2ec;}</style>
</head>
<body>
<div id="map"></div>
<script src="${LEAFLET_JS}"></script>
<script>
function post(msg) {
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
}
window.onerror = function (msg) { post({ type: 'error', message: String(msg) }); return false; };
${bodyScript}
</script>
</body>
</html>`;
}

// Read-only display map (courier/destination markers + optional route line).
// Callers rebuild the HTML and remount (via a changing `key`) whenever the
// coordinates change — cheap, since this map has no user interaction to lose.
export function buildStaticMapHtml({ centerLat, centerLng, zoom = 14, markers = [], polyline = null, polylineColor = '#1E4E09' }) {
  const script = `
    var map = L.map('map', { attributionControl: true, zoomControl: true }).setView([${centerLat}, ${centerLng}], ${zoom});
    L.tileLayer('${TILE_URL}', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    ${markers.map((m) => `
    L.circleMarker([${m.lat}, ${m.lng}], { radius: 9, color: '#fff', weight: 2, fillColor: ${JSON.stringify(m.color || '#1E4E09')}, fillOpacity: 1 })
      .addTo(map)${m.popup ? `.bindPopup(${JSON.stringify(m.popup)})` : ''};
    `).join('\n')}
    ${polyline && polyline.length > 1 ? `
    L.polyline(${JSON.stringify(polyline.map((p) => [p.lat, p.lng]))}, { color: ${JSON.stringify(polylineColor)}, weight: 3 }).addTo(map);
    ` : ''}
    post({ type: 'ready' });
  `;
  return page(script);
}

// Interactive pin-placement map: draggable marker + tap-to-move. RN drives it
// via WebView.injectJavaScript() calling window.setPin()/window.flyTo(); the
// page reports pin moves back to RN via postMessage({ type: 'pinchange' }).
export function buildPinningMapHtml({ centerLat, centerLng, zoom = 15 }) {
  const script = `
    ${ICON_SETUP}
    var map = L.map('map', { attributionControl: true, zoomControl: true }).setView([${centerLat}, ${centerLng}], ${zoom});
    L.tileLayer('${TILE_URL}', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    var pin = L.marker([${centerLat}, ${centerLng}], { draggable: true, icon: defaultIcon }).addTo(map);
    pin.on('dragend', function () {
      var p = pin.getLatLng();
      post({ type: 'pinchange', latitude: p.lat, longitude: p.lng });
    });
    map.on('click', function (e) {
      pin.setLatLng(e.latlng);
      post({ type: 'pinchange', latitude: e.latlng.lat, longitude: e.latlng.lng });
    });
    window.setPin = function (lat, lng) { pin.setLatLng([lat, lng]); };
    window.flyTo = function (lat, lng, z) { map.setView([lat, lng], z || map.getZoom()); pin.setLatLng([lat, lng]); };
    post({ type: 'ready' });
  `;
  return page(script);
}
