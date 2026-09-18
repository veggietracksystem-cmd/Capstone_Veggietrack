/* ==========================================================================
   FARMER SCREENS — Proposed Design (Prototype Only)
   ========================================================================== */

const FarmerScreens = {

  'farmer-dashboard': {
    tab: 'home', back: false,
    render() {
      const activePickup = FARMER_PICKUPS.find(p => p.stage < 5);
      const week = FARMER_REPORTS.find(r => r.current);
      const recent = FARMER_HARVESTS.slice(0, 3);
      return `
      ${topBar('', { back: false, right: bellIcon('farmer') })}
      <div class="hero">
        <div class="hero-top">
          <div>
            <p class="greeting-eyebrow">Good morning</p>
            <h2 class="greeting-name">${FARMER.name}</h2>
          </div>
        </div>
      </div>
      ${syncStatusPill(State.connectivity)}

      ${activePickup ? `
      <div class="section tight">
        ${sectionHead('Active Pickup', { link: 'farmer-pickup-tracking', linkLabel: 'Track', linkParams: { id: activePickup.id } })}
        <div class="card" style="margin:0; cursor:pointer;" data-nav="farmer-pickup-tracking" ${attrParams({ id: activePickup.id })}>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <span style="font-weight:700; font-size:13.5px;">${veg(activePickup.vegId).name} · ${activePickup.qty}kg</span>
            ${pickupStageBadge(activePickup.stage)}
          </div>
          <div class="muted" style="font-size:12.5px;">${activePickup.rider ? `Rider ${activePickup.rider} · ETA ${activePickup.eta}` : 'Waiting for rider assignment'}</div>
        </div>
      </div>` : `<div class="section tight">${sectionHead('Active Pickup')}<div class="card" style="margin:0;"><div class="muted" style="font-size:12.5px;">No active pickups yet.</div></div></div>`}

      <div class="section tight">
        ${sectionHead('This Week', { link: 'farmer-reports-list', linkLabel: 'View Reports' })}
        <div class="tile-grid">
          ${statTile('Harvested', week.kg, 'kg')}
          ${statTile('Pickups', week.pickups, week.pickups === 1 ? 'trip' : 'trips')}
        </div>
      </div>

      <div class="section tight">
        <button class="btn btn-primary btn-block" data-nav="farmer-harvest-add">+ Add Harvest</button>
      </div>

      <div class="section tight">
        ${sectionHead('Recent Activity', { link: 'farmer-harvest-list', linkLabel: 'See all' })}
        ${list(recent.map(h => row({
          photo: veg(h.vegId),
          title: `${veg(h.vegId).name} · ${h.qty}kg`,
          subtitle: h.date,
          trailing: badge(h.status),
          nav: 'farmer-harvest-detail',
          params: { id: h.id },
        })))}
      </div>
      `;
    }
  },

  'farmer-harvest-list': {
    tab: 'harvest', back: false,
    render() {
      return `
      ${topBar('Harvest', { back: false, right: `<button class="icon-btn" data-nav="farmer-harvest-add">${ICON('plus')}</button>` })}
      <div class="section tight">
        ${list(FARMER_HARVESTS.map(h => row({
          photo: veg(h.vegId),
          title: `${veg(h.vegId).name} · ${h.qty}kg`,
          subtitle: `Harvested ${h.date}`,
          trailing: badge(h.status),
          nav: 'farmer-harvest-detail',
          params: { id: h.id },
        })))}
      </div>
      `;
    }
  },

  'farmer-harvest-add': {
    tab: 'harvest', back: true, immersive: true,
    render() {
      return `
      ${topBar('Add Harvest', { back: true })}
      <div class="section">
        ${formGroup('Vegetable', `<select class="select">${VEGGIES.map(v => `<option>${v.name}</option>`).join('')}</select>`)}
        ${formGroup('Quantity (kg)', `<input class="input" type="number" placeholder="e.g. 25" value="25" />`)}
        ${formGroup('Harvest Date', `<input class="input" type="text" value="Sep 18, 2026" />`)}
        ${formGroup('Status', `<select class="select"><option>Available</option><option>Reserved</option></select>`)}
        ${formGroup('Notes (optional)', `<textarea class="input" rows="2" placeholder="e.g. Grade A, sorted"></textarea>`)}
      </div>
      ${fixedBottomBar(`<button class="btn btn-primary btn-block" data-action="saveHarvest">Save Harvest</button>`)}
      `;
    }
  },

  'farmer-harvest-detail': {
    tab: 'harvest', back: true,
    render(params) {
      const h = FARMER_HARVESTS.find(x => x.id === params.id) || FARMER_HARVESTS[0];
      const v = veg(h.vegId);
      return `
      ${topBar('Harvest Details', { back: true, right: `<button class="icon-btn" data-action="editHarvest">${ICON('edit')}</button>` })}
      <div class="section tight">
        <div class="photo-hero" style="background:${v.photo}; margin-left:18px; margin-right:18px;"></div>
      </div>
      <div class="section tight text-center">
        <h2 style="margin:4px 0 2px;">${v.name}</h2>
        ${badge(h.status)}
      </div>
      <div class="section tight">
        ${list([
          row({ title: 'Quantity', trailing: `${h.qty} kg`, chevron: false }),
          row({ title: 'Harvest Date', trailing: h.date, chevron: false }),
          row({ title: 'Harvest ID', trailing: h.id, chevron: false }),
        ])}
      </div>
      <div class="section tight">
        <button class="btn btn-outline btn-block" data-action="editHarvest">Edit Details</button>
      </div>
      `;
    }
  },

  'farmer-pickup-list': {
    tab: 'pickup', back: false,
    render() {
      const active = FARMER_PICKUPS.filter(p => p.stage < 5);
      const done = FARMER_PICKUPS.filter(p => p.stage === 5);
      return `
      ${topBar('Pickup Requests', { back: false })}
      <div class="section tight">
        ${sectionHead('In Progress')}
        ${active.length ? list(active.map(p => row({
          photo: veg(p.vegId),
          title: `${veg(p.vegId).name} · ${p.qty}kg`,
          subtitle: p.schedule,
          trailing: pickupStageBadge(p.stage),
          nav: 'farmer-pickup-tracking',
          params: { id: p.id },
        }))) : emptyState('box', 'No active pickups yet', 'Requests you receive from the distributor will show up here.')}
      </div>
      <div class="section tight">
        ${sectionHead('Completed')}
        ${list(done.map(p => row({
          photo: veg(p.vegId),
          title: `${veg(p.vegId).name} · ${p.qty}kg`,
          subtitle: `Completed ${p.completedAt}`,
          trailing: pickupStageBadge(p.stage),
          nav: 'farmer-pickup-tracking',
          params: { id: p.id },
        })))}
      </div>
      `;
    }
  },

  'farmer-pickup-tracking': {
    tab: 'pickup', back: true,
    render(params) {
      const p = FARMER_PICKUPS.find(x => x.id === params.id) || FARMER_PICKUPS[0];
      const v = veg(p.vegId);
      const stepDefs = ['Pending', 'Approved', 'Rider Assigned', 'OTW', 'Picked Up', 'Completed'];
      const steps = stepDefs.map((title, i) => ({
        title,
        state: i < p.stage ? 'done' : i === p.stage ? 'active' : 'upcoming',
        sub: i === 0 ? p.schedule : (i === 2 && p.rider ? p.rider : (i === 3 && p.stage === 3 ? `ETA ${p.eta}` : '')),
      }));
      return `
      ${topBar('Pickup Tracking', { back: true })}
      <div class="section tight">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-size:12px; color:var(--text-muted); font-weight:600;">${p.id}</div>
            <div style="font-size:16px; font-weight:800; color:var(--primary-dark);">${v.name} · ${p.qty}kg</div>
          </div>
          ${pickupStageBadge(p.stage)}
        </div>
      </div>

      ${p.stage >= 2 ? mapWidget({
        statusLabel: p.rider, statusSub: p.stage === 3 ? 'Live GPS' : 'Assigned', statusState: p.stage === 3 ? 'live' : 'pending',
        distance: p.distance, eta: p.stage === 3 ? p.eta : null,
        markers: [{ type: 'rider', top: 62, left: 22, icon: 'navigation' }, { type: 'dest', top: 30, left: 76, icon: 'pin' }],
        expandNav: 'farmer-pickup-map', expandParams: { id: p.id },
      }) : `
      <div class="section tight"><div class="banner" style="cursor:default;"><div class="banner-icon">${ICON('clock', 20)}</div><div><div class="banner-title">Waiting for rider assignment</div><div class="banner-sub">Map will appear once a rider is assigned</div></div></div></div>`}

      ${p.stage === 3 ? `<div class="section tight"><div style="display:flex; align-items:center; gap:6px; margin-bottom:2px;">${proposedTag('Proposed status')}</div><div class="helper-note" style="margin:0;">"OTW" (On The Way) is a proposed live-tracking status. The current VeggieTrack backend may only track Pending / Completed — this shows the intended richer flow.</div></div>` : ''}

      <div class="section tight">
        ${sectionHead('Status')}
        <div class="card" style="margin:0;">${timeline(steps)}</div>
      </div>

      <div class="section tight">
        ${sectionHead('Details')}
        ${list([
          p.rider ? row({ avatarText: p.rider, title: 'Rider', trailing: p.rider, chevron: false }) : '',
          row({ title: 'Pickup Location', subtitle: p.address, chevron: false }),
          row({ title: 'Schedule', trailing: p.schedule, chevron: false }),
          p.distance ? row({ title: 'Distance', trailing: p.distance, chevron: false }) : '',
        ].filter(Boolean))}
      </div>

      ${p.stage === 5 ? `<div class="section tight"><button class="btn btn-outline btn-block" data-nav="farmer-pickup-pod" ${attrParams({ id: p.id })}>View Proof of Pickup</button></div>` : ''}
      `;
    }
  },

  'farmer-pickup-map': {
    tab: 'pickup', back: true, immersive: true, isMapScreen: true,
    render(params) {
      const p = FARMER_PICKUPS.find(x => x.id === params.id) || FARMER_PICKUPS[0];
      return mapWidgetFull({
        statusLabel: p.rider || 'Unassigned', statusSub: p.stage === 3 ? 'Live GPS' : 'Assigned', statusState: p.stage === 3 ? 'live' : 'pending',
        distance: p.distance, eta: p.eta,
        markers: [{ type: 'rider', top: 55, left: 18, icon: 'navigation' }, { type: 'dest', top: 28, left: 78, icon: 'pin' }],
        card: `<div class="map-floating-card" style="position:absolute; bottom:14px; left:14px; right:14px; background:var(--surface); border-radius:var(--radius-md); padding:14px; box-shadow:var(--shadow-md);">
          <div class="muted" style="font-size:12.5px;">${p.distance || ''} to ${p.address}</div>
        </div>`,
      });
    }
  },

  'farmer-pickup-pod': {
    tab: 'pickup', back: true, immersive: true,
    render(params) {
      const p = FARMER_PICKUPS.find(x => x.id === params.id) || FARMER_PICKUPS[0];
      const completedAt = p.completedAt || 'Sep 15, 2026 · 7:52 AM';
      const [date, time] = completedAt.split('·').map(s => s.trim());
      return podScreenBody({
        title: 'Proof of Pickup',
        date, time,
        distance: 'at farm gate',
        extraRows: `
          <div class="row" style="padding:6px 0; border:none;"><div class="row-body"><div class="row-subtitle">Vegetable</div><div class="row-title">${veg(p.vegId).name} · ${p.qty}kg</div></div></div>
          <div class="row" style="padding:6px 0; border:none;"><div class="row-body"><div class="row-subtitle">Rider</div><div class="row-title">${p.rider || '—'}</div></div></div>`,
        note: 'Captured by the rider upon collection — for your records only.',
        viewOnly: true,
      });
    }
  },

  'farmer-reports-list': {
    tab: 'home', back: true,
    render() {
      return `
      ${topBar('Weekly Reports', { back: true })}
      <div class="section tight">
        ${list(FARMER_REPORTS.map(r => row({
          title: r.range,
          subtitle: `${r.kg} kg harvested · ${r.pickups} pickup${r.pickups === 1 ? '' : 's'}`,
          trailing: r.current ? badge('pending', 'This Week') : '',
          nav: 'farmer-report-detail',
          params: { id: r.id },
        })))}
      </div>
      `;
    }
  },

  'farmer-report-detail': {
    tab: 'home', back: true,
    render(params) {
      const r = FARMER_REPORTS.find(x => x.id === params.id) || FARMER_REPORTS[0];
      const rows = FARMER_REPORT_ROWS[r.id] || [];
      return `
      ${topBar('Report Details', { back: true })}
      <div class="section tight">
        <div class="tile-grid">
          ${statTile('Total Harvested', r.kg, 'kg')}
          ${statTile('Pickups', r.pickups)}
        </div>
      </div>
      <div class="section tight">
        ${sectionHead('Breakdown')}
        ${rows.length ? rows.map(item => `
          <div class="card" style="margin:0 18px 10px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-weight:700; font-size:13.5px;">${item.veg} · ${item.qty} kg</span>
              ${badge('completed', item.status)}
            </div>
            <div class="muted" style="font-size:12px; margin-top:4px;">${item.date}</div>
            <div class="divider" style="margin:10px 0;"></div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; font-size:12px;">
              <div><div class="muted">Harvest Date</div><div style="font-weight:700;">${item.harvestDate}</div></div>
              <div><div class="muted">Pickup Date</div><div style="font-weight:700;">${item.pickupDate}</div></div>
              <div><div class="muted">Rider</div><div style="font-weight:700;">${item.rider}</div></div>
              <div><div class="muted">Distributor</div><div style="font-weight:700;">${item.distributor}</div></div>
            </div>
          </div>
        `).join('') : `<div class="section tight">${emptyState('receipt', 'No detailed rows for this week yet', 'This week is still in progress.')}</div>`}
      </div>
      `;
    }
  },

  'farmer-messages': { tab: 'messages', back: false, render: () => conversationListScreen('farmer', { back: false }) },
  'farmer-chat': { tab: 'messages', back: true, immersive: true, render: (p) => chatScreen('farmer', p) },
  'farmer-notifications': { tab: 'home', back: true, render: () => notificationsScreen('farmer') },

  'farmer-profile': {
    tab: 'profile', back: false,
    render: () => profileScreen('farmer', FARMER, { addressLabel: 'Farm Address', addressLine: FARMER.farm }),
  },
  'farmer-profile-edit': {
    tab: 'profile', back: true, immersive: true,
    render: () => editProfileScreen('farmer', { name: FARMER.name, phone: FARMER.phone, address: FARMER.farm }),
  },
};
