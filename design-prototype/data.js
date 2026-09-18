/* ==========================================================================
   VeggieTrack Redesign Prototype — Sample Data
   PROTOTYPE ONLY. Not connected to the real VeggieTrack backend/database.
   All records below are fictional sample data for demo purposes.
   ========================================================================== */

/* `photo` = the gradient standing in for the actual photo the distributor
   uploads for that batch (BatchPhotoField in the real Stocks screen). The
   retailer sees this exact photo in their menu — not a generic icon. */
const VEGGIES = [
  { id: 'v1', name: 'Tomato',       price: 85,  unit: 'kg', stock: 120, sellPrice: 95,  photo: 'linear-gradient(135deg,#e2543f,#a82c1c)' },
  { id: 'v2', name: 'Eggplant',     price: 60,  unit: 'kg', stock: 80,  sellPrice: 68,  photo: 'linear-gradient(135deg,#8a5aa8,#4a2e63)' },
  { id: 'v3', name: 'Okra',         price: 70,  unit: 'kg', stock: 45,  sellPrice: 78,  photo: 'linear-gradient(135deg,#7fae52,#44662a)' },
  { id: 'v4', name: 'Lettuce',      price: 120, unit: 'kg', stock: 8,   sellPrice: 135, photo: 'linear-gradient(135deg,#94c15a,#5a8f2e)' },
  { id: 'v5', name: 'Cabbage',      price: 45,  unit: 'kg', stock: 95,  sellPrice: 52,  photo: 'linear-gradient(135deg,#b3cf8c,#7a9a5c)' },
  { id: 'v6', name: 'Carrot',       price: 65,  unit: 'kg', stock: 110, sellPrice: 72,  photo: 'linear-gradient(135deg,#f0954a,#c96f27)' },
  { id: 'v7', name: 'String Beans', price: 55,  unit: 'kg', stock: 40,  sellPrice: 62,  photo: 'linear-gradient(135deg,#6fa050,#3d5f29)' },
  { id: 'v8', name: 'Squash',       price: 40,  unit: 'kg', stock: 60,  sellPrice: 46,  photo: 'linear-gradient(135deg,#f2b544,#d1841a)' },
  { id: 'v9', name: 'Potato',       price: 50,  unit: 'kg', stock: 0,   sellPrice: 58,  photo: 'linear-gradient(135deg,#c9a876,#96754a)' },
  { id: 'v10', name: 'Red Onion',   price: 90,  unit: 'kg', stock: 70,  sellPrice: 99,  photo: 'linear-gradient(135deg,#9c4a6b,#5f2940)' },
];

function veg(id) { return VEGGIES.find(v => v.id === id); }

/* ---------------- FARMER ---------------- */

const FARMER = { name: 'Mang Tomas', role: 'Farmer', phone: '0917 234 5678', farm: 'Tomas Family Farm, Brgy. San Isidro, Batangas' };

const FARMER_HARVESTS = [
  { id: 'H-105', vegId: 'v7', qty: 12, date: 'Sep 18, 2026', status: 'available' },
  { id: 'H-104', vegId: 'v6', qty: 30, date: 'Sep 17, 2026', status: 'reserved' },
  { id: 'H-101', vegId: 'v1', qty: 25, date: 'Sep 17, 2026', status: 'available' },
  { id: 'H-102', vegId: 'v2', qty: 15, date: 'Sep 16, 2026', status: 'reserved' },
  { id: 'H-103', vegId: 'v3', qty: 10, date: 'Sep 15, 2026', status: 'picked_up' },
];

// Pickup stage index: 0 Pending, 1 Approved, 2 Rider Assigned, 3 OTW, 4 Picked Up, 5 Completed
const PICKUP_STAGES = ['Pending', 'Approved', 'Rider Assigned', 'OTW', 'Picked Up', 'Completed'];

const FARMER_PICKUPS = [
  { id: 'P-2201', vegId: 'v1', qty: 25, stage: 3, rider: 'Juan D.', eta: '12 min', schedule: 'Sep 18, 2026 · 9:00 AM', address: 'Tomas Family Farm, Brgy. San Isidro', distance: '3.2 km' },
  { id: 'P-2189', vegId: 'v2', qty: 15, stage: 1, rider: null, eta: null, schedule: 'Sep 19, 2026 · 8:00 AM', address: 'Tomas Family Farm, Brgy. San Isidro', distance: null },
  { id: 'P-2170', vegId: 'v3', qty: 10, stage: 5, rider: 'Juan D.', eta: null, schedule: 'Sep 15, 2026 · 7:30 AM', address: 'Tomas Family Farm, Brgy. San Isidro', distance: null, completedAt: 'Sep 15, 2026 · 7:52 AM' },
  { id: 'P-2140', vegId: 'v6', qty: 20, stage: 5, rider: 'Juan D.', eta: null, schedule: 'Sep 12, 2026 · 8:00 AM', address: 'Tomas Family Farm, Brgy. San Isidro', distance: null, completedAt: 'Sep 12, 2026 · 8:15 AM' },
];

const FARMER_REPORTS = [
  { id: 'W-38', range: 'Sep 15 – Sep 21, 2026', kg: 25, pickups: 1, current: true },
  { id: 'W-37', range: 'Sep 8 – Sep 14, 2026', kg: 92, pickups: 3 },
  { id: 'W-36', range: 'Sep 1 – Sep 7, 2026', kg: 78, pickups: 2 },
  { id: 'W-35', range: 'Aug 25 – Aug 31, 2026', kg: 64, pickups: 2 },
];

const FARMER_REPORT_ROWS = {
  'W-37': [
    { veg: 'Tomato', qty: 25, date: 'Sep 12', status: 'Picked Up', rider: 'Juan D.', distributor: 'VeggieTrack Central Hub', harvestDate: 'Sep 11', pickupDate: 'Sep 12' },
    { veg: 'Carrot', qty: 20, date: 'Sep 12', status: 'Picked Up', rider: 'Juan D.', distributor: 'VeggieTrack Central Hub', harvestDate: 'Sep 10', pickupDate: 'Sep 12' },
    { veg: 'Okra', qty: 47, date: 'Sep 9', status: 'Picked Up', rider: 'Ramon P.', distributor: 'VeggieTrack Central Hub', harvestDate: 'Sep 8', pickupDate: 'Sep 9' },
  ],
};

/* ---------------- DISTRIBUTOR ---------------- */

const DISTRIBUTOR = { name: 'VeggieTrack Central Hub', role: 'Distributor', phone: '0918 555 0199', address: 'Warehouse 3, Agri Trade Center, Batangas City' };

const DIST_BATCHES = [
  { id: 'B-501', vegId: 'v1', qty: 25, farmer: 'Mang Tomas', received: 'Sep 18, 2026', hasPhoto: true },
  { id: 'B-499', vegId: 'v2', qty: 15, farmer: 'Mang Tomas', received: 'Sep 16, 2026', hasPhoto: false },
  { id: 'B-495', vegId: 'v6', qty: 20, farmer: 'Aling Rosa', received: 'Sep 15, 2026', hasPhoto: true },
  { id: 'B-488', vegId: 'v4', qty: 8, farmer: 'Mang Ernie', received: 'Sep 14, 2026', hasPhoto: true },
];

const DIST_PICKUPS = [
  { id: 'P-2201', vegId: 'v1', qty: 25, stage: 3, farmer: 'Mang Tomas', rider: 'Juan D.', schedule: 'Sep 18, 2026 · 9:00 AM' },
  { id: 'P-2189', vegId: 'v2', qty: 15, stage: 1, farmer: 'Mang Tomas', rider: null, schedule: 'Sep 19, 2026 · 8:00 AM' },
  { id: 'P-2205', vegId: 'v10', qty: 18, stage: 0, farmer: 'Aling Rosa', rider: null, schedule: 'Sep 19, 2026 · 9:30 AM' },
];

const DIST_ORDERS = [
  { id: 'O-3301', retailer: "Nena's Turo-Turo", items: [{ vegId: 'v1', qty: 10 }, { vegId: 'v2', qty: 5 }], total: 1290, stage: 3, rider: 'Juan D.' },
  { id: 'O-3298', retailer: "Green Bowl Cafe", items: [{ vegId: 'v6', qty: 8 }], total: 576, stage: 1, rider: null },
  { id: 'O-3280', retailer: "Nena's Turo-Turo", items: [{ vegId: 'v1', qty: 6 }], total: 570, stage: 5, rider: 'Juan D.' },
];
const ORDER_STAGES = ['Pending', 'Preparing', 'Assigned', 'Out for Delivery', 'Delivered', 'Delivered'];

const RIDERS = [
  { name: 'Juan D.', status: 'On Delivery', tasks: 2 },
  { name: 'Ramon P.', status: 'Available', tasks: 0 },
  { name: 'Kevin S.', status: 'Available', tasks: 0 },
];

const DIST_INVENTORY_LOG = [
  { veg: 'Tomato', change: '+25 kg', reason: 'Batch B-501 received', date: 'Sep 18, 10:02 AM' },
  { veg: 'Tomato', change: '-10 kg', reason: 'Order O-3301', date: 'Sep 18, 11:40 AM' },
  { veg: 'Eggplant', change: '-5 kg', reason: 'Order O-3301', date: 'Sep 18, 11:40 AM' },
  { veg: 'Carrot', change: '+20 kg', reason: 'Batch B-495 received', date: 'Sep 15, 8:20 AM' },
  { veg: 'Lettuce', change: '-4 kg', reason: 'Spoilage adjustment', date: 'Sep 14, 4:10 PM' },
];

/* This matches the columns of the REAL DistributorInventoryReportScreen
   (a horizontally-scrollable ReportTable with Inventory/History segments).
   `delivered` decides which segment a row appears in. This structure is
   kept as-is per review feedback — only the visual chrome was restyled. */
const DIST_INVENTORY_TABLE = [
  { product: 'Tomato', qtyReceived: 25, qtySold: 10, remaining: 15, pricePerKg: 95, totalAmount: 950, farmer: 'Mang Tomas', retailer: "Nena's Turo-Turo", pickupRider: 'Juan D.', deliveryRider: 'Juan D.', harvestDate: 'Sep 17', pickupDate: 'Sep 18', deliveryDate: 'Sep 18', paymentStatus: 'Paid', orderStatus: 'Out for Delivery', delivered: false },
  { product: 'Eggplant', qtyReceived: 15, qtySold: 5, remaining: 10, pricePerKg: 68, totalAmount: 340, farmer: 'Mang Tomas', retailer: "Nena's Turo-Turo", pickupRider: 'Juan D.', deliveryRider: 'Juan D.', harvestDate: 'Sep 16', pickupDate: 'Sep 16', deliveryDate: 'Sep 18', paymentStatus: 'Paid', orderStatus: 'Out for Delivery', delivered: false },
  { product: 'Carrot', qtyReceived: 20, qtySold: 8, remaining: 12, pricePerKg: 72, totalAmount: 576, farmer: 'Aling Rosa', retailer: 'Green Bowl Cafe', pickupRider: 'Juan D.', deliveryRider: '—', harvestDate: 'Sep 14', pickupDate: 'Sep 15', deliveryDate: '—', paymentStatus: 'Pending', orderStatus: 'Preparing', delivered: false },
  { product: 'Tomato', qtyReceived: 18, qtySold: 6, remaining: 0, pricePerKg: 90, totalAmount: 570, farmer: 'Mang Tomas', retailer: "Nena's Turo-Turo", pickupRider: 'Juan D.', deliveryRider: 'Juan D.', harvestDate: 'Sep 9', pickupDate: 'Sep 10', deliveryDate: 'Sep 10', paymentStatus: 'Paid', orderStatus: 'Delivered', delivered: true },
  { product: 'Lettuce', qtyReceived: 8, qtySold: 4, remaining: 4, pricePerKg: 135, totalAmount: 540, farmer: 'Mang Ernie', retailer: 'Green Bowl Cafe', pickupRider: 'Ramon P.', deliveryRider: 'Ramon P.', harvestDate: 'Sep 13', pickupDate: 'Sep 14', deliveryDate: 'Sep 15', paymentStatus: 'Paid', orderStatus: 'Delivered', delivered: true },
  { product: 'Okra', qtyReceived: 10, qtySold: 10, remaining: 0, pricePerKg: 78, totalAmount: 780, farmer: 'Mang Tomas', retailer: "Nena's Turo-Turo", pickupRider: 'Juan D.', deliveryRider: 'Juan D.', harvestDate: 'Sep 14', pickupDate: 'Sep 15', deliveryDate: 'Sep 15', paymentStatus: 'Paid', orderStatus: 'Delivered', delivered: true },
];

/* ---------------- RIDER ---------------- */

const RIDER = { name: 'Juan Dela Cruz', shortName: 'Juan D.', role: 'Rider', phone: '0919 888 2233', vehicle: 'Motorcycle · NBC 2231' };

const RIDER_TASKS = [
  { id: 'T-01', type: 'pickup', stage: 3, veg: 'Tomato', qty: 25, party: 'Mang Tomas', address: 'Brgy. San Isidro, Batangas', schedule: '9:00 AM', distance: '3.2 km' },
  { id: 'T-02', type: 'delivery', stage: 2, veg: 'Tomato 10kg, Eggplant 5kg', qty: null, party: "Nena's Turo-Turo", address: 'Purok 3, Brgy. Maligaya, Batangas City', schedule: '10:30 AM', distance: '5.8 km' },
  { id: 'T-03', type: 'pickup', stage: 0, veg: 'Red Onion', qty: 18, party: 'Aling Rosa', address: 'Brgy. Malaya, Batangas', schedule: '9:30 AM', distance: '4.1 km' },
];

const RIDER_HISTORY = [
  { id: 'T-98', type: 'delivery', veg: 'Tomato 6kg', party: "Nena's Turo-Turo", date: 'Sep 17, 2026', time: '2:10 PM' },
  { id: 'T-95', type: 'pickup', veg: 'Okra 10kg', party: 'Mang Tomas', date: 'Sep 15, 2026', time: '7:52 AM' },
  { id: 'T-90', type: 'pickup', veg: 'Carrot 20kg', party: 'Mang Tomas', date: 'Sep 12, 2026', time: '8:15 AM' },
];

/* ---------------- RETAILER ---------------- */

const RETAILER = { name: "Nena's Turo-Turo", role: 'Retailer', phone: '0920 111 4455' };

const RETAILER_ADDRESSES = [
  { id: 'a1', label: 'Store', line: 'Purok 3, Brgy. Maligaya, Batangas City', default: true },
  { id: 'a2', label: 'Home', line: 'Blk 2 Lot 5, Green Valley Subd., Batangas City', default: false },
];

const RETAILER_ORDERS = [
  { id: 'ORD-3301', items: [{ vegId: 'v1', qty: 10 }, { vegId: 'v2', qty: 5 }], total: 1290, stage: 3, rider: 'Juan D.', eta: '15 min', placed: 'Sep 18, 2026 · 9:05 AM', address: RETAILER_ADDRESSES[0] },
  { id: 'ORD-3280', items: [{ vegId: 'v1', qty: 6 }], total: 570, stage: 5, placed: 'Sep 15, 2026', deliveredAt: 'Sep 15, 2026 · 2:12 PM' },
  { id: 'ORD-3260', items: [{ vegId: 'v6', qty: 8 }, { vegId: 'v5', qty: 5 }], total: 745, stage: 5, placed: 'Sep 10, 2026', deliveredAt: 'Sep 10, 2026 · 3:40 PM' },
];

/* ---------------- MESSAGING & NOTIFICATIONS ---------------- */

const MESSAGES = {
  farmer: [
    { id: 'c1', name: 'VeggieTrack Central Hub', last: 'Your pickup has been approved', time: '10:32 AM', unread: 1 },
    { id: 'c2', name: 'Juan D. (Rider)', last: 'On my way, 12 mins out', time: '9:45 AM', unread: 0 },
  ],
  distributor: [
    { id: 'c1', name: 'Mang Tomas (Farmer)', last: 'Tomatoes ready for pickup', time: '8:50 AM', unread: 1 },
    { id: 'c2', name: "Nena's Turo-Turo", last: 'Can we get extra eggplant?', time: 'Yesterday', unread: 0 },
    { id: 'c3', name: 'Juan D. (Rider)', last: 'Delivered order O-3280', time: 'Sep 15', unread: 0 },
  ],
  rider: [
    { id: 'c1', name: 'VeggieTrack Central Hub', last: 'New pickup assigned: P-2201', time: '8:40 AM', unread: 1 },
    { id: 'c2', name: 'Mang Tomas (Farmer)', last: 'I\'m at the farm gate', time: '8:55 AM', unread: 0 },
  ],
  retailer: [
    { id: 'c1', name: 'VeggieTrack Central Hub', last: 'Order O-3301 is out for delivery', time: '9:10 AM', unread: 1 },
    { id: 'c2', name: 'Juan D. (Rider)', last: 'Arriving in 15 minutes', time: '9:12 AM', unread: 1 },
  ],
};

const CHAT_THREADS = {
  c1: [
    { from: 'them', text: 'Hi! Just confirming your request.', time: '10:20 AM' },
    { from: 'me', text: 'Yes please, thank you!', time: '10:25 AM' },
    { from: 'them', text: 'Your pickup has been approved.', time: '10:32 AM' },
  ],
  c2: [
    { from: 'them', text: 'Heading out now.', time: '9:30 AM' },
    { from: 'them', text: 'On my way, 12 mins out', time: '9:45 AM' },
  ],
  c3: [
    { from: 'them', text: 'Delivered order O-3280, thank you!', time: 'Sep 15' },
  ],
};

const NOTIFICATIONS = {
  farmer: [
    { text: 'Pickup P-2201 approved for Tomato 25kg', time: '10:32 AM', unread: true, nav: 'farmer-pickup-tracking', params: { id: 'P-2201' } },
    { text: 'Rider Juan D. assigned to your pickup', time: '9:10 AM', unread: true, nav: 'farmer-pickup-tracking', params: { id: 'P-2201' } },
    { text: 'Weekly report ready: 92 kg harvested', time: 'Sep 14', unread: false, nav: 'farmer-report-detail', params: { id: 'W-37' } },
  ],
  distributor: [
    { text: 'New pickup request from Aling Rosa', time: '9:05 AM', unread: true, nav: 'distributor-pickup-detail', params: { id: 'P-2205' } },
    { text: 'Low stock alert: Lettuce (8 kg left)', time: '8:30 AM', unread: true, nav: 'distributor-product-edit', params: { id: 'v4' } },
    { text: 'New order from Green Bowl Cafe', time: 'Yesterday', unread: false, nav: 'distributor-order-detail', params: { id: 'O-3298' } },
  ],
  rider: [
    { text: 'New task assigned: Pickup at Aling Rosa', time: '8:40 AM', unread: true, nav: 'rider-pickup-task', params: { id: 'T-03' } },
    { text: 'Delivery T-02 scheduled at 10:30 AM', time: '8:00 AM', unread: false, nav: 'rider-delivery-task', params: { id: 'T-02' } },
  ],
  retailer: [
    { text: 'Order ORD-3301 is out for delivery', time: '9:10 AM', unread: true, nav: 'retailer-order-tracking', params: { id: 'ORD-3301' } },
    { text: 'Order ORD-3280 delivered — rate your experience', time: 'Sep 15', unread: false, nav: 'retailer-order-detail', params: { id: 'ORD-3280' } },
  ],
};
