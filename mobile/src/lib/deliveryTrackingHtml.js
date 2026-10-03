import { MAP_ZOOM_CSS } from './mapZoomStyle';
// One persistent Leaflet document for WebView (Android/iOS) and iframe (web).
// The rider's pulse ring runs three times, not forever: an endless CSS animation
// repaints the WebView every frame, which is costly on Android phones.
// Data updates move layers in place, preserving zoom, tile cache, and open controls.
export function buildDeliveryTrackingHtml() {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta name="referrer" content="strict-origin-when-cross-origin">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="">
<style>
html,body,#map{height:100%;margin:0;background:#e8efe6;font-family:system-ui,sans-serif}
html,body{overflow:hidden;overscroll-behavior:none;touch-action:none}
${MAP_ZOOM_CSS}
.marker{background:transparent;border:0}.pin{position:relative;display:grid;place-items:center;width:38px;height:38px;border:3px solid white;border-radius:50%;background:#244d36;box-shadow:0 2px 8px #0005;font-size:23px}
.pin.rider{background:#218258}.pin.hub{background:#31598a}.pin.shop{background:#b8702b}.pin.viewer{background:#6654af}
.pin svg{width:19px;height:19px;fill:#fff;display:block}
.pin.pulse:before{content:'';position:absolute;inset:-9px;border:2px solid #218258;border-radius:50%;animation:radar 2s ease-out 3}
@keyframes radar{from{transform:scale(.7);opacity:.85}to{transform:scale(1.7);opacity:0}}
@media(prefers-reduced-motion:reduce){.pin.pulse:before{animation:none}}
.leaflet-popup-content{max-width:220px;white-space:pre-line;overflow-wrap:anywhere}.leaflet-control-attribution{font-size:10px}
#load-error{position:absolute;z-index:1000;top:14px;left:50px;right:14px;padding:12px;background:#fff3dd;color:#704b13;border-radius:8px;display:none}
</style></head><body><div id="map"></div><div id="load-error" role="alert"></div>
<script>
function post(data){data.channel='veggietrack-map';if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify(data));else window.parent.postMessage(data,'*');}
function fail(message){var el=document.getElementById('load-error');el.textContent=message;el.style.display='block';post({type:'error',message:message});}
</script>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin="" onerror="fail('The map could not load. Please check your internet connection and try again.')"></script>
<script>
if(window.L){
var map=L.map('map',{zoomControl:true,attributionControl:true}).setView([14.0683,121.3256],13);
var tiles=null,tileUrl=null,markers={},accuracy=null,route=null,progress=null,lastFit=0,lastToken=null,initialFit=false,riderFrame=null;
// Last drawn road line and greyed-out part; updates without a route keep them.
var routePts=[],routeStyle=null,doneKey=null,followKey=null;
// Rider navigation camera: 'overview' fits the whole route, 'follow' keeps the
// rider centred, 'free' leaves the camera wherever the rider moved it.
var navMode=false,camera='overview',cameraToken=null,commandToken=null,riderFitted=false,routeFitted=false,insetKey='';
function latLng(p){return [p.latitude,p.longitude];}
function valid(p){return p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude);}
function moveRider(marker,target){
 // Same fix again (poll or repeated GPS sample): leave the marker where it is or is going.
 if(marker._vtTarget&&marker._vtTarget[0]===target[0]&&marker._vtTarget[1]===target[1])return;
 marker._vtTarget=target;
 if(riderFrame)cancelAnimationFrame(riderFrame);
 var from=marker.getLatLng(),started=performance.now();
 if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){marker.setLatLng(target);if(accuracy)accuracy.setLatLng(target);return;}
 function tick(time){var part=Math.min(1,(time-started)/450);
  var next=[from.lat+(target[0]-from.lat)*part,from.lng+(target[1]-from.lng)*part];
  marker.setLatLng(next);if(accuracy)accuracy.setLatLng(next);
  riderFrame=part<1?requestAnimationFrame(tick):null;
 }riderFrame=requestAnimationFrame(tick);
}
// Monochrome glyphs (Material Symbols outlines, inlined so the map needs no
// extra download) keyed by marker type.
var GLYPHS={
 hub:'<svg viewBox="0 0 24 24"><path d="M3 21V7l6-4 6 4v2h6v12H3zm2-2h4v-3H5v3zm0-5h4v-3H5v3zm0-5h4V6H5v3zm6 10h4v-3h-4v3zm0-5h4v-3h-4v3zm0-5h4V6h-4v3zm6 10h4v-3h-4v3zm0-5h4v-3h-4v3z"/></svg>',
 shop:'<svg viewBox="0 0 24 24"><path d="M4 4h16l1.5 5a3 3 0 0 1-2.9 3.8A3 3 0 0 1 16 11a3 3 0 0 1-4 1.7A3 3 0 0 1 8 11a3 3 0 0 1-2.6 1.8A3 3 0 0 1 2.5 9L4 4zm1 9.9V20h14v-6.1a5 5 0 0 1-3-.6A5 5 0 0 1 12 14a5 5 0 0 1-4-.7 5 5 0 0 1-3 .6z"/></svg>',
 rider:'<svg viewBox="0 0 24 24"><path d="M19 17a3 3 0 1 1-2.8-3H13l-3-4H7.2A3 3 0 1 1 5 7h3.5l1.5 2h4V7h5v4h1l1 3h-1.3A3 3 0 0 1 19 17z"/></svg>',
 viewer:'<svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7zm0 9.5A2.5 2.5 0 1 0 12 6.5a2.5 2.5 0 0 0 0 5z"/></svg>',
 farm:'<svg viewBox="0 0 24 24"><path d="M12 2 2 8v14h7v-7h6v7h7V8L12 2zm-2 8h4v3h-4v-3z"/></svg>'
};
function popupText(text){var el=document.createElement('div');el.textContent=text;return el;}
// Markers are created once and then only moved. Their icon and popup are rebuilt
// only when they change: setIcon replaces the element, which would restart the
// rider's pulse ring on every update and look like endless loading.
function putMarker(key,p,glyphKey,title,details,pulse){
 var emoji=GLYPHS[glyphKey]||GLYPHS.viewer;
 if(!valid(p)){if(key==='rider'&&riderFrame){cancelAnimationFrame(riderFrame);riderFrame=null;}if(markers[key]){map.removeLayer(markers[key]);delete markers[key];}return;}
 var html='<div class="pin '+key+(pulse?' pulse':'')+'">'+emoji+'</div>',text=title+'\\n'+(details||''),m=markers[key];
 var icon=function(){return L.divIcon({className:'marker',html:html,iconSize:[44,44],iconAnchor:[22,22]});};
 if(!m){m=markers[key]=L.marker(latLng(p),{icon:icon(),title:title}).addTo(map);m._vtHtml=html;m._vtTarget=latLng(p);m._vtText=text;m.bindPopup(popupText(text));return;}
 if(m._vtHtml!==html){m.setIcon(icon());m._vtHtml=html;}
 if(key==='rider')moveRider(m,latLng(p));else m.setLatLng(latLng(p));
 if(m._vtText!==text){m._vtText=text;m.setPopupContent(popupText(text));}
}
function update(data){
 var cfg=data.tileConfig||{},url=cfg.url||'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
 if(url!==tileUrl){if(tiles)map.removeLayer(tiles);tileUrl=url;
  tiles=L.tileLayer(url,{maxZoom:19,keepBuffer:2,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'+(cfg.attribution?' · '+cfg.attribution:'')}).addTo(map);
  tiles.on('tileerror',function(){fail('The map could not load, but the delivery details below are still up to date.');});
  tiles.on('tileload',function(){document.getElementById('load-error').style.display='none';});
 }
 putMarker('hub',data.origin,'hub',data.origin.name,data.origin.address,false);
 putMarker('shop',data.destination,data.destination.glyph==='farm'?'farm':'shop',data.destination.name,[data.destination.address,data.destination.contact].filter(Boolean).join('\\n'),false);
 putMarker('rider',data.rider,'rider',data.rider.name||'Delivery rider',data.rider.label,data.rider.live);
 putMarker('viewer',data.viewer,'viewer','Your device',data.viewer?data.viewer.latitude.toFixed(5)+', '+data.viewer.longitude.toFixed(5):'',false);
 // GPS accuracy ring: resized in place; it follows the rider marker as it moves.
 var radius=valid(data.rider)&&Number.isFinite(data.rider.accuracy)&&data.rider.accuracy>0?data.rider.accuracy:null;
 if(radius==null){if(accuracy){map.removeLayer(accuracy);accuracy=null;}}
 else if(!accuracy)accuracy=L.circle(markers.rider?markers.rider.getLatLng():latLng(data.rider),{radius:radius,color:'#218258',weight:1,fillOpacity:.12}).addTo(map);
 else if(accuracy.getRadius()!==radius)accuracy.setRadius(radius);
 // Navigation mode: a bold green road line, with the part already driven greyed out.
 if(!route)route=L.polyline([],{color:'#4a7295',weight:6,opacity:.65}).addTo(map);
 if(!progress)progress=L.polyline([],{color:'#198656',weight:6}).addTo(map);
 var style=data.nav?'nav':'track';
 if(style!==routeStyle){routeStyle=style;
  route.setStyle(data.nav?{color:'#198656',weight:8,opacity:.95}:{color:'#4a7295',weight:6,opacity:.65});
  progress.setStyle(data.nav?{color:'#9aa79f',weight:8,opacity:.9}:{color:'#198656',weight:6});
 }
 // An update without a route means the line is unchanged (see mapPayload).
 var newRoute=data.route!==undefined;
 if(newRoute){routePts=(data.route||[]).map(latLng);route.setLatLngs(routePts);}
 var pts=routePts,mark=data.progress;
 // progress {index, point}: the driven part is the route up to index, then point.
 var key=mark===undefined?null:mark&&valid(mark.point)?mark.index+','+mark.point.latitude+','+mark.point.longitude:'';
 if(mark===undefined)progress.setLatLngs((data.completed||[]).map(latLng));
 else if(newRoute||key!==doneKey)progress.setLatLngs(key?pts.slice(0,mark.index).concat([latLng(mark.point)]):[]);
 doneKey=key;
 if(data.nav){navigationCamera(data,pts);return;}
 var bounds=(data.focusPoints||[data.origin,data.destination,data.rider]).filter(valid).map(latLng);
 var force=data.fitToken!==lastToken;lastToken=data.fitToken;
 if(bounds.length&&(force||!initialFit||(data.autoRecenter&&Date.now()-lastFit>1500))){map.fitBounds(L.latLngBounds(bounds),{padding:[38,38],maxZoom:16,animate:initialFit});initialFit=true;lastFit=Date.now();}
 if(data.viewer&&data.viewerToken!==window.viewerToken){window.viewerToken=data.viewerToken;map.panTo(latLng(data.viewer));}
}
// Screen overlays (instruction banner, map buttons, bottom panel) in CSS pixels.
function insetsOf(data){var i=data.insets||{};return{top:+i.top||0,right:+i.right||0,bottom:+i.bottom||0,left:+i.left||0};}
function setCamera(mode){if(camera!==mode){camera=mode;followKey=null;post({type:'camera',mode:mode});}}
// Centres a point in the part of the map that no overlay covers.
function centreOn(point,zoom,i,animate){
 var z=zoom==null?map.getZoom():zoom,shift=L.point((i.right-i.left)/2,(i.bottom-i.top)/2);
 map.setView(map.unproject(map.project(L.latLng(point),z).add(shift),z),z,{animate:animate,duration:.6});
}
function fitOverview(data,pts,i,animate){
 var points=pts.slice();[data.rider,data.origin,data.destination].forEach(function(p){if(valid(p))points.push(latLng(p));});
 if(!points.length)return;
 if(points.length===1){centreOn(points[0],16,i,animate);return;}
 map.fitBounds(L.latLngBounds(points),{paddingTopLeft:[i.left+28,i.top+28],paddingBottomRight:[i.right+28,i.bottom+28],maxZoom:17,animate:animate});
}
// True when the point sits behind an overlay or off screen.
function hidden(point,i){var c=map.latLngToContainerPoint(L.latLng(point)),size=map.getSize();return c.x<i.left||c.y<i.top||c.x>size.x-i.right||c.y>size.y-i.bottom;}
function anyHidden(data,i){return [data.rider,data.origin,data.destination].some(function(p){return valid(p)&&hidden(latLng(p),i);});}
function navigationCamera(data,pts){
 var i=insetsOf(data),animate=initialFit,key=[i.top,i.right,i.bottom,i.left].join(',');
 if(!navMode){navMode=true;if(map.zoomControl){map.removeControl(map.zoomControl);map.zoomControl=null;}}
 document.getElementById('load-error').style.top=(i.top+8)+'px';
 var request=data.camera||{},command=data.command||{};
 var forced=request.token!=null&&request.token!==cameraToken;cameraToken=request.token;
 if(forced&&request.mode)setCamera(request.mode);
 if(command.type&&command.token!==commandToken){commandToken=command.token;
  var step=command.type==='zoom-in'?1:command.type==='zoom-out'?-1:0,z=Math.max(map.getMinZoom?map.getMinZoom():0,Math.min(19,map.getZoom()+step));
  if(step){if(camera==='follow'&&valid(data.rider))centreOn(latLng(data.rider),z,i,true);else{setCamera('free');map.setZoom(z,{animate:true});}}
  return;
 }
 var insetsChanged=key!==insetKey;insetKey=key;
 var hasRider=valid(data.rider),hasTarget=valid(data.origin)||valid(data.destination);
 if(camera==='follow'){
  // Re-centre only when the rider moved, the overlays changed or Recenter was pressed.
  var next=hasRider?data.rider.latitude+','+data.rider.longitude+'|'+key:null;
  if(hasRider&&(forced||next!==followKey)){centreOn(latLng(data.rider),forced?(data.followZoom||17):null,i,animate);initialFit=true;followKey=next;}
 }else if(camera==='overview'){
  // Fit once the stop is known, again when the rider and then the road route
  // first appear, when a resized overlay now covers a marker, or when the rider
  // leaves the visible area. Otherwise the view stays put (banner text changing
  // height must not move the map).
  var refit=forced||!initialFit||(insetsChanged&&anyHidden(data,i))||(hasRider&&!riderFitted)||(pts.length>1&&!routeFitted)||(hasRider&&hidden(latLng(data.rider),i));
  if(refit&&(hasRider||hasTarget||pts.length)){fitOverview(data,pts,i,animate);initialFit=true;riderFitted=riderFitted||hasRider;routeFitted=routeFitted||pts.length>1;}
 }
}
// Any gesture by the rider stops automatic camera moves until Recenter or Route overview is pressed.
function userMoved(){if(navMode)setCamera('free');}
window.updateDeliveryMap=update;
window.addEventListener('message',function(event){if(event.source!==window.parent)return;var msg=event.data;if(msg&&msg.channel==='veggietrack-map'&&msg.type==='update')update(msg.data);});
map.on('dragstart',function(){post({type:'manual-pan'});userMoved();});
map.on('dblclick',userMoved);
var mapBox=document.getElementById('map');
if(mapBox&&mapBox.addEventListener){
 mapBox.addEventListener('touchstart',function(event){if(event.touches&&event.touches.length>1)userMoved();},{passive:true});
 mapBox.addEventListener('wheel',userMoved,{passive:true});
}
new ResizeObserver(function(){map.invalidateSize();}).observe(document.getElementById('map'));
map.attributionControl.addAttribution('<a href="https://project-osrm.org/" target="_blank" rel="noopener">OSRM routing</a> · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener">Fix the map</a>');
post({type:'ready'});
}
</script></body></html>`;
}
