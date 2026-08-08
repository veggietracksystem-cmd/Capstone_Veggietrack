import { rf } from '../lib/responsive';
import { useState, useEffect, useCallback } from 'react';
import {
  Text, View, ScrollView, TextInput, TouchableOpacity, Modal, Image,
  ActivityIndicator, StyleSheet, RefreshControl, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../api/client';
import { readThrough } from '../offline/cache';
import { useAuth } from '../context/AuthContext';
import LogoutButton from '../components/LogoutButton';
import NotificationBell from '../components/NotificationBell';
import MessagesIcon from '../components/MessagesIcon';
import BottomNavBar from '../components/BottomNavBar';
import OfflineBanner from '../components/OfflineBanner';
import EmptyState from '../components/EmptyState';
import CustomModal from '../components/CustomModal';
import ImageViewerModal from '../components/ImageViewerModal';
import { showAlert, confirmAction, peso, shortId } from '../lib/ui';
import { colors, fonts, radius, shadowCard } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';
import { getVegetableTile } from '../lib/vegetableIcons';
import { localizeVegetableName } from '../lib/vegetableNames';

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
  const { t, language } = useTranslation();

  const DISTRIBUTOR_TABS = [
    { id: 'home', iconName: 'home-outline', label: t('dashboards.distributor.tabHome') },
    { id: 'orders', iconName: 'clipboard-outline', label: t('dashboards.distributor.tabOrders') },
    { id: 'stocks', iconName: 'archive-outline', label: t('dashboards.distributor.tabStocks') },
    { id: 'inventory', iconName: 'cube-outline', label: t('dashboards.distributor.tabInventory') },
    { id: 'profile', iconName: 'person-outline', label: t('dashboards.distributor.tabProfile') },
  ];
  const [tab, setTab] = useState('home'); // 'home' | 'orders' | 'pickups' | 'payments'
  const [activeBottomTab, setActiveBottomTab] = useState('home');

  const handleBottomTabPress = (tab) => {
    setActiveBottomTab(tab.id);
    if (tab.id === 'stocks') {
      navigation.navigate('Stocks');
    } else if (tab.id === 'inventory') {
      // Repurposed: this now opens the Inventory + Weekly Report screen
      // (table layout, History section, PDF export) instead of the old
      // Product List screen — Product List lives inline on Home now.
      navigation.navigate('DistributorInventoryReport');
    } else if (tab.id === 'profile') {
      navigation.navigate('Profile');
    } else if (tab.id === 'orders') {
      setTab('orders');
    } else if (tab.id === 'home') {
      setTab('home');
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
  const [proofUri, setProofUri] = useState(null);

  // ----- Payments state -----
  const [paymentsSub, setPaymentsSub] = useState('unpaid'); // 'unpaid' | 'paid'
  const [unpaidOrders, setUnpaidOrders] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loadingPayments, setLoadingPayments] = useState(true);
  const [recordingId, setRecordingId] = useState(null); // order id being paid
  const [amountInput, setAmountInput] = useState('');
  const [recordBusy, setRecordBusy] = useState(false);

  // ----- Offline state -----
  const [ordersOffline, setOrdersOffline] = useState(false);
  const [paymentsOffline, setPaymentsOffline] = useState(false);

  // ---------- Loaders ----------
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

  useEffect(() => {
    (async () => {
      setLoadingOrders(true);
      setLoadingPayments(true);
      await Promise.all([loadOrders(), loadActiveOrders(), loadPersonnel(), loadPayments(), loadPickupRequests()]);
      setLoadingOrders(false);
      setLoadingPayments(false);
    })();
  }, [loadOrders, loadActiveOrders, loadPersonnel, loadPayments, loadPickupRequests]);

  // Refresh pickup requests whenever this screen regains focus (e.g.
  // returning from Stocks after listing a batch).
  useEffect(() => {
    if (!navigation?.addListener) return undefined;
    return navigation.addListener('focus', () => {
      loadPickupRequests();
    });
  }, [navigation, loadPickupRequests]);

  // Issue 10: poll orders every 30s so the Approved-tab statuses (picked up /
  // in transit / delivered) update without a manual pull-to-refresh.
  useEffect(() => {
    const id = setInterval(() => { loadOrders(); loadActiveOrders(); }, 30000);
    return () => clearInterval(id);
  }, [loadOrders, loadActiveOrders]);

  const onRefresh = async () => {
    setRefreshing(true);
    if (tab === 'orders') await Promise.all([loadOrders(), loadActiveOrders(), loadPersonnel(), loadPickupRequests()]);
    else if (tab === 'pickups') await loadPickupRequests();
    else if (tab === 'payments') await loadPayments();
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

  const rejectOrder = async (order, reason) => {
    setBusyOrderId(order.id);
    try {
      await api.put(`/api/orders/${order.id}/cancel`, { reason });
      setOrders((prev) => prev.filter((o) => o.id !== order.id));
      await loadActiveOrders();
      showAlert(t('dashboards.distributor.orderRejectedTitle'), t('dashboards.distributor.orderRejectedMessage', { id: shortId(order.id) }));
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
      await loadPickupRequests();
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
        <View style={styles.headerIcons}>
          <MessagesIcon />
          <NotificationBell />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <OfflineBanner
          offline={tab === 'orders' ? ordersOffline : tab === 'payments' ? paymentsOffline : false}
          pendingCount={0}
        />

        {tab === 'home' && (
          <HomeTab
            pendingOrderCount={orders.length}
            pendingPickupCount={pendingReceiveCount}
            unpaidCount={unpaidOrders.length}
            onViewOrders={() => setTab('orders')}
            onViewPickups={() => setTab('pickups')}
            onViewPayments={() => setTab('payments')}
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
            onReject={rejectOrder}
            onAssign={assignDelivery}
            onTrack={(o) => navigation.navigate('OrderTracking', {
              orderId: o.id,
              deliveryAddress: o.delivery_address,
              orderStatus: o.status,
            })}
            onViewProof={setProofUri}
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

      <ImageViewerModal
        uri={proofUri}
        visible={!!proofUri}
        onClose={() => setProofUri(null)}
      />

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
              {harvestOf(receiveReq)?.vegetable_name ? localizeVegetableName(harvestOf(receiveReq).vegetable_name, language) : t('dashboards.distributor.unknownHarvest')}
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
  const { t, language } = useTranslation();
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
                {harvest?.vegetable_name ? localizeVegetableName(harvest.vegetable_name, language) : t('dashboards.distributor.unknownHarvest')}
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

// ================= Home tab =================
// At-a-glance counts (each a shortcut into the relevant tab/screen), plus the
// Product List (price editing) embedded inline — it used to be a separate
// screen reached via a "Product List →" button; it now lives directly here.
function HomeTab({
  pendingOrderCount, pendingPickupCount, unpaidCount,
  onViewOrders, onViewPickups, onViewPayments,
}) {
  const { t } = useTranslation();
  return (
    <View>
      <View style={styles.homeStatsRow}>
        <TouchableOpacity style={styles.homeStatCard} onPress={onViewOrders} activeOpacity={0.85}>
          <Text style={styles.homeStatValue}>{pendingOrderCount}</Text>
          <Text style={styles.homeStatLabel}>{t('dashboards.distributor.pendingOrders')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.homeStatCard} onPress={onViewPickups} activeOpacity={0.85}>
          <Text style={styles.homeStatValue}>{pendingPickupCount}</Text>
          <Text style={styles.homeStatLabel}>{t('dashboards.distributor.pickupRequests')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.homeStatCard} onPress={onViewPayments} activeOpacity={0.85}>
          <Text style={styles.homeStatValue}>{unpaidCount}</Text>
          <Text style={styles.homeStatLabel}>{t('dashboards.distributor.unpaid')}</Text>
        </TouchableOpacity>
      </View>

      <Text style={[styles.sectionTitle, { marginTop: 4 }]}>{t('productList.title')}</Text>
      <ProductListSection />
    </View>
  );
}

// Aggregated product listings, ported from ProductListScreen.js so it can
// live directly on the Distributor Home tab. Each card shows a single Edit
// button that opens a centered modal for quantity/price edits and removal.
function ProductListSection() {
  const { t, language } = useTranslation();
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);

  // The listing currently open in the edit modal, addressed by vegetable
  // name so it always reflects the latest data after a reload.
  const [activeVeg, setActiveVeg] = useState(null);
  const [priceInput, setPriceInput] = useState('');
  const [qtyInput, setQtyInput] = useState('');
  const [savingPrice, setSavingPrice] = useState(false);
  const [savingQty, setSavingQty] = useState(false);
  const [removing, setRemoving] = useState(false);

  const activeListing = activeVeg ? listings.find((l) => l.vegetable_name === activeVeg) : null;

  const loadListings = useCallback(async () => {
    try {
      const data = await api.get('/api/products/listings');
      setListings(Array.isArray(data) ? data : []);
    } catch (err) {
      showAlert(t('common.error'), err.message);
    }
  }, [t]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadListings();
      setLoading(false);
    })();
  }, [loadListings]);

  const openEditModal = (listing) => {
    setActiveVeg(listing.vegetable_name);
    setPriceInput(String(listing.price_per_kg ?? ''));
    setQtyInput(String(listing.available_kg ?? ''));
  };

  const closeEditModal = () => {
    if (savingPrice || savingQty || removing) return;
    setActiveVeg(null);
  };

  const savePrice = async () => {
    if (!activeListing) return;
    const priceNum = parseFloat(priceInput);
    if (isNaN(priceNum) || priceNum <= 0) {
      showAlert(t('common.error'), t('dashboards.distributor.enterValidPrice'));
      return;
    }
    setSavingPrice(true);
    try {
      await api.put(`/api/products/${activeListing.id}`, { price_per_kg: priceNum });
      await loadListings();
    } catch (err) {
      showAlert(t('common.error'), err.message);
    } finally {
      setSavingPrice(false);
    }
  };

  const saveQty = async () => {
    if (!activeListing) return;
    const qtyNum = parseFloat(qtyInput);
    if (isNaN(qtyNum) || qtyNum < 0) {
      showAlert(t('common.error'), t('productList.invalidQuantity'));
      return;
    }
    if (qtyNum >= activeListing.available_kg) {
      showAlert(t('common.error'), t('productList.quantityMustBeLess', { qty: activeListing.available_kg }));
      return;
    }
    setSavingQty(true);
    try {
      await api.put(`/api/products/${activeListing.id}/reduce-quantity`, { new_total_kg: qtyNum });
      await loadListings();
    } catch (err) {
      showAlert(t('common.error'), err.message);
    } finally {
      setSavingQty(false);
    }
  };

  const removeProduct = () => {
    if (!activeListing) return;
    // Capture the target and close the edit modal *before* showing the confirm
    // dialog — stacking two native Modals (this one on top of the edit modal)
    // is unreliable on Android/iOS and can silently eat the Confirm tap.
    const target = activeListing;
    const label = localizeVegetableName(target.vegetable_name, language);
    setActiveVeg(null);
    confirmAction(
      t('productList.removeConfirmTitle'),
      t('productList.removeConfirmMessage', { name: label }),
      async () => {
        setRemoving(true);
        try {
          await api.put(`/api/products/${target.id}/unlist`);
          await loadListings();
        } catch (err) {
          showAlert(t('common.error'), err.message || t('productList.removeFailed'));
        } finally {
          setRemoving(false);
        }
      }
    );
  };

  if (loading) return <ActivityIndicator size="large" color={PRIMARY} style={{ marginVertical: 20 }} />;

  const modalTile = activeListing ? getVegetableTile(activeListing.vegetable_name) : null;
  const modalIsSoldOut = activeListing?.status === 'Sold Out';

  return (
    <View>
      {listings.length === 0 ? (
        <EmptyState
          icon="📦"
          title={t('productList.emptyTitleNone')}
          message={t('productList.emptyMessageNoneStocks')}
        />
      ) : (
        listings.map((l) => {
          const isSoldOut = l.status === 'Sold Out';
          const tile = getVegetableTile(l.vegetable_name);
          return (
            <View key={l.vegetable_name} style={styles.productRowCard}>
              <View style={styles.productRowTop}>
                <View style={[styles.productTile, { backgroundColor: tile.bg }]}>
                  <Text style={styles.productTileIcon}>{tile.icon}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.productRowTitle}>{localizeVegetableName(l.vegetable_name, language)}</Text>
                  <Text style={styles.productRowMeta}>
                    {peso(l.price_per_kg)} / kg · {isSoldOut ? (
                      <Text style={{ color: colors.danger, fontWeight: '700' }}>{t('productList.outOfStock')}</Text>
                    ) : (
                      t('productList.kgInStock', { qty: l.available_kg })
                    )}
                  </Text>
                </View>
                <TouchableOpacity style={styles.smallBtn} onPress={() => openEditModal(l)}>
                  <Text style={styles.smallBtnText}>{t('productList.editBtn')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })
      )}

      <Modal
        visible={!!activeListing}
        transparent
        animationType="fade"
        onRequestClose={closeEditModal}
      >
        <KeyboardAvoidingView style={styles.modalKav} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalBackdrop}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={closeEditModal} />

            <View style={styles.modalCard}>
              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={closeEditModal}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>

              {activeListing ? (
                <ScrollView
                  style={styles.modalScroll}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                  <View style={styles.modalHeader}>
                    <View style={[styles.productTile, styles.modalTile, { backgroundColor: modalTile.bg }]}>
                      <Text style={styles.modalTileIcon}>{modalTile.icon}</Text>
                    </View>
                    <Text style={styles.modalVegName}>{localizeVegetableName(activeListing.vegetable_name, language)}</Text>
                  </View>

                  <Text style={styles.modalLabel}>{t('productList.newQuantityLabel')}</Text>
                  <View style={styles.editRow}>
                    <TextInput
                      style={[styles.priceInput, modalIsSoldOut && styles.modalInputDisabled]}
                      value={qtyInput}
                      onChangeText={setQtyInput}
                      keyboardType="decimal-pad"
                      editable={!modalIsSoldOut && !savingQty}
                    />
                    <TouchableOpacity
                      style={[styles.smallBtn, (savingQty || modalIsSoldOut) && styles.btnDisabled]}
                      onPress={saveQty}
                      disabled={savingQty || modalIsSoldOut}
                    >
                      {savingQty ? <ActivityIndicator size="small" color={PRIMARY} /> : <Text style={styles.smallBtnText}>{t('common.save')}</Text>}
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.modalLabel}>{t('productList.priceLabel')}</Text>
                  <View style={styles.editRow}>
                    <TextInput
                      style={styles.priceInput}
                      value={priceInput}
                      onChangeText={setPriceInput}
                      keyboardType="decimal-pad"
                      editable={!savingPrice}
                    />
                    <TouchableOpacity
                      style={[styles.smallBtn, savingPrice && styles.btnDisabled]}
                      onPress={savePrice}
                      disabled={savingPrice}
                    >
                      {savingPrice ? <ActivityIndicator size="small" color={PRIMARY} /> : <Text style={styles.smallBtnText}>{t('common.save')}</Text>}
                    </TouchableOpacity>
                  </View>

                  <TouchableOpacity
                    style={[styles.removeBtnFull, removing && styles.btnDisabled]}
                    onPress={removeProduct}
                    disabled={removing}
                  >
                    {removing
                      ? <ActivityIndicator size="small" color={colors.danger} />
                      : <Text style={styles.deleteBtnText}>{t('productList.removeBtn')}</Text>}
                  </TouchableOpacity>
                </ScrollView>
              ) : null}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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

function getProofUrl(order) {
  return getDelivery(order)?.proof_photo_url || null;
}

// ================= Orders tab =================
const ORDER_SUB_TABS = ['pending', 'approved', 'cancelled', 'history'];

function OrdersTab({
  loading, orders, activeOrders = [], personnel, selectedPersonnel, setSelectedPersonnel,
  busyOrderId, onApprove, onReject, onAssign, onTrack, onViewProof,
}) {
  const { t, language } = useTranslation();
  const [sub, setSub] = useState('pending');
  const [rejectingOrder, setRejectingOrder] = useState(null);
  const [reasonInput, setReasonInput] = useState('');

  if (loading) return <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />;

  // A freshly-assigned order has delivery.status === 'assigned' (not yet
  // picked_up), which effectiveStatus surfaces ahead of the order's own
  // 'approved' status — include it here too, or the order vanishes from
  // every tab the instant a rider is assigned instead of moving to Approved.
  const approved = activeOrders.filter(
    (o) => ['approved', 'assigned', 'picked_up', 'in_transit'].includes(effectiveStatus(o)) && o.delivery_personnel_id
  );
  const cancelled = activeOrders.filter((o) => o.status === 'cancelled');
  const history = activeOrders.filter((o) => effectiveStatus(o) === 'delivered');

  const submitReject = () => {
    if (!reasonInput.trim()) return;
    onReject(rejectingOrder, reasonInput.trim());
    setRejectingOrder(null);
    setReasonInput('');
  };

  return (
    <View>
      <View style={styles.subTabs}>
        {ORDER_SUB_TABS.map((s) => (
          <TouchableOpacity key={s} style={[styles.subTab, sub === s && styles.subTabActive]} onPress={() => setSub(s)}>
            <Text style={[styles.subTabText, sub === s && styles.subTabTextActive]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
              {t(`dashboards.distributor.ordersSub.${s}`)}
              {s === 'pending' && orders.length ? ` (${orders.length})` : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {sub === 'pending' && (
        orders.length === 0 ? (
          <EmptyState icon="✅" title={t('dashboards.distributor.noPendingOrders')} message={t('dashboards.distributor.noPendingOrdersMessage')} />
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
                      • {localizeVegetableName(it.vegetable_name, language)} — {it.quantity_kg}kg @ {peso(it.price_at_order)}
                    </Text>
                  ))
                )}
              </View>

              {!isApproved ? (
                <View style={styles.pendingActionsRow}>
                  <TouchableOpacity
                    style={[styles.button, styles.buttonPrimary, styles.pendingActionBtn, busy && styles.buttonDisabled]}
                    onPress={() => onApprove(order)}
                    disabled={busy}
                  >
                    {busy
                      ? <ActivityIndicator color="#fff" />
                      : <Text style={styles.buttonPrimaryText}>{t('dashboards.distributor.approve')}</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.button, styles.buttonDanger, styles.pendingActionBtn, busy && styles.buttonDisabled]}
                    onPress={() => { setRejectingOrder(order); setReasonInput(''); }}
                    disabled={busy}
                  >
                    <Text style={styles.buttonDangerText}>{t('dashboards.distributor.reject')}</Text>
                  </TouchableOpacity>
                </View>
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
        })
      )}

      {sub === 'approved' && (
        approved.length === 0 ? (
          <EmptyState icon="🚚" title={t('dashboards.distributor.noApprovedOrders')} message={t('dashboards.distributor.noApprovedOrdersMessage')} />
        ) : approved.map((order) => (
          <View key={order.id} style={styles.orderCard}>
            <View style={styles.orderHeader}>
              <Text style={styles.orderId}>{t('dashboards.distributor.orderNumber', { id: shortId(order.id) })}</Text>
              <Text style={styles.orderTotal}>{peso(order.total_amount)}</Text>
            </View>
            <Text style={styles.rowMeta}>{t('dashboards.distributor.retailerLabel', { id: shortId(order.retailer_id) })}</Text>
            <Text style={styles.rowMeta}>
              {order.delivery_personnel_name
                ? t('dashboards.distributor.riderLabel', { name: order.delivery_personnel_name })
                : t('dashboards.distributor.awaitingRider')}
            </Text>
            {order.delivery_address ? (
              <TouchableOpacity style={[styles.trackBtn, { marginTop: 10, marginBottom: 0 }]} onPress={() => onTrack(order)} activeOpacity={0.8}>
                <Text style={styles.trackBtnText}>{t('dashboards.distributor.trackDelivery')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ))
      )}

      {sub === 'cancelled' && (
        cancelled.length === 0 ? (
          <EmptyState icon="🚫" title={t('dashboards.distributor.noCancelledOrders')} message={t('dashboards.distributor.noCancelledOrdersMessage')} />
        ) : cancelled.map((order) => (
          <View key={order.id} style={styles.orderCard}>
            <View style={styles.orderHeader}>
              <Text style={styles.orderId}>{t('dashboards.distributor.orderNumber', { id: shortId(order.id) })}</Text>
              <View style={[styles.statusPill, { backgroundColor: colors.danger }]}>
                <Text style={styles.statusPillText}>{t('dashboards.distributor.ordersSub.cancelled')}</Text>
              </View>
            </View>
            <Text style={styles.rowMeta}>{t('dashboards.distributor.totalLabel', { amount: peso(order.total_amount) })}</Text>
            <Text style={styles.rowMeta}>
              {t('dashboards.distributor.cancellationReason', { reason: order.cancellation_reason || t('dashboards.distributor.noReasonGiven') })}
            </Text>
          </View>
        ))
      )}

      {sub === 'history' && (
        history.length === 0 ? (
          <EmptyState icon="📜" title={t('dashboards.distributor.noHistoryOrders')} message={t('dashboards.distributor.noHistoryOrdersMessage')} />
        ) : history.map((order) => (
          <View key={order.id} style={styles.orderCard}>
            <View style={styles.orderHeader}>
              <Text style={styles.orderId}>{t('dashboards.distributor.orderNumber', { id: shortId(order.id) })}</Text>
              <View style={[styles.statusPill, { backgroundColor: colors.leaf700 }]}>
                <Text style={styles.statusPillText}>{t('dashboards.distributor.ordersSub.history')}</Text>
              </View>
            </View>
            <Text style={styles.rowMeta}>{t('dashboards.distributor.totalLabel', { amount: peso(order.total_amount) })}</Text>
            <Text style={styles.rowMeta}>
              {order.delivery_personnel_name
                ? t('dashboards.distributor.riderLabel', { name: order.delivery_personnel_name })
                : ''}
            </Text>
            {getProofUrl(order) && (
              <TouchableOpacity
                style={styles.proofRow}
                onPress={() => onViewProof(getProofUrl(order))}
                activeOpacity={0.8}
              >
                <Image source={{ uri: getProofUrl(order) }} style={styles.proofThumb} />
                <Text style={styles.proofText}>{t('dashboards.distributor.proofOfDelivery')}</Text>
              </TouchableOpacity>
            )}
          </View>
        ))
      )}

      <CustomModal
        visible={!!rejectingOrder}
        title={t('dashboards.distributor.rejectModalTitle')}
        confirmLabel={t('dashboards.distributor.rejectConfirm')}
        onConfirm={submitReject}
        cancelLabel={t('common.cancel')}
        onCancel={() => setRejectingOrder(null)}
        confirmDisabled={!reasonInput.trim()}
      >
        <Text style={styles.fieldLabel}>{t('dashboards.distributor.rejectReasonLabel')}</Text>
        <TextInput
          style={styles.input}
          value={reasonInput}
          onChangeText={setReasonInput}
          placeholder={t('dashboards.distributor.rejectReasonPlaceholder')}
          multiline
        />
      </CustomModal>
    </View>
  );
}

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

  headerIcons: { flexDirection: 'row', alignItems: 'center' },

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
  minimalTitle: { fontFamily: fonts.heading, fontSize: rf(19), color: colors.ink },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 16, paddingBottom: 8 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontFamily: fonts.heading, fontSize: rf(22), color: colors.ink },
  subtitle: { fontFamily: fonts.body, fontSize: rf(13.5), color: colors.inkSoft, marginTop: 2 },

  subTabs: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  subTab: { flex: 1, paddingVertical: 8, borderRadius: radius.ctrl, alignItems: 'center', borderWidth: 1.4, borderColor: PRIMARY },
  subTabActive: { backgroundColor: PRIMARY },
  subTabText: { fontFamily: fonts.bodySemiBold, color: PRIMARY, fontSize: rf(14) },
  subTabTextActive: { color: '#fff' },

  recordBox: { marginTop: 10, backgroundColor: colors.leaf50, borderRadius: radius.ctrl, padding: 10 },
  recordButtons: { flexDirection: 'row', gap: 10, marginTop: 12 },
  paidBadge: { paddingVertical: 3, paddingHorizontal: 10, borderRadius: 12, backgroundColor: colors.leaf100, borderWidth: 1, borderColor: PRIMARY },
  paidBadgeText: { fontFamily: fonts.bodySemiBold, fontSize: rf(12), color: PRIMARY, textTransform: 'capitalize' },

  content: { padding: 16, paddingBottom: 40 },

  homeStatsRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  homeStatCard: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, paddingVertical: 16, alignItems: 'center', ...shadowCard },
  homeStatValue: { fontFamily: fonts.heading, fontSize: rf(24), color: PRIMARY },
  homeStatLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(11.5), color: colors.inkSoft, marginTop: 4, textAlign: 'center' },

  // Harvest Receiving card

  primaryBtn: { backgroundColor: PRIMARY, borderRadius: radius.ctrl, paddingVertical: 14, alignItems: 'center', marginBottom: 14 },
  primaryBtnText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(15.5) },

  // Home tab: embedded Product List section
  productRowCard: { backgroundColor: colors.card, borderRadius: radius.card, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.border, ...shadowCard },
  productRowTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  productTile: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  productTileIcon: { fontSize: rf(22) },
  productRowTitle: { fontFamily: fonts.bodyBold, fontSize: rf(15), color: colors.ink, textTransform: 'capitalize' },
  productRowMeta: { fontFamily: fonts.body, fontSize: rf(13.5), color: colors.inkSoft, marginTop: 2 },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  priceInput: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.ctrl, paddingHorizontal: 10, paddingVertical: 6, fontFamily: fonts.body, fontSize: rf(14), color: colors.ink },
  deleteBtnText: { fontFamily: fonts.bodySemiBold, color: colors.danger, fontSize: rf(13) },
  btnDisabled: { opacity: 0.5 },

  // Home tab: Product List edit modal (icon + name header, qty/price edit, remove, X close)
  modalKav: { flex: 1 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(20,17,16,0.42)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: { width: '100%', maxWidth: 380, maxHeight: '90%', backgroundColor: colors.bgScreen, borderRadius: radius.card, padding: 22, ...shadowCard },
  modalScroll: { flexGrow: 0, flexShrink: 1 },
  modalCloseBtn: { position: 'absolute', top: 14, right: 14, width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.leaf50, zIndex: 1 },
  modalCloseText: { fontFamily: fonts.bodyBold, fontSize: rf(15), color: colors.inkSoft },
  modalHeader: { alignItems: 'center', marginBottom: 18, marginTop: 4 },
  modalTile: { width: 60, height: 60, borderRadius: 16, marginBottom: 10 },
  modalTileIcon: { fontSize: rf(30) },
  modalVegName: { fontFamily: fonts.headingBold, fontSize: rf(18), color: colors.ink, textTransform: 'capitalize', textAlign: 'center' },
  modalLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(13), color: colors.inkSoft, marginTop: 12, marginBottom: 6 },
  modalInputDisabled: { opacity: 0.5 },
  removeBtnFull: { marginTop: 22, borderWidth: 1.4, borderColor: colors.danger, borderRadius: radius.ctrl, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },

  formCard: { backgroundColor: colors.card, borderRadius: radius.card, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.border, ...shadowCard },
  formTitle: { fontFamily: fonts.heading, fontSize: rf(17), color: colors.ink, marginBottom: 8 },
  fieldLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(12.5), color: colors.inkSoft, marginTop: 8, marginBottom: 6 },
  input: { backgroundColor: colors.bgScreen, borderRadius: radius.ctrl, padding: 12, fontFamily: fonts.body, fontSize: rf(15), borderWidth: 1.4, borderColor: colors.border, color: colors.ink },
  inputDisabled: { backgroundColor: '#EFEAE2', color: colors.inkFaint },
  hint: { fontFamily: fonts.body, fontSize: rf(12), color: colors.inkFaint, marginTop: 4 },
  formButtons: { flexDirection: 'row', gap: 10, marginTop: 16 },
  button: { flex: 1, paddingVertical: 14, borderRadius: radius.ctrl, alignItems: 'center' },
  buttonPrimary: { backgroundColor: PRIMARY },
  buttonPrimaryText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(15.5) },
  buttonOutline: { borderWidth: 1.4, borderColor: PRIMARY },
  buttonOutlineText: { fontFamily: fonts.bodySemiBold, color: PRIMARY, fontSize: rf(15.5) },
  buttonDanger: { borderWidth: 1.4, borderColor: colors.danger, backgroundColor: 'transparent' },
  buttonDangerText: { fontFamily: fonts.bodySemiBold, color: colors.danger, fontSize: rf(15.5) },
  buttonDisabled: { opacity: 0.6 },
  pendingActionsRow: { flexDirection: 'row', gap: 10 },
  pendingActionBtn: { flex: 1 },

  sectionTitle: { fontFamily: fonts.heading, fontSize: rf(17), color: colors.ink, marginBottom: 10, marginTop: 4 },

  // Pickup Requests tab
  pickupCard: { backgroundColor: colors.card, borderRadius: radius.card, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border, ...shadowCard },
  pickupFarmer: { fontFamily: fonts.bodyBold, fontSize: rf(15), color: colors.ink },
  pickupHarvest: { fontFamily: fonts.bodySemiBold, fontSize: rf(14.5), color: PRIMARY, marginTop: 4 },
  pickupNote: { fontFamily: fonts.body, fontSize: rf(13), color: colors.inkSoft, marginTop: 4 },
  pickupMeta: { fontFamily: fonts.body, fontSize: rf(12), color: colors.inkFaint, marginTop: 4 },
  // Approve & Receive modal
  modalLine: { fontFamily: fonts.bodyBold, fontSize: rf(15), color: colors.ink, marginBottom: 6 },
  modalHint: { fontFamily: fonts.body, fontSize: rf(13), color: colors.inkSoft, marginBottom: 10 },
  emptyText: { fontFamily: fonts.body, color: colors.inkFaint, fontStyle: 'italic', marginTop: 8 },

  rowCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.border, ...shadowCard },
  rowTitle: { fontFamily: fonts.bodyBold, fontSize: rf(15), color: colors.ink },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  rowMeta: { fontFamily: fonts.body, fontSize: rf(13.5), color: colors.inkSoft, marginTop: 2 },
  pendingBadge: { paddingVertical: 2, paddingHorizontal: 8, borderRadius: 10, backgroundColor: colors.gold100, borderWidth: 1, borderColor: colors.gold500 },
  pendingBadgeText: { fontFamily: fonts.bodySemiBold, fontSize: rf(11), color: colors.gold700 },
  smallBtn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: radius.ctrl, borderWidth: 1.4, borderColor: PRIMARY },
  smallBtnText: { fontFamily: fonts.bodySemiBold, color: PRIMARY, fontSize: rf(13) },

  orderCard: { backgroundColor: colors.card, borderRadius: radius.card, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border, ...shadowCard },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  orderId: { fontFamily: fonts.bodyBold, fontSize: rf(15), color: colors.ink },
  orderTotal: { fontFamily: fonts.bodyBold, fontSize: rf(15), color: PRIMARY },
  statusPill: { paddingVertical: 3, paddingHorizontal: 10, borderRadius: 12 },
  statusPillText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(12), textTransform: 'capitalize' },
  itemsBox: { backgroundColor: colors.leaf50, borderRadius: radius.ctrl, padding: 10, marginVertical: 10 },
  itemLine: { fontFamily: fonts.body, fontSize: rf(13), color: colors.inkSoft, marginBottom: 2 },

  proofRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, backgroundColor: colors.leaf50, borderRadius: radius.ctrl, padding: 8 },
  proofThumb: { width: 48, height: 48, borderRadius: 6, backgroundColor: colors.border },
  proofText: { fontFamily: fonts.bodySemiBold, fontSize: rf(13), color: PRIMARY },

  trackBtn: { marginBottom: 10, paddingVertical: 10, borderRadius: radius.ctrl, alignItems: 'center', borderWidth: 1.4, borderColor: PRIMARY },
  trackBtnText: { fontFamily: fonts.bodyBold, color: PRIMARY, fontSize: rf(13.5) },

  assignLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(13.5), color: colors.ink, marginTop: 6, marginBottom: 8 },
  personnelWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  personChip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgScreen },
  personChipActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  personChipText: { fontFamily: fonts.body, color: colors.inkSoft, fontSize: rf(13) },
  personChipTextActive: { fontFamily: fonts.bodySemiBold, color: '#fff' },
});
