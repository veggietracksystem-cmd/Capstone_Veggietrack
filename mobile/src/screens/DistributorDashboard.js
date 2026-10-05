import useRefreshOnFocus from '../hooks/useRefreshOnFocus';
import useLatestRequest from '../hooks/useLatestRequest';
import useRequestLock from '../hooks/useRequestLock';
import { rf } from '../lib/responsive';
import { useState, useEffect, useCallback, useRef } from 'react';
import { SharedScreenTransition } from '../lib/motion';
import {
  Text, View, ScrollView, TouchableOpacity, Pressable, Modal, ActivityIndicator, StyleSheet, RefreshControl, KeyboardAvoidingView, Platform,
  BackHandler, useWindowDimensions,
} from 'react-native';
import TextInput from '../components/AppTextInput';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import ModalCloseButton from '../components/ui/ModalCloseButton';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import api from '../api/client';
import { readThrough } from '../offline/cache';
import ScreenHeader from '../components/ScreenHeader';
import HomeHeaderActions from '../components/HomeHeaderActions';
import BottomNavBar, { useBottomNavSpace } from '../components/BottomNavBar';
import OfflineBanner from '../components/OfflineBanner';
import EmptyState from '../components/EmptyState';
import { SegmentedTabs } from '../components/ui/SegmentedTabs';
import StatusBadge from '../components/ui/StatusBadge';
import CustomModal from '../components/CustomModal';
import ImageViewerModal from '../components/ImageViewerModal';
import { showAlert, confirmAction, peso, shortId } from '../lib/ui';
import { friendlyError } from '../lib/errorMessages';
import { effectiveOrderStatus } from '../lib/orderStatus';
import { colors, control, fontSize, fonts, radius, shadowCard, spacing, actionBtn, actionBtnOutline, actionBtnText } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';
import { getVegetableTile } from '../lib/vegetableIcons';
import VegetableImage from '../components/VegetableImage';
import { localizeVegetableName } from '../lib/vegetableNames';
import { useAutoSync } from '../sync/SyncProvider';
import RemoteImage from '../components/RemoteImage';
import { statusLabel } from '../i18n/translate';
import PickupRequestsPanel from '../components/distributor/PickupRequestsPanel';
import useStockAlerts from '../hooks/useStockAlerts';

const PRIMARY = colors.leaf700;


export default function DistributorDashboard({ navigation, route }) {
  const navSpace = useBottomNavSpace();
  const beginRead = useLatestRequest();
  const requestLock = useRequestLock();
  const refreshProducts = useRef(null);
  const stockAlerts = useStockAlerts();
  const { t, language } = useTranslation();

  const DISTRIBUTOR_TABS = [
    { id: 'home', iconName: 'home-outline', label: t('dashboards.distributor.tabHome') },
    { id: 'orders', iconName: 'clipboard-outline', label: t('dashboards.distributor.tabOrders') },
    { id: 'stocks', iconName: 'archive-outline', label: t('dashboards.distributor.tabStocks') },
    { id: 'inventory', iconName: 'cube-outline', label: t('dashboards.distributor.tabInventory') },
    { id: 'profile', iconName: 'person-outline', label: t('dashboards.distributor.tabProfile') },
  ];
  const [tab, setTab] = useState('home'); // 'home' | 'orders' | 'pickups' | 'payments'
  // The highlighted bottom tab is derived from the visible content. Pickup Requests
  // and Payment are opened from Home.
  const activeBottomTab = tab === 'orders' ? 'orders' : 'home';

  const handleBottomTabPress = (tab) => {
    if (tab.id === 'stocks') {
      navigation.navigate('Stocks');
    } else if (tab.id === 'inventory') {
      navigation.navigate('DistributorInventoryReport');
    } else if (tab.id === 'profile') {
      navigation.navigate('Profile');
    } else if (tab.id === 'orders') {
      setTab('orders');
    } else if (tab.id === 'home') {
      setTab('home');
    }
  };

  // Pickup Requests and Payment open as full screens without the bottom nav, so
  // the Android back button returns to Home.
  const FULL_SCREEN_TITLES = {
    pickups: 'dashboards.distributor.pickupRequests',
    payments: 'dashboards.distributor.paymentAction',
  };
  const isFullScreen = !!FULL_SCREEN_TITLES[tab];
  useEffect(() => {
    if (!isFullScreen) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setTab('home');
      return true;
    });
    return () => sub.remove();
  }, [isFullScreen]);

  // Keyed on the params object (new on every navigate) so a repeated tab param still applies.
  useEffect(() => {
    if (route.params?.tab) {
      setTab(route.params.tab);
    }
  }, [route.params]);

  const [pickupRequests, setPickupRequests] = useState([]);

  const [orders, setOrders] = useState([]);
  // Orders that are approved or in delivery.
  const [activeOrders, setActiveOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [personnel, setPersonnel] = useState([]);
  const [selectedPersonnel, setSelectedPersonnel] = useState({}); // { [orderId]: personnelId }
  const [busyOrderId, setBusyOrderId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [proofUri, setProofUri] = useState(null);

  const [paymentsSub, setPaymentsSub] = useState('unpaid'); // 'unpaid' | 'paid'
  const [unpaidOrders, setUnpaidOrders] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loadingPayments, setLoadingPayments] = useState(true);
  const [recordingId, setRecordingId] = useState(null); // order id being paid
  const [amountInput, setAmountInput] = useState('');
  const [recordBusy, setRecordBusy] = useState(false);

  // Pending orders: read-through cache only (approve/assign stay online).
  const loadOrders = useCallback(async () => {
    const isCurrent = beginRead('loadOrders');
    const { list } = await readThrough('orders_pending_cache', () =>
      api.get('/api/orders/pending')
    );
    if (!isCurrent()) return;
    setOrders(list);
  }, []);

  // Approved, picked-up and in-transit orders, so assigned orders stay visible.
  const loadActiveOrders = useCallback(async () => {
    const isCurrent = beginRead('loadActiveOrders');
    const { list } = await readThrough('orders_active_cache', () =>
      api.get('/api/orders/active')
    );
    if (!isCurrent()) return;
    setActiveOrders(list);
  }, []);

  // Pickup requests from farmers — feeds the Harvest Receiving card count.
  const loadPickupRequests = useCallback(async () => {
    const isCurrent = beginRead('loadPickupRequests');
    const { list } = await readThrough('pickup_requests_cache', () =>
      api.get('/api/pickup-requests')
    );
    if (!isCurrent()) return;
    setPickupRequests(list);
  }, []);

  // Accounts waiting for approval — the Account Management badge. Same list the
  // Account Management screen shows; a failed read keeps the last count.
  const [pendingAccountCount, setPendingAccountCount] = useState(0);
  const loadPendingAccounts = useCallback(async () => {
    const isCurrent = beginRead('loadPendingAccounts');
    try {
      const rows = await api.get('/api/accounts?status=pending_approval');
      if (isCurrent()) setPendingAccountCount(Array.isArray(rows) ? rows.length : 0);
    } catch {
      // The badge is optional; the screen itself reports its own errors.
    }
  }, []);

  // Delivery personnel: only riders who are Available for Deliveries (the server
  // filters). Cached so the assign picker has names offline; the server still
  // refuses a rider who has since turned availability off.
  const loadPersonnel = useCallback(async () => {
    const isCurrent = beginRead('loadPersonnel');
    const { list } = await readThrough('personnel_cache', () =>
      api.get('/api/delivery-personnel')
    );
    if (!isCurrent()) return;
    setPersonnel(list);
  }, []);

  // Payments: read-through cache (recording a payment stays online).
  const loadPayments = useCallback(async () => {
    const isCurrent = beginRead('loadPayments');
    const [unpaidRes, paidRes] = await Promise.all([
      readThrough('unpaid_orders_cache', () => api.get('/api/orders/unpaid')),
      readThrough('payments_cache', () => api.get('/api/payments')),
    ]);
    if (!isCurrent()) return;
    setUnpaidOrders(unpaidRes.list);
    setPayments(paidRes.list);
  }, []);

  const { syncState } = useAutoSync('distributor-dashboard', useCallback(async () => {
    await Promise.all([loadOrders(), loadActiveOrders(), loadPersonnel(), loadPayments(), loadPickupRequests(), loadPendingAccounts(), refreshProducts.current?.(), stockAlerts.reload()]);
  }, [loadOrders, loadActiveOrders, loadPersonnel, loadPayments, loadPickupRequests, loadPendingAccounts, stockAlerts.reload]));

  useEffect(() => {
    (async () => {
      setLoadingOrders(true);
      setLoadingPayments(true);
      await Promise.all([loadOrders(), loadActiveOrders(), loadPersonnel(), loadPayments(), loadPickupRequests(), loadPendingAccounts()]);
      setLoadingOrders(false);
      setLoadingPayments(false);
    })();
  }, [loadOrders, loadActiveOrders, loadPersonnel, loadPayments, loadPickupRequests, loadPendingAccounts]);

  // Refresh pickup requests whenever this screen regains focus (e.g.
  // returning from Stocks after listing a batch, or from Account Management).
  useEffect(() => {
    if (!navigation?.addListener) return undefined;
    return navigation.addListener('focus', () => {
      loadPickupRequests();
      loadOrders();
      loadActiveOrders();
      loadPayments();
      loadPendingAccounts();
      loadPersonnel().catch(() => {});
    });
  }, [navigation, loadPickupRequests, loadOrders, loadActiveOrders, loadPayments, loadPendingAccounts, loadPersonnel]);

  // Riders change their availability at any time, so the list is re-read when a
  // rider picker is about to be used.
  const refreshPersonnel = useCallback(() => loadPersonnel().catch(() => {}), [loadPersonnel]);
  useEffect(() => {
    if (tab === 'orders' || tab === 'pickups') refreshPersonnel();
  }, [tab, refreshPersonnel]);

  const onRefresh = async () => {
    if (!requestLock.acquire('refresh')) return;
    setRefreshing(true);
    try {
      if (tab === 'orders') await Promise.all([loadOrders(), loadActiveOrders(), loadPersonnel(), loadPickupRequests()]);
      else if (tab === 'pickups') await Promise.all([loadPickupRequests(), loadPersonnel()]);
      else if (tab === 'payments') await loadPayments();
      else await Promise.all([loadOrders(), loadActiveOrders(), loadPickupRequests(), loadPayments(), loadPendingAccounts(), refreshProducts.current?.(), stockAlerts.reload()]);
    } catch (err) {
      showAlert(t('common.error'), friendlyError(err));
    } finally {
      requestLock.release('refresh');
      setRefreshing(false);
    }
  };

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
    if (!requestLock.acquire('RecordBusy')) return;
    setRecordBusy(true);
    try {
      await api.post('/api/payments', { order_id: order.id, amount });
      setRecordingId(null);
      setAmountInput('');
      await loadPayments(); // refresh unpaid + paid lists
      showAlert(t('dashboards.distributor.paymentRecordedTitle'), t('dashboards.distributor.paymentRecordedMessage', { amount: amount.toFixed(2), id: shortId(order.id) }));
    } catch (err) {
      showAlert(t('common.error'), friendlyError(err));
    } finally {
      requestLock.release('RecordBusy');
      setRecordBusy(false);
    }
  };

  const approveOrder = async (order) => {
    if (!requestLock.acquire('BusyOrderId')) return;
    setBusyOrderId(order.id);
    try {
      await api.put(`/api/orders/${order.id}/approve`);
      // Flip the card to "approved" so the assign picker appears (don't remove yet).
      beginRead('loadOrders');
      setOrders((prev) =>
        prev.map((o) => (o.id === order.id ? { ...o, status: 'approved' } : o))
      );
      // Approval is when stock leaves the batches, so the product list changes now.
      refreshProducts.current?.();
      stockAlerts.reload();
      // An approved order is now awaiting payment (Payment badge).
      loadPayments().catch(() => {});
      await refreshPersonnel();
      showAlert(t('dashboards.distributor.orderApprovedTitle'), t('dashboards.distributor.orderApprovedMessage', { id: shortId(order.id) }));
    } catch (err) {
      showAlert(t('common.error'), friendlyError(err));
    } finally {
      requestLock.release('BusyOrderId');
      setBusyOrderId(null);
    }
  };

  const rejectOrder = async (order, reason) => {
    if (!requestLock.acquire('BusyOrderId')) return;
    setBusyOrderId(order.id);
    try {
      await api.put(`/api/orders/${order.id}/cancel`, { reason });
      beginRead('loadOrders');
      setOrders((prev) => prev.filter((o) => o.id !== order.id));
      await loadActiveOrders();
      showAlert(t('dashboards.distributor.orderRejectedTitle'), t('dashboards.distributor.orderRejectedMessage', { id: shortId(order.id) }));
      return true;
    } catch (err) {
      showAlert(t('common.error'), friendlyError(err));
    } finally {
      requestLock.release('BusyOrderId');
      setBusyOrderId(null);
    }
  };

  const assignDelivery = async (order) => {
    const personnelId = selectedPersonnel[order.id];
    if (!personnelId) {
      showAlert(t('common.error'), t('dashboards.distributor.selectDeliveryPerson'));
      return;
    }
    if (!requestLock.acquire('BusyOrderId')) return;
    setBusyOrderId(order.id);
    try {
      await api.put(`/api/orders/${order.id}/assign`, { delivery_personnel_id: personnelId });
      // Remove the order from the pending list and refresh the active list, where
      // it reappears as "assigned".
      beginRead('loadOrders');
      setOrders((prev) => prev.filter((o) => o.id !== order.id));
      await loadActiveOrders();
      showAlert(t('dashboards.distributor.deliveryAssignedTitle'), t('dashboards.distributor.deliveryAssignedMessage', { id: shortId(order.id) }));
    } catch (err) {
      // The rider turned availability off after the list was loaded.
      if (err?.code === 'RIDER_UNAVAILABLE') {
        setSelectedPersonnel((prev) => ({ ...prev, [order.id]: undefined }));
        refreshPersonnel();
      }
      showAlert(t('common.error'), friendlyError(err));
    } finally {
      requestLock.release('BusyOrderId');
      setBusyOrderId(null);
    }
  };

  // Outstanding pickup requests still awaiting the distributor.
  const pendingReceiveCount = pickupRequests.filter((p) => p.status === 'requested').length;
  // Pickup Requests badge: requests the distributor still has to act on — new
  // ones to approve or decline, and approved ones still waiting for a rider.
  const pickupActionCount = pickupRequests.filter((p) => p.status === 'requested' || p.status === 'approved').length;

  return (
    <SafeAreaView style={styles.container}>
      {isFullScreen ? (
        <ScreenHeader
          key="full-screen-header"
          title={t(FULL_SCREEN_TITLES[tab])}
          onBack={() => setTab('home')}
        />
      ) : (
        <ScreenHeader
          key="hub-header"
          title={tab === 'orders' ? t('dashboards.distributor.tabOrders') : t('dashboards.distributor.tabHome')}
          // Messages and notifications only appear on Home; Account
          // Management is reached from Quick Actions.
          right={tab === 'home' ? <HomeHeaderActions /> : null}
        />
      )}

      <SharedScreenTransition style={{ flex: 1 }} visible>
        <ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled"
          // Full screens (Pickup Requests, Payment) have no bottom nav.
          contentContainerStyle={[styles.content, !isFullScreen && { paddingBottom: navSpace }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <OfflineBanner
            offline={syncState === 'offline'}
            pendingCount={0}
          />

          {tab === 'home' && (
            <HomeTab
              navigation={navigation}
              refreshProducts={refreshProducts}
              stockAlertCount={stockAlerts.alerts.length}
              onStockChanged={stockAlerts.reload}
              pendingOrderCount={orders.length}
              pendingPickupCount={pendingReceiveCount}
              pickupActionCount={pickupActionCount}
              pendingAccountCount={pendingAccountCount}
              unpaidCount={unpaidOrders.length}
              onViewPickups={() => setTab('pickups')}
              onViewPayments={() => setTab('payments')}
              onManageAccounts={() => navigation.navigate('AccountManagement')}
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
              onTrack={(o) => navigation.navigate('ShopeeTracking', { orderId: o.id })}
              onViewProof={setProofUri}
            />
          )}

          {tab === 'pickups' && (
            <PickupRequestsPanel
              loading={loadingOrders}
              requests={pickupRequests}
              personnel={personnel}
              onChanged={loadPickupRequests}
              onOpenRiderPicker={refreshPersonnel}
              onViewProof={setProofUri}
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
      </SharedScreenTransition>

      <ImageViewerModal
        uri={proofUri?.proof_photo_url} proof={proofUri?.pod}
        visible={!!proofUri}
        onClose={() => setProofUri(null)}
      />

      {!isFullScreen && (
        <BottomNavBar
          tabs={DISTRIBUTOR_TABS}
          activeTab={activeBottomTab}
          onTabPress={handleBottomTabPress}
        />
      )}
    </SafeAreaView>
  );
}

function HomeTab({
  navigation, refreshProducts, stockAlertCount, onStockChanged,
  pendingOrderCount, pendingPickupCount, pickupActionCount, pendingAccountCount, unpaidCount,
  onViewPickups, onViewPayments, onManageAccounts,
}) {
  const { t, tc } = useTranslation();
  // Four shortcuts share one row when each tile fits "Account Management" (about 96 wide);
  // phones get two rows of two.
  const { width } = useWindowDimensions();
  const quickActionBasis = { flexBasis: (width - 32 - 30) / 4 >= 96 ? '20%' : '40%' };
  return (
    <View>
      {/* One display-only summary card (not tappable); navigation lives in Quick Actions below. */}
      <View style={styles.homeStatsRow}>
        <View style={styles.homeStatItem}>
          <Text style={styles.homeStatValue}>{pendingOrderCount}</Text>
          <Text style={styles.homeStatLabel}>{tc('plural.pendingOrders', pendingOrderCount)}</Text>
        </View>
        <View style={styles.homeStatDivider} />
        <View style={styles.homeStatItem}>
          <Text style={styles.homeStatValue}>{pendingPickupCount}</Text>
          <Text style={styles.homeStatLabel}>{tc('plural.pickupRequests', pendingPickupCount)}</Text>
        </View>
        <View style={styles.homeStatDivider} />
        <View style={styles.homeStatItem}>
          <Text style={styles.homeStatValue}>{unpaidCount}</Text>
          <Text style={styles.homeStatLabel}>{t('dashboards.distributor.unpaid')}</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>{t('dashboards.distributor.quickActions')}</Text>
      <View style={styles.quickActionGrid}>
        <QuickAction icon="checkmark-circle-outline" label={t('dashboards.distributor.pickupRequests')} badge={pickupActionCount}
          badgeLabel={t('dashboards.distributor.needsActionBadge', { count: pickupActionCount })}
          onPress={onViewPickups} style={quickActionBasis} />
        {/* Batches on their last sellable day (7-day stock rule); Stocks opens filtered to them. */}
        <QuickAction icon="alert-circle-outline" label={t('dashboards.distributor.stockAlertAction')} badge={stockAlertCount}
          badgeLabel={tc('stockAlerts.needAttention', stockAlertCount)}
          onPress={() => navigation.navigate('Stocks', { showStockAlerts: stockAlertCount > 0 })} style={quickActionBasis} />
        <QuickAction icon="people-outline" label={t('dashboards.distributor.accountManagement')} badge={pendingAccountCount}
          badgeLabel={t('dashboards.distributor.needsActionBadge', { count: pendingAccountCount })}
          onPress={onManageAccounts} style={quickActionBasis} />
        {/* Unpaid orders, the same list as the Unpaid tab on Payment. */}
        <QuickAction icon="wallet-outline" label={t('dashboards.distributor.paymentAction')} badge={unpaidCount}
          badgeLabel={t('dashboards.distributor.needsActionBadge', { count: unpaidCount })}
          onPress={onViewPayments} style={quickActionBasis} />
      </View>

      <Text style={[styles.sectionTitle, { marginTop: 4 }]}>{t('productList.title')}</Text>
      <ProductListSection refreshProducts={refreshProducts} onStockChanged={onStockChanged} />
    </View>
  );
}

// Aggregated product listings on the Home tab. Each card's Edit button opens a
// modal for quantity and price edits and removal.
function ProductListSection({ refreshProducts, onStockChanged }) {
  const { t, language } = useTranslation();
  const requestLock = useRequestLock();
  const beginRead = useLatestRequest();
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
    const isCurrent = beginRead('loadListings');
    try {
      const data = await api.get('/api/products/listings');
      if (!isCurrent()) return;
      setListings(Array.isArray(data) ? data : []);
    } catch (err) {
      if (!isCurrent()) return;
      showAlert(t('common.error'), friendlyError(err));
    }
  }, [t]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadListings();
      setLoading(false);
    })();
  }, [loadListings]);

  useRefreshOnFocus(loadListings);
  useEffect(() => {
    refreshProducts.current = loadListings;
    return () => { refreshProducts.current = null; };
  }, [refreshProducts, loadListings]);

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
    if (!requestLock.acquire('productEdit')) return;
    setSavingPrice(true);
    try {
      await api.put(`/api/products/${activeListing.id}`, { price_per_kg: priceNum });
      await loadListings();
    } catch (err) {
      showAlert(t('common.error'), friendlyError(err));
    } finally {
      requestLock.release('productEdit');
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
    if (!requestLock.acquire('productEdit')) return;
    setSavingQty(true);
    try {
      await api.put(`/api/products/${activeListing.id}/reduce-quantity`, { new_total_kg: qtyNum });
      await loadListings();
      onStockChanged?.();
    } catch (err) {
      showAlert(t('common.error'), friendlyError(err));
    } finally {
      requestLock.release('productEdit');
      setSavingQty(false);
    }
  };

  const removeProduct = () => {
    if (!activeListing) return;
    // Close the edit modal before showing the confirmation; stacked native modals
    // are unreliable on Android/iOS and can swallow the Confirm tap.
    const target = activeListing;
    const label = localizeVegetableName(target.vegetable_name, language);
    setActiveVeg(null);
    confirmAction(
      t('productList.removeConfirmTitle'),
      t('productList.removeConfirmMessage', { name: label }),
      async () => {
        if (!requestLock.acquire('productEdit')) return;
        setRemoving(true);
        try {
          await api.put(`/api/products/${target.id}/unlist`);
          await loadListings();
          onStockChanged?.();
        } catch (err) {
          showAlert(t('common.error'), friendlyError(err, t('productList.removeFailed')));
        } finally {
          requestLock.release('productEdit');
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
          iconElement={<MaterialCommunityIcons name="package-variant" size={rf(44)} color={colors.inkFaint} />}
          title={t('productList.emptyTitleNone')}
          message={t('productList.emptyMessageNoneStocks')}
        />
      ) : (
        <View style={styles.list}>
          {listings.map((l, i, arr) => {
            const isSoldOut = l.status === 'Sold Out';
            const tile = getVegetableTile(l.vegetable_name);
            return (
              <View key={l.vegetable_name} style={[styles.listRow, i === arr.length - 1 && styles.listRowLast]}>
                <View style={[styles.productTile, { backgroundColor: tile.bg }]}>
                  <VegetableImage source={tile.source} style={styles.productTileIcon} fallbackSize={rf(22)} />
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
                <TouchableOpacity
                  style={[styles.smallBtn, styles.productEditBtn]}
                  onPress={() => openEditModal(l)}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Text style={styles.smallBtnText}>{t('productList.editBtn')}</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
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
              <ModalCloseButton onPress={closeEditModal} style={styles.modalCloseBtn} />

              {activeListing ? (
                <ScrollView
                  style={styles.modalScroll}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                  <View style={styles.modalHeader}>
                    <View style={[styles.productTile, styles.modalTile, { backgroundColor: modalTile.bg }]}>
                      <VegetableImage source={modalTile.source} style={styles.modalTileIcon} fallbackSize={rf(30)} />
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
                      disabled={savingPrice || savingQty || removing}
                    >
                      {savingPrice ? <ActivityIndicator size="small" color={PRIMARY} /> : <Text style={styles.smallBtnText}>{t('common.save')}</Text>}
                    </TouchableOpacity>
                  </View>

                  <TouchableOpacity
                    style={[styles.removeBtnFull, removing && styles.btnDisabled]}
                    onPress={removeProduct}
                    disabled={savingPrice || savingQty || removing}
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

// Same status every role sees (lib/orderStatus).
const effectiveStatus = effectiveOrderStatus;

function getProofUrl(order) {
  return getDelivery(order)?.proof_photo_url || null;
}

// `badge` shows a red count on the icon only when it is above zero.
function QuickAction({ icon, label, onPress, badge = 0, badgeLabel, style }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={badge > 0 && badgeLabel ? `${label}, ${badgeLabel}` : label}
      style={({ pressed }) => [styles.quickAction, style, pressed && styles.quickActionPressed]}
    >
      <View style={styles.quickActionIcon}>
        <Ionicons name={icon} size={rf(20)} color={PRIMARY} />
        {badge > 0 && (
          <View style={styles.quickActionBadge}>
            <Text style={styles.quickActionBadgeText}>{badge > 9 ? '9+' : badge}</Text>
          </View>
        )}
      </View>
      <Text style={styles.quickActionLabel} numberOfLines={2}>{label}</Text>
      <Ionicons name="chevron-forward" size={rf(13)} color={colors.leaf500} style={styles.quickActionChevron} />
    </Pressable>
  );
}

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

  // A newly assigned order reports delivery.status 'assigned', so include it in Approved.
  const approved = activeOrders.filter(
    (o) => ['approved', 'assigned', 'picked_up', 'in_transit'].includes(effectiveStatus(o)) && o.delivery_personnel_id
  );
  const cancelled = activeOrders.filter((o) => o.status === 'cancelled');
  // Finished deliveries: delivered, or unsuccessful (not delivered by the end of its day).
  const history = activeOrders.filter((o) => ['delivered', 'unsuccessful'].includes(effectiveStatus(o)));

  const submitReject = async () => {
    if (!reasonInput.trim() || busyOrderId != null) return;
    const saved = await onReject(rejectingOrder, reasonInput.trim());
    if (saved) {
      setRejectingOrder(null);
      setReasonInput('');
    }
  };

  return (
    <View>
      {/* Scrolls sideways because four labels do not fit evenly on a phone. */}
      <SegmentedTabs
        scroll
        inset={spacing.lg}
        style={styles.tabsBleed}
        value={sub}
        onChange={setSub}
        options={ORDER_SUB_TABS.map((s) => ({
          value: s,
          label: t(`dashboards.distributor.ordersSub.${s}`),
          count: s === 'pending' ? orders.length : 0,
        }))}
      />

      {sub === 'pending' && (
        orders.length === 0 ? (
          <EmptyState iconElement={<Ionicons name="checkmark-circle-outline" size={rf(44)} color={colors.inkFaint} />} title={t('dashboards.distributor.noPendingOrders')} message={t('dashboards.distributor.noPendingOrdersMessage')} />
        ) : orders.map((order) => {
          const busy = busyOrderId != null;
          const isApproved = order.status === 'approved';
          const items = order.order_items || [];

          return (
            <View key={order.id} style={styles.orderCard}>
              <View style={styles.orderHeader}>
                <Text style={styles.orderId}>{t('dashboards.distributor.orderNumber', { id: shortId(order.id) })}</Text>
                <StatusBadge status={order.status} />
              </View>
              <Text style={styles.rowMeta}>{t('dashboards.distributor.retailerLabel', { id: shortId(order.retailer_id) })}</Text>
              {order.delivery_address ? (
                <Text style={styles.rowMeta}>{t('dashboards.distributor.deliverTo', { address: order.delivery_address })}</Text>
              ) : null}

              {items.length === 0 ? (
                <Text style={[styles.rowMeta, { marginTop: 10 }]}>{t('dashboards.distributor.noItemDetails')}</Text>
              ) : (
                <View style={[styles.list, { marginTop: 10 }]}>
                  {items.map((it, i, arr) => {
                    const tile = getVegetableTile(it.vegetable_name);
                    return (
                      <View key={i} style={[styles.listRow, i === arr.length - 1 && styles.listRowLast]}>
                        <View style={[styles.productTile, { backgroundColor: tile.bg }]}>
                          <VegetableImage source={tile.source} style={styles.productTileIcon} fallbackSize={rf(18)} />
                        </View>
                        <Text style={[styles.itemLine, { flex: 1, marginBottom: 0 }]}>{localizeVegetableName(it.vegetable_name, language)}</Text>
                        <Text style={styles.itemLine}>{it.quantity_kg}kg @ {peso(it.price_at_order)}</Text>
                      </View>
                    );
                  })}
                </View>
              )}
              <View style={[styles.list, styles.totalRow]}>
                <Text style={styles.rowTitle}>{t('dashboards.distributor.totalAmountLabel')}</Text>
                <Text style={styles.orderTotal}>{peso(order.total_amount)}</Text>
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
          <EmptyState iconElement={<MaterialCommunityIcons name="truck-delivery-outline" size={rf(44)} color={colors.inkFaint} />} title={t('dashboards.distributor.noApprovedOrders')} message={t('dashboards.distributor.noApprovedOrdersMessage')} />
        ) : approved.map((order) => (
          <View key={order.id} style={styles.orderCard}>
            <View style={styles.orderHeader}>
              <Text style={styles.orderId}>{t('dashboards.distributor.orderNumber', { id: shortId(order.id) })}</Text>
              <StatusBadge status={effectiveStatus(order)} />
            </View>
            <Text style={styles.rowMeta}>{t('dashboards.distributor.retailerLabel', { id: shortId(order.retailer_id) })}</Text>
            <Text style={styles.rowMeta}>
              {order.delivery_personnel_name
                ? t('dashboards.distributor.riderLabel', { name: order.delivery_personnel_name })
                : t('dashboards.distributor.awaitingRider')}
            </Text>
            <View style={[styles.list, styles.totalRow]}>
              <Text style={styles.rowTitle}>{t('dashboards.distributor.totalAmountLabel')}</Text>
              <Text style={styles.orderTotal}>{peso(order.total_amount)}</Text>
            </View>
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
          <EmptyState iconElement={<Ionicons name="close-circle-outline" size={rf(44)} color={colors.inkFaint} />} title={t('dashboards.distributor.noCancelledOrders')} message={t('dashboards.distributor.noCancelledOrdersMessage')} />
        ) : cancelled.map((order) => (
          <View key={order.id} style={styles.orderCard}>
            <View style={styles.orderHeader}>
              <Text style={styles.orderId}>{t('dashboards.distributor.orderNumber', { id: shortId(order.id) })}</Text>
              <StatusBadge status="cancelled" label={t('dashboards.distributor.ordersSub.cancelled')} />
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
          <EmptyState iconElement={<Ionicons name="time-outline" size={rf(44)} color={colors.inkFaint} />} title={t('dashboards.distributor.noHistoryOrders')} message={t('dashboards.distributor.noHistoryOrdersMessage')} />
        ) : history.map((order) => (
          <View key={order.id} style={styles.orderCard}>
            <View style={styles.orderHeader}>
              <Text style={styles.orderId}>{t('dashboards.distributor.orderNumber', { id: shortId(order.id) })}</Text>
              {effectiveStatus(order) === 'unsuccessful'
                ? <StatusBadge status="unsuccessful" />
                : <StatusBadge status="delivered" label={t('dashboards.distributor.ordersSub.history')} />}
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
                onPress={() => onViewProof(getDelivery(order))}
                activeOpacity={0.8}
              >
                <RemoteImage uri={getProofUrl(order)} style={styles.proofThumb} />
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
        busy={busyOrderId != null}
        confirmDisabled={!reasonInput.trim()}
      >
        <Text style={styles.fieldLabel}>{t('dashboards.distributor.rejectReasonLabel')}</Text>
        <TextInput
          style={styles.input}
          value={reasonInput}
          onChangeText={setReasonInput}
          placeholder={t('dashboards.distributor.rejectReasonPlaceholder')} placeholderTextColor={colors.placeholder}
          multiline
        />
      </CustomModal>
    </View>
  );
}

function PaymentsTab({
  loading, sub, setSub, unpaidOrders, payments,
  recordingId, amountInput, setAmountInput, recordBusy,
  onStartRecord, onCancelRecord, onRecord,
}) {
  const { t } = useTranslation();
  if (loading) return <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />;

  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const thisWeekTotal = payments
    .filter((p) => p.recorded_at && new Date(p.recorded_at).getTime() >= weekAgo)
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const pendingTotal = unpaidOrders.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);

  return (
    <View>
      <View style={styles.summaryGrid}>
        <View style={styles.statTile}>
          <Text style={styles.statTileLabel}>{t('dashboards.distributor.thisWeekLabel')}</Text>
          <Text style={styles.statTileValue}>{peso(thisWeekTotal)}</Text>
        </View>
        <View style={styles.statTile}>
          <Text style={styles.statTileLabel}>{t('dashboards.distributor.unpaid')}</Text>
          <Text style={styles.statTileValue}>{peso(pendingTotal)}</Text>
        </View>
      </View>

      <SegmentedTabs
        style={styles.tabsSpaced}
        value={sub}
        onChange={setSub}
        options={[
          { value: 'unpaid', label: t('dashboards.distributor.unpaid'), count: unpaidOrders.length },
          { value: 'paid', label: t('dashboards.distributor.paid') },
        ]}
      />

      {sub === 'unpaid' ? (
        unpaidOrders.length === 0 ? (
          <EmptyState iconElement={<Ionicons name="checkmark-done-outline" size={rf(44)} color={colors.inkFaint} />} title={t('dashboards.distributor.allCaughtUp')} message={t('dashboards.distributor.noUnpaidOrders')} />
        ) : (
          unpaidOrders.map((o) => (
            <View key={o.id} style={styles.rowCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{t('dashboards.distributor.orderNumber', { id: shortId(o.id) })}</Text>
                <Text style={styles.rowMeta}>{peso(o.total_amount)} · {statusLabel(o.status)}</Text>
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
        <EmptyState iconElement={<Ionicons name="cash-outline" size={rf(44)} color={colors.inkFaint} />} title={t('dashboards.distributor.noPaymentsYet')} message={t('dashboards.distributor.noPaymentsYetMessage')} />
      ) : (
        <View style={styles.list}>
          {payments.map((p, i, arr) => (
            <View key={p.id} style={[styles.listRow, i === arr.length - 1 && styles.listRowLast]}>
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
              <StatusBadge status={p.status || 'paid'} />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 16, paddingBottom: 8 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontFamily: fonts.heading, fontSize: rf(fontSize.title), color: colors.ink },
  subtitle: { fontFamily: fonts.body, fontSize: rf(fontSize.md), color: colors.inkSoft, marginTop: 2 },

  summaryGrid: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  statTile: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 14 },
  statTileLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.xs), color: colors.inkSoft },
  statTileValue: { fontFamily: fonts.heading, fontSize: rf(fontSize.h1), color: colors.ink, marginTop: 4 },

  recordBox: { marginTop: 10, backgroundColor: colors.leaf50, borderRadius: radius.ctrl, padding: 10 },
  recordButtons: { flexDirection: 'row', gap: 10, marginTop: 12 },

  content: { padding: 16, paddingBottom: 40 },
  // Distributor filter tabs: 16px below the header (content padding) and
  // 16px above the content that follows.
  tabsSpaced: { marginBottom: spacing.lg },
  tabsBleed: { marginHorizontal: -spacing.lg, marginBottom: spacing.lg },

  homeStatsRow: { flexDirection: 'row', alignItems: 'stretch', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, paddingVertical: 16, marginBottom: 20, ...shadowCard },
  // Three equal-width columns (flex 1, minWidth 0) so long labels wrap instead of squeezing a neighbor.
  homeStatItem: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  homeStatDivider: { width: 1, backgroundColor: colors.border },
  homeStatValue: { fontFamily: fonts.heading, fontSize: rf(fontSize.h1), color: PRIMARY },
  homeStatLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.xs), color: colors.inkSoft, marginTop: 4, textAlign: 'center' },

  quickActionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  quickAction: {
    flexGrow: 1, minHeight: 104, alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.surface, borderWidth: 1.4, borderColor: colors.leaf500, borderRadius: radius.card,
    paddingVertical: 14, paddingHorizontal: 6, ...shadowCard,
  },
  quickActionPressed: { backgroundColor: colors.leaf100, borderColor: colors.leaf700, transform: [{ scale: 0.97 }] },
  quickActionIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.leaf100, alignItems: 'center', justifyContent: 'center' },
  quickActionChevron: { position: 'absolute', top: 8, right: 8 },
  // Same red count badge as the notification and message icons.
  quickActionBadge: {
    position: 'absolute', top: -5, right: -7, minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  quickActionBadgeText: { fontFamily: fonts.bodyBold, color: '#fff', fontSize: rf(11) },
  quickActionLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.xs), color: colors.ink, textAlign: 'center' },

  primaryBtn: { backgroundColor: PRIMARY, borderRadius: radius.ctrl, paddingVertical: 14, alignItems: 'center', marginBottom: 14, justifyContent: 'center', minHeight: control.height },
  primaryBtnText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(fontSize.lg), textAlign: 'center' },

  list: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, overflow: 'hidden' },
  listRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  listRowLast: { borderBottomWidth: 0 },

  productTile: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  productTileIcon: { width: 34, height: 34 },
  productRowTitle: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.lg), color: colors.ink, textTransform: 'capitalize' },
  productRowMeta: { fontFamily: fonts.body, fontSize: rf(fontSize.md), color: colors.inkSoft, marginTop: 2 },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  priceInput: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.ctrl, paddingHorizontal: 10, paddingVertical: 6, fontFamily: fonts.body, fontSize: rf(fontSize.md), color: colors.ink },
  deleteBtnText: { fontFamily: fonts.bodySemiBold, color: colors.danger, fontSize: rf(fontSize.sm), textAlign: 'center' },
  btnDisabled: { opacity: 0.5 },

  modalKav: { flex: 1 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(20,17,16,0.42)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: { width: '100%', maxWidth: 380, maxHeight: '90%', backgroundColor: colors.bgScreen, borderRadius: radius.card, padding: 22, ...shadowCard },
  modalScroll: { flexGrow: 0, flexShrink: 1 },
  modalCloseBtn: { position: 'absolute', top: 14, right: 14, zIndex: 1 },
  modalCloseText: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.lg), color: colors.inkSoft },
  modalHeader: { alignItems: 'center', marginBottom: 18, marginTop: 4 },
  modalTile: { width: 60, height: 60, borderRadius: 16, marginBottom: 10 },
  modalTileIcon: { width: 48, height: 48 },
  modalVegName: { fontFamily: fonts.headingBold, fontSize: rf(fontSize.xl), color: colors.ink, textTransform: 'capitalize', textAlign: 'center' },
  modalLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), color: colors.inkSoft, marginTop: 12, marginBottom: 6 },
  modalInputDisabled: { opacity: 0.5 },
  removeBtnFull: { marginTop: 22, borderWidth: 1.4, borderColor: colors.danger, borderRadius: radius.ctrl, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },

  formCard: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.border, ...shadowCard },
  formTitle: { fontFamily: fonts.heading, fontSize: rf(fontSize.xl), color: colors.ink, marginBottom: 8 },
  fieldLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), color: colors.labelInk, marginTop: 8, marginBottom: 6 },
  input: { backgroundColor: colors.bgScreen, borderRadius: radius.ctrl, padding: 12, fontFamily: fonts.body, fontSize: rf(fontSize.lg), borderWidth: 1.4, borderColor: colors.border, color: colors.ink },
  inputDisabled: { backgroundColor: colors.soil300, color: colors.inkFaint },
  hint: { fontFamily: fonts.body, fontSize: rf(fontSize.sm), color: colors.inkFaint, marginTop: 4 },
  formButtons: { flexDirection: 'row', gap: 10, marginTop: 16 },
  button: { flex: 1, paddingVertical: 14, borderRadius: radius.ctrl, alignItems: 'center' },
  buttonPrimary: { backgroundColor: PRIMARY },
  buttonPrimaryText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(fontSize.lg) },
  buttonOutline: { borderWidth: 1.4, borderColor: PRIMARY },
  buttonOutlineText: { fontFamily: fonts.bodySemiBold, color: PRIMARY, fontSize: rf(fontSize.lg) },
  buttonDanger: { borderWidth: 1.4, borderColor: colors.danger, backgroundColor: 'transparent' },
  buttonDangerText: { fontFamily: fonts.bodySemiBold, color: colors.danger, fontSize: rf(fontSize.lg) },
  buttonDisabled: { opacity: 0.6 },
  pendingActionsRow: { flexDirection: 'row', gap: 10 },
  pendingActionBtn: { flex: 1 },

  sectionTitle: { fontFamily: fonts.heading, fontSize: rf(fontSize.xl), color: colors.ink, marginBottom: 10, marginTop: 4 },

  pickupCard: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border, ...shadowCard },
  pickupFarmer: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.lg), color: colors.ink },
  pickupHarvest: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.md), color: PRIMARY, marginTop: 4 },
  pickupNote: { fontFamily: fonts.body, fontSize: rf(fontSize.sm), color: colors.inkSoft, marginTop: 4 },
  pickupMeta: { fontFamily: fonts.body, fontSize: rf(fontSize.sm), color: colors.inkFaint, marginTop: 4 },
  modalLine: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.lg), color: colors.ink, marginBottom: 6 },
  modalHint: { fontFamily: fonts.body, fontSize: rf(fontSize.sm), color: colors.inkSoft, marginBottom: 10 },
  emptyText: { fontFamily: fonts.body, color: colors.inkFaint, fontStyle: 'italic', marginTop: 8 },

  rowCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.border, ...shadowCard },
  rowTitle: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.lg), color: colors.ink },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  rowMeta: { fontFamily: fonts.body, fontSize: rf(fontSize.md), color: colors.inkSoft, marginTop: 2 },
  pendingBadge: { paddingVertical: 2, paddingHorizontal: 8, borderRadius: 10, backgroundColor: colors.gold100, borderWidth: 1, borderColor: colors.gold500 },
  pendingBadgeText: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.xs), color: colors.gold700 },
  smallBtn: { ...actionBtn, ...actionBtnOutline },
  smallBtnText: { ...actionBtnText, color: PRIMARY },
  // Compact text-only Edit button; hitSlop keeps the tap area at ~44px.
  productEditBtn: { minHeight: 32, paddingVertical: 6, paddingHorizontal: 14 },

  orderCard: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border, ...shadowCard },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  orderId: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.lg), color: colors.ink },
  orderTotal: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.lg), color: PRIMARY },
  itemLine: { fontFamily: fonts.body, fontSize: rf(fontSize.sm), color: colors.inkSoft, marginBottom: 2 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, marginTop: 10, marginBottom: 0 },

  proofRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, backgroundColor: colors.leaf50, borderRadius: radius.ctrl, padding: 8 },
  proofThumb: { width: 48, height: 48, borderRadius: 6, backgroundColor: colors.border },
  proofText: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), color: PRIMARY },

  trackBtn: { ...actionBtn, ...actionBtnOutline, marginBottom: 10 },
  trackBtnText: { ...actionBtnText, color: PRIMARY },

  assignLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.md), color: colors.ink, marginTop: 6, marginBottom: 8 },
  personnelWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  personChip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgScreen },
  personChipActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  personChipText: { fontFamily: fonts.body, color: colors.inkSoft, fontSize: rf(fontSize.sm) },
  personChipTextActive: { fontFamily: fonts.bodySemiBold, color: '#fff' },
});
