/* ==========================================================================
   VeggieTrack Redesign Prototype — Minimal Line-Icon Set
   Replaces ad-hoc emoji with a small, consistent SVG icon vocabulary.
   ========================================================================== */

const ICON_PATHS = {
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  'message-circle': '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
  leaf: '<path d="M12 21v-6.5"/><path d="M9 8c0 3.3 1.6 6.5 3 6.5s3-3.2 3-6.5c0-3.3-3-6-3-6s-3 2.7-3 6z"/><path d="M6 12.5c1.6 2 3.6 2.5 6 2"/>',
  truck: '<path d="M2.5 7h11v8h-11z"/><path d="M13.5 10h3.6l3 3v2h-6.6z"/><circle cx="7" cy="17" r="1.6"/><circle cx="17" cy="17" r="1.6"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/>',
  'bar-chart': '<line x1="6" y1="20" x2="6" y2="12"/><line x1="12" y1="20" x2="12" y2="6"/><line x1="18" y1="20" x2="18" y2="15"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h2l2.6 12.2a2 2 0 0 0 2 1.6h8.8a2 2 0 0 0 2-1.6L21 7H5.2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M2.3 21c0-3.6 3-6.2 6.7-6.2s6.7 2.6 6.7 6.2"/><circle cx="17.3" cy="9.2" r="2.5"/><path d="M15.8 15.1c2.5.6 4.3 2.5 4.7 5.9"/>',
  receipt: '<path d="M6 3h12v18l-2.5-1.6L13 21l-2.5-1.6L8 21l-2-1.6z"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="12" x2="15" y2="12"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><line x1="16" y1="3" x2="16" y2="7"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="3" y1="10" x2="21" y2="10"/>',
  'credit-card': '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>',
  camera: '<path d="M4 8h3l1.6-2h6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.4"/>',
  'alert-triangle': '<path d="M12 3 2 21h20L12 3z"/><line x1="12" y1="10" x2="12" y2="14"/><circle cx="12" cy="17.3" r="0.15"/>',
  sliders: '<line x1="4" y1="6" x2="20" y2="6"/><circle cx="9" cy="6" r="2"/><line x1="4" y1="12" x2="20" y2="12"/><circle cx="16" cy="12" r="2"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="10" cy="18" r="2"/>',
  'help-circle': '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.6 2.6 0 1 1 3.6 2.4c-.9.4-1.1.9-1.1 1.8"/><circle cx="12" cy="17" r="0.2"/>',
  'log-out': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  star: '<path d="M12 2.5l3 6.6 7 .9-5.1 5 1.2 7-6.1-3.4-6.1 3.4 1.2-7-5.1-5 7-.9z"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  building: '<rect x="4" y="3" width="16" height="18" rx="1"/><line x1="8" y1="7.5" x2="10" y2="7.5"/><line x1="14" y1="7.5" x2="16" y2="7.5"/><line x1="8" y1="12" x2="10" y2="12"/><line x1="14" y1="12" x2="16" y2="12"/><line x1="10" y1="21" x2="10" y2="16.5"/><line x1="14" y1="21" x2="14" y2="16.5"/>',
  navigation: '<path d="M12 2 4 20l8-4.5L20 20z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/>',
  download: '<path d="M12 3v13"/><polyline points="7 11 12 16 17 11"/><path d="M5 20h14"/>',
  printer: '<path d="M7 8V3h10v5"/><rect x="4" y="8" width="16" height="8" rx="1"/><path d="M7 16h10v5H7z"/>',
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="M8 12.3l2.5 2.5L16.2 9"/>',
  chevronRight: '<polyline points="9 6 15 12 9 18"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  minus: '<line x1="5" y1="12" x2="19" y2="12"/>',
  x: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
  pin: '<path d="M12 21s7-6.3 7-11.5A7 7 0 0 0 5 9.5C5 14.7 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.4"/>',
  send: '<line x1="21" y1="3" x2="10" y2="14"/><polygon points="21 3 14 21 10 14 3 10 21 3"/>',
};

function ICON(name, size, extraClass) {
  size = size || 18;
  const inner = ICON_PATHS[name];
  if (!inner) return '';
  return `<svg class="icon ${extraClass || ''}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}
