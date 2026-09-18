/* ==========================================================================
   RIDER SCREENS — Proposed Design (Prototype Only)
   Pickup Task and Delivery Task share one reusable "Task Detail" pattern:
   Task → Details → Navigate → Update Status → POD → Complete
   ========================================================================== */

const TASK_STAGE_LABELS = {
  pickup: ['Assigned', 'Heading to Farmer', 'Arrived', 'Picked Up'],
  delivery: ['Assigned', 'Heading to Retailer', 'Arrived', 'Delivered'],
};
function taskTypeIcon(type) { return ICON(type === 'pickup' ? 'leaf' : 'box', 16); }

function riderTaskDetail(t) {
  const labels = TASK_STAGE_LABELS[t.type];
  const isPickup = t.type === 'pickup';
  const steps = labels.map((title, i) => ({
    title,
    state: i < t.stage ? 'done' : i === t.stage ? 'active' : 'upcoming',
  }));
  return `
  ${topBar(isPickup ? 'Pickup Task' : 'Delivery Task', { back: true })}
  <div class="section tight">
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <div>
        <div style="font-size:12px; color:var(--text-muted); font-weight:600;">${t.id}</div>
        <div style="font-size:16px; font-weight:800; color:var(--primary-dark); display:flex; align-items:center; gap:6px;">${taskTypeIcon(t.type)} ${t.veg}</div>
      </div>
      <span class="badge ${t.stage >= labels.length - 1 ? 'green' : 'purple'}">${labels[t.stage]}</span>
    </div>
  </div>

  ${mapWidget({
    statusLabel: RIDER.shortName, statusSub: t.stage > 0 ? 'Live GPS' : 'Assigned', statusState: t.stage > 0 ? 'live' : 'pending',
    distance: t.distance, eta: t.stage > 0 ? '10 min' : null,
    markers: [{ type: 'rider', top: 62, left: 22, icon: 'navigation' }, { type: isPickup ? 'dest' : 'shop', top: 30, left: 76, icon: 'pin' }],
    expandNav: isPickup ? 'rider-pickup-route' : 'rider-delivery-route', expandParams: { id: t.id },
  })}

  <div class="section tight">
    ${sectionHead('Details')}
    ${list([
      row({ avatarText: t.party, title: isPickup ? 'Farmer' : 'Retailer', trailing: t.party, chevron: false }),
      row({ title: 'Address', subtitle: t.address, chevron: false }),
      row({ title: 'Schedule', trailing: t.schedule, chevron: false }),
      row({ title: 'Distance', trailing: t.distance, chevron: false }),
    ])}
  </div>

  <div class="section tight">
    <div class="tile-grid">
      <button class="btn btn-secondary" data-nav="${isPickup ? 'rider-pickup-route' : 'rider-delivery-route'}" ${attrParams({ id: t.id })}>${ICON('navigation', 15)} Navigate</button>
      <button class="btn btn-secondary" data-nav="rider-chat" ${attrParams({ id: 'c2' })}>${ICON('message-circle', 15)} Contact</button>
    </div>
  </div>

  <div class="section tight">
    ${t.stage < labels.length - 1
      ? `<button class="btn btn-primary btn-block" data-action="advanceTaskStage" ${attrParams({ id: t.id })}>Update Status: ${labels[t.stage + 1]}</button>`
      : `<button class="btn btn-primary btn-block" data-nav="${isPickup ? 'rider-pickup-pod' : 'rider-delivery-pod'}" ${attrParams({ id: t.id })}>${isPickup ? 'Submit Proof of Pickup' : 'Submit Proof of Delivery'}</button>`}
  </div>
  `;
}

function riderTaskRoute(t) {
  const isPickup = t.type === 'pickup';
  return mapWidgetFull({
    statusLabel: RIDER.shortName, statusSub: 'Live GPS', statusState: 'live',
    distance: t.distance, eta: '10 min',
    markers: [{ type: 'rider', top: 55, left: 18, icon: 'navigation' }, { type: isPickup ? 'dest' : 'shop', top: 28, left: 78, icon: 'pin' }],
    card: `<div class="map-floating-card" style="position:absolute; bottom:14px; left:14px; right:14px; background:var(--surface); border-radius:var(--radius-md); padding:14px; box-shadow:var(--shadow-md);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <span style="font-weight:800; display:flex; align-items:center; gap:6px;">${taskTypeIcon(t.type)} ${t.party}</span>
      </div>
      <div class="muted" style="font-size:12.5px; margin-bottom:10px;">${t.distance} · ${t.address}</div>
      <button class="btn btn-primary btn-block btn-sm" data-nav="${isPickup ? 'rider-pickup-task' : 'rider-delivery-task'}" ${attrParams({ id: t.id })}>Back to Task</button>
    </div>`
  });
}

function riderPod(t, kind) {
  return podScreenBody({
    title: kind === 'pickup' ? 'Proof of Pickup' : 'Proof of Delivery',
    date: 'Sep 18, 2026',
    time: '10:32 AM',
    distance: kind === 'pickup' ? '6m from farm gate' : '8m from destination',
    extraRows: `<div class="row" style="padding:6px 0; border:none;"><div class="row-body"><div class="row-subtitle">${kind === 'pickup' ? 'Farmer' : 'Retailer'}</div><div class="row-title">${t.party}</div></div></div>
      <div class="row" style="padding:6px 0; border:none;"><div class="row-body"><div class="row-subtitle">Item</div><div class="row-title">${t.veg}</div></div></div>`,
    note: kind === 'pickup' ? 'Confirms produce collected from the farmer matches the request.' : 'Confirms the order was handed off to the retailer.',
    buttonLabel: 'Submit & Complete Task',
    completeParams: { id: t.id, kind },
  });
}

const RiderScreens = {

  'rider-dashboard': {
    tab: 'home', back: false,
    render() {
      const current = RIDER_TASKS.find(t => t.stage < 3) || RIDER_TASKS[0];
      const next = RIDER_TASKS.find(t => t.id !== current.id && t.stage < 3);
      const completedToday = RIDER_HISTORY.length;
      return `
      ${topBar('', { back: false, right: topBarActions('rider') })}
      <div class="hero">
        <div class="hero-top">
          <div>
            <p class="greeting-eyebrow">Today, Sep 18</p>
            <h2 class="greeting-name">${RIDER.shortName}</h2>
          </div>
        </div>
      </div>
      ${syncStatusPill(State.connectivity)}

      <div class="section tight">
        ${sectionHead('Current Task')}
        <div class="card" style="margin:0; cursor:pointer;" data-nav="${current.type === 'pickup' ? 'rider-pickup-task' : 'rider-delivery-task'}" ${attrParams({ id: current.id })}>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-weight:700; font-size:13.5px; display:flex; align-items:center; gap:6px;">${taskTypeIcon(current.type)} ${current.type === 'pickup' ? 'Pickup' : 'Delivery'} · ${current.party}</span>
            <span class="badge purple">${TASK_STAGE_LABELS[current.type][current.stage]}</span>
          </div>
          <div class="muted" style="font-size:12.5px;">${current.veg} · ${current.distance}</div>
        </div>
      </div>

      ${next ? `
      <div class="section tight">
        ${sectionHead('Next Up')}
        ${list([row({
          title: `${next.type === 'pickup' ? 'Pickup' : 'Delivery'} · ${next.party}`,
          subtitle: `${next.schedule} · ${next.distance}`,
          nav: next.type === 'pickup' ? 'rider-pickup-task' : 'rider-delivery-task',
          params: { id: next.id },
        })])}
      </div>` : ''}

      <div class="section tight">
        ${sectionHead("Today's Progress")}
        <div class="tile-grid">
          ${statTile('Completed', completedToday, 'tasks')}
          ${statTile('Remaining', RIDER_TASKS.filter(t => t.stage < 3).length, 'tasks')}
        </div>
      </div>

      <div class="section tight">
        <button class="btn btn-secondary btn-block" data-tab="tasks">${ICON('navigation', 15)} View All Tasks</button>
      </div>
      `;
    }
  },

  'rider-tasks': {
    tab: 'tasks', back: false,
    render() {
      const pickups = RIDER_TASKS.filter(t => t.type === 'pickup');
      const deliveries = RIDER_TASKS.filter(t => t.type === 'delivery');
      const taskRow = t => row({
        title: `${t.party}`,
        subtitle: `${t.veg} · ${t.schedule}`,
        trailing: `<span class="badge ${t.stage >= 3 ? 'green' : 'purple'}">${TASK_STAGE_LABELS[t.type][t.stage]}</span>`,
        nav: t.type === 'pickup' ? 'rider-pickup-task' : 'rider-delivery-task',
        params: { id: t.id },
      });
      return `
      ${topBar('Tasks', { back: false })}
      <div class="section tight">
        ${sectionHead('Pickups')}
        ${pickups.length ? list(pickups.map(taskRow)) : emptyState('leaf', 'No pickup tasks', '')}
      </div>
      <div class="section tight">
        ${sectionHead('Deliveries')}
        ${deliveries.length ? list(deliveries.map(taskRow)) : emptyState('box', 'No delivery tasks', '')}
      </div>
      `;
    }
  },

  'rider-pickup-task': { tab: 'tasks', back: true, render: (params) => riderTaskDetail(RIDER_TASKS.find(t => t.id === params.id) || RIDER_TASKS[0]) },
  'rider-pickup-details': { tab: 'tasks', back: true, render: (params) => riderTaskDetail(RIDER_TASKS.find(t => t.id === params.id) || RIDER_TASKS[0]) },
  'rider-pickup-route': { tab: 'tasks', back: true, immersive: true, isMapScreen: true, render: (params) => riderTaskRoute(RIDER_TASKS.find(t => t.id === params.id) || RIDER_TASKS[0]) },
  'rider-pickup-tracking': { tab: 'tasks', back: true, render: (params) => riderTaskDetail(RIDER_TASKS.find(t => t.id === params.id) || RIDER_TASKS[0]) },
  'rider-pickup-status': { tab: 'tasks', back: true, render: (params) => riderTaskDetail(RIDER_TASKS.find(t => t.id === params.id) || RIDER_TASKS[0]) },
  'rider-pickup-pod': { tab: 'tasks', back: true, immersive: true, render: (params) => riderPod(RIDER_TASKS.find(t => t.id === params.id) || RIDER_TASKS[0], 'pickup') },

  'rider-delivery-task': { tab: 'tasks', back: true, render: (params) => riderTaskDetail(RIDER_TASKS.find(t => t.id === params.id) || RIDER_TASKS[1]) },
  'rider-delivery-details': { tab: 'tasks', back: true, render: (params) => riderTaskDetail(RIDER_TASKS.find(t => t.id === params.id) || RIDER_TASKS[1]) },
  'rider-delivery-route': { tab: 'tasks', back: true, immersive: true, isMapScreen: true, render: (params) => riderTaskRoute(RIDER_TASKS.find(t => t.id === params.id) || RIDER_TASKS[1]) },
  'rider-delivery-tracking': { tab: 'tasks', back: true, render: (params) => riderTaskDetail(RIDER_TASKS.find(t => t.id === params.id) || RIDER_TASKS[1]) },
  'rider-eta': { tab: 'tasks', back: true, render: (params) => riderTaskDetail(RIDER_TASKS.find(t => t.id === params.id) || RIDER_TASKS[1]) },
  'rider-delivery-pod': { tab: 'tasks', back: true, immersive: true, render: (params) => riderPod(RIDER_TASKS.find(t => t.id === params.id) || RIDER_TASKS[1], 'delivery') },

  'rider-history': {
    tab: 'history', back: false,
    render() {
      return `
      ${topBar('History', { back: false })}
      <div class="section tight">
        ${list(RIDER_HISTORY.map(h => row({
          title: `${h.type === 'pickup' ? 'Pickup' : 'Delivery'} · ${h.party}`,
          subtitle: `${h.veg} · ${h.date}`,
          trailing: h.time,
          nav: 'rider-history-detail',
          params: { id: h.id },
        })))}
      </div>
      `;
    }
  },
  'rider-history-detail': {
    tab: 'history', back: true,
    render(params) {
      const h = RIDER_HISTORY.find(x => x.id === params.id) || RIDER_HISTORY[0];
      return `
      ${topBar('Task Details', { back: true })}
      <div class="section tight">
        ${list([
          row({ title: h.type === 'pickup' ? 'Pickup' : 'Delivery', trailing: badge('completed'), chevron: false }),
          row({ avatarText: h.party, title: h.type === 'pickup' ? 'Farmer' : 'Retailer', trailing: h.party, chevron: false }),
          row({ title: 'Item', trailing: h.veg, chevron: false }),
          row({ title: 'Completed', trailing: `${h.date} · ${h.time}`, chevron: false }),
        ])}
      </div>
      `;
    }
  },

  'rider-messages': { tab: 'profile', back: true, render: () => conversationListScreen('rider') },
  'rider-chat': { tab: 'profile', back: true, immersive: true, render: (p) => chatScreen('rider', p) },
  'rider-notifications': { tab: 'home', back: true, render: () => notificationsScreen('rider') },

  'rider-profile': {
    tab: 'profile', back: false,
    render: () => profileScreen('rider', { name: RIDER.name, role: RIDER.role, phone: RIDER.phone }, {
      subRole: RIDER.vehicle,
    }),
  },
  'rider-profile-edit': {
    tab: 'profile', back: true, immersive: true,
    render: () => editProfileScreen('rider', { name: RIDER.name, phone: RIDER.phone }),
  },
};
