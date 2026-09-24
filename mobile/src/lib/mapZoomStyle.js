// One look for the Leaflet + / - zoom buttons on every map in the app (pin picker,
// delivery route, live tracking; web and native web views). Dark-green icons on a
// white button with a green border, a light-green pressed state and 36px tap
// targets. Colors only - zoom behavior is Leaflet's own.
export const MAP_ZOOM_CSS = `
.leaflet-bar{border:1.5px solid #1E4E09 !important;border-radius:10px !important;box-shadow:0 1px 4px rgba(30,78,9,.25) !important;overflow:hidden}
.leaflet-bar a,.leaflet-bar a:visited{width:36px !important;height:36px !important;line-height:34px !important;background:#fff !important;color:#1E4E09 !important;font-weight:700;border-bottom:1px solid #C9DBBC !important}
.leaflet-bar a:last-child{border-bottom:0 !important}
.leaflet-bar a:hover,.leaflet-bar a:active,.leaflet-bar a:focus{background:#E7F0DD !important;color:#123005 !important}
.leaflet-bar a.leaflet-disabled{background:#F2F7ED !important;color:#9AA290 !important;cursor:default}
`;
