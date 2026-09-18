/* ==========================================================================
   RETAILER SCREENS — Proposed Design (Prototype Only)
   ========================================================================== */

function retailerCartTotal() {
  return State.cart.reduce((sum, item) => {
    const v = veg(item.id);
    return sum + (v ? v.sellPrice * item.qty : 0);
  }, 0);
}
function retailerCartCount() {
  return State.cart.reduce((sum, item) => sum + item.qty, 0);
}

function productCard(v) {
  const inCart = State.cart.find(c => c.id === v.id);
  const out = v.stock === 0;
  return `
  <div class="prod-card" data-sheet="retailer-product-detail" ${attrParams({ id: v.id })}>
    <div class="prod-photo" style="background:${v.photo}"></div>
    <div class="prod-name">${v.name}</div>
    <div class="prod-sub">${out ? 'Out of stock' : v.stock + 'kg available'}</div>
    <div class="prod-row-bottom">
      <span class="prod-price">${money(v.sellPrice)}/kg</span>
      <button class="prod-add" ${out ? 'disabled' : ''} data-action="quickAddToCart" data-id="${v.id}">${inCart ? inCart.qty : '+'}</button>
    </div>
  </div>`;
}

function orderRow(o) {
  return row({
    title: o.id,
    subtitle: `${o.items.length} item${o.items.length > 1 ? 's' : ''} · ${money(o.total)}`,
    trailing: orderStageBadge(o.stage),
    nav: o.stage < 5 ? 'retailer-order-tracking' : 'retailer-order-detail',
    params: { id: o.id },
  });
}

const RetailerScreens = {

  'retailer-home': {
    tab: 'home', back: false,
    render() {
      const active = RETAILER_ORDERS.find(o => o.stage < 5);
      return `
      ${topBar('', { back: false, right: topBarActions('retailer') })}
      <div class="hero">
        <div class="hero-top">
          <div>
            <p class="greeting-eyebrow">Order fresh produce</p>
            <h2 class="greeting-name">${RETAILER.name}</h2>
          </div>
        </div>
      </div>
      ${syncStatusPill(State.connectivity)}
      <div class="search-bar" data-nav="retailer-search">${ICON('search', 15)} Search vegetables…</div>
      <div class="spacer-h"></div>

      ${active ? `
      <div class="section tight">
        <div class="banner" data-nav="retailer-order-tracking" ${attrParams({ id: active.id })}>
          <div class="banner-icon">${ICON('truck', 22)}</div>
          <div><div class="banner-title">Order ${active.id} · ${ORDER_STAGES[active.stage]}</div><div class="banner-sub">${active.rider ? `Rider ${active.rider} · ETA ${active.eta}` : 'Preparing your order'}</div></div>
        </div>
      </div>` : ''}

      <div class="section tight">
        ${sectionHead('Available Vegetables')}
      </div>
      <div class="prod-grid">${VEGGIES.map(productCard).join('')}</div>

      <div class="section tight">
        ${sectionHead('Recent Orders', { link: 'retailer-order-history', linkLabel: 'See all' })}
        ${list(RETAILER_ORDERS.slice(1, 3).map(orderRow))}
      </div>
      `;
    }
  },

  'retailer-search': {
    tab: 'home', back: true, immersive: true,
    render() {
      return `
      ${topBar('Search', { back: true })}
      <div class="search-bar" style="margin-top:2px;">${ICON('search', 15)} Try "Tomato" or "Lettuce"</div>
      <div class="spacer-h"></div>
      <div class="section tight">${sectionHead('All Vegetables')}</div>
      <div class="prod-grid">${VEGGIES.map(productCard).join('')}</div>
      `;
    }
  },

  'retailer-product-detail': {
    tab: 'home', back: true, isSheetLike: true,
    render(params) {
      const v = veg(params.id) || VEGGIES[0];
      const out = v.stock === 0;
      return `
      ${topBar(v.name, { back: true })}
      <div class="section tight">
        ${photoHero(v)}
      </div>
      <div class="section tight">
        <h2 style="margin:0 0 2px;">${v.name}</h2>
        <div style="font-size:18px; font-weight:800; color:var(--primary-dark);">${money(v.sellPrice)}<span style="font-size:12.5px; font-weight:600; color:var(--text-muted);">/kg</span></div>
        <div class="muted" style="font-size:12.5px; margin-top:4px;">${out ? '<span style="color:var(--red); font-weight:700;">Out of stock</span>' : `${v.stock}kg available`}</div>
      </div>
      ${!out ? `
      <div class="section tight">
        ${sectionHead('Quantity (kg)')}
        <div class="qty-stepper">
          <button class="qbtn" data-action="pdDecQty">–</button>
          <span class="qval" id="pdQtyVal">1</span>
          <button class="qbtn" data-action="pdIncQty">+</button>
        </div>
        ${v.stock <= 10 ? `<div class="helper-note">Only ${v.stock} kg available.</div>` : ''}
      </div>` : `<div class="section tight">${emptyState('alert-triangle', 'Currently unavailable', 'Check back soon or browse similar vegetables.')}</div>`}
      ${fixedBottomBar(out ? `<button class="btn btn-primary btn-block" disabled>Out of Stock</button>` : `<button class="btn btn-primary btn-block" data-action="addToCartFromDetail" data-id="${v.id}">Add to Cart · <span id="pdTotalVal">${money(v.sellPrice)}</span></button>`)}
      `;
    }
  },

  'retailer-cart': {
    tab: 'cart', back: false,
    render() {
      const items = State.cart;
      const total = retailerCartTotal();
      return `
      ${topBar('Cart', { back: false })}
      ${items.length ? `
      <div class="section tight">
        ${list(items.map(item => {
          const v = veg(item.id);
          return row({
            photo: v,
            title: v.name,
            subtitle: `${money(v.sellPrice)}/kg`,
            chevron: false,
            trailing: `<div class="qty-stepper">
                <button class="qbtn" data-action="cartDecQty" data-id="${v.id}">–</button>
                <span class="qval">${item.qty}</span>
                <button class="qbtn" data-action="cartIncQty" data-id="${v.id}">+</button>
              </div>`,
          });
        }))}
      </div>
      <div class="section tight">
        ${list([row({ title: 'Subtotal', trailing: money(total), chevron: false })])}
      </div>
      ${fixedBottomBar(`<button class="btn btn-primary btn-block" data-nav="retailer-address-list">Checkout · ${money(total)}</button>`)}
      ` : emptyState('cart', 'Your cart is empty', 'Add vegetables from Home to get started.', `<button class="btn btn-primary" style="margin-top:14px;" data-tab="home">Browse Vegetables</button>`)}
      `;
    }
  },

  'retailer-address-list': {
    tab: 'cart', back: true,
    render() {
      return `
      ${topBar('Manage Address', { back: true })}
      <div class="section tight">
        ${list(RETAILER_ADDRESSES.map(a => row({
          icon: ICON('pin'),
          title: a.label,
          subtitle: a.line,
          trailing: a.default ? badge('active', 'Default') : `<button class="btn btn-ghost btn-sm" data-nav="retailer-address-edit" ${attrParams({ id: a.id })}>Edit</button>`,
          nav: 'retailer-delivery-schedule',
          params: { addressId: a.id },
          chevron: false,
        })))}
      </div>
      <div class="section tight">
        <button class="btn btn-outline btn-block" data-nav="retailer-address-add">+ Add New Address</button>
      </div>
      `;
    }
  },
  'retailer-address-add': {
    tab: 'cart', back: true, immersive: true,
    render() {
      return `
      ${topBar('Add Address', { back: true })}
      <div class="section">
        ${formGroup('Label', `<input class="input" placeholder="e.g. Store, Home" />`)}
        ${formGroup('Full Address', `<textarea class="input" rows="3" placeholder="Street, Barangay, City"></textarea>`)}
        ${formGroup('Landmark (optional)', `<input class="input" placeholder="e.g. Near public market" />`)}
      </div>
      ${fixedBottomBar(`<button class="btn btn-primary btn-block" data-action="saveAddress">Save Address</button>`)}
      `;
    }
  },
  'retailer-address-edit': {
    tab: 'cart', back: true, immersive: true,
    render(params) {
      const a = RETAILER_ADDRESSES.find(x => x.id === params.id) || RETAILER_ADDRESSES[0];
      return `
      ${topBar('Edit Address', { back: true })}
      <div class="section">
        ${formGroup('Label', `<input class="input" value="${a.label}" />`)}
        ${formGroup('Full Address', `<textarea class="input" rows="3">${a.line}</textarea>`)}
      </div>
      ${fixedBottomBar(`<button class="btn btn-primary btn-block" data-action="saveAddress">Save Changes</button>`)}
      `;
    }
  },

  'retailer-delivery-schedule': {
    tab: 'cart', back: true, immersive: true,
    render() {
      return `
      ${topBar('Delivery Schedule', { back: true })}
      <div class="section">
        ${formGroup('Delivery Date', `<input class="input" value="Sep 19, 2026" />`)}
        ${formGroup('Time Window', `<select class="select"><option>8:00 – 10:00 AM</option><option>10:00 AM – 12:00 PM</option><option>1:00 – 3:00 PM</option></select>`)}
        ${formGroup('Notes for rider (optional)', `<textarea class="input" rows="2" placeholder="e.g. Leave with guard"></textarea>`)}
      </div>
      ${fixedBottomBar(`<button class="btn btn-primary btn-block" data-nav="retailer-order-confirmation">Continue</button>`)}
      `;
    }
  },

  'retailer-order-confirmation': {
    tab: 'cart', back: true, immersive: true,
    render() {
      const total = retailerCartTotal() || 1290;
      return `
      ${topBar('Confirm Order', { back: true })}
      <div class="section tight">
        ${sectionHead('Items')}
        ${list((State.cart.length ? State.cart : [{ id: 'v1', qty: 10 }, { id: 'v2', qty: 5 }]).map(item => {
          const v = veg(item.id);
          return row({ photo: v, title: v.name, trailing: `${item.qty}kg · ${money(v.sellPrice * item.qty)}`, chevron: false });
        }))}
      </div>
      <div class="section tight">
        ${list([
          row({ title: 'Deliver to', subtitle: RETAILER_ADDRESSES[0].line, chevron: false }),
          row({ title: 'Schedule', trailing: 'Sep 19 · 8–10 AM', chevron: false }),
          row({ title: 'Total', trailing: money(total), chevron: false }),
        ])}
      </div>
      ${fixedBottomBar(`<button class="btn btn-primary btn-block" data-action="placeOrder">Place Order</button>`)}
      `;
    }
  },

  'retailer-orders': {
    tab: 'orders', back: false,
    render(params) {
      const seg = (params && params.seg) || 'active';
      const active = RETAILER_ORDERS.filter(o => o.stage < 5);
      const past = RETAILER_ORDERS.filter(o => o.stage === 5);
      return `
      ${topBar('Orders', { back: false })}
      ${segmented([{ id: 'active', label: 'Active' }, { id: 'history', label: 'History' }], seg, 'switchOrdersSeg')}
      <div class="section tight">
        ${seg === 'active'
          ? (active.length ? list(active.map(orderRow)) : emptyState('box', 'No active orders', 'Your current orders will appear here.'))
          : list(past.map(orderRow))}
      </div>
      `;
    }
  },
  'retailer-order-active': {
    tab: 'orders', back: true,
    render(params) {
      return RetailerScreens['retailer-order-tracking'].render(params);
    }
  },

  'retailer-order-tracking': {
    tab: 'orders', back: true,
    render(params) {
      const o = RETAILER_ORDERS.find(x => x.id === params.id) || RETAILER_ORDERS[0];
      return `
      ${topBar('Order Tracking', { back: true })}
      <div class="section tight">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="font-size:16px; font-weight:800; color:var(--primary-dark);">${ORDER_STAGES[o.stage]}</div>
          ${o.eta ? `<span class="badge purple">ETA ${o.eta}</span>` : orderStageBadge(o.stage)}
        </div>
        <div class="muted" style="font-size:12.5px; margin-top:2px;">${o.id}</div>
      </div>

      ${o.rider ? `
      <div class="section tight">
        <div class="list">
          <div class="row row-tap" data-sheet="retailer-rider-information" ${attrParams({ id: o.id })}>
            ${avatarInitials(o.rider)}
            <div class="row-body"><div class="row-title">${o.rider}</div><div class="row-subtitle">Your rider · tap for details</div></div>
            <div class="row-trailing"><button class="btn btn-ghost btn-sm" data-nav="retailer-chat" ${attrParams({ id: 'c2' })}>${ICON('message-circle', 14)} Message</button></div>
          </div>
        </div>
      </div>
      ${mapWidget({
        statusLabel: o.rider, statusSub: 'Live GPS', statusState: 'live',
        distance: '1.8 km', eta: o.eta,
        markers: [{ type: 'rider', top: 62, left: 22, icon: 'navigation' }, { type: 'shop', top: 30, left: 76, icon: 'pin' }],
        expandNav: 'retailer-map-tracking', expandParams: { id: o.id },
      })}
      ` : `<div class="section tight"><div class="banner" style="cursor:default;"><div class="banner-icon">${ICON('clock', 20)}</div><div><div class="banner-title">Preparing your order</div><div class="banner-sub">A rider will be assigned soon</div></div></div></div>`}

      <div class="section tight">
        ${sectionHead('Order Details')}
        ${list([
          row({ title: 'Delivery Address', subtitle: o.address ? o.address.line : RETAILER_ADDRESSES[0].line, chevron: false }),
          ...o.items.map(it => row({ photo: veg(it.vegId), title: veg(it.vegId).name, trailing: `${it.qty}kg`, chevron: false })),
          row({ title: 'Total', trailing: money(o.total), chevron: false }),
        ])}
      </div>
      `;
    }
  },
  'retailer-map-tracking': {
    tab: 'orders', back: true, immersive: true, isMapScreen: true,
    render(params) {
      const o = RETAILER_ORDERS.find(x => x.id === params.id) || RETAILER_ORDERS[0];
      return mapWidgetFull({
        statusLabel: o.rider || 'Assigning rider…', statusSub: 'Live GPS', statusState: o.rider ? 'live' : 'pending',
        distance: '1.8 km', eta: o.eta,
        markers: [{ type: 'hub', top: 78, left: 12, icon: 'building' }, { type: 'rider', top: 55, left: 18, icon: 'navigation' }, { type: 'shop', top: 28, left: 78, icon: 'pin' }],
        card: `<div class="map-floating-card" style="position:absolute; bottom:14px; left:14px; right:14px; background:var(--surface); border-radius:var(--radius-md); padding:14px; box-shadow:var(--shadow-md);">
          <div class="muted" style="font-size:12.5px;">Heading to ${o.address ? o.address.line : RETAILER_ADDRESSES[0].line}</div>
        </div>`,
      });
    }
  },
  'retailer-rider-information': {
    tab: 'orders', back: true,
    render(params) {
      const o = RETAILER_ORDERS.find(x => x.id === params.id) || RETAILER_ORDERS[0];
      return `
      ${topBar('Rider Information', { back: true })}
      <div class="profile-header">
        ${avatarInitials(o.rider || '?', { lg: true })}
        <div class="profile-name">${o.rider || 'Unassigned'}</div>
        <div class="profile-role">Motorcycle · NBC 2231</div>
      </div>
      <div class="section tight">
        ${list([
          row({ icon: ICON('star'), title: 'Rating', trailing: '4.9 (320 deliveries)', chevron: false }),
          row({ icon: ICON('message-circle'), title: 'Message rider', nav: 'retailer-chat', params: { id: 'c2' } }),
        ])}
      </div>
      `;
    }
  },

  'retailer-order-history': {
    tab: 'orders', back: true,
    render() {
      return `
      ${topBar('Order History', { back: true })}
      <div class="section tight">
        ${list(RETAILER_ORDERS.filter(o => o.stage === 5).map(orderRow))}
      </div>
      `;
    }
  },
  'retailer-order-detail': {
    tab: 'orders', back: true,
    render(params) {
      const o = RETAILER_ORDERS.find(x => x.id === params.id) || RETAILER_ORDERS[1];
      return `
      ${topBar('Order Details', { back: true })}
      <div class="section tight">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="font-weight:800; font-size:16px;">${o.id}</div>
          ${orderStageBadge(o.stage)}
        </div>
        <div class="muted" style="font-size:12.5px; margin-top:2px;">Placed ${o.placed}</div>
      </div>
      <div class="section tight">
        ${sectionHead('Items')}
        ${list(o.items.map(it => row({ photo: veg(it.vegId), title: veg(it.vegId).name, trailing: `${it.qty}kg`, chevron: false })))}
      </div>
      <div class="section tight">
        ${list([row({ title: 'Total', trailing: money(o.total), chevron: false })])}
      </div>
      <div class="section tight">
        <button class="btn btn-outline btn-block" data-nav="retailer-pod" ${attrParams({ id: o.id })}>View Proof of Delivery</button>
      </div>
      `;
    }
  },
  'retailer-pod': {
    tab: 'orders', back: true, immersive: true,
    render(params) {
      const o = RETAILER_ORDERS.find(x => x.id === params.id) || RETAILER_ORDERS[1];
      const deliveredAt = o.deliveredAt || 'Sep 15, 2026 · 2:12 PM';
      const [deliveredDate, deliveredTime] = deliveredAt.split('·').map(s => s.trim());
      return podScreenBody({
        title: 'Proof of Delivery',
        date: deliveredDate,
        time: deliveredTime,
        distance: 'at store front',
        extraRows: `
          <div class="row" style="padding:6px 0; border:none;"><div class="row-body"><div class="row-subtitle">Order</div><div class="row-title">${o.id}</div></div></div>
          <div class="row" style="padding:6px 0; border:none;"><div class="row-body"><div class="row-subtitle">Rider</div><div class="row-title">${o.rider || 'Juan D.'}</div></div></div>`,
        note: 'Captured by the rider on delivery — for your records only.',
        viewOnly: true,
      });
    }
  },

  'retailer-messages': { tab: 'profile', back: true, render: () => conversationListScreen('retailer') },
  'retailer-chat': { tab: 'profile', back: true, immersive: true, render: (p) => chatScreen('retailer', p) },
  'retailer-notifications': { tab: 'home', back: true, render: () => notificationsScreen('retailer') },

  'retailer-profile': {
    tab: 'profile', back: false,
    render: () => profileScreen('retailer', { name: RETAILER.name, role: RETAILER.role, phone: RETAILER.phone }, {
      addressLabel: 'Store Address', addressLine: RETAILER_ADDRESSES[0].line,
      extraLinks: [
        { icon: 'pin', title: 'Manage Addresses', nav: 'retailer-address-list' },
      ],
    }),
  },
  'retailer-profile-edit': {
    tab: 'profile', back: true, immersive: true,
    render: () => editProfileScreen('retailer', { name: RETAILER.name, phone: RETAILER.phone }),
  },
};
