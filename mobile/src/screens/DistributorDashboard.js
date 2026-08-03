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
import OfflineBanner from '../components/OfflineBanner';
import EmptyState from '../components/EmptyState';
import CustomModal from '../components/CustomModal';
import { showAlert, peso, shortId } from '../lib/ui';
import { colors, fonts, radius, shadowCard } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';
import { isVegetable, VEGETABLE_VALIDATION_MESSAGE } from '../lib/vegetables';

const PRIMARY = colors.leaf700;

// Pickup requests embed the harvest + (optionally) the farmer. Be defensive
// about the exact relation key the backend returns.
function harvestOf(req) {
  return req.harvests || req.harvest || null;
}
function farmerNameOf(req) {
  return (
    req.farmer_name ||
    req.farmer?.full_name ||
    req.users?.full_name ||
    `Farmer ${shortId(req.farmer_id)}`
  );
}

export default function DistributorDashboard({ navigation, route }) {
  const { user } = useAuth();
  const { t } = useTranslation();

  const DISTRIBUTOR_TABS = [
    { id: 'home', iconName: 'home-outline', label: t('dashboards.distributor.tabHome') },
    { id: 'orders', iconName: 'clipboard-outline', label: t('dashboards.distributor.tabOrders') },
    { id: 'inventory', iconName: 'cube-outline', label: t('dashboards.distributor.tabInventory') },
    { id: 'riders', iconName: 'bicycle-outline', label: t('dashboards.distributor.tabRiders') },
    { id: 'profile', iconName: 'person-outline', label: t('dashboards.distributor.tabProfile') },
  ];
  const [tab, setTab] = useState('orders'); // 'products' | 'pickups' | 'orders' | 'payments'
  const [activeBottomTab, setActiveBottomTab] = useState('home');

  const handleBottomTabPress = (tab) => {
    setActiveBottomTab(tab.id);
    if (tab.id === 'inventory') {
      navigation.navigate('ProductList');
    } else if (tab.id === 'profile') {
      navigation.navigate('Profile');
    } else if (tab.id === 'orders') {
      setTab('orders');
    } else if (tab.id === 'riders') {
      setTab('pickups');
    } else if (tab.id === 'home') {
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
      showAlert(t('common.error'), t('dashboards.distributor.invalidAmount'));
      return;
    }
    setRecordBusy(true);
    try {
      await api.post('/api/payments', { order_id: order.id, amount });
      setRecordingId(null);
      setAmountInput('');
      await loadPayments(); // refresh unpaid + paid lists
      showAlert(t('dashboards.distributor.paymentRecordedTitle'), t('dashboards.distributor.paymentRecordedMessage', { amount: amount.toFixed(2), id: shortId(order.id) }));
    } catch (err) {
      showAlert(t('common.error'), err.message);
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
      showAlert(t('common.error'), t('dashboards.distributor.enterVegetableName'));
      return;
    }
    if (!editingProductId && !isVegetable(name)) {
      showAlert(t('common.error'), VEGETABLE_VALIDATION_MESSAGE);
      return;
    }
    if (isNaN(priceNum) || priceNum < 0) {
      showAlert(t('common.error'), t('dashboards.distributor.enterValidPrice'));
      return;
    }
    if (isNaN(stockNum) || stockNum < 0) {
      showAlert(t('common.error'), t('dashboards.distributor.enterValidStock'));
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
        showAlert(t('dashboards.distributor.savedOfflineTitle'), t('dashboards.distributor.savedOfflineMessage'));
      }
    } catch (err) {
      showAlert(t('common.error'), err.message);
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
      showAlert(t('dashboards.distributor.orderApprovedTitle'), t('dashboards.distributor.orderApprovedMessage', { id: shortId(order.id) }));
    } catch (err) {
      showAlert(t('common.error'), err.message);
    } finally {
      setBusyOrderId(null);
    }
  };

  const assignDelivery = async (order) => {
    const personnelId = selectedPersonnel[order.id];
    if (!personnelId) {
      showAlert(t('common.error'), t('dashboards.distributor.selectDeliveryPerson'));
      return;
    }
    setBusyOrderId(order.id);
    try {
      await api.put(`/api/orders/${order.id}/assign`, { delivery_personnel_id: personnelId });
      // Remove from the pending/approved list and refresh the active list so the
      // order reappears there as "assigned" instead of disappearing (Issue 9).
      setOrders((prev) => prev.filter((o) => o.id !== order.id));
      await loadActiveOrders();
      showAlert(t('dashboards.distributor.deliveryAssignedTitle'), t('dashboards.distributor.deliveryAssignedMessage', { id: shortId(order.id) }));
    } catch (err) {
      showAlert(t('common.error'), err.message);
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
        : t('dashboards.distributor.noInventory');
      const body =
        `${t('dashboards.distributor.reportPeriod', { period: r.period })}\n` +
        `${t('dashboards.distributor.reportTotalOrders', { count: r.total_orders })}\n` +
        `${t('dashboards.distributor.reportCompletedOrders', { count: r.completed_orders })}\n` +
        `${t('dashboards.distributor.reportRevenue', { amount: peso(r.total_revenue) })}\n\n` +
        t('dashboards.distributor.reportInventory', { list: inventory });
      showAlert(t('dashboards.distributor.weeklyReportTitle'), body);
    } catch (err) {
      showAlert(t('common.error'), err.message);
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
      showAlert(t('common.error'), t('dashboards.distributor.enterValidPickupPrice'));
      return;
    }
    if (!selectedRiderForPickup) {
      showAlert(t('common.error'), t('dashboards.distributor.selectRider'));
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
      showAlert(t('dashboards.distributor.riderAssignedTitle'), t('dashboards.distributor.riderAssignedMessage'));
    } catch (err) {
      showAlert(t('common.error'), t('dashboards.distributor.riderAssignFailed', { message: err.message }));
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
        <Text style={styles.minimalTitle}>{t('dashboards.distributor.hubTitle')}</Text>
        <NotificationBell />
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, tab === 'products' && styles.tabActive]}
          onPress={() => setTab('products')}
        >
          <Text style={[styles.tabText, tab === 'products' && styles.tabTextActive]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{t('dashboards.distributor.productsTab')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'orders' && styles.tabActive]}
          onPress={() => setTab('orders')}
        >
          <Text style={[styles.tabText, tab === 'orders' && styles.tabTextActive]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            {t('dashboards.distributor.ordersTab')}{orders.length ? ` (${orders.length})` : ''}
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
            {t('dashboards.distributor.pickupRequestsTab')}{pendingReceiveCount ? ` (${pendingReceiveCount})` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'payments' && styles.tabActive]}
          onPress={() => setTab('payments')}
        >
          <Text style={[styles.tabText, tab === 'payments' && styles.tabTextActive]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            {t('dashboards.distributor.paymentsTab')}{unpaidOrders.length ? ` (${unpaidOrders.length})` : ''}
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
        title={t('dashboards.distributor.approveAndAssignModalTitle')}
        confirmLabel={receiveBusyId === receiveReq?.id ? t('dashboards.distributor.saving') : t('common.confirm')}
        onConfirm={confirmReceive}
        cancelLabel={t('common.cancel')}
        onCancel={() => setReceiveReq(null)}
        busy={receiveBusyId === receiveReq?.id}
      >
        {receiveReq ? (
          <>
            <Text style={styles.modalLine}>
              {harvestOf(receiveReq)?.vegetable_name || t('dashboards.distributor.unknownHarvest')}
              {harvestOf(receiveReq)?.quantity_kg != null
                ? ` — ${harvestOf(receiveReq).quantity_kg} kg`
                : ''}
            </Text>
            <Text style={styles.modalHint}>
              {t('dashboards.distributor.pickupPriceHint')}
            </Text>
            <Text style={styles.fieldLabel}>{t('dashboards.distributor.pricePerKgLabel')}</Text>
            <TextInput
              style={styles.input}
              value={priceInput}
              onChangeText={setPriceInput}
              keyboardType="numeric"
              placeholder={t('dashboards.distributor.pricePlaceholder')}
              editable={receiveBusyId !== receiveReq.id}
            />

            <Text style={[styles.fieldLabel, { marginTop: 15 }]}>{t('dashboards.distributor.assignPersonnelLabel')}</Text>
            {personnel.length === 0 ? (
              <Text style={styles.modalHint}>{t('dashboards.distributor.noPersonnelAvailable')}</Text>
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
  const { t } = useTranslation();
  if (loading) return <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />;

  // Only requests still awaiting receipt are actionable.
  const pending = (requests || []).filter((r) => r.status === 'requested');

  return (
    <View>
      <Text style={styles.sectionTitle}>{t('dashboards.distributor.pickupRequests')}</Text>
      {pending.length === 0 ? (
        <EmptyState
          icon="🚜"
          title={t('dashboards.distributor.noPendingPickups')}
          message={t('dashboards.distributor.noPendingPickupsMessage')}
        />
      ) : (
        pending.map((req) => {
          const harvest = harvestOf(req);
          const busy = busyId === req.id;
          return (
            <View key={req.id} style={styles.pickupCard}>
              <Text style={styles.pickupFarmer}>👨‍🌾 {farmerNameOf(req)}</Text>
              <Text style={styles.pickupHarvest}>
                {harvest?.vegetable_name || t('dashboards.distributor.unknownHarvest')}
                {harvest?.quantity_kg != null ? ` — ${harvest.quantity_kg} kg` : ''}
              </Text>
              {req.note ? <Text style={styles.pickupNote}>{t('dashboards.distributor.noteLabel', { note: req.note })}</Text> : null}
              <Text style={styles.pickupMeta}>
                {t('dashboards.distributor.statusLabel', { status: req.status })}
                {req.created_at ? t('dashboards.distributor.requestedOn', { date: new Date(req.created_at).toLocaleDateString() }) : ''}
              </Text>

              <TouchableOpacity
                style={[styles.primaryBtn, { marginTop: 12, marginBottom: 0 }, busy && styles.buttonDisabled]}
                onPress={() => onApprove(req)}
                disabled={busy}
              >
                {busy
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.primaryBtnText}>{t('dashboards.distributor.approveAndAssign')}</Text>}
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
  const { t } = useTranslation();
  if (loading) return <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />;

  return (
    <View>
      <TouchableOpacity style={styles.primaryBtn} onPress={onAdd}>
        <Text style={styles.primaryBtnText}>{t('dashboards.distributor.addProduct')}</Text>
      </TouchableOpacity>

      {showForm && (
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>{editingProductId ? t('dashboards.distributor.editProductTitle') : t('dashboards.distributor.addProductTitle')}</Text>

          <Text style={styles.fieldLabel}>{t('dashboards.distributor.vegetableNameLabel')}</Text>
          <TextInput
            style={[styles.input, editingProductId && styles.inputDisabled]}
            placeholder={t('dashboards.distributor.vegetableNamePlaceholder')}
            value={vegName}
            onChangeText={setVegName}
            editable={!editingProductId && !saving}
          />
          {editingProductId ? (
            <Text style={styles.hint}>{t('dashboards.distributor.nameCantChange')}</Text>
          ) : null}

          <Text style={styles.fieldLabel}>{t('dashboards.distributor.priceLabel')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('dashboards.distributor.pricePlaceholder')}
            value={price}
            onChangeText={setPrice}
            keyboardType="numeric"
            editable={!saving}
          />

          <Text style={styles.fieldLabel}>{t('dashboards.distributor.stockLabel')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('dashboards.distributor.stockPlaceholder')}
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
                : <Text style={styles.buttonPrimaryText}>{editingProductId ? t('common.saveChanges') : t('dashboards.distributor.addProductTitle')}</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.buttonOutline]} onPress={onCancel} disabled={saving}>
              <Text style={styles.buttonOutlineText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <Text style={styles.sectionTitle}>{t('dashboards.distributor.myProducts')}</Text>
      {products.length === 0 ? (
        <EmptyState
          icon="📦"
          title={t('dashboards.distributor.noProductsYet')}
          message={t('dashboards.distributor.noProductsYetMessage')}
          actionLabel={t('dashboards.distributor.addProductTitle')}
          onAction={onAdd}
        />
      ) : (
        <TouchableOpacity style={styles.viewAllBtn} onPress={onViewAll} activeOpacity={0.85}>
          <Text style={styles.viewAllText}>{t('dashboards.distributor.viewAllProducts', { count: products.length })}</Text>
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
  const { t } = useTranslation();
  if (loading) return <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />;

  // "In Progress" = approved/assigned/in-transit orders not currently being
  // worked on in the pending list above (Issue 9 — they used to disappear).
  const pendingIds = new Set(orders.map((o) => o.id));
  const inProgress = activeOrders.filter((o) => !pendingIds.has(o.id));

  return (
    <View>
      <Text style={styles.sectionTitle}>{t('dashboards.distributor.pendingOrders')}</Text>
      {orders.length === 0 ? (
        <EmptyState
          icon="✅"
          title={t('dashboards.distributor.noPendingOrders')}
          message={t('dashboards.distributor.noPendingOrdersMessage')}
        />
      ) : orders.map((order) => {
        const busy = busyOrderId === order.id;
        const isApproved = order.status === 'approved';
        const items = order.order_items || [];

        return (
          <View key={order.id} style={styles.orderCard}>
            <View style={styles.orderHeader}>
              <Text style={styles.orderId}>{t('dashboards.distributor.orderNumber', { id: shortId(order.id) })}</Text>
              <Text style={styles.orderTotal}>{peso(order.total_amount)}</Text>
            </View>
            <Text style={styles.rowMeta}>{t('dashboards.distributor.retailerLabel', { id: shortId(order.retailer_id) })}</Text>
            {order.delivery_address ? (
              <Text style={styles.rowMeta}>{t('dashboards.distributor.deliverTo', { address: order.delivery_address })}</Text>
            ) : null}

            <View style={styles.itemsBox}>
              {items.length === 0 ? (
                <Text style={styles.rowMeta}>{t('dashboards.distributor.noItemDetails')}</Text>
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
                <Text style={styles.trackBtnText}>{t('dashboards.distributor.trackDelivery')}</Text>
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
                  : <Text style={styles.buttonPrimaryText}>{t('dashboards.distributor.approve')}</Text>}
              </TouchableOpacity>
            ) : (
              <View>
                <Text style={styles.assignLabel}>{t('dashboards.distributor.assignDeliveryPersonLabel')}</Text>
                {personnel.length === 0 ? (
                  <Text style={styles.rowMeta}>{t('dashboards.distributor.noPersonnelAvailable')}</Text>
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
                    : <Text style={styles.buttonPrimaryText}>{t('dashboards.distributor.assignDelivery')}</Text>}
                </TouchableOpacity>
              </View>
            )}
          </View>
        );
      })}

      {/* Issue 9 & History: orders approved/assigned/in-transit/delivered/cancelled stay visible here in history. */}
      {inProgress.length > 0 && (
        <View style={{ marginTop: 18 }}>
          <Text style={styles.sectionTitle}>{t('dashboards.distributor.orderHistory', { count: inProgress.length })}</Text>
          {inProgress.map((order) => {
            const status = effectiveStatus(order);
            return (
              <View key={order.id} style={styles.orderCard}>
                <View style={styles.orderHeader}>
                  <Text style={styles.orderId}>{t('dashboards.distributor.orderNumber', { id: shortId(order.id) })}</Text>
                  <View style={[styles.statusPill, { backgroundColor: ACTIVE_STATUS_COLOR[status] || '#607d8b' }]}>
                    <Text style={styles.statusPillText}>{status.replace(/_/g, ' ')}</Text>
                  </View>
                </View>
                <Text style={styles.rowMeta}>{t('dashboards.distributor.totalLabel', { amount: peso(order.total_amount) })}</Text>
                <Text style={styles.rowMeta}>
                  {order.delivery_personnel_name
                    ? t('dashboards.distributor.riderLabel', { name: order.delivery_personnel_name })
                    : t('dashboards.distributor.awaitingRider')}
                </Text>
                {order.delivery_address && order.status !== 'pending' && order.status !== 'cancelled' ? (
                  <TouchableOpacity
                    style={[styles.trackBtn, { marginTop: 10, marginBottom: 0 }]}
                    onPress={() => onTrack(order)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.trackBtnText}>{t('dashboards.distributor.trackDelivery')}</Text>
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
  delivered: colors.leaf700,
  cancelled: colors.danger,
};

// ================= Payments tab =================
function PaymentsTab({
  loading, sub, setSub, unpaidOrders, payments,
  recordingId, amountInput, setAmountInput, recordBusy,
  onStartRecord, onCancelRecord, onRecord,
}) {
  const { t } = useTranslation();
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
            {t('dashboards.distributor.unpaid')}{unpaidOrders.length ? ` (${unpaidOrders.length})` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.subTab, sub === 'paid' && styles.subTabActive]}
          onPress={() => setSub('paid')}
        >
          <Text style={[styles.subTabText, sub === 'paid' && styles.subTabTextActive]}>{t('dashboards.distributor.paid')}</Text>
        </TouchableOpacity>
      </View>

      {sub === 'unpaid' ? (
        unpaidOrders.length === 0 ? (
          <EmptyState icon="🎉" title={t('dashboards.distributor.allCaughtUp')} message={t('dashboards.distributor.noUnpaidOrders')} />
        ) : (
          unpaidOrders.map((o) => (
            <View key={o.id} style={styles.rowCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{t('dashboards.distributor.orderNumber', { id: shortId(o.id) })}</Text>
                <Text style={styles.rowMeta}>{peso(o.total_amount)} · {o.status}</Text>
                {o.delivery_address ? (
                  <Text style={styles.rowMeta}>{o.delivery_address}</Text>
                ) : null}

                {recordingId === o.id && (
                  <View style={styles.recordBox}>
                    <Text style={styles.fieldLabel}>{t('dashboards.distributor.amountReceivedLabel')}</Text>
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
                          : <Text style={styles.buttonPrimaryText}>{t('common.confirm')}</Text>}
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.button, styles.buttonOutline]}
                        onPress={onCancelRecord}
                        disabled={recordBusy}
                      >
                        <Text style={styles.buttonOutlineText}>{t('common.cancel')}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>

              {recordingId !== o.id && (
                <TouchableOpacity style={styles.smallBtn} onPress={() => onStartRecord(o)}>
                  <Text style={styles.smallBtnText}>{t('dashboards.distributor.recordPayment')}</Text>
                </TouchableOpacity>
              )}
            </View>
          ))
        )
      ) : payments.length === 0 ? (
        <EmptyState icon="💸" title={t('dashboards.distributor.noPaymentsYet')} message={t('dashboards.distributor.noPaymentsYetMessage')} />
      ) : (
        payments.map((p) => (
          <View key={p.id} style={styles.rowCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{peso(p.amount)}</Text>
              <Text style={styles.rowMeta}>
                {t('dashboards.distributor.orderNumber', { id: shortId(p.order_id) })}
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
  container: { flex: 1, backgroundColor: colors.bgScreen },

  minimalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.bgScreen,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  minimalTitle: { fontFamily: fonts.heading, fontSize: 19, color: colors.ink },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 16, paddingBottom: 8 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontFamily: fonts.heading, fontSize: 22, color: colors.ink },
  subtitle: { fontFamily: fonts.body, fontSize: 13.5, color: colors.inkSoft, marginTop: 2 },

  tabs: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 8, backgroundColor: colors.leaf50, borderRadius: radius.ctrl, padding: 4 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  tabActive: { backgroundColor: PRIMARY },
  tabText: { fontFamily: fonts.bodySemiBold, color: PRIMARY, fontSize: 13 },
  tabTextActive: { color: '#fff' },

  subTabs: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  subTab: { flex: 1, paddingVertical: 8, borderRadius: radius.ctrl, alignItems: 'center', borderWidth: 1.4, borderColor: PRIMARY },
  subTabActive: { backgroundColor: PRIMARY },
  subTabText: { fontFamily: fonts.bodySemiBold, color: PRIMARY, fontSize: 14 },
  subTabTextActive: { color: '#fff' },

  recordBox: { marginTop: 10, backgroundColor: colors.leaf50, borderRadius: radius.ctrl, padding: 10 },
  recordButtons: { flexDirection: 'row', gap: 10, marginTop: 12 },
  paidBadge: { paddingVertical: 3, paddingHorizontal: 10, borderRadius: 12, backgroundColor: colors.leaf100, borderWidth: 1, borderColor: PRIMARY },
  paidBadgeText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: PRIMARY, textTransform: 'capitalize' },

  content: { padding: 16, paddingBottom: 40 },

  // Harvest Receiving card

  primaryBtn: { backgroundColor: PRIMARY, borderRadius: radius.ctrl, paddingVertical: 14, alignItems: 'center', marginBottom: 14 },
  primaryBtnText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: 15.5 },

  viewAllBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.card, borderRadius: radius.ctrl, paddingVertical: 14, paddingHorizontal: 16, borderWidth: 1.4, borderColor: PRIMARY },
  viewAllText: { fontFamily: fonts.bodySemiBold, color: PRIMARY, fontSize: 14.5 },
  viewAllChevron: { fontSize: 22, color: PRIMARY },

  formCard: { backgroundColor: colors.card, borderRadius: radius.card, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.border, ...shadowCard },
  formTitle: { fontFamily: fonts.heading, fontSize: 17, color: colors.ink, marginBottom: 8 },
  fieldLabel: { fontFamily: fonts.bodySemiBold, fontSize: 12.5, color: colors.inkSoft, marginTop: 8, marginBottom: 6 },
  input: { backgroundColor: colors.bgScreen, borderRadius: radius.ctrl, padding: 12, fontFamily: fonts.body, fontSize: 15, borderWidth: 1.4, borderColor: colors.border, color: colors.ink },
  inputDisabled: { backgroundColor: '#EFEAE2', color: colors.inkFaint },
  hint: { fontFamily: fonts.body, fontSize: 12, color: colors.inkFaint, marginTop: 4 },
  formButtons: { flexDirection: 'row', gap: 10, marginTop: 16 },
  button: { flex: 1, paddingVertical: 14, borderRadius: radius.ctrl, alignItems: 'center' },
  buttonPrimary: { backgroundColor: PRIMARY },
  buttonPrimaryText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: 15.5 },
  buttonOutline: { borderWidth: 1.4, borderColor: PRIMARY },
  buttonOutlineText: { fontFamily: fonts.bodySemiBold, color: PRIMARY, fontSize: 15.5 },
  buttonDisabled: { opacity: 0.6 },

  sectionTitle: { fontFamily: fonts.heading, fontSize: 17, color: colors.ink, marginBottom: 10, marginTop: 4 },

  // Pickup Requests tab
  pickupCard: { backgroundColor: colors.card, borderRadius: radius.card, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border, ...shadowCard },
  pickupFarmer: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  pickupHarvest: { fontFamily: fonts.bodySemiBold, fontSize: 14.5, color: PRIMARY, marginTop: 4 },
  pickupNote: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft, marginTop: 4 },
  pickupMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.inkFaint, marginTop: 4 },
  // Approve & Receive modal
  modalLine: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink, marginBottom: 6 },
  modalHint: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft, marginBottom: 10 },
  emptyText: { fontFamily: fonts.body, color: colors.inkFaint, fontStyle: 'italic', marginTop: 8 },

  rowCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.border, ...shadowCard },
  rowTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  rowMeta: { fontFamily: fonts.body, fontSize: 13.5, color: colors.inkSoft, marginTop: 2 },
  pendingBadge: { paddingVertical: 2, paddingHorizontal: 8, borderRadius: 10, backgroundColor: colors.gold100, borderWidth: 1, borderColor: colors.gold500 },
  pendingBadgeText: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: colors.gold700 },
  smallBtn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: radius.ctrl, borderWidth: 1.4, borderColor: PRIMARY },
  smallBtnText: { fontFamily: fonts.bodySemiBold, color: PRIMARY, fontSize: 13 },

  orderCard: { backgroundColor: colors.card, borderRadius: radius.card, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border, ...shadowCard },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  orderId: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  orderTotal: { fontFamily: fonts.bodyBold, fontSize: 15, color: PRIMARY },
  statusPill: { paddingVertical: 3, paddingHorizontal: 10, borderRadius: 12 },
  statusPillText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: 12, textTransform: 'capitalize' },
  itemsBox: { backgroundColor: colors.leaf50, borderRadius: radius.ctrl, padding: 10, marginVertical: 10 },
  itemLine: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft, marginBottom: 2 },

  trackBtn: { marginBottom: 10, paddingVertical: 10, borderRadius: radius.ctrl, alignItems: 'center', borderWidth: 1.4, borderColor: PRIMARY },
  trackBtnText: { fontFamily: fonts.bodyBold, color: PRIMARY, fontSize: 13.5 },

  assignLabel: { fontFamily: fonts.bodySemiBold, fontSize: 13.5, color: colors.ink, marginTop: 6, marginBottom: 8 },
  personnelWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  personChip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgScreen },
  personChipActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  personChipText: { fontFamily: fonts.body, color: colors.inkSoft, fontSize: 13 },
  personChipTextActive: { fontFamily: fonts.bodySemiBold, color: '#fff' },
});
