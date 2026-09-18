/* ==========================================================================
   VeggieTrack Redesign Prototype — Router & App Shell
   PROTOTYPE ONLY — not wired to any real backend/API/database.
   ========================================================================== */

const ROLES = {
  farmer: {
    label: 'Farmer',
    tabs: [
      { id: 'home', label: 'Home', icon: 'home', screen: 'farmer-dashboard' },
      { id: 'harvest', label: 'Harvest', icon: 'leaf', screen: 'farmer-harvest-list' },
      { id: 'pickup', label: 'Pickup', icon: 'truck', screen: 'farmer-pickup-list' },
      { id: 'messages', label: 'Messages', icon: 'message-circle', screen: 'farmer-messages' },
      { id: 'profile', label: 'Profile', icon: 'user', screen: 'farmer-profile' },
    ],
  },
  distributor: {
    label: 'Distributor',
    tabs: [
      { id: 'home', label: 'Home', icon: 'home', screen: 'distributor-dashboard' },
      { id: 'orders', label: 'Orders', icon: 'receipt', screen: 'distributor-orders' },
      { id: 'stocks', label: 'Stocks', icon: 'box', screen: 'distributor-stocks' },
      { id: 'inventory', label: 'Inventory', icon: 'bar-chart', screen: 'distributor-inventory' },
      { id: 'profile', label: 'Profile', icon: 'user', screen: 'distributor-profile' },
    ],
  },
  rider: {
    label: 'Rider',
    tabs: [
      { id: 'home', label: 'Home', icon: 'home', screen: 'rider-dashboard' },
      { id: 'tasks', label: 'Tasks', icon: 'box', screen: 'rider-tasks' },
      { id: 'history', label: 'History', icon: 'clock', screen: 'rider-history' },
      { id: 'profile', label: 'Profile', icon: 'user', screen: 'rider-profile' },
    ],
  },
  retailer: {
    label: 'Retailer',
    tabs: [
      { id: 'home', label: 'Home', icon: 'home', screen: 'retailer-home' },
      { id: 'cart', label: 'Cart', icon: 'cart', screen: 'retailer-cart', badge: () => retailerCartCount() },
      { id: 'orders', label: 'Orders', icon: 'receipt', screen: 'retailer-orders' },
      { id: 'profile', label: 'Profile', icon: 'user', screen: 'retailer-profile' },
    ],
  },
  auth: {
    label: 'Onboarding',
    tabs: [
      { id: 'start', label: 'Start', icon: 'home', screen: 'auth-landing' },
    ],
  },
};

const ALL_SCREENS = Object.assign({}, FarmerScreens, DistributorScreens, RiderScreens, RetailerScreens, AuthScreens);

ALL_SCREENS['demo-error'] = {
  tab: null, back: true, immersive: true,
  render: () => `${topBar('Error State (Demo)', { back: true })}
    <div class="section tight">${emptyState('alert-triangle', 'Something went wrong', 'Please try again.', '<button class="btn btn-primary" style="margin-top:14px;" data-action="retryDemo">Retry</button>')}</div>`,
};

const State = {
  role: 'auth',
  stack: [{ screen: 'auth-landing', params: {} }],
  activeTab: 'start',
  cart: [],
  pdProductId: null,
  pdQty: 1,
  connectivity: 'synced',
  regRole: 'farmer',
};

function titleizeScreenId(id, roleId) {
  return id.replace(new RegExp('^' + roleId + '-'), '').split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

/* ---------------- Navigation ---------------- */

function currentScreenEntry() { return State.stack[State.stack.length - 1]; }

function pushScreen(screenId, params) {
  if (!ALL_SCREENS[screenId]) { console.warn('Unknown screen', screenId); return; }
  State.stack.push({ screen: screenId, params: params || {} });
  renderApp();
}

function goBack() {
  if (State.stack.length > 1) { State.stack.pop(); renderApp(); }
}

function goTab(tabId) {
  const roleCfg = ROLES[State.role];
  const tab = roleCfg.tabs.find(t => t.id === tabId) || roleCfg.tabs[0];
  State.activeTab = tab.id;
  State.stack = [{ screen: tab.screen, params: {} }];
  renderApp();
}

function switchRole(role) {
  State.role = role;
  State.stack = [{ screen: ROLES[role].tabs[0].screen, params: {} }];
  State.activeTab = ROLES[role].tabs[0].id;
  renderApp();
}

function jumpToScreen(screenId) {
  const entry = ALL_SCREENS[screenId];
  State.stack = [{ screen: screenId, params: {} }];
  if (entry && entry.tab) State.activeTab = entry.tab;
  renderApp();
}

/* ---------------- Sheet overlay ---------------- */

function openSheet(html) {
  const overlay = document.getElementById('sheetOverlay');
  const sheet = document.getElementById('sheet');
  sheet.innerHTML = `<div class="sheet-handle"></div>${html}`;
  overlay.classList.add('open');
}
function closeSheet() {
  document.getElementById('sheetOverlay').classList.remove('open');
  if (currentScreenEntry().__sheet) State.stack.pop();
}
function isSheetOpen() {
  return document.getElementById('sheetOverlay').classList.contains('open');
}

/* ---------------- Toast ---------------- */

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.remove('show'), 1800);
}

/* ---------------- Render ---------------- */

function renderApp() {
  const entry = currentScreenEntry();
  const screenDef = ALL_SCREENS[entry.screen];
  const content = document.getElementById('screenContent');
  content.innerHTML = screenDef.render(entry.params || {});
  content.scrollTop = 0;

  const bottomNav = document.getElementById('bottomNav');
  const gestureBar = document.getElementById('gestureBar');
  const hideChrome = !!screenDef.immersive;
  bottomNav.style.display = hideChrome ? 'none' : 'flex';

  renderBottomNav();
  renderControlPanel();
}

function renderBottomNav() {
  const bottomNav = document.getElementById('bottomNav');
  const roleCfg = ROLES[State.role];
  bottomNav.innerHTML = roleCfg.tabs.map(t => {
    const badgeVal = t.badge ? t.badge() : 0;
    return `<div class="navitem ${State.activeTab === t.id ? 'active' : ''}" data-tab="${t.id}">
      <span class="navicon">${ICON(t.icon, 20)}</span>
      <span class="navlabel">${t.label}</span>
      ${badgeVal ? `<span class="navbadge">${badgeVal}</span>` : ''}
    </div>`;
  }).join('');
}

function renderControlPanel() {
  const roleBtns = document.getElementById('roleButtons');
  roleBtns.querySelectorAll('.role-btn').forEach(b => b.classList.toggle('active', b.dataset.role === State.role));

  const jumpEl = document.getElementById('screenJump');
  const roleId = State.role;
  const roleScreenIds = Object.keys(ALL_SCREENS).filter(id => id.startsWith(roleId + '-'));
  const current = currentScreenEntry().screen;
  jumpEl.innerHTML = roleScreenIds.map(id =>
    `<div class="screen-jump-item ${id === current ? 'current' : ''}" data-jump="${id}">${titleizeScreenId(id, roleId)}</div>`
  ).join('');
}

/* ---------------- Actions ---------------- */

function handleAction(action, dataset) {
  switch (action) {
    case 'noop':
      showToast('Not part of this prototype flow');
      break;
    case 'toggleDetail':
      break;

    /* Farmer */
    case 'saveHarvest':
      showToast('Harvest saved');
      goTab('harvest');
      break;
    case 'editHarvest':
      showToast('Opening edit form (reuses Add Harvest layout)');
      pushScreen('farmer-harvest-add', {});
      break;

    /* Distributor */
    case 'approvePickup': {
      const p = DIST_PICKUPS.find(x => x.id === dataset.id);
      if (p) p.stage = 1;
      showToast('Pickup approved');
      renderApp();
      break;
    }
    case 'confirmAssignRider': {
      const list = dataset.kind === 'pickup' ? DIST_PICKUPS : DIST_ORDERS;
      const item = list.find(x => x.id === dataset.id);
      if (item) { item.stage = 2; item.rider = dataset.rider; }
      showToast(`${dataset.rider} assigned`);
      closeSheet();
      renderApp();
      break;
    }
    case 'markPreparing': {
      const o = DIST_ORDERS.find(x => x.id === dataset.id);
      if (o) o.stage = 1;
      showToast('Order marked as preparing');
      renderApp();
      break;
    }
    case 'saveProduct':
      showToast('Product updated');
      goBack();
      break;
    case 'uploadBatchPhoto': {
      const entry = currentScreenEntry();
      const b = DIST_BATCHES.find(x => x.id === entry.params.id);
      if (b) b.hasPhoto = true;
      showToast('Batch photo captured');
      goBack();
      break;
    }

    /* Rider */
    case 'advanceTaskStage': {
      const t = RIDER_TASKS.find(x => x.id === dataset.id);
      if (t) t.stage = Math.min(t.stage + 1, 3);
      showToast('Status updated');
      renderApp();
      break;
    }
    case 'submitPod': {
      const t = RIDER_TASKS.find(x => x.id === dataset.id);
      showToast('Proof submitted · Task completed');
      if (t) t.stage = 3;
      goTab('tasks');
      break;
    }

    /* Retailer */
    case 'pdIncQty': {
      State.pdQty = Math.min(State.pdQty + 1, 99);
      updateProductDetailQty();
      break;
    }
    case 'pdDecQty': {
      State.pdQty = Math.max(State.pdQty - 1, 1);
      updateProductDetailQty();
      break;
    }
    case 'addToCartFromDetail': {
      addToCart(dataset.id, State.pdQty);
      showToast(`Added ${veg(dataset.id).name} to cart`);
      State.pdQty = 1;
      if (isSheetOpen()) closeSheet(); else goBack();
      renderApp();
      break;
    }
    case 'quickAddToCart': {
      addToCart(dataset.id, 1);
      showToast(`Added ${veg(dataset.id).name} to cart`);
      renderApp();
      break;
    }
    case 'cartIncQty': {
      const it = State.cart.find(c => c.id === dataset.id);
      if (it) it.qty += 1;
      renderApp();
      break;
    }
    case 'cartDecQty': {
      const it = State.cart.find(c => c.id === dataset.id);
      if (it) {
        it.qty -= 1;
        if (it.qty <= 0) State.cart = State.cart.filter(c => c.id !== dataset.id);
      }
      renderApp();
      break;
    }
    case 'switchStocksSeg': {
      currentScreenEntry().params.seg = dataset.value;
      renderApp();
      break;
    }
    case 'switchOrdersSeg': {
      currentScreenEntry().params.seg = dataset.value;
      renderApp();
      break;
    }
    case 'switchInventorySeg': {
      currentScreenEntry().params.seg = dataset.value;
      renderApp();
      break;
    }
    case 'refreshInventory':
      showToast('Inventory refreshed');
      renderApp();
      break;
    case 'exportInventoryPdf':
      showToast('Exporting PDF… (prototype)');
      break;
    case 'printInventory':
      showToast('Sending to printer… (prototype)');
      break;
    case 'saveAddress':
      showToast('Address saved');
      pushScreen('retailer-address-list', {});
      break;
    case 'placeOrder':
      State.cart = [];
      showToast('Order placed!');
      goTab('orders');
      pushScreen('retailer-order-tracking', { id: 'ORD-3301' });
      break;

    /* Shared */
    case 'saveProfile':
      showToast('Profile updated');
      goBack();
      break;
    case 'logout':
      showToast('Logged out (prototype only)');
      State.cart = [];
      switchRole('auth');
      break;

    /* Onboarding (Landing / Login / Register / OTP / Pending) */
    case 'selectRegRole':
      State.regRole = dataset.value;
      renderApp();
      break;
    case 'demoLogin':
      showToast('Signed in — continuing into the Farmer experience for this demo');
      switchRole('farmer');
      break;
    case 'demoRegister':
      showToast('Account created — verify your number to continue');
      pushScreen('auth-otp', {});
      break;
    case 'demoVerifyOtp':
      showToast('Number verified');
      pushScreen('auth-pending', {});
      break;
    case 'sendMessage': {
      const input = document.getElementById('chatInputField');
      const text = input && input.value.trim();
      if (text) {
        const id = currentScreenEntry().params.id;
        if (!CHAT_THREADS[id]) CHAT_THREADS[id] = [];
        CHAT_THREADS[id].push({ from: 'me', text, time: 'Now' });
        renderApp();
      }
      break;
    }
    case 'retryDemo':
      showToast('Retrying… (demo)');
      break;
    default:
      break;
  }
}

function addToCart(id, qty) {
  const existing = State.cart.find(c => c.id === id);
  if (existing) existing.qty += qty; else State.cart.push({ id, qty });
}

function updateProductDetailQty() {
  const v = veg(currentScreenEntry().params.id);
  const qtyEl = document.getElementById('pdQtyVal');
  const totalEl = document.getElementById('pdTotalVal');
  if (qtyEl) qtyEl.textContent = State.pdQty;
  if (totalEl) totalEl.textContent = money(v.sellPrice * State.pdQty);
}

/* ---------------- Event delegation ---------------- */

function setupEvents() {
  const phone = document.getElementById('phoneRoot');
  phone.addEventListener('click', (e) => {
    const target = e.target.closest('[data-nav],[data-sheet],[data-action],[data-back],[data-tab],[data-jump]');
    if (!target) return;

    if (target.hasAttribute('data-back')) {
      if (isSheetOpen()) closeSheet(); else goBack();
      return;
    }
    if (target.hasAttribute('data-tab')) {
      closeSheet();
      goTab(target.getAttribute('data-tab'));
      return;
    }
    if (target.hasAttribute('data-nav')) {
      closeSheet();
      const screen = target.getAttribute('data-nav');
      const params = target.getAttribute('data-params');
      pushScreen(screen, params ? JSON.parse(params) : {});
      return;
    }
    if (target.hasAttribute('data-sheet')) {
      const screen = target.getAttribute('data-sheet');
      const params = target.getAttribute('data-params');
      const parsedParams = params ? JSON.parse(params) : {};
      if (screen === 'retailer-product-detail') { State.pdQty = 1; }
      // Track params for actions fired from within the sheet (e.g. add-to-cart id)
      State.stack.push({ screen: screen, params: parsedParams, __sheet: true });
      openSheet(ALL_SCREENS[screen].render(parsedParams));
      return;
    }
    if (target.hasAttribute('data-action')) {
      handleAction(target.getAttribute('data-action'), target.dataset);
      return;
    }
    if (target.hasAttribute('data-jump')) {
      jumpToScreen(target.getAttribute('data-jump'));
      return;
    }
  });

  document.getElementById('sheetOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'sheetOverlay') closeSheet();
  });
}

/* ---------------- Control panel bootstrap ---------------- */

function setupControlPanel() {
  document.getElementById('roleButtons').addEventListener('click', (e) => {
    const btn = e.target.closest('.role-btn');
    if (btn) switchRole(btn.dataset.role);
  });
  document.getElementById('screenJump').addEventListener('click', (e) => {
    const item = e.target.closest('[data-jump]');
    if (item) jumpToScreen(item.getAttribute('data-jump'));
  });
  document.getElementById('connectivityButtons').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-conn]');
    if (btn) { State.connectivity = btn.getAttribute('data-conn'); renderApp(); showToast('Connectivity: ' + btn.getAttribute('data-conn')); }
  });
  document.getElementById('resetProtoBtn').addEventListener('click', () => {
    State.cart = [];
    switchRole('farmer');
    showToast('Prototype reset');
  });
}

/* ---------------- Boot ---------------- */

document.addEventListener('DOMContentLoaded', () => {
  setupEvents();
  setupControlPanel();
  renderApp();
});
