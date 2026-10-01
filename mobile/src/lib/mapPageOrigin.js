import api from '../api/client';

// OpenStreetMap's tile servers answer tile requests that carry no Referer with
// an "Access blocked" image (tile usage policy). A WebView page built from an
// HTML string has no origin, so its tile requests carry no Referer. Native map
// WebViews therefore load their HTML with the app's own backend origin as the
// base URL, so tiles are requested with a Referer that names this app.
export const MAP_PAGE_BASE_URL = `${(String(api.baseUrl).match(/^https?:\/\/[^/?#]+/i) || ['https://localhost'])[0]}/`;

// The initial load of an HTML string with a base URL reports that URL; it must
// load in place instead of being opened in the external browser.
export function isMapPageLoad(url) {
  return url === MAP_PAGE_BASE_URL || /^(about|data):/i.test(String(url));
}
