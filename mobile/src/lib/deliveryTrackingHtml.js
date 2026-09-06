// One persistent Leaflet document for WebView (Android/iOS) and iframe (web).
// Data updates move layers in place, preserving zoom, tile cache, and open controls.
export function buildDeliveryTrackingHtml() {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="strict-origin-when-cross-origin">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
html,body,#map{height:100%;margin:0;background:#e8efe6;font-family:system-ui,sans-serif}
.marker{background:transparent;border:0}.pin{position:relative;display:grid;place-items:center;width:38px;height:38px;border:3px solid white;border-radius:50%;background:#244d36;box-shadow:0 2px 8px #0005;font-size:23px}
.pin.rider{background:#218258}.pin.hub{background:#31598a}.pin.shop{background:#b8702b}.pin.viewer{background:#6654af}
.pin.pulse:before{content:'';position:absolute;inset:-9px;border:2px solid #218258;border-radius:50%;animation:radar 2s ease-out infinite}
@keyframes radar{from{transform:scale(.7);opacity:.85}to{transform:scale(1.7);opacity:0}}
@media(prefers-reduced-motion:reduce){.pin.pulse:before{animation:none}}
.leaflet-popup-content{max-width:220px;white-space:pre-line;overflow-wrap:anywhere}.leaflet-control-attribution{font-size:10px}
#load-error{position:absolute;z-index:1000;top:14px;left:50px;right:14px;padding:12px;background:#fff3dd;color:#704b13;border-radius:8px;display:none}
</style></head><body><div id="map"></div><div id="load-error" role="alert"></div>
<script>
function post(data){data.channel='veggietrack-map';if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify(data));else window.parent.postMessage(data,'*');}
function fail(message){var el=document.getElementById('load-error');el.textContent=message;el.style.display='block';post({type:'error',message:message});}
</script>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" onerror="fail('Map could not load. Check your connection and retry.')"></script>
<script>
if(window.L){
var map=L.map('map',{zoomControl:true,attributionControl:true}).setView([14.0683,121.3256],13);
var tiles=null,tileUrl=null,markers={},accuracy=null,route=null,progress=null,lastFit=0,lastToken=null,initialFit=false,riderFrame=null;
function latLng(p){return [p.latitude,p.longitude];}
function valid(p){return p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude);}
function moveRider(marker,target){
 if(riderFrame)cancelAnimationFrame(riderFrame);
 var from=marker.getLatLng(),started=performance.now();
 if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){marker.setLatLng(target);return;}
 function tick(time){var part=Math.min(1,(time-started)/450);
  var next=[from.lat+(target[0]-from.lat)*part,from.lng+(target[1]-from.lng)*part];
  marker.setLatLng(next);if(accuracy)accuracy.setLatLng(next);
  riderFrame=part<1?requestAnimationFrame(tick):null;
 }riderFrame=requestAnimationFrame(tick);
}
function putMarker(key,p,emoji,title,details,pulse){
 if(!valid(p)){if(key==='rider'&&riderFrame){cancelAnimationFrame(riderFrame);riderFrame=null;}if(markers[key]){map.removeLayer(markers[key]);delete markers[key];}return;}
 var icon=L.divIcon({className:'marker',html:'<div class="pin '+key+(pulse?' pulse':'')+'">'+emoji+'</div>',iconSize:[44,44],iconAnchor:[22,22]});
 if(!markers[key])markers[key]=L.marker(latLng(p),{icon:icon,title:title}).addTo(map);
 else {markers[key].setIcon(icon);if(key==='rider')moveRider(markers[key],latLng(p));else markers[key].setLatLng(latLng(p));}
 var text=document.createElement('div');text.textContent=title+'\\n'+(details||'');markers[key].bindPopup(text);
}
function update(data){
 var cfg=data.tileConfig||{},url=cfg.url||'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
 if(url!==tileUrl){if(tiles)map.removeLayer(tiles);tileUrl=url;
  tiles=L.tileLayer(url,{maxZoom:19,keepBuffer:2,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'+(cfg.attribution?' · '+cfg.attribution:'')}).addTo(map);
  tiles.on('tileerror',function(){fail('Map tiles unavailable. Tracking details remain available.');});
  tiles.on('tileload',function(){document.getElementById('load-error').style.display='none';});
 }
 putMarker('hub',data.origin,'🏢',data.origin.name,data.origin.address,false);
 putMarker('shop',data.destination,'🏪',data.destination.name,[data.destination.address,data.destination.contact].filter(Boolean).join('\\n'),false);
 putMarker('rider',data.rider,data.riderEmoji==='🚛'?'🚛':'🛵',data.rider.name||'Delivery rider',data.rider.label,data.rider.live);
 putMarker('viewer',data.viewer,'📍','Your device',data.viewer?data.viewer.latitude.toFixed(5)+', '+data.viewer.longitude.toFixed(5):'',false);
 if(accuracy){map.removeLayer(accuracy);accuracy=null;}
 if(valid(data.rider)&&Number.isFinite(data.rider.accuracy)&&data.rider.accuracy>0)accuracy=L.circle(latLng(data.rider),{radius:data.rider.accuracy,color:'#218258',weight:1,fillOpacity:.12}).addTo(map);
 var pts=(data.route||[]).map(latLng),done=(data.completed||[]).map(latLng);
 if(!route)route=L.polyline([],{color:'#4a7295',weight:6,opacity:.65}).addTo(map);route.setLatLngs(pts);
 if(!progress)progress=L.polyline([],{color:'#198656',weight:6}).addTo(map);progress.setLatLngs(done);
 var bounds=(data.focusPoints||[data.origin,data.destination,data.rider]).filter(valid).map(latLng);
 var force=data.fitToken!==lastToken;lastToken=data.fitToken;
 if(bounds.length&&(force||!initialFit||(data.autoRecenter&&Date.now()-lastFit>1500))){map.fitBounds(L.latLngBounds(bounds),{padding:[38,38],maxZoom:16,animate:initialFit});initialFit=true;lastFit=Date.now();}
 if(data.viewer&&data.viewerToken!==window.viewerToken){window.viewerToken=data.viewerToken;map.panTo(latLng(data.viewer));}
}
window.updateDeliveryMap=update;
window.addEventListener('message',function(event){if(event.source!==window.parent)return;var msg=event.data;if(msg&&msg.channel==='veggietrack-map'&&msg.type==='update')update(msg.data);});
map.on('dragstart',function(){post({type:'manual-pan'});});
new ResizeObserver(function(){map.invalidateSize();}).observe(document.getElementById('map'));
map.attributionControl.addAttribution('<a href="https://project-osrm.org/" target="_blank" rel="noopener">OSRM routing</a> · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener">Fix the map</a>');
post({type:'ready'});
}
</script></body></html>`;
}
