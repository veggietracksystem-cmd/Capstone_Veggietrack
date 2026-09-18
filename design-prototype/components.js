/* ==========================================================================
   VeggieTrack Redesign Prototype — Reusable UI Component Helpers
   ========================================================================== */

function esc(str) { return String(str == null ? '' : str); }
function money(n) { return '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 0 }); }
function attrParams(params) { return params ? `data-params='${JSON.stringify(params).replace(/'/g, '&#39;')}'` : ''; }

function initials(name) {
  const clean = String(name || '').replace(/\(.*?\)/g, '').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map(p => p[0]).join('').toUpperCase();
}
function avatarColorClass(name) {
  const s = String(name || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h += s.charCodeAt(i);
  return 'avatar-c' + (h % 5);
}
function avatarInitials(name, opts) {
  opts = opts || {};
  return `<div class="avatar-initials ${opts.lg ? 'lg' : ''} ${avatarColorClass(name)}" ${opts.style ? `style="${opts.style}"` : ''}>${initials(name)}</div>`;
}

function topBar(title, opts) {
  opts = opts || {};
  const back = opts.back !== false;
  const right = opts.right || '';
  return `
  <div class="topbar ${opts.solid ? 'solid' : ''}">
    ${back ? `<button class="icon-btn" data-back>${ICON('chevronRight', 18, 'flip')}</button>` : `<span class="icon-btn spacer"></span>`}
    <div class="topbar-title">${esc(title)}</div>
    <div class="topbar-right">${right}</div>
  </div>`;
}

function bellIcon(role) {
  const list = NOTIFICATIONS[role] || [];
  const unread = list.some(n => n.unread);
  return `<button class="icon-btn" data-nav="${role}-notifications">${ICON('bell')}${unread ? '<span class="notif-dot"></span>' : ''}</button>`;
}
function messageIcon(role) {
  const list = MESSAGES[role] || [];
  const unread = list.some(c => c.unread);
  return `<button class="icon-btn" data-nav="${role}-messages">${ICON('message-circle')}${unread ? '<span class="notif-dot"></span>' : ''}</button>`;
}
/* Roles without a dedicated bottom-nav Messages tab get a chat icon next to
   the bell so messaging isn't buried inside Profile. Farmer already has a
   Messages tab, so we don't add a second entry point there. */
function topBarActions(role) {
  const hasMessagesTab = role === 'farmer';
  return `${hasMessagesTab ? '' : messageIcon(role)}${bellIcon(role)}`;
}

function row(opts) {
  const clickable = opts.nav || opts.action || opts.sheet;
  const attrs = [];
  if (opts.nav) attrs.push(`data-nav="${opts.nav}" ${attrParams(opts.params)}`);
  if (opts.sheet) attrs.push(`data-sheet="${opts.sheet}" ${attrParams(opts.params)}`);
  if (opts.action) attrs.push(`data-action="${opts.action}" ${attrParams(opts.params)}`);
  let leading = '';
  if (opts.photo) leading = `<div class="row-photo" style="background:${opts.photo.photo}"></div>`;
  else if (opts.avatarText) leading = avatarInitials(opts.avatarText);
  else if (opts.avatar) leading = `<div class="row-avatar">${opts.avatar}</div>`;
  else if (opts.icon) leading = `<div class="row-icon">${opts.icon}</div>`;
  return `
  <div class="row ${clickable ? 'row-tap' : ''}" ${attrs.join(' ')}>
    ${leading}
    <div class="row-body">
      <div class="row-title">${esc(opts.title)}</div>
      ${opts.subtitle ? `<div class="row-subtitle ${opts.muted ? 'muted' : ''}">${opts.subtitle}</div>` : ''}
    </div>
    <div class="row-trailing">${opts.trailing || ''}${clickable && opts.chevron !== false ? '<span class="chevron">›</span>' : ''}</div>
  </div>`;
}

function list(rowsHtml) {
  return `<div class="list">${rowsHtml.join('')}</div>`;
}

const STATUS_BADGE_MAP = {
  pending: ['amber', 'Pending'],
  approved: ['blue', 'Approved'],
  assigned: ['purple', 'Assigned'],
  otw: ['purple', 'OTW'],
  'out for delivery': ['purple', 'Out for Delivery'],
  picked_up: ['blue', 'Picked Up'],
  'picked up': ['blue', 'Picked Up'],
  completed: ['green', 'Completed'],
  delivered: ['green', 'Delivered'],
  cancelled: ['red', 'Cancelled'],
  available: ['green', 'Available'],
  reserved: ['amber', 'Reserved'],
  low: ['red', 'Low Stock'],
  out: ['red', 'Out of Stock'],
  active: ['green', 'Active'],
  preparing: ['amber', 'Preparing'],
  paid: ['green', 'Paid'],
};

function badge(key, labelOverride) {
  const entry = STATUS_BADGE_MAP[String(key).toLowerCase()] || ['gray', key];
  return `<span class="badge ${entry[0]}">${labelOverride || entry[1]}</span>`;
}

function pickupStageBadge(stage) {
  const label = PICKUP_STAGES[stage];
  const colorByStage = ['amber', 'blue', 'purple', 'purple', 'blue', 'green'];
  return `<span class="badge ${colorByStage[stage]}">${label}</span>`;
}

function orderStageBadge(stage) {
  const label = ORDER_STAGES[stage];
  const colorByStage = ['amber', 'amber', 'purple', 'purple', 'green', 'green'];
  return `<span class="badge ${colorByStage[stage]}">${label}</span>`;
}

function proposedTag(label) {
  return `<span class="proposed-tag">✦ ${label || 'Proposed'}</span>`;
}

function sectionHead(title, opts) {
  opts = opts || {};
  return `<div class="section-head"><h3 class="section-title">${esc(title)}</h3>${opts.link ? `<span class="section-link" data-nav="${opts.link}" ${attrParams(opts.linkParams)}>${opts.linkLabel || 'See all'}</span>` : ''}</div>`;
}

function emptyState(iconName, title, sub, cta) {
  return `<div class="empty-state">
    <div class="empty-emoji">${ICON(iconName, 34)}</div>
    <div class="empty-title">${esc(title)}</div>
    <div class="empty-sub">${esc(sub || '')}</div>
    ${cta || ''}
  </div>`;
}

function syncStatusPill(kind) {
  if (kind === 'offline') return `<div class="status-pill offline"><span class="dot"></span> You're offline · showing saved data</div>`;
  if (kind === 'syncing') return `<div class="status-pill syncing"><span class="dot"></span> Syncing 3 changes…</div>`;
  return '';
}

function timeline(steps) {
  return `<div class="timeline">${steps.map((s, i) => `
    <div class="tl-step ${s.state}">
      <div class="tl-marker">
        <div class="tl-dot">${s.state === 'done' ? '✓' : ''}</div>
        ${i < steps.length - 1 ? '<div class="tl-line"></div>' : ''}
      </div>
      <div class="tl-body">
        <div class="tl-title">${esc(s.title)}</div>
        ${s.sub ? `<div class="tl-sub">${s.sub}</div>` : ''}
      </div>
    </div>`).join('')}</div>`;
}

/* ---------------- Map widget ----------------
   Styled to match the real app's Leaflet/OpenStreetMap tracking screen:
   role-colored circular markers (hub=blue, shop=orange, rider=green with
   a live pulse, destination=purple), a two-tone route (planned + progress),
   a status bar above, and a distance/ETA row below. */

const MAP_MARKER_META = {
  hub: { color: '#31598a', label: 'H' },
  shop: { color: '#b8702b', label: 'S' },
  rider: { color: '#218258', label: 'R' },
  dest: { color: '#6654af', label: 'D' },
};

function mapMarkersAndRoute(markers) {
  const pts = markers.map(m => `${m.left},${m.top}`);
  let routeSvg = '';
  if (markers.length >= 2) {
    const full = `M ${markers[0].left} ${markers[0].top} Q ${(markers[0].left + markers[markers.length - 1].left) / 2} ${Math.min(markers[0].top, markers[markers.length - 1].top) - 12}, ${markers[markers.length - 1].left} ${markers[markers.length - 1].top}`;
    const midIdx = Math.max(0, markers.findIndex(m => m.type === 'rider'));
    const rider = markers[midIdx] || markers[0];
    const progress = `M ${markers[0].left} ${markers[0].top} Q ${(markers[0].left + rider.left) / 2} ${Math.min(markers[0].top, rider.top) - 8}, ${rider.left} ${rider.top}`;
    routeSvg = `
      <svg class="map-route-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path d="${full}" fill="none" stroke="#4a7295" stroke-width="1.6" opacity="0.65" vector-effect="non-scaling-stroke"/>
        <path d="${progress}" fill="none" stroke="#198656" stroke-width="1.6" opacity="0.95" vector-effect="non-scaling-stroke"/>
      </svg>`;
  }
  const markerHtml = markers.map(m => {
    const meta = MAP_MARKER_META[m.type];
    return `<div class="map-marker ${m.type}" style="top:${m.top}%; left:${m.left}%;" title="${m.label || ''}">${ICON(m.icon || 'pin', 13)}</div>`;
  }).join('');
  return `
    <div class="map-blob park" style="width:70px; height:50px; top:8%; left:6%;"></div>
    <div class="map-blob water" style="width:60px; height:40px; bottom:6%; right:8%;"></div>
    ${routeSvg}
    ${markerHtml}
  `;
}

function mapWidget(opts) {
  opts = opts || {};
  const markers = opts.markers || [
    { type: 'rider', top: 62, left: 22, icon: 'navigation' },
    { type: 'dest', top: 30, left: 76, icon: 'pin' },
  ];
  return `
  <div class="map-widget">
    <div class="map-status-bar">
      <span class="map-status-dot ${opts.statusState || 'live'}"></span>
      <span class="map-status-text"><b>${opts.statusLabel || 'Rider'}</b> · ${opts.statusSub || 'Live location'}</span>
      <span class="map-status-time">${opts.statusTime || 'Updated just now'}</span>
    </div>
    <div class="map-canvas ${opts.tall ? 'tall' : ''}">
      ${mapMarkersAndRoute(markers)}
      ${opts.expand !== false ? `<div class="map-expand-btn" data-nav="${opts.expandNav}" ${attrParams(opts.expandParams)}>${ICON('navigation', 12)} Full Map</div>` : ''}
    </div>
    <div class="map-metrics">
      <span>${ICON('pin', 13)} ${opts.distance || '—'} remaining</span>
      <span>${ICON('clock', 13)} ${opts.eta ? 'ETA ' + opts.eta : 'Calculating…'}</span>
    </div>
  </div>`;
}

function mapWidgetFull(opts) {
  opts = opts || {};
  const markers = opts.markers || [
    { type: 'rider', top: 55, left: 18, icon: 'navigation' },
    { type: 'dest', top: 28, left: 78, icon: 'pin' },
  ];
  return `
  <div class="map-widget flush">
    <div class="map-status-bar solid">
      <button class="map-floating-back" data-back style="position:static; box-shadow:none; background:transparent; width:24px; height:24px;">${ICON('chevronRight', 16, 'flip')}</button>
      <span class="map-status-dot ${opts.statusState || 'live'}"></span>
      <span class="map-status-text"><b>${opts.statusLabel || 'Rider'}</b> · ${opts.statusSub || 'Live location'}</span>
    </div>
    <div class="map-canvas full">
      ${mapMarkersAndRoute(markers)}
    </div>
    <div class="map-metrics">
      <span>${ICON('pin', 13)} ${opts.distance || '—'} remaining</span>
      <span>${ICON('clock', 13)} ${opts.eta ? 'ETA ' + opts.eta : 'Calculating…'}</span>
    </div>
    ${opts.card || ''}
  </div>`;
}

function statTile(label, value, unit) {
  return `<div class="tile"><div class="tile-label">${label}</div><div class="tile-value">${value}${unit ? ` <small>${unit}</small>` : ''}</div></div>`;
}

function segmented(segs, activeId, action) {
  return `<div class="segmented">${segs.map(s => `<div class="seg ${s.id === activeId ? 'active' : ''}" data-action="${action}" data-value="${s.id}">${s.label}</div>`).join('')}</div>`;
}

function fixedBottomBar(innerHtml, split) {
  return `<div class="fixed-bottom-bar ${split ? 'split' : ''}">${innerHtml}</div>`;
}

function formGroup(label, inputHtml, hint) {
  return `<div class="form-group"><label class="form-label">${label}</label>${inputHtml}${hint ? `<div class="form-hint">${hint}</div>` : ''}</div>`;
}

function quickActionGrid(actions) {
  return `<div class="quick-action-grid">${actions.map(a => `
    <div class="quick-action" data-nav="${a.nav}" ${attrParams(a.params)}>
      ${ICON(a.icon, 20)}
      <span>${a.label}</span>
    </div>`).join('')}</div>`;
}

/* ---------------- Photo components (distributor-uploaded batch photo) ---------------- */

function photoHero(v, opts) {
  opts = opts || {};
  return `
  <div class="photo-hero" style="background:${v.photo}"></div>
  <div class="photo-caption">${ICON('camera', 13)} ${opts.caption || `Photo uploaded by ${DISTRIBUTOR.name}`}</div>`;
}
function photoMissing(opts) {
  opts = opts || {};
  return `<div class="photo-missing">${ICON('camera', 26)}${opts.label || 'No photo yet'}</div>`;
}

function podScreenBody(opts) {
  return `
  ${topBar(opts.title, { back: true })}
  <div class="section tight">
    ${opts.hasPhoto === false ? photoMissing({ label: opts.photoLabel || 'Photo not captured yet' }) : `<div class="photo-hero" style="background:linear-gradient(135deg,#DDE7CD,#C9DAB6); display:flex; align-items:center; justify-content:center; color:var(--primary-dark);">${ICON('camera', 30)}</div>`}
    <div class="verify-row">${ICON('check-circle', 16)} Location Verified <span class="muted" style="font-weight:600;">· ${opts.distance || '8m from destination'}</span></div>
    <div class="card">
      <div class="row" style="padding:6px 0; border:none;"><div class="row-body"><div class="row-subtitle">Date</div><div class="row-title">${opts.date}</div></div></div>
      <div class="row" style="padding:6px 0; border:none;"><div class="row-body"><div class="row-subtitle">Time</div><div class="row-title">${opts.time}</div></div></div>
      ${opts.extraRows || ''}
    </div>
    <div class="helper-note">${opts.note || 'This confirms the handoff. A photo and GPS check are captured automatically.'}</div>
  </div>
  ${opts.viewOnly ? '' : fixedBottomBar(`<button class="btn btn-primary btn-block" data-action="submitPod" ${attrParams(opts.completeParams)}>${opts.buttonLabel || 'Submit Proof'}</button>`)}
  `;
}

function conversationListScreen(role, opts) {
  opts = opts || {};
  const convos = MESSAGES[role] || [];
  return `
  ${topBar('Messages', { back: opts.back !== false })}
  <div class="search-bar">${ICON('search', 15)} Search conversations</div>
  <div class="spacer-h"></div>
  <div class="section tight">
    ${convos.length ? list(convos.map(c => row({
        avatarText: c.name,
        title: c.name,
        subtitle: c.last,
        muted: c.unread === 0,
        trailing: `<div style="text-align:right;"><div style="font-size:11px; color:var(--text-faint); margin-bottom:4px;">${c.time}</div>${c.unread ? `<span class="unread-badge">${c.unread}</span>` : ''}</div>`,
        nav: role + '-chat',
        params: { id: c.id },
        chevron: false,
      }))) : emptyState('message-circle', 'No conversations yet', 'Messages with your contacts will appear here.')}
  </div>`;
}

function chatScreen(role, params) {
  const convo = (MESSAGES[role] || []).find(c => c.id === params.id) || (MESSAGES[role] || [])[0];
  const thread = CHAT_THREADS[params.id] || [];
  return `
  <div class="topbar solid">
    <button class="icon-btn" data-back>${ICON('chevronRight', 18, 'flip')}</button>
    <div class="chat-header" style="flex:1;">
      ${avatarInitials(convo ? convo.name : '?', { style: 'width:32px;height:32px;font-size:12px;' })}
      <div class="topbar-title" style="font-size:14.5px;">${convo ? convo.name : 'Conversation'}</div>
    </div>
  </div>
  <div style="padding: 12px 0 6px;">
    ${thread.map(m => `<div class="msg-row ${m.from === 'me' ? 'me' : 'them'}"><div><div class="msg-bubble">${m.text}</div><span class="msg-time">${m.time}</span></div></div>`).join('')}
  </div>
  <div class="chat-input-bar" style="position:sticky; bottom:0;">
    <input class="input" placeholder="Type a message…" id="chatInputField" />
    <button class="send-btn" data-action="sendMessage">${ICON('send', 15)}</button>
  </div>`;
}

function notificationsScreen(role) {
  const items = NOTIFICATIONS[role] || [];
  return `
  ${topBar('Notifications', { back: true })}
  <div class="section tight">
    ${items.length ? list(items.map(n => row({
        title: n.text,
        subtitle: n.time,
        muted: !n.unread,
        nav: n.nav,
        params: n.params,
        chevron: false,
        trailing: n.unread ? '<span class="dot" style="background:var(--red); width:8px; height:8px; border-radius:50%;"></span>' : '',
      }))) : emptyState('bell', 'You\'re all caught up', 'No new notifications right now.')}
  </div>`;
}

function profileScreen(role, personObj, opts) {
  opts = opts || {};
  return `
  ${topBar('Profile', { back: false })}
  <div class="profile-header">
    ${avatarInitials(personObj.name, { lg: true })}
    <div class="profile-name">${personObj.name}</div>
    <div class="profile-role">${personObj.role}${opts.subRole ? ' · ' + opts.subRole : ''}</div>
    <button class="btn btn-outline btn-sm" style="margin-top:12px;" data-nav="${role}-profile-edit">Edit Profile</button>
  </div>
  <div class="section tight">
    ${sectionHead('Account')}
    ${list([
      row({ icon: ICON('user'), title: 'Phone', subtitle: personObj.phone, chevron: false }),
      opts.addressLine ? row({ icon: ICON('pin'), title: opts.addressLabel || 'Address', subtitle: opts.addressLine, chevron: false }) : '',
    ].filter(Boolean))}
  </div>
  ${opts.extraLinks && opts.extraLinks.length ? `
  <div class="section tight">
    ${sectionHead('More')}
    ${list(opts.extraLinks.map(l => row({ icon: ICON(l.icon), title: l.title, nav: l.nav })))}
  </div>` : ''}
  <div class="section tight">
    ${sectionHead('Preferences')}
    ${list([
      row({ icon: ICON('sliders'), title: 'Language', subtitle: 'English', action: 'noop' }),
      row({ icon: ICON('help-circle'), title: 'Help & Support', action: 'noop' }),
      row({ icon: ICON('receipt'), title: 'Terms & Privacy', action: 'noop' }),
    ])}
  </div>
  <div class="section tight">
    ${list([
      row({ icon: ICON('log-out'), title: 'Log Out', action: 'logout' }),
      opts.hideDeactivate ? '' : row({ icon: ICON('alert-triangle'), title: 'Deactivate Account', action: 'noop' }),
    ].filter(Boolean))}
  </div>
  ${opts.hideDeactivate ? `<div class="helper-note" style="margin-top:-2px;">Distributor accounts are managed by VeggieTrack directly — self-service deactivation is not available for this role.</div>` : ''}
  `;
}

function editProfileScreen(role, personObj) {
  return `
  ${topBar('Edit Profile', { back: true })}
  <div class="section">
    <div class="text-center" style="margin-bottom:18px;">
      ${avatarInitials(personObj.name, { lg: true, style: 'margin:0 auto 8px;' })}
      <span class="section-link">Change Photo</span>
    </div>
    ${formGroup('Full Name', `<input class="input" value="${personObj.name}" />`)}
    ${formGroup('Phone Number', `<input class="input" value="${personObj.phone}" />`)}
    ${personObj.address ? formGroup('Address', `<textarea class="input" rows="2">${personObj.address}</textarea>`) : ''}
  </div>
  ${fixedBottomBar(`<button class="btn btn-primary btn-block" data-action="saveProfile">Save Changes</button>`)}
  `;
}
