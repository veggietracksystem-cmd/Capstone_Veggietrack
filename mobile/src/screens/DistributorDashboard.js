import { useState, useEffect, useCallback } from 'react';
import {
  Text, View, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, StyleSheet, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../api/client';
import { fetchProducts, queueProduct, syncPending, getQueue } from '../offline/productStore';
import { readThrough } from '../offline/cache';
import { onReconnect } from '../offline/net';
import { useAuth } from '../context/AuthContext';
import LogoutButton from '../components/LogoutButton';
import NotificationBell from '../components/NotificationBell';
import BottomNavBar from '../components/BottomNavBar';

const PRIMARY = '#2e7d32';

const DISTRIBUTOR_TABS = [
  { id: 'home', icon: '🏠', label: 'Home' },
  { id: 'orders', icon: '📋', label: 'Orders' },
  { id: 'inventory', icon: '📦', label: 'Inventory' },
  { id: 'riders', icon: '🛵', label: 'Riders' },
  { id: 'profile', icon: '👤', label: 'Profile' },
];

export default function DistributorDashboard({ navigation, route }) {
  const { user } = useAuth();
  const [tab, setTab] = useState('orders'); // 'products' | 'pickups' | 'orders' | 'payments'
  const [activeBottomTab, setActiveBottomTab] = useState('home');

  const handleBottomTabPress = (t) => {
    setActiveBottomTab(t.id);
    if (t.id === 'inventory') {
      navigation.navigate('ProductList');
    } else if (t.id === 'profile') {
      navigation.navigate('Profile');
    } else if (t.id === 'orders') {
      setTab('orders');
    } else if (t.id === 'riders') {
      setTab('pickups');
    } else if (t.id === 'home') {
      setTab('orders');
    }
  };

  useEffect(() => {
    if (route.params?.tab) {
      setTab(route.params.tab);
    }
  }, [route.params?.tab]);

  // ----- Pickup requests (from farmers) + the receive (approve) modal -----
  const [pickupRequests, setPickupRequests] = useState([]);
  const [receiveReq, setReceiveReq] = useState(null); // request currently in the modal
  const [selectedRiderForPickup, setSelectedRiderForPickup] = useState(null);
  const [priceInput, setPriceInput] = useState('');   // optional price per kg
  const [receiveBusyId, setReceiveBusyId] = useState(null);

  // ----- Products state -----
  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [showProductForm, setShowProductForm] = useState(false);
  const [editingProductId, setEditingProductId] = useState(null);
  const [vegName, setVegName] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [savingProduct, setSavingProduct] = useState(false);

  // ----- Orders state -----
  const [orders, setOrders] = useState([]);
  // Issue 9: orders that are approved / in delivery. Without this list, an order
  // vanishes from the dashboard the moment a rider is assigned.
  const [activeOrders, setActiveOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [personnel, setPersonnel] = useState([]);
  const [selectedPersonnel, setSelectedPersonnel] = useState({}); // { [orderId]: personnelId }
  const [busyOrderId, setBusyOrderId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);

  // ----- Payments state -----
  const [paymentsSub, setPaymentsSub] = useState('unpaid'); // 'unpaid' | 'paid'
  const [unpaidOrders, setUnpaidOrders] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loadingPayments, setLoadingPayments] = useState(true);
  const [recordingId, setRecordingId] = useState(null); // order id being paid
  const [amountInput, setAmountInput] = useState('');
  const [recordBusy, setRecordBusy] = useState(false);

  // ----- Offline state -----
  const [productsOffline, setProductsOffline] = useState(false);
  const [ordersOffline, setOrdersOffline] = useState(false);
  const [paymentsOffline, setPaymentsOffline] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  // ---------- Loaders ----------
  const refreshPendingCount = useCallback(async () => {
    setPendingCount((await getQueue()).length);
  }, []);

  // Products: read-through cache + write queue.
  const loadProducts = useCallback(async () => {
    const { list, source } = await fetchProducts();
    setProducts(list);
    setProductsOffline(source === 'cache');
    await refreshPendingCount();
  }, [refreshPendingCount]);

  // Pending orders: read-through cache only (approve/assign stay online).
  const loadOrders = useCallback(async () => {
    const { list, source } = await readThrough('orders_pending_cache', () =>
      api.get('/api/orders/pending')
    );
    setOrders(list);
    setOrdersOffline(source === 'cache');
  }, []);

  // Active (approved / picked_up / in_transit) orders — so assigned orders stay
  // visible on the dashboard (Issue 9).
  const loadActiveOrders = useCallback(async () => {
    const { list } = await readThrough('orders_active_cache', () =>
      api.get('/api/orders/active')
    );
    setActiveOrders(list);
  }, []);

  // Pickup requests from farmers — feeds the Harvest Receiving card count.
  const loadPickupRequests = useCallback(async () => {
    const { list } = await readThrough('pickup_requests_cache', () =>
      api.get('/api/pickup-requests')
    );
    setPickupRequests(list);
  }, []);

  // Delivery personnel: cached so the assign picker has names offline.
  const loadPersonnel = useCallback(async () => {
    const { list } = await readThrough('personnel_cache', () =>
      api.get('/api/delivery-personnel')
    );
    setPersonnel(list);
  }, []);

  // Payments: read-through cache (recording a payment stays online).
  const loadPayments = useCallback(async () => {
    const [unpaidRes, paidRes] = await Promise.all([
      readThrough('unpaid_orders_cache', () => api.get('/api/orders/unpaid')),
      readThrough('payments_cache', () => api.get('/api/payments')),
    ]);
    setUnpaidOrders(unpaidRes.list);
    setPayments(paidRes.list);
    setPaymentsOffline(unpaidRes.source === 'cache' || paidRes.source === 'cache');
  }, []);

  // Flush queued product writes, then reload.
  const trySync = useCallback(async () => {
    const result = await syncPending();
    if (result.synced > 0) await loadProducts();
    await refreshPendingCount();
    return result;
  }, [loadProducts, refreshPendingCount]);

  useEffect(() => {
    (async () => {
      setLoadingProducts(true);
      setLoadingOrders(true);
      setLoadingPayments(true);
      await Promise.all([loadProducts(), loadOrders(), loadActiveOrders(), loadPersonnel(), loadPayments(), loadPickupRequests()]);
      await trySync();
      setLoadingProducts(false);
      setLoadingOrders(false);
      setLoadingPayments(false);
    })();

    const unsubscribe = onReconnect(() => { trySync(); });
    return unsubscribe;
  }, [loadProducts, loadOrders, loadActiveOrders, loadPersonnel, loadPayments, loadPickupRequests, trySync]);

  // Refresh the pickup-request count whenever this screen regains focus
  // (e.g. returning from another screen after stock changes).
  useEffect(() => {
    if (!navigation?.addListener) return undefined;
    return navigation.addListener('focus', () => {
      loadPickupRequests();
      loadProducts();
    });
  }, [navigation, loadPickupRequests, loadProducts]);

  // Issue 10: poll orders every 30s so the "In Progress" statuses (picked up /
  // in transit / delivered) update without a manual pull-to-refresh.
  useEffect(() => {
    const id = setInterval(() => { loadOrders(); loadActiveOrders(); }, 30000);
    return () => clearInterval(id);
  }, [loadOrders, loadActiveOrders]);

  const onRefresh = async () => {
    setRefreshing(true);
    if (tab === 'products') { await loadProducts(); await trySync(); }
    else if (tab === 'orders') await Promise.all([loadOrders(), loadActiveOrders(), loadPersonnel(), loadPickupRequests()]);
    else if (tab === 'pickups') await loadPickupRequests();
    else await loadPayments();
    setRefreshing(false);
  };

  // ---------- Payment actions (online-only) ----------
  const startRecord = (order) => {
    setRecordingId(order.id);
    setAmountInput(String(order.total_amount ?? ''));
  };

  const recordPayment = async (order) => {
    const amount = parseFloat(amountInput);
    if (isNaN(amount) || amount <= 0) {
      showAlert('Error', 'Enter a valid payment amount.');
      return;
    }
    setRecordBusy(true);
    try {
      await api.post('/api/payments', { order_id: order.id, amount });
      setRecordingId(null);
      setAmountInput('');
      await loadPayments(); // refresh unpaid + paid lists
      showAlert('Payment recorded', `₱${amount.toFixed(2)} recorded for order ${shortId(order.id)}.`);
    } catch (err) {
      showAlert('Error', err.message);
    } finally {
      setRecordBusy(false);
    }
  };

  // ---------- Product form ----------
  const resetProductForm = () => {
    setEditingProductId(null);
    setVegName('');
    setPrice('');
    setStock('');
  };

  const openAddProduct = () => {
    resetProductForm();
    setShowProductForm(true);
  };

  const openEditProduct = (p) => {
    setEditingProductId(p.id);
    setVegName(p.vegetable_name);
    setPrice(String(p.price_per_kg));
    setStock(String(p.stock_kg));
    setShowProductForm(true);
  };

  // ProductListScreen's "Edit" action navigates here with an editProduct param.
  // Switch to the Products tab, open the form pre-filled, then clear the param.
  useEffect(() => {
    const p = route?.params?.editProduct;
    if (p) {
      setTab('products');
      openEditProduct(p);
      navigation?.setParams?.({ editProduct: undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params?.editProduct]);

  const saveProduct = async () => {
    const name = vegName.trim();
    const priceNum = parseFloat(price);
    const stockNum = parseFloat(stock);

    if (!editingProductId && !name) {
      showAlert('Error', 'Enter a vegetable name.');
      return;
    }
    if (isNaN(priceNum) || priceNum < 0) {
      showAlert('Error', 'Enter a valid price per kg.');
      return;
    }
    if (isNaN(stockNum) || stockNum < 0) {
      showAlert('Error', 'Enter a valid stock in kg.');
      return;
    }

    setSavingProduct(true);
    try {
      const mutation = editingProductId
        ? { type: 'edit', id: editingProductId, payload: { price_per_kg: priceNum, stock_kg: stockNum } }
        : { type: 'add', payload: { vegetable_name: name, price_per_kg: priceNum, stock_kg: stockNum } };

      // Write locally + update UI immediately (works offline).
      const optimistic = await queueProduct(mutation);
      setProducts(optimistic);
      await refreshPendingCount();
      resetProductForm();
      setShowProductForm(false);

      // Try to push now; if offline it stays queued.
      const result = await trySync();
      if (result.offline || result.remaining > 0) {
        showAlert('Saved offline', 'Your change is saved on this device and will sync when you’re back online.');
      }
    } catch (err) {
      showAlert('Error', err.message);
    } finally {
      setSavingProduct(false);
    }
  };

  // ---------- Order actions ----------
  const approveOrder = async (order) => {
    setBusyOrderId(order.id);
    try {
      await api.put(`/api/orders/${order.id}/approve`);
      // Flip the card to "approved" so the assign picker appears (don't remove yet).
      setOrders((prev) =>
        prev.map((o) => (o.id === order.id ? { ...o, status: 'approved' } : o))
      );
      if (personnel.length === 0) await loadPersonnel();
      showAlert('Approved', `Order ${shortId(order.id)} approved. Now assign a delivery person.`);
    } catch (err) {
      showAlert('Error', err.message);
    } finally {
      setBusyOrderId(null);
    }
  };

  const assignDelivery = async (order) => {
    const personnelId = selectedPersonnel[order.id];
    if (!personnelId) {
      showAlert('Error', 'Select a delivery person first.');
      return;
    }
    setBusyOrderId(order.id);
    try {
      await api.put(`/api/orders/${order.id}/assign`, { delivery_personnel_id: personnelId });
      // Remove from the pending/approved list and refresh the active list so the
      // order reappears there as "assigned" instead of disappearing (Issue 9).
      setOrders((prev) => prev.filter((o) => o.id !== order.id));
      await loadActiveOrders();
      showAlert('Assigned', `Delivery assigned for order ${shortId(order.id)}. See "In Progress" below.`);
    } catch (err) {
      showAlert('Error', err.message);
    } finally {
      setBusyOrderId(null);
    }
  };

  // ---------- Weekly report (online-only) ----------
  const showWeeklyReport = async () => {
    setLoadingReport(true);
    try {
      const r = await api.get('/api/distributor/weekly-report');
      const inventory = (r.current_inventory || []).length
        ? r.current_inventory.map((p) => `• ${p.vegetable_name} — ${p.stock_kg} kg`).join('\n')
        : 'No products in inventory.';
      const body =
        `Period: ${r.period}\n` +
        `Total orders: ${r.total_orders}\n` +
        `Completed orders: ${r.completed_orders}\n` +
        `Revenue: ${peso(r.total_revenue)}\n\n` +
        `Inventory:\n${inventory}`;
      showAlert('Weekly Report', body);
    } catch (err) {
      showAlert('Error', err.message);
    } finally {
      setLoadingReport(false);
    }
  };

  // ---------- Pickup request actions ----------
  // Open the price-entry / approval modal for a request.
  const openReceive = (req) => {
    setReceiveReq(req);
    setPriceInput('');
    setSelectedRiderForPickup(null);
  };

  // Approve & receive: assigns rider (PUT /api/pickup-requests/:id/assign), then refreshes lists.
  const confirmReceive = async () => {
    const req = receiveReq;
    if (!req) return;
    const price = parseFloat(priceInput);
    if (priceInput && (isNaN(price) || price < 0)) {
      showAlert('Error', 'Enter a valid price per kg (or leave blank).');
      return;
    }
    if (!selectedRiderForPickup) {
      showAlert('Error', 'Please select a delivery personnel to assign.');
      return;
    }
    setReceiveBusyId(req.id);
    try {
      await api.put(`/api/pickup-requests/${req.id}/assign`, {
        delivery_personnel_id: selectedRiderForPickup,
        price_per_kg: priceInput ? price : null
      });
      setReceiveReq(null);
      // Refresh so the request leaves the list.
      await Promise.all([loadPickupRequests(), loadProducts()]);
      showAlert('Rider Assigned', 'Delivery personnel has been assigned to the pickup request.');
    } catch (err) {
      showAlert('Error', `Could not assign rider: ${err.message}`);
    } finally {
      setReceiveBusyId(null);
    }
  };

  // Outstanding pickup requests still awaiting the distributor.
  const pendingReceiveCount = pickupRequests.filter((p) => p.status === 'requested').length;

  // ---------- Render ----------
  return (
    <SafeAreaView style={styles.container}>
      {/* Minimal Top Navigation Bar */}
      <View style={styles.minimalHeader}>
        <Text style={styles.minimalTitle}>Distributor Hub</Text>
        <NotificationBell />
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, tab === 'products' && styles.tabActive]}
          onPress={() => setTab('products')}
        >
          <Text style={[styles.tabText, tab === 'products' && styles.tabTextActive]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>Products</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'orders' && styles.tabActive]}
          onPress={() => setTab('orders')}
        >
          <Text style={[styles.tabText, tab === 'orders' && styles.tabTextActive]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            Orders{orders.length ? ` (${orders.length})` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'pickups' && styles.tabActive]}
          onPress={() => setTab('pickups')}
        >
          <Text
            style={[styles.tabText, tab === 'pickups' && styles.tabTextActive]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
          >
            Pickup Requests{pendingReceiveCount ? ` (${pendingReceiveCount})` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'payments' && styles.tabActive]}
          onPress={() => setTab('payments')}
        >
          <Text style={[styles.tabText, tab === 'payments' && styles.tabTextActive]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            Payments{unpaidOrders.length ? ` (${unpaidOrders.length})` : ''}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <OfflineBanner
          offline={tab === 'products' ? productsOffline : tab === 'orders' ? ordersOffline : tab === 'payments' ? paymentsOffline : false}
          pendingCount={tab === 'products' ? pendingCount : 0}
        />

        {tab === 'products' && (
          <ProductsTab
            loading={loadingProducts}
            products={products}
            showForm={showProductForm}
            editingProductId={editingProductId}
            vegName={vegName} setVegName={setVegName}
            price={price} setPrice={setPrice}
            stock={stock} setStock={setStock}
            saving={savingProduct}
            onAdd={openAddProduct}
            onSave={saveProduct}
            onCancel={() => { resetProductForm(); setShowProductForm(false); }}
            onViewAll={() => navigation.navigate('ProductList')}
          />
        )}

        {tab === 'orders' && (
          <OrdersTab
            loading={loadingOrders}
            orders={orders}
            activeOrders={activeOrders}
            personnel={personnel}
            selectedPersonnel={selectedPersonnel}
            setSelectedPersonnel={setSelectedPersonnel}
            busyOrderId={busyOrderId}
            onApprove={approveOrder}
            onAssign={assignDelivery}
            onTrack={(o) => navigation.navigate('OrderTracking', {
              orderId: o.id,
              deliveryAddress: o.delivery_address,
              orderStatus: o.status,
            })}
          />
        )}

        {tab === 'pickups' && (
          <PickupRequestsTab
            loading={loadingOrders}
            requests={pickupRequests}
            busyId={receiveBusyId}
            onApprove={openReceive}
          />
        )}

        {tab === 'payments' && (
          <PaymentsTab
            loading={loadingPayments}
            sub={paymentsSub}
            setSub={setPaymentsSub}
            unpaidOrders={unpaidOrders}
            payments={payments}
            recordingId={recordingId}
            amountInput={amountInput}
            setAmountInput={setAmountInput}
            recordBusy={recordBusy}
            onStartRecord={startRecord}
            onCancelRecord={() => { setRecordingId(null); setAmountInput(''); }}
            onRecord={recordPayment}
          />
        )}
      </ScrollView>

      {/* Approve & Assign modal — set a selling price and assign a rider (PUT /api/pickup-requests/:id/assign). */}
      <CustomModal
        visible={!!receiveReq}
        title="Approve & Assign Rider"
        confirmLabel={receiveBusyId === receiveReq?.id ? 'Saving…' : 'Confirm'}
        onConfirm={confirmReceive}
        cancelLabel="Cancel"
        onCancel={() => setReceiveReq(null)}
        busy={receiveBusyId === receiveReq?.id}
      >
        {receiveReq ? (
          <>
            <Text style={styles.modalLine}>
              {harvestOf(receiveReq)?.vegetable_name || 'Harvest'}
              {harvestOf(receiveReq)?.quantity_kg != null
                ? ` — ${harvestOf(receiveReq).quantity_kg} kg`
                : ''}
            </Text>
            <Text style={styles.modalHint}>
              Set a selling price per kg. Leave blank to add it with ₱0 and price it
              later in Products.
            </Text>
            <Text style={styles.fieldLabel}>Price per kg (₱)</Text>
            <TextInput
              style={styles.input}
              value={priceInput}
              onChangeText={setPriceInput}
              keyboardType="numeric"
              placeholder="e.g., 45"
              editable={receiveBusyId !== receiveReq.id}
            />

            <Text style={[styles.fieldLabel, { marginTop: 15 }]}>Assign Delivery Personnel</Text>
            {personnel.length === 0 ? (
              <Text style={styles.modalHint}>No delivery personnel available.</Text>
            ) : (
              <View style={styles.personnelWrap}>
                {personnel.map((dp) => {
                  const selected = selectedRiderForPickup === dp.id;
                  return (
                    <TouchableOpacity
                      key={dp.id}
                      style={[styles.personChip, selected && styles.personChipActive]}
                      onPress={() => setSelectedRiderForPickup(dp.id)}
                      disabled={receiveBusyId === receiveReq.id}
                    >
                      <Text style={[styles.personChipText, selected && styles.personChipTextActive]}>
                        {dp.full_name || shortId(dp.id)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </>
        ) : null}
      </CustomModal>

      <BottomNavBar
        tabs={DISTRIBUTOR_TABS}
        activeTab={activeBottomTab}
        onTabPress={handleBottomTabPress}
      />
    </SafeAreaView>
  );
}

// ================= Pickup Requests tab =================
function PickupRequestsTab({ loading, requests, busyId, onApprove }) {
  if (loading) return <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />;

  // Only requests still awaiting receipt are actionable.
  const pending = (requests || []).filter((r) => r.status === 'requested');

  return (
    <View>
      <Text style={styles.sectionTitle}>Pickup Requests</Text>
      {pending.length === 0 ? (
        <EmptyState
          icon="🚜"
          title="No pending pickup requests"
          message="When farmers request a pickup, it will appear here for approval."
        />
      ) : (
        pending.map((req) => {
          const harvest = harvestOf(req);
          const busy = busyId === req.id;
          return (
            <View key={req.id} style={styles.pickupCard}>
              <Text style={styles.pickupFarmer}>👨‍🌾 {farmerNameOf(req)}</Text>
              <Text style={styles.pickupHarvest}>
                {harvest?.vegetable_name || 'Harvest'}
                {harvest?.quantity_kg != null ? ` — ${harvest.quantity_kg} kg` : ''}
              </Text>
              {req.note ? <Text style={styles.pickupNote}>Note: {req.note}</Text> : null}
              <Text style={styles.pickupMeta}>
                Status: {req.status}
                {req.created_at ? ` • Requested ${new Date(req.created_at).toLocaleDateString()}` : ''}
              </Text>

              <TouchableOpacity
                style={[styles.primaryBtn, { marginTop: 12, marginBottom: 0 }, busy && styles.buttonDisabled]}
                onPress={() => onApprove(req)}
                disabled={busy}
              >
                {busy
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.primaryBtnText}>Approve & Assign Rider</Text>}
              </TouchableOpacity>
            </View>
          );
        })
      )}
    </View>
  );
}

// ================= Products tab =================
function ProductsTab({
  loading, products, showForm, editingProductId,
  vegName, setVegName, price, setPrice, stock, setStock,
  saving, onAdd, onSave, onCancel, onViewAll,
}) {
  if (loading) return <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />;

  return (
    <View>
      <TouchableOpacity style={styles.primaryBtn} onPress={onAdd}>
        <Text style={styles.primaryBtnText}>+ Add Product</Text>
      </TouchableOpacity>

      {showForm && (
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>{editingProductId ? 'Edit Product' : 'Add Product'}</Text>

          <Text style={styles.fieldLabel}>Vegetable name</Text>
          <TextInput
            style={[styles.input, editingProductId && styles.inputDisabled]}
            placeholder="e.g., Carrot"
            value={vegName}
            onChangeText={setVegName}
            editable={!editingProductId && !saving}
          />
          {editingProductId ? (
            <Text style={styles.hint}>Name can’t be changed when editing.</Text>
          ) : null}

          <Text style={styles.fieldLabel}>Price per kg (₱)</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g., 45"
            value={price}
            onChangeText={setPrice}
            keyboardType="numeric"
            editable={!saving}
          />

          <Text style={styles.fieldLabel}>Stock (kg)</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g., 100"
            value={stock}
            onChangeText={setStock}
            keyboardType="numeric"
            editable={!saving}
          />

          <View style={styles.formButtons}>
            <TouchableOpacity
              style={[styles.button, styles.buttonPrimary, saving && styles.buttonDisabled]}
              onPress={onSave}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.buttonPrimaryText}>{editingProductId ? 'Save Changes' : 'Add Product'}</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.buttonOutline]} onPress={onCancel} disabled={saving}>
              <Text style={styles.buttonOutlineText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <Text style={styles.sectionTitle}>My Products</Text>
      {products.length === 0 ? (
        <EmptyState
          icon="📦"
          title="No products yet"
          message="Add a product to start selling to retailers."
          actionLabel="Add Product"
          onAction={onAdd}
        />
      ) : (
        <TouchableOpacity style={styles.viewAllBtn} onPress={onViewAll} activeOpacity={0.85}>
          <Text style={styles.viewAllText}>View All Products ({products.length})</Text>
          <Text style={styles.viewAllChevron}>›</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// The embedded deliveries relation comes back as an array; take the first record.
function getDelivery(order) {
  if (Array.isArray(order.deliveries)) return order.deliveries[0] || null;
  return order.deliveries || null;
}

// Effective status prefers the delivery record's status, falling back to the order's.
function effectiveStatus(order) {
  const d = getDelivery(order);
  return d?.status || order.status || 'pending';
}

// ================= Orders tab =================
function OrdersTab({
  loading, orders, activeOrders = [], personnel, selectedPersonnel, setSelectedPersonnel,
  busyOrderId, onApprove, onAssign, onTrack,
}) {
  if (loading) return <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />;

  // "In Progress" = approved/assigned/in-transit orders not currently being
  // worked on in the pending list above (Issue 9 — they used to disappear).
  const pendingIds = new Set(orders.map((o) => o.id));
  const inProgress = activeOrders.filter((o) => !pendingIds.has(o.id));

  return (
    <View>
      <Text style={styles.sectionTitle}>Pending Orders</Text>
      {orders.length === 0 ? (
        <EmptyState
          icon="✅"
          title="No pending orders"
          message="New retailer orders will appear here for approval."
        />
      ) : orders.map((order) => {
        const busy = busyOrderId === order.id;
        const isApproved = order.status === 'approved';
        const items = order.order_items || [];

        return (
          <View key={order.id} style={styles.orderCard}>
            <View style={styles.orderHeader}>
              <Text style={styles.orderId}>Order #{shortId(order.id)}</Text>
              <Text style={styles.orderTotal}>{peso(order.total_amount)}</Text>
            </View>
            <Text style={styles.rowMeta}>Retailer: {shortId(order.retailer_id)}</Text>
            {order.delivery_address ? (
              <Text style={styles.rowMeta}>Deliver to: {order.delivery_address}</Text>
            ) : null}

            <View style={styles.itemsBox}>
              {items.length === 0 ? (
                <Text style={styles.rowMeta}>No item details.</Text>
              ) : (
                items.map((it, i) => (
                  <Text key={i} style={styles.itemLine}>
                    • {it.vegetable_name} — {it.quantity_kg}kg @ {peso(it.price_at_order)}
                  </Text>
                ))
              )}
            </View>

            {order.delivery_address && order.status !== 'pending' && order.status !== 'cancelled' ? (
              <TouchableOpacity
                style={styles.trackBtn}
                onPress={() => onTrack(order)}
                activeOpacity={0.8}
              >
                <Text style={styles.trackBtnText}>🗺️  Track Delivery</Text>
              </TouchableOpacity>
            ) : null}

            {!isApproved ? (
              <TouchableOpacity
                style={[styles.button, styles.buttonPrimary, busy && styles.buttonDisabled]}
                onPress={() => onApprove(order)}
                disabled={busy}
              >
                {busy
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.buttonPrimaryText}>Approve</Text>}
              </TouchableOpacity>
            ) : (
              <View>
                <Text style={styles.assignLabel}>Assign delivery person:</Text>
                {personnel.length === 0 ? (
                  <Text style={styles.rowMeta}>No delivery personnel available.</Text>
                ) : (
                  <View style={styles.personnelWrap}>
                    {personnel.map((dp) => {
                      const selected = selectedPersonnel[order.id] === dp.id;
                      return (
                        <TouchableOpacity
                          key={dp.id}
                          style={[styles.personChip, selected && styles.personChipActive]}
                          onPress={() =>
                            setSelectedPersonnel((prev) => ({ ...prev, [order.id]: dp.id }))
                          }
                          disabled={busy}
                        >
                          <Text style={[styles.personChipText, selected && styles.personChipTextActive]}>
                            {dp.full_name || shortId(dp.id)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
                <TouchableOpacity
                  style={[styles.button, styles.buttonPrimary, busy && styles.buttonDisabled, { marginTop: 10 }]}
                  onPress={() => onAssign(order)}
                  disabled={busy}
                >
                  {busy
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={styles.buttonPrimaryText}>Assign Delivery</Text>}
                </TouchableOpacity>
              </View>
            )}
          </View>
        );
      })}

      {/* Issue 9 & History: orders approved/assigned/in-transit/delivered/cancelled stay visible here in history. */}
      {inProgress.length > 0 && (
        <View style={{ marginTop: 18 }}>
          <Text style={styles.sectionTitle}>Order History ({inProgress.length})</Text>
          {inProgress.map((order) => {
            const status = effectiveStatus(order);
            return (
              <View key={order.id} style={styles.orderCard}>
                <View style={styles.orderHeader}>
                  <Text style={styles.orderId}>Order #{shortId(order.id)}</Text>
                  <View style={[styles.statusPill, { backgroundColor: ACTIVE_STATUS_COLOR[status] || '#607d8b' }]}>
                    <Text style={styles.statusPillText}>{status.replace(/_/g, ' ')}</Text>
                  </View>
                </View>
                <Text style={styles.rowMeta}>Total: {peso(order.total_amount)}</Text>
                <Text style={styles.rowMeta}>
                  {order.delivery_personnel_name
                    ? `Rider: ${order.delivery_personnel_name}`
                    : 'Awaiting rider assignment'}
                </Text>
                {order.delivery_address && order.status !== 'pending' && order.status !== 'cancelled' ? (
                  <TouchableOpacity
                    style={[styles.trackBtn, { marginTop: 10, marginBottom: 0 }]}
                    onPress={() => onTrack(order)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.trackBtnText}>🗺️  Track Delivery</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

// Status badge colours for the "History" list.
const ACTIVE_STATUS_COLOR = {
  approved: '#1976d2',
  assigned: '#1565c0',
  picked_up: '#00897b',
  in_transit: '#7b1fa2',
  delivered: '#2e7d32',
  cancelled: '#c62828',
};

// ================= Payments tab =================
function PaymentsTab({
  loading, sub, setSub, unpaidOrders, payments,
  recordingId, amountInput, setAmountInput, recordBusy,
  onStartRecord, onCancelRecord, onRecord,
}) {
  if (loading) return <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />;

  return (
    <View>
      {/* Unpaid / Paid sub-toggle */}
      <View style={styles.subTabs}>
        <TouchableOpacity
          style={[styles.subTab, sub === 'unpaid' && styles.subTabActive]}
          onPress={() => setSub('unpaid')}
        >
          <Text style={[styles.subTabText, sub === 'unpaid' && styles.subTabTextActive]}>
            Unpaid{unpaidOrders.length ? ` (${unpaidOrders.length})` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.subTab, sub === 'paid' && styles.subTabActive]}
          onPress={() => setSub('paid')}
        >
          <Text style={[styles.subTabText, sub === 'paid' && styles.subTabTextActive]}>Paid</Text>
        </TouchableOpacity>
      </View>

      {sub === 'unpaid' ? (
        unpaidOrders.length === 0 ? (
          <EmptyState icon="🎉" title="All caught up" message="No unpaid orders right now." />
        ) : (
          unpaidOrders.map((o) => (
            <View key={o.id} style={styles.rowCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>Order #{shortId(o.id)}</Text>
                <Text style={styles.rowMeta}>{peso(o.total_amount)} · {o.status}</Text>
                {o.delivery_address ? (
                  <Text style={styles.rowMeta}>{o.delivery_address}</Text>
                ) : null}

                {recordingId === o.id && (
                  <View style={styles.recordBox}>
                    <Text style={styles.fieldLabel}>Amount received (₱)</Text>
                    <TextInput
                      style={styles.input}
                      value={amountInput}
                      onChangeText={setAmountInput}
                      keyboardType="numeric"
                      editable={!recordBusy}
                    />
                    <View style={styles.recordButtons}>
                      <TouchableOpacity
                        style={[styles.button, styles.buttonPrimary, recordBusy && styles.buttonDisabled]}
                        onPress={() => onRecord(o)}
                        disabled={recordBusy}
                      >
                        {recordBusy
                          ? <ActivityIndicator color="#fff" />
                          : <Text style={styles.buttonPrimaryText}>Confirm</Text>}
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.button, styles.buttonOutline]}
                        onPress={onCancelRecord}
                        disabled={recordBusy}
                      >
                        <Text style={styles.buttonOutlineText}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>

              {recordingId !== o.id && (
                <TouchableOpacity style={styles.smallBtn} onPress={() => onStartRecord(o)}>
                  <Text style={styles.smallBtnText}>Record Payment</Text>
                </TouchableOpacity>
              )}
            </View>
          ))
        )
      ) : payments.length === 0 ? (
        <EmptyState icon="💸" title="No payments yet" message="Recorded payments will show up here." />
      ) : (
        payments.map((p) => (
          <View key={p.id} style={styles.rowCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{peso(p.amount)}</Text>
              <Text style={styles.rowMeta}>
                Order #{shortId(p.order_id)}
                {p.orders?.total_amount != null ? ` · total ${peso(p.orders.total_amount)}` : ''}
              </Text>
              {p.recorded_at ? (
                <Text style={styles.rowMeta}>{new Date(p.recorded_at).toLocaleDateString()}</Text>
              ) : null}
            </View>
            <View style={styles.paidBadge}>
              <Text style={styles.paidBadgeText}>{p.status || 'paid'}</Text>
            </View>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },

  minimalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#eeeeee',
  },
  minimalTitle: { fontSize: 18, fontWeight: '700', color: PRIMARY },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 16, paddingBottom: 8 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 24, fontWeight: 'bold', color: PRIMARY },
  subtitle: { fontSize: 14, color: '#555', marginTop: 2 },

  tabs: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 8, backgroundColor: '#e8f0e9', borderRadius: 10, padding: 4 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  tabActive: { backgroundColor: PRIMARY },
  tabText: { color: PRIMARY, fontWeight: '600', fontSize: 13 },
  tabTextActive: { color: '#fff' },

  subTabs: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  subTab: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: PRIMARY },
  subTabActive: { backgroundColor: PRIMARY },
  subTabText: { color: PRIMARY, fontWeight: '600', fontSize: 14 },
  subTabTextActive: { color: '#fff' },

  recordBox: { marginTop: 10, backgroundColor: '#fafafa', borderRadius: 8, padding: 10 },
  recordButtons: { flexDirection: 'row', gap: 10, marginTop: 12 },
  paidBadge: { paddingVertical: 3, paddingHorizontal: 10, borderRadius: 12, backgroundColor: '#e8f5e9', borderWidth: 1, borderColor: PRIMARY },
  paidBadgeText: { fontSize: 12, color: PRIMARY, fontWeight: '600', textTransform: 'capitalize' },

  content: { padding: 16, paddingBottom: 40 },

  // Harvest Receiving card

  primaryBtn: { backgroundColor: PRIMARY, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginBottom: 14 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },

  viewAllBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderRadius: 10, paddingVertical: 14, paddingHorizontal: 16, borderWidth: 1, borderColor: PRIMARY },
  viewAllText: { color: PRIMARY, fontWeight: '700', fontSize: 15 },
  viewAllChevron: { fontSize: 22, color: PRIMARY },

  formCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#eee' },
  formTitle: { fontSize: 18, fontWeight: '700', color: PRIMARY, marginBottom: 8 },
  fieldLabel: { fontSize: 13, color: '#555', marginTop: 8, marginBottom: 6 },
  input: { backgroundColor: '#fafafa', borderRadius: 8, padding: 12, fontSize: 16, borderWidth: 1, borderColor: '#ddd' },
  inputDisabled: { backgroundColor: '#f0f0f0', color: '#888' },
  hint: { fontSize: 12, color: '#999', marginTop: 4 },
  formButtons: { flexDirection: 'row', gap: 10, marginTop: 16 },
  button: { flex: 1, paddingVertical: 14, borderRadius: 8, alignItems: 'center' },
  buttonPrimary: { backgroundColor: PRIMARY },
  buttonPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  buttonOutline: { borderWidth: 1, borderColor: PRIMARY },
  buttonOutlineText: { color: PRIMARY, fontWeight: '600', fontSize: 16 },
  buttonDisabled: { opacity: 0.6 },

  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#333', marginBottom: 10, marginTop: 4 },

  // Pickup Requests tab
  pickupCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#eee' },
  pickupFarmer: { fontSize: 16, fontWeight: '700', color: '#222' },
  pickupHarvest: { fontSize: 15, color: PRIMARY, fontWeight: '600', marginTop: 4 },
  pickupNote: { fontSize: 13, color: '#555', marginTop: 4 },
  pickupMeta: { fontSize: 12, color: '#999', marginTop: 4 },
  // Approve & Receive modal
  modalLine: { fontSize: 16, fontWeight: '700', color: '#222', marginBottom: 6 },
  modalHint: { fontSize: 13, color: '#777', marginBottom: 10 },
  emptyText: { color: '#888', fontStyle: 'italic', marginTop: 8 },

  rowCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#eee' },
  rowTitle: { fontSize: 16, fontWeight: '700', color: '#222' },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  rowMeta: { fontSize: 14, color: '#555', marginTop: 2 },
  pendingBadge: { paddingVertical: 2, paddingHorizontal: 8, borderRadius: 10, backgroundColor: '#fff3e0', borderWidth: 1, borderColor: '#fb8c00' },
  pendingBadgeText: { fontSize: 11, color: '#e65100', fontWeight: '600' },
  smallBtn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: PRIMARY },
  smallBtnText: { color: PRIMARY, fontWeight: '600', fontSize: 13 },

  orderCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#eee' },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  orderId: { fontSize: 16, fontWeight: '700', color: '#222' },
  orderTotal: { fontSize: 16, fontWeight: '700', color: PRIMARY },
  statusPill: { paddingVertical: 3, paddingHorizontal: 10, borderRadius: 12 },
  statusPillText: { color: '#fff', fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },
  itemsBox: { backgroundColor: '#fafafa', borderRadius: 8, padding: 10, marginVertical: 10 },
  itemLine: { fontSize: 13, color: '#444', marginBottom: 2 },

  trackBtn: { marginBottom: 10, paddingVertical: 10, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: PRIMARY },
  trackBtnText: { color: PRIMARY, fontWeight: '700', fontSize: 14 },

  assignLabel: { fontSize: 14, fontWeight: '600', color: '#333', marginTop: 6, marginBottom: 8 },
  personnelWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  personChip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: '#ccc', backgroundColor: '#fafafa' },
  personChipActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  personChipText: { color: '#555', fontSize: 13 },
  personChipTextActive: { color: '#fff', fontWeight: '600' },
});
