/* ==========================================================================
   DISTRIBUTOR SCREENS — Proposed Design (Prototype Only)
   Note: Distributor role has NO disable/deactivate account action (by design).
   ========================================================================== */

/* The real DistributorInventoryReportScreen renders a horizontally-scrollable
   table with these exact columns, split into Inventory/History segments and
   backed by Export PDF / Print actions. That structure is preserved here —
   only the surrounding chrome (status bar, colors, spacing) was restyled. */
const INVENTORY_COLUMNS = [
  { key: 'product', label: 'Product' },
  { key: 'qtyReceived', label: 'Qty Received', fmt: v => v + ' kg' },
  { key: 'qtySold', label: 'Qty Sold', fmt: v => v + ' kg' },
  { key: 'remaining', label: 'Remaining', fmt: v => v + ' kg' },
  { key: 'pricePerKg', label: 'Price/kg', fmt: v => money(v) },
  { key: 'totalAmount', label: 'Total Amount', fmt: v => money(v) },
  { key: 'farmer', label: 'Farmer' },
  { key: 'retailer', label: 'Retailer' },
  { key: 'pickupRider', label: 'Pickup Rider' },
  { key: 'deliveryRider', label: 'Delivery Rider' },
  { key: 'harvestDate', label: 'Harvest Date' },
  { key: 'pickupDate', label: 'Pickup Date' },
  { key: 'deliveryDate', label: 'Delivery Date' },
  { key: 'paymentStatus', label: 'Payment Status', fmt: v => badge(v) },
  { key: 'orderStatus', label: 'Order Status', fmt: v => badge(v) },
];

function inventoryReportTable(rows) {
  if (!rows.length) return emptyState('bar-chart', 'No records in this segment', 'Rows will appear here once activity happens.');
  return `
  <div class="table-scroll">
    <table class="report-table">
      <thead><tr>${INVENTORY_COLUMNS.map(c => `<th>${c.label}</th>`).join('')}</tr></thead>
      <tbody>
        ${rows.map(r => `<tr>${INVENTORY_COLUMNS.map(c => `<td>${c.fmt ? c.fmt(r[c.key]) : r[c.key]}</td>`).join('')}</tr>`).join('')}
      </tbody>
    </table>
  </div>
  <div class="table-scroll-hint">${ICON('navigation', 11)} Swipe to see more columns</div>`;
}

const DistributorScreens = {

  'distributor-dashboard': {
    tab: 'home', back: false,
    render() {
      const pendingPickups = DIST_PICKUPS.filter(p => p.stage === 0).length;
      const pendingOrders = DIST_ORDERS.filter(o => o.stage === 0).length;
      const lowStock = VEGGIES.filter(v => v.stock <= 10);
      return `
      ${topBar('', { back: false, right: topBarActions('distributor') })}
      <div class="hero">
        <div class="hero-top">
          <div>
            <p class="greeting-eyebrow">Welcome back</p>
            <h2 class="greeting-name">${DISTRIBUTOR.name}</h2>
          </div>
        </div>
      </div>
      ${syncStatusPill(State.connectivity)}

      <div class="section tight">
        <div class="tile-grid">
          <div class="tile" style="cursor:pointer;" data-nav="distributor-pickup-list">${`<div class="tile-label">Pending Pickups</div><div class="tile-value">${pendingPickups}</div>`}</div>
          <div class="tile" style="cursor:pointer;" data-nav="distributor-orders">${`<div class="tile-label">Pending Orders</div><div class="tile-value">${pendingOrders}</div>`}</div>
        </div>
      </div>

      ${lowStock.length ? `
      <div class="section tight">
        <div class="banner" data-nav="distributor-stocks" ${attrParams({ seg: 'products' })}>
          <div class="banner-icon">${ICON('alert-triangle', 20)}</div>
          <div><div class="banner-title">Low stock alert</div><div class="banner-sub">${lowStock.map(v => v.name).join(', ')} running low</div></div>
        </div>
      </div>` : ''}

      <div class="section tight">
        ${sectionHead('Quick Actions')}
        ${quickActionGrid([
          { icon: 'check-circle', label: 'Approve Pickups', nav: 'distributor-pickup-list' },
          { icon: 'credit-card', label: 'Update Pricing', nav: 'distributor-product-edit', params: { id: 'v1' } },
          { icon: 'users', label: 'Account Management', nav: 'distributor-account-mgmt' },
        ])}
      </div>

      <div class="section tight">
        ${sectionHead('Recent Activity', { link: 'distributor-inventory', linkLabel: 'View log' })}
        ${list(DIST_INVENTORY_LOG.slice(0, 3).map(l => row({
          title: `${l.veg} ${l.change}`,
          subtitle: `${l.reason} · ${l.date}`,
          chevron: false,
        })))}
      </div>
      `;
    }
  },

  /* ---- Pickups ---- */
  'distributor-pickup-list': {
    tab: 'home', back: true,
    render() {
      return `
      ${topBar('Pickup Requests', { back: true })}
      <div class="section tight">
        ${list(DIST_PICKUPS.map(p => row({
          photo: veg(p.vegId),
          title: `${p.farmer} · ${veg(p.vegId).name} ${p.qty}kg`,
          subtitle: p.schedule,
          trailing: pickupStageBadge(p.stage),
          nav: 'distributor-pickup-detail',
          params: { id: p.id },
        })))}
      </div>
      `;
    }
  },
  'distributor-pickup-detail': {
    tab: 'home', back: true,
    render(params) {
      const p = DIST_PICKUPS.find(x => x.id === params.id) || DIST_PICKUPS[0];
      const v = veg(p.vegId);
      return `
      ${topBar('Pickup Details', { back: true })}
      <div class="section tight">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="font-size:16px; font-weight:800; color:var(--primary-dark);">${v.name} · ${p.qty}kg</div>
          ${pickupStageBadge(p.stage)}
        </div>
      </div>
      <div class="section tight">
        ${list([
          row({ avatarText: p.farmer, title: 'Farmer', trailing: p.farmer, chevron: false }),
          row({ title: 'Schedule', trailing: p.schedule, chevron: false }),
          p.rider ? row({ avatarText: p.rider, title: 'Rider', trailing: p.rider, chevron: false }) : '',
        ].filter(Boolean))}
      </div>
      <div class="section tight">
        ${p.stage === 0 ? `<button class="btn btn-primary btn-block" data-action="approvePickup" ${attrParams({ id: p.id })}>Approve Pickup</button>` : ''}
        ${p.stage === 1 ? `<button class="btn btn-primary btn-block" data-sheet="distributor-rider-assign" ${attrParams({ kind: 'pickup', id: p.id })}>Assign Rider</button>` : ''}
        ${p.stage >= 2 ? `<button class="btn btn-outline btn-block">Track (see Farmer/Rider tracking view)</button>` : ''}
      </div>
      `;
    }
  },
  'distributor-rider-assign': {
    tab: 'home', back: true, isSheetLike: true,
    render(params) {
      return `
      ${topBar('Assign Rider', { back: true })}
      <div class="section tight">
        ${list(RIDERS.map(r => row({
          avatarText: r.name,
          title: r.name,
          subtitle: `${r.status} · ${r.tasks} active task${r.tasks === 1 ? '' : 's'}`,
          trailing: `<button class="btn btn-primary btn-sm" data-action="confirmAssignRider" ${attrParams({ rider: r.name, kind: params.kind, id: params.id })}>Assign</button>`,
          chevron: false,
        })))}
      </div>
      `;
    }
  },

  /* ---- Stocks (Batches / Products) ---- */
  'distributor-stocks': {
    tab: 'stocks', back: false,
    render(params) {
      const seg = (params && params.seg) || 'batches';
      return `
      ${topBar('Stocks', { back: false })}
      <div class="helper-note" style="margin-top:0;">Batches = physical stock received from farmers. Products = catalog &amp; pricing shown to retailers.</div>
      ${segmented([{ id: 'batches', label: 'Batches' }, { id: 'products', label: 'Products' }], seg, 'switchStocksSeg')}
      <div class="section tight" id="stocksSegBody">
        ${seg === 'batches' ? list(DIST_BATCHES.map(b => row({
          photo: veg(b.vegId),
          title: `${veg(b.vegId).name} · ${b.qty}kg`,
          subtitle: `From ${b.farmer} · ${b.received}`,
          trailing: b.hasPhoto ? badge('completed', 'Photo ✓') : badge('pending', 'No Photo'),
          nav: 'distributor-batch-detail',
          params: { id: b.id },
        }))) : list(VEGGIES.map(v => row({
          photo: v,
          title: v.name,
          subtitle: `${money(v.sellPrice)}/kg · ${v.stock}kg in stock`,
          trailing: v.stock === 0 ? badge('out') : v.stock <= 10 ? badge('low') : badge('active'),
          nav: 'distributor-product-edit',
          params: { id: v.id },
        })))}
      </div>
      `;
    }
  },
  'distributor-batch-detail': {
    tab: 'stocks', back: true,
    render(params) {
      const b = DIST_BATCHES.find(x => x.id === params.id) || DIST_BATCHES[0];
      const v = veg(b.vegId);
      return `
      ${topBar('Batch Details', { back: true })}
      <div class="section tight">
        ${b.hasPhoto ? photoHero(v, { caption: `Photo you uploaded · ${b.received}` }) : photoMissing({ label: 'No batch photo yet' })}
      </div>
      <div class="section tight">
        ${list([
          row({ title: v.name, trailing: `${b.qty} kg`, chevron: false }),
          row({ avatarText: b.farmer, title: 'Farmer', trailing: b.farmer, chevron: false }),
          row({ title: 'Received', trailing: b.received, chevron: false }),
          row({ title: 'Batch ID', trailing: b.id, chevron: false }),
        ])}
      </div>
      <div class="section tight">
        <button class="btn ${b.hasPhoto ? 'btn-outline' : 'btn-primary'} btn-block" data-nav="distributor-batch-photo" ${attrParams({ id: b.id })}>${b.hasPhoto ? 'View Batch Photo' : 'Add Batch Photo'}</button>
      </div>
      `;
    }
  },
  'distributor-batch-photo': {
    tab: 'stocks', back: true, immersive: true,
    render(params) {
      const b = DIST_BATCHES.find(x => x.id === params.id) || DIST_BATCHES[0];
      const v = veg(b.vegId);
      return `
      ${topBar('Batch Photo', { back: true })}
      <div class="section tight">
        ${b.hasPhoto ? photoHero(v, { caption: 'Current photo on file' }) : photoMissing({ label: 'No photo yet' })}
        <div class="helper-note">This is the exact photo retailers will see on this vegetable's product card and details in their menu — confirm it clearly shows condition and quantity received from ${b.farmer}.</div>
      </div>
      ${fixedBottomBar(`<button class="btn btn-primary btn-block" data-action="uploadBatchPhoto">${b.hasPhoto ? 'Replace Photo' : 'Capture Photo'}</button>`)}
      `;
    }
  },
  'distributor-product-edit': {
    tab: 'stocks', back: true, immersive: true,
    render(params) {
      const v = veg(params.id) || VEGGIES[0];
      return `
      ${topBar('Product Management', { back: true })}
      <div class="section tight">
        ${photoHero(v, { caption: 'Photo shown to retailers' })}
        <h3 class="text-center" style="margin:4px 0 10px;">${v.name}</h3>
      </div>
      <div class="section">
        ${formGroup('Selling Price (per kg)', `<input class="input" type="number" value="${v.sellPrice}" />`)}
        ${formGroup('Available Quantity (kg)', `<input class="input" type="number" value="${v.stock}" />`)}
        ${formGroup('Status', `<select class="select"><option ${v.stock === 0 ? 'selected' : ''}>Out of Stock</option><option ${v.stock > 0 && v.stock <= 10 ? 'selected' : ''}>Low Stock</option><option ${v.stock > 10 ? 'selected' : ''}>Active</option></select>`)}
      </div>
      ${fixedBottomBar(`<button class="btn btn-primary btn-block" data-action="saveProduct">Save Changes</button>`)}
      `;
    }
  },

  /* ---- Orders ---- */
  'distributor-orders': {
    tab: 'orders', back: false,
    render() {
      return `
      ${topBar('Orders', { back: false })}
      <div class="section tight">
        ${list(DIST_ORDERS.map(o => row({
          title: `${o.id} · ${o.retailer}`,
          subtitle: money(o.total),
          trailing: orderStageBadge(o.stage),
          nav: 'distributor-order-detail',
          params: { id: o.id },
        })))}
      </div>
      `;
    }
  },
  'distributor-order-detail': {
    tab: 'orders', back: true,
    render(params) {
      const o = DIST_ORDERS.find(x => x.id === params.id) || DIST_ORDERS[0];
      return `
      ${topBar('Order Details', { back: true })}
      <div class="section tight">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="font-weight:800; font-size:16px;">${o.id}</div>
          ${orderStageBadge(o.stage)}
        </div>
        <div class="muted" style="font-size:12.5px; margin-top:2px;">${o.retailer}</div>
      </div>
      <div class="section tight">
        ${sectionHead('Items')}
        ${list(o.items.map(it => row({ photo: veg(it.vegId), title: veg(it.vegId).name, trailing: `${it.qty}kg`, chevron: false })))}
      </div>
      <div class="section tight">
        ${list([row({ title: 'Total', trailing: money(o.total), chevron: false })])}
      </div>
      <div class="section tight">
        ${o.stage === 0 ? `<button class="btn btn-primary btn-block" data-action="markPreparing" ${attrParams({ id: o.id })}>Start Preparing</button>` : ''}
        ${o.stage === 1 ? `<button class="btn btn-primary btn-block" data-sheet="distributor-rider-assign" ${attrParams({ kind: 'order', id: o.id })}>Assign Rider</button>` : ''}
        ${o.stage >= 2 ? `<div class="helper-note" style="margin:0;">Live tracking is shown on the Retailer's Order Tracking screen and the Rider's Delivery Task screen — one consistent tracking experience.</div>` : ''}
      </div>
      `;
    }
  },

  /* ---- Inventory (kept as the real report table + Inventory/History segments) ---- */
  'distributor-inventory': {
    tab: 'inventory', back: false,
    render(params) {
      const seg = (params && params.seg) || 'inventory';
      const rows = DIST_INVENTORY_TABLE.filter(r => seg === 'history' ? r.delivered : !r.delivered);
      return `
      ${topBar('Inventory', { back: false, right: `<button class="icon-btn" data-action="refreshInventory">${ICON('refresh')}</button>` })}
      ${segmented([{ id: 'inventory', label: 'Inventory' }, { id: 'history', label: 'History' }], seg, 'switchInventorySeg')}
      ${inventoryReportTable(rows)}
      <div class="table-actions">
        <button class="btn btn-outline" ${rows.length ? '' : 'disabled'} data-action="exportInventoryPdf">${ICON('download', 15)} Export PDF</button>
        <button class="btn btn-outline" ${rows.length ? '' : 'disabled'} data-action="printInventory">${ICON('printer', 15)} Print</button>
      </div>
      <div class="section tight">
        ${sectionHead('Summary', { link: 'distributor-inventory-report', linkLabel: 'View report' })}
      </div>
      `;
    }
  },
  'distributor-inventory-history': {
    tab: 'inventory', back: true,
    render() { return DistributorScreens['distributor-inventory'].render({ seg: 'history' }); }
  },
  'distributor-inventory-report': {
    tab: 'inventory', back: true,
    render() {
      const received = DIST_INVENTORY_TABLE.reduce((s, r) => s + r.qtyReceived, 0);
      const sold = DIST_INVENTORY_TABLE.reduce((s, r) => s + r.qtySold, 0);
      return `
      ${topBar('Inventory Report', { back: true })}
      <div class="helper-note" style="margin-top:0;">A compact summary view. The full itemized table with all columns lives on the main Inventory screen.</div>
      <div class="section tight">
        <div class="tile-grid">
          ${statTile('Received', received, 'kg this week')}
          ${statTile('Sold', sold, 'kg this week')}
        </div>
      </div>
      <div class="section tight">
        ${sectionHead('By Vegetable')}
        ${list(VEGGIES.slice(0, 6).map(v => row({
          photo: v,
          title: v.name,
          subtitle: `${v.stock}kg on hand`,
          trailing: v.stock <= 10 ? badge('low') : badge('active'),
          chevron: false,
        })))}
      </div>
      `;
    }
  },

  /* ---- Payments / Account ---- */
  'distributor-payments': {
    tab: 'profile', back: true,
    render() {
      return `
      ${topBar('Payments', { back: true })}
      <div class="section tight">
        <div class="tile-grid">
          ${statTile('This Week', money(4820))}
          ${statTile('Pending', money(1290))}
        </div>
      </div>
      <div class="section tight">
        ${sectionHead('Recent Transactions')}
        ${list(DIST_ORDERS.map(o => row({ title: o.id, subtitle: o.retailer, trailing: money(o.total), chevron: false })))}
      </div>
      `;
    }
  },
  'distributor-account-mgmt': {
    tab: 'home', back: true,
    render() {
      return `
      ${topBar('Account Management', { back: true })}
      <div class="section tight">
        ${sectionHead('Team Access')}
        ${list([
          row({ icon: ICON('users'), title: 'Riders', subtitle: `${RIDERS.length} active`, action: 'noop' }),
          row({ icon: ICON('building'), title: 'Warehouse Staff', subtitle: '2 active', action: 'noop' }),
        ])}
      </div>
      <div class="helper-note">Account creation/removal for staff is managed by VeggieTrack administrators.</div>
      `;
    }
  },

  'distributor-messages': { tab: 'profile', back: true, render: () => conversationListScreen('distributor') },
  'distributor-chat': { tab: 'profile', back: true, immersive: true, render: (p) => chatScreen('distributor', p) },
  'distributor-notifications': { tab: 'home', back: true, render: () => notificationsScreen('distributor') },

  'distributor-profile': {
    tab: 'profile', back: false,
    render: () => profileScreen('distributor', DISTRIBUTOR, {
      addressLabel: 'Warehouse', addressLine: DISTRIBUTOR.address, hideDeactivate: true,
      extraLinks: [
        { icon: 'credit-card', title: 'Payments', nav: 'distributor-payments' },
      ],
    }),
  },
  'distributor-profile-edit': {
    tab: 'profile', back: true, immersive: true,
    render: () => editProfileScreen('distributor', { name: DISTRIBUTOR.name, phone: DISTRIBUTOR.phone, address: DISTRIBUTOR.address }),
  },
};
