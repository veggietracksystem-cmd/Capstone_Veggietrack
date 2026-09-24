import useLatestRequest from '../hooks/useLatestRequest';
import useRequestLock from '../hooks/useRequestLock';
import { rf } from '../lib/responsive';
import { useState, useEffect, useCallback, useRef } from 'react';
import { SharedScreenTransition } from '../lib/motion';
import {
  Text, View, ScrollView, TouchableOpacity, Platform,
  ActivityIndicator, StyleSheet, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import api from '../api/client';
import { readThrough } from '../offline/cache';
import { kvGet, kvSet } from '../offline/db';
import { useAuth } from '../context/AuthContext';
import LogoutButton from '../components/LogoutButton';
import ScreenHeader from '../components/ScreenHeader';
import HomeHeaderActions from '../components/HomeHeaderActions';
import ProfileButton from '../components/ProfileButton';
import OfflineBanner from '../components/OfflineBanner';
import DeliveryMapModal from '../components/DeliveryMapModal';
import ProofPreviewModal from '../components/ProofPreviewModal';
import EmptyState from '../components/EmptyState';
import CustomModal from '../components/CustomModal';
import { SegmentedTabs } from '../components/ui/SegmentedTabs';
import StatusBadge from '../components/ui/StatusBadge';
import BottomNavBar, { useBottomNavSpace } from '../components/BottomNavBar';
import { showAlert, peso, shortId } from '../lib/ui';
import { friendlyError } from '../lib/errorMessages';
import { colors, control, fontSize, fonts, radius, shadowCard, spacing, actionBtn, actionBtnOutline, actionBtnPrimary, actionBtnDanger, actionBtnText } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';
import { localizeVegetableName } from '../lib/vegetableNames';
import { useAutoSync } from '../sync/SyncProvider';
import { currentProofLocation, captureProofPhoto, recoverPendingProofPhoto } from '../lib/podCapture';
import { createProofSubmission, proofFailureMessage } from '../lib/podSubmission';
import { uploadToCloudinary } from '../lib/cloudinary';
import { isOnline } from '../offline/net';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import useRiderLocation from '../hooks/useRiderLocation';
import { tr } from '../i18n/translate';

const PRIMARY = colors.leaf700;

// Remembers which pickup the camera was opened for, so a photo Android hands
// back after restarting the app can be reattached to it.
const PENDING_PICKUP_PHOTO_KEY = 'pending_pickup_proof_photo';
const PENDING_PICKUP_PHOTO_MAX_AGE_MS = 15 * 60 * 1000;

// TEMP rider-dashboard diagnostics — remove once the glitch is found.
const dbg = (...args) => console.log('[rider-debug]', ...args);

export function statusColor(status) {
  switch (status) {
    case 'assigned': return colors.info;
    case 'in_transit': return colors.purple;
    case 'delivered': return PRIMARY;
    case 'pending': return colors.gold500;
    default: return colors.soil600;
  }
}

// Status codes with a translated label (see `status.*` in the translations).
const STATUS_LABEL_KEYS = ['pending', 'approved', 'assigned', 'otw', 'picked_up', 'in_transit', 'delivered', 'completed', 'cancelled'];

// Never show raw db values (snake_case) in the UI — always a friendly label.
export function formatStatus(status) {
  if (!status) return '';
  if (STATUS_LABEL_KEYS.includes(status)) return tr(status === 'delivered' ? 'status.completed' : `status.${status}`);
  return status
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// The embedded deliveries relation comes back as an array; take the first record.
export function getDelivery(order) {
  if (Array.isArray(order.deliveries)) return order.deliveries[0] || null;
  return order.deliveries || null; // tolerate a single object too
}

// Effective status prefers the delivery record's status, falling back to the order's.
export function effectiveStatus(order) {
  const d = getDelivery(order);
  return d?.status || order.status || 'pending';
}

// Delivery progression ranking, used to enable/disable the progress buttons
// (Issue 10): assigned → picked_up → in_transit → delivered.
export const STATUS_RANK = { pending: 0, approved: 0, assigned: 0, picked_up: 1, in_transit: 2, delivered: 3 };

function matchesFilter(order, filter) {
  const s = effectiveStatus(order);
  if (filter === 'all') return true;
  if (filter === 'completed') return s === 'delivered';
  if (filter === 'cancelled') return s === 'cancelled';
  // active = anything not yet finished
  return s !== 'delivered' && s !== 'cancelled';
}

// Route params from ProfileScreen / NotificationBell still pass a legacy
// `filter` value ('all' | 'active' | 'completed') — map it onto a bottom tab.
function tabForLegacyFilter(filter) {
  if (filter === 'active') return 'tasks';
  if (filter === 'completed') return 'history';
  return 'home';
}

export default function DeliveryDashboard({ navigation, route }) {
  const navSpace = useBottomNavSpace();
  const beginRead = useLatestRequest();
  const requestLock = useRequestLock();
  const { user } = useAuth();
  const { t, tc, language } = useTranslation();

  const RIDER_TABS = [
    { id: 'home', iconName: 'home-outline', label: t('dashboards.delivery.tabHome') },
    { id: 'tasks', iconName: 'clipboard-outline', label: t('dashboards.delivery.tabTasks') },
    { id: 'history', iconName: 'time-outline', label: t('dashboards.delivery.tabHistory') },
    { id: 'profile', iconName: 'person-outline', label: t('dashboards.delivery.tabProfile') },
  ];

  const [orders, setOrders] = useState([]);
  const [pickups, setPickups] = useState([]);
  // Pickup tracking's rider marker and ETA both read the rider's published
  // position, but the pickup flow lives on this screen and never visits
  // RiderNavigationScreen, which is where the location publisher otherwise
  // mounts (and is scoped to a delivery order). Publish from here too while a
  // pickup is outstanding. No delivery_id is passed: the position belongs to a
  // pickup rather than an order, and POST /api/delivery/update-location records
  // it on the rider either way — sending a pickup id there would be rejected as
  // an unassigned delivery.
  const hasOutstandingPickup = pickups.some((p) => p.status === 'assigned' || p.status === 'otw');
  const riderLocation = useRiderLocation(null, hasOutstandingPickup);
  useEffect(() => { if (riderLocation.error) dbg('location error', riderLocation.error); }, [riderLocation.error]);
  // 'deliveries' | 'pickups' — only relevant on the Tasks & History tabs.
  const [mode, setMode] = useState('deliveries');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [mapAddress, setMapAddress] = useState(null); // address shown in the map modal (Farmer Pickups mode)
  const [mapCoords, setMapCoords] = useState(null); // coordinates shown in the map modal (Farmer Pickups mode)
  // Which bottom-nav tab's content is showing. This is the single source of
  // truth for what's on screen — Home, Tasks and History each render their
  // own distinct content below instead of sharing one filtered list.
  const [activeBottomTab, setActiveBottomTab] = useState('home');
  // History: pickup whose full details are open in the modal.
  const [historyPickup, setHistoryPickup] = useState(null);

  useEffect(() => {
    if (route.params?.filter) {
      setActiveBottomTab(tabForLegacyFilter(route.params.filter));
      setMode('deliveries');
    }
    // Params object is new on every navigate, so a repeated filter still applies.
  }, [route.params]);

  // Throws on failure so each caller decides whether the rider should see it:
  // background refreshes stay silent instead of popping an alert every 30s.
  const loadPickups = useCallback(async () => {
    const isCurrent = beginRead('loadPickups');
    const started = Date.now();
    let data;
    try { data = await api.get('/api/pickup-requests'); }
    catch (err) { dbg('pickups FAILED', Date.now() - started, 'ms', err?.status, err?.message); throw err; }
    dbg('pickups ok', Date.now() - started, 'ms', Array.isArray(data) ? data.map((p) => `${String(p.id).slice(0, 8)}:${p.status}`).join(',') : typeof data, 'current', isCurrent());
    if (!isCurrent()) return;
    setPickups(Array.isArray(data) ? data : []);
  }, []);

  const loadOrders = useCallback(async () => {
    const isCurrent = beginRead('loadOrders');
    const started = Date.now();
    const { list, source, error } = await readThrough('delivery_orders_cache', () =>
      api.get('/api/delivery/orders')
    );
    dbg('orders', source, Date.now() - started, 'ms', list.length, error ? `ERR ${error?.status} ${error?.message}` : '', 'current', isCurrent());
    if (!isCurrent()) return;
    setOrders(list);
    // A cache fallback can be a server error; it is not proof of no internet.
  }, []);

  // Only the first load shows the spinner. Later refreshes (the 30s sync, a
  // reconnect, returning to this screen) update the lists in place, so the
  // cards no longer flash away to a spinner and back on every refresh.
  const hasLoaded = useRef(false);
  const loadAll = useCallback(async ({ silent = hasLoaded.current } = {}) => {
    dbg('loadAll start', { silent });
    if (!silent) setLoading(true);
    try { await Promise.all([loadOrders(), loadPickups()]); }
    catch (err) { if (!silent) showAlert(t('common.error'), friendlyError(err)); }
    finally {
      hasLoaded.current = true;
      setLoading(false);
    }
  }, [loadOrders, loadPickups]);

  // This fixes the rider's stale-assignment path: the same central lifecycle
  // that refreshes every role now revalidates both pickup and delivery feeds.
  const { syncState } = useAutoSync('delivery-dashboard', () => loadAll({ silent: true }));

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Refresh whenever this screen regains focus (e.g. returning from
  // DeliveryDetails after a status change or a reject), so a delivery that
  // was rejected or just marked delivered disappears immediately instead of
  // waiting for a manual pull-to-refresh. Keep the selected tab and task mode.
  // The first focus event arrives with the mount, which loadAll already covers.
  useEffect(() => {
    if (!navigation?.addListener) return undefined;
    return navigation.addListener('focus', () => {
      if (hasLoaded.current) loadAll({ silent: true });
    });
  }, [navigation, loadAll]);

  const onRefresh = async () => {
    if (!requestLock.acquire('refresh')) return;
    setRefreshing(true);
    try {
      await Promise.all([loadOrders(), loadPickups()]);
    } catch (err) {
      showAlert(t('common.error'), friendlyError(err));
    } finally {
      requestLock.release('refresh');
      setRefreshing(false);
    }
  };

  // Proof-of-pickup: same photo + GPS capture flow as delivery completion,
  // reusing the shared podCapture/podSubmission/cloudinary helpers so the
  // rider cannot mark a pickup complete without a verified photo + location.
  const [pickupProofVisible, setPickupProofVisible] = useState(false);
  const [pickupPhoto, setPickupPhoto] = useState(null);
  const [activePickup, setActivePickup] = useState(null);
  const [pickupBusy, setPickupBusy] = useState(false);
  const pickupSubmissionRef = useRef(null);
  const pickupActionRef = useRef(null);

  const acquirePickupLocation = async () => currentProofLocation(t);

  // "On the way" is informational for the farmer (see PUT
  // /api/pickup-requests/:id/status) — the rider can still complete the
  // pickup directly from 'assigned' without visiting this step.
  const handleStartPickup = async (pickupId) => {
    dbg('START pickup tapped', pickupId, 'busyId', busyId, 'lockFree', requestLock.acquire('dbgProbe') && (requestLock.release('dbgProbe'), true));
    if (!requestLock.acquire('BusyId') || busyId != null) return;
    setBusyId(pickupId);
    try {
      await api.put(`/api/pickup-requests/${pickupId}/status`, { status: 'otw' });
      dbg('START pickup ok');
      beginRead('loadPickups');
      setPickups(prev => prev.map(p => p.id === pickupId ? { ...p, status: 'otw' } : p));
      await loadAll({ silent: true });
    } catch (err) {
      showAlert(t('common.error'), friendlyError(err));
    } finally {
      requestLock.release('BusyId');
      setBusyId(null);
    }
  };

  const openPickupProof = async (pickup) => {
    dbg('MARK picked up tapped', pickup.id, 'action', pickupActionRef.current, 'busyId', busyId);
    if (pickupActionRef.current || busyId != null) return;
    pickupActionRef.current = 'location'; setBusyId(pickup.id);
    try {
      const loc = await acquirePickupLocation();
      dbg('MARK location ok', loc);
      setActivePickup(pickup);
      setPickupPhoto(null);
      pickupSubmissionRef.current = null;
      setPickupProofVisible(true);
    } catch (err) {
      dbg('MARK location FAILED', err?.code, err?.message);
      showAlert(t('common.error'), friendlyError(err));
    } finally {
      pickupActionRef.current = null; setBusyId(null);
    }
  };

  const pickPickupPhoto = async () => {
    if (pickupActionRef.current) return;
    pickupActionRef.current = 'photo'; setPickupBusy(true);
    try {
      dbg('PHOTO tapped');
      if (activePickup) await kvSet(PENDING_PICKUP_PHOTO_KEY, { pickup: activePickup, at: Date.now() });
      dbg('PHOTO pending saved', activePickup?.id, JSON.stringify(await kvGet(PENDING_PICKUP_PHOTO_KEY))?.slice(0, 80));
      const selected = await captureProofPhoto(t, ImagePicker, Platform.OS, setPickupPhoto);
      dbg('PHOTO result', selected ? 'ok' : 'cancelled', selected?.pod);
      if (selected) setPickupPhoto(selected);
    } catch (err) {
      dbg('PHOTO FAILED', err?.code, err?.message);
      if (err.selectedPhoto) setPickupPhoto(err.selectedPhoto);
      showAlert(t('common.error'), friendlyError(err, t('dashboards.delivery.cameraErrorFallback')));
    } finally {
      pickupActionRef.current = null; setPickupBusy(false);
      await kvSet(PENDING_PICKUP_PHOTO_KEY, null);
    }
  };

  // If Android killed the app while the camera was open, reopen the proof
  // screen for the same pickup with the photo that was taken. The pickup comes
  // from the note saved before the camera opened, or, failing that, the one
  // pickup that is on the way.
  const [recoveredPhoto, setRecoveredPhoto] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pending = await kvGet(PENDING_PICKUP_PHOTO_KEY);
      dbg('PHOTO recovery check', pending ? `note for ${pending.pickup?.id} age ${Date.now() - pending.at}ms` : 'no note');
      let asset = null;
      try { asset = await recoverPendingProofPhoto(ImagePicker, Platform.OS); }
      catch (err) { dbg('PHOTO recovery FAILED', err?.message); }
      dbg('PHOTO recovery result', asset ? 'photo recovered' : 'no pending photo');
      await kvSet(PENDING_PICKUP_PHOTO_KEY, null);
      if (!asset || cancelled) return;
      const noteIsFresh = pending?.pickup && Date.now() - pending.at <= PENDING_PICKUP_PHOTO_MAX_AGE_MS;
      setRecoveredPhoto({ asset, pickup: noteIsFresh ? pending.pickup : null });
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!recoveredPhoto || loading) return;
    const onTheWay = pickups.filter((p) => p.status === 'otw');
    const pickup = recoveredPhoto.pickup || (onTheWay.length === 1 ? onTheWay[0] : null);
    const { asset } = recoveredPhoto;
    setRecoveredPhoto(null);
    dbg('PHOTO recovery reopening', pickup?.id || 'no matching pickup');
    if (!pickup) return;
    pickupSubmissionRef.current = null;
    setActivePickup(pickup);
    setPickupPhoto(asset);
    setPickupProofVisible(true);
    currentProofLocation(t)
      .then((pod) => setPickupPhoto((current) => (current === asset ? { ...asset, pod } : current)))
      // Confirm takes a fresh location anyway; the preview just lacks it.
      .catch((err) => dbg('PHOTO recovery location FAILED', err?.code, err?.message));
  }, [recoveredPhoto, loading, pickups]);

  const confirmPickupCompletion = async () => {
    dbg('CONFIRM tapped', activePickup?.id, 'action', pickupActionRef.current, 'hasPhoto', !!pickupPhoto?.uri);
    if (pickupActionRef.current || !activePickup) return;
    pickupActionRef.current = 'complete'; setPickupBusy(true);
    const pickupId = activePickup.id;
    try {
      if (!pickupSubmissionRef.current || pickupSubmissionRef.current.id !== pickupId) {
        pickupSubmissionRef.current = { id: pickupId, controller: createProofSubmission({
          upload: uploadToCloudinary, isOnline,
          // Pre-flight first: a rejection here costs no Cloudinary upload.
          precheck: body => api.post(`/api/pickup-requests/${pickupId}/pickup/check`, body),
          complete: body => api.post(`/api/pickup-requests/${pickupId}/pickup`, body),
          isConfirmed: (result) => !!result && (result.request?.status === 'picked_up' ||
            ['Pickup completed successfully and inventory updated', 'Pickup marked complete, but the batch could not be added to Stocks — contact support', 'Pickup already completed'].includes(result.message)),
        }) };
      }
      const result = await pickupSubmissionRef.current.controller.submit({ photo: pickupPhoto, getLocation: acquirePickupLocation });
      dbg('CONFIRM ok', JSON.stringify(result).slice(0, 300));
      beginRead('loadPickups');
      setPickups(prev => prev.map(p => p.id === pickupId ? { ...p, status: 'picked_up' } : p));
      setPickupProofVisible(false);
      setPickupPhoto(null);
      setActivePickup(null);
      await loadAll({ silent: true });
      showAlert(t('common.success'), t('dashboards.delivery.pickedUpSuccessMessage'));
    } catch (err) {
      dbg('CONFIRM FAILED', err?.stage, err?.status, err?.code, err?.message, JSON.stringify(err?.data || null).slice(0, 300));
      // TEMP diagnostics: the Metro log link drops once the camera opens, so show
      // the underlying failure on screen in development builds.
      const detail = __DEV__ ? `

[debug] stage=${err?.stage} code=${err?.code} status=${err?.status}
${err?.cause || err?.message}
${JSON.stringify(err?.file || '')}` : '';
      showAlert(t('common.error'), proofFailureMessage(err) + detail);
    } finally {
      pickupActionRef.current = null; setPickupBusy(false);
    }
  };

  // Deliveries: active (not yet completed/cancelled) vs history (finished).
  const activeOrders = orders.filter((o) => matchesFilter(o, 'active'));
  const historyOrders = orders.filter((o) => {
    const s = effectiveStatus(o);
    return s === 'delivered' || s === 'cancelled';
  });
  // Pickups: still actionable (assigned or on the way) vs already picked up (history).
  const activePickups = pickups.filter((p) => p.status === 'assigned' || p.status === 'otw');
  const pickupHistory = pickups.filter((p) => p.status !== 'assigned' && p.status !== 'otw');
  // History tab shows both kinds in one list, most recent first (records
  // without a timestamp keep their original order).
  const historyTime = (r) => new Date(r.updated_at || r.created_at || 0).getTime() || 0;
  const combinedHistory = [
    ...historyOrders.map((record) => ({ kind: 'order', key: `o-${record.id}`, record })),
    ...pickupHistory.map((record) => ({ kind: 'pickup', key: `p-${record.id}`, record })),
  ].sort((a, b) => historyTime(b.record) - historyTime(a.record));

  const handleBottomTabPress = (tab) => {
    if (tab.id === 'profile') {
      navigation.navigate('Profile');
      return;
    }
    setActiveBottomTab(tab.id);
    setMode('deliveries');
  };

  const goToTasks = (targetMode) => {
    setMode(targetMode);
    setActiveBottomTab('tasks');
  };
  const renderOrderCard = (order) => {
  const status = effectiveStatus(order);
  const canNavigate = status === 'assigned' || status === 'in_transit' || status === 'picked_up';
  
  return (
    <View key={order.id} style={styles.orderCard}>
      <View style={styles.orderHeader}>
        <Text style={styles.orderId}>{t('dashboards.distributor.orderNumber', { id: shortId(order.id) })}</Text>
        <StatusBadge status={status} label={formatStatus(status)} />
      </View>

      <Text style={styles.orderTotal}>{peso(order.total_amount)}</Text>

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[styles.detailsBtn, styles.flexButton]}
          onPress={() => navigation.navigate('DeliveryDetails', { order })}
          activeOpacity={0.8}
        >
          <Text style={styles.detailsBtnText}>{t('dashboards.delivery.viewDetailsBtn')}</Text>
        </TouchableOpacity>

        {canNavigate && (
          <TouchableOpacity
            style={[styles.detailsBtn, styles.navigateBtn]}
            onPress={() => navigation.navigate('RiderNavigation', { orderId: order.id })}
            activeOpacity={0.8}
          >
            <Text style={styles.navigateBtnText}>{t('dashboards.delivery.navigateBtn')}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

  // History list: compact card with just the number, status and View
  // Details. Orders open the existing Delivery Details screen; pickups open
  // the details modal below.
  const renderHistoryCard = (item) => {
    const isOrder = item.kind === 'order';
    const r = item.record;
    const status = isOrder ? effectiveStatus(r) : r.status;
    return (
      <View key={item.key} style={styles.historyCard}>
        <View style={styles.orderHeader}>
          <Text style={styles.orderId} numberOfLines={1}>
            {isOrder
              ? t('dashboards.distributor.orderNumber', { id: shortId(r.id) })
              : t('dashboards.delivery.pickupNumber', { id: shortId(r.id) })}
          </Text>
          <StatusBadge status={status} label={formatStatus(status)} />
        </View>
        <TouchableOpacity
          style={styles.historyDetailsBtn}
          onPress={() => (isOrder ? navigation.navigate('DeliveryDetails', { order: r }) : setHistoryPickup(r))}
          activeOpacity={0.8}
        >
          <Text style={styles.routeBtnText}>{t('dashboards.delivery.viewDetailsBtn')}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderPickupCard = (pickup, { actionable }) => {
    const harvest = pickup.harvests;
    return (
      <View key={pickup.id} style={styles.orderCard}>
        <View style={styles.orderHeader}>
          <Text style={styles.orderId}>{t('dashboards.delivery.pickupNumber', { id: shortId(pickup.id) })}</Text>
          <StatusBadge status={pickup.status} label={formatStatus(pickup.status)} />
        </View>
        <Text style={styles.rowMeta}>{pickup.farmer_name || t('dashboards.delivery.farmerFallback')}</Text>
        <Text style={styles.rowMeta}>{harvest ? `${localizeVegetableName(harvest.vegetable_name, language)} · ${harvest.quantity_kg} kg` : t('dashboards.delivery.vegetablesFallback')}</Text>
        {!!pickup.farmer_address && <Text style={styles.rowMeta}>{pickup.farmer_address}</Text>}
        <View style={styles.buttonRow}>
          {!!pickup.farmer_address && <TouchableOpacity style={styles.routeBtn} onPress={() => {
            setMapAddress(pickup.farmer_address);
            setMapCoords(pickup.farmer_coords);
          }}><Text style={styles.routeBtnText}>{t('dashboards.delivery.viewRoute')}</Text></TouchableOpacity>}
          {actionable && pickup.status === 'assigned' && <TouchableOpacity style={styles.detailsBtn} disabled={busyId != null} onPress={() => handleStartPickup(pickup.id)}>
            {busyId === pickup.id ? <ActivityIndicator color={PRIMARY} /> : <Text style={styles.detailsBtnText}>{t('dashboards.delivery.startPickupBtn')}</Text>}
          </TouchableOpacity>}
          {actionable && pickup.status === 'otw' && <TouchableOpacity style={styles.detailsBtn} disabled={busyId != null} onPress={() => openPickupProof(pickup)}>
            {busyId === pickup.id ? <ActivityIndicator color={PRIMARY} /> : <Text style={styles.detailsBtnText}>{t('dashboards.delivery.markPickedUpBtn')}</Text>}
          </TouchableOpacity>}
        </View>
      </View>
    );
  };

  const renderCount = useRef(0);
  renderCount.current += 1;
  if (renderCount.current % 10 === 1) dbg('render #', renderCount.current, { tab: activeBottomTab, mode, loading, orders: orders.length, pickups: pickups.length, gpsOn: hasOutstandingPickup });

  const modeToggle = (
    <SegmentedTabs
      value={mode}
      onChange={setMode}
      options={[
        { value: 'deliveries', label: t('dashboards.delivery.modeDeliveries'), count: activeOrders.length },
        { value: 'pickups', label: t('dashboards.delivery.modePickups'), count: activePickups.length },
      ]}
    />
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Same centred header every screen in the app uses. */}
      <ScreenHeader
        // Title follows the open tab (Home / Tasks / History).
        title={activeBottomTab === 'tasks' ? t('dashboards.delivery.tabTasks')
          : activeBottomTab === 'history' ? t('dashboards.delivery.tabHistory')
          : t('dashboards.delivery.tabHome')}
        // Messages and notifications only appear on Home.
        right={activeBottomTab === 'home' ? <HomeHeaderActions /> : null}
      />

  <SharedScreenTransition style={{ flex: 1 }} visible>
    <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: navSpace }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <OfflineBanner offline={syncState === 'offline'} />

          {activeBottomTab === 'home' && (
          <View>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>{tc('plural.activeDeliveries', activeOrders.length)}</Text>
              {activeOrders.length > 3 && (
                <TouchableOpacity onPress={() => goToTasks('deliveries')} activeOpacity={0.7}>
                  <Text style={styles.seeAllText}>{t('dashboards.delivery.seeAllBtn')}</Text>
                </TouchableOpacity>
              )}
            </View>
            {loading ? (
              <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 24, marginBottom: 24 }} />
            ) : activeOrders.length === 0 ? (
              <EmptyState
                iconElement={<MaterialCommunityIcons name="truck-delivery-outline" size={rf(44)} color={colors.inkFaint} />}
                title={t('dashboards.delivery.noDeliveriesTitle', { filter: '' })}
                message={t('dashboards.delivery.noDeliveriesMessage')}
              />
            ) : (
              activeOrders.slice(0, 3).map(renderOrderCard)
            )}

            <View style={[styles.sectionHead, { marginTop: 8 }]}>
              <Text style={styles.sectionTitle}>{tc('plural.pendingPickups', activePickups.length)}</Text>
              {activePickups.length > 3 && (
                <TouchableOpacity onPress={() => goToTasks('pickups')} activeOpacity={0.7}>
                  <Text style={styles.seeAllText}>{t('dashboards.delivery.seeAllBtn')}</Text>
                </TouchableOpacity>
              )}
            </View>
            {loading ? null : activePickups.length === 0 ? (
              <EmptyState
                iconElement={<MaterialCommunityIcons name="tractor" size={rf(44)} color={colors.inkFaint} />}
                title={t('dashboards.delivery.noAssignedPickupsTitle')}
                message={t('dashboards.delivery.noAssignedPickupsMessage')}
              />
            ) : (
              activePickups.slice(0, 3).map((p) => renderPickupCard(p, { actionable: true }))
            )}
          </View>
        )}

        {activeBottomTab === 'tasks' && (
          <View>
            {modeToggle}

            {mode === 'deliveries' ? (
              <>
                <Text style={styles.sectionTitle}>{t('dashboards.delivery.myDeliveries')}</Text>
                {loading ? (
                  <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />
                ) : activeOrders.length === 0 ? (
                  <EmptyState
                    iconElement={<MaterialCommunityIcons name="truck-delivery-outline" size={rf(44)} color={colors.inkFaint} />}
                    title={t('dashboards.delivery.noDeliveriesTitle', { filter: '' })}
                    message={t('dashboards.delivery.noDeliveriesMessage')}
                  />
                ) : (
                  activeOrders.map(renderOrderCard)
                )}
              </>
            ) : (
              <>
                <Text style={styles.sectionTitle}>{t('dashboards.delivery.farmerPickups')}</Text>
                {loading ? (
                  <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />
                ) : activePickups.length === 0 ? (
                  <EmptyState
                    iconElement={<MaterialCommunityIcons name="tractor" size={rf(44)} color={colors.inkFaint} />}
                    title={t('dashboards.delivery.noAssignedPickupsTitle')}
                    message={t('dashboards.delivery.noAssignedPickupsMessage')}
                  />
                ) : (
                  activePickups.map((p) => renderPickupCard(p, { actionable: true }))
                )}
              </>
            )}
          </View>
        )}

        {activeBottomTab === 'history' && (
          <View>
            {/* One combined list: finished deliveries and past pickups,
                newest first. Each card's own title (Order # / Pickup #)
                tells them apart, so no filter tabs are needed. */}
            {loading ? (
              <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />
            ) : combinedHistory.length === 0 ? (
              <EmptyState
                iconElement={<MaterialCommunityIcons name="history" size={rf(44)} color={colors.inkFaint} />}
                title={t('dashboards.delivery.noCombinedHistoryTitle')}
                message={t('dashboards.delivery.noCombinedHistoryMessage')}
              />
            ) : (
              combinedHistory.map(renderHistoryCard)
            )}
          </View>
          )}
          </ScrollView>
        </SharedScreenTransition>

      {/* Full details for a pickup opened from History. */}
      <CustomModal
        visible={!!historyPickup}
        title={historyPickup ? t('dashboards.delivery.pickupNumber', { id: shortId(historyPickup.id) }) : ''}
        onCancel={() => setHistoryPickup(null)}
        compactActions
      >
        {!!historyPickup && (() => {
          const harvest = historyPickup.harvests;
          const when = historyPickup.updated_at || historyPickup.created_at;
          const rows = [
            [t('dashboards.delivery.detailFarmer'), historyPickup.farmer_name || t('dashboards.delivery.farmerFallback')],
            [t('dashboards.delivery.detailProduce'), harvest ? localizeVegetableName(harvest.vegetable_name, language) : t('dashboards.delivery.vegetablesFallback')],
            harvest && [t('dashboards.delivery.detailQuantity'), `${harvest.quantity_kg} kg`],
            historyPickup.farmer_address && [t('dashboards.delivery.detailAddress'), historyPickup.farmer_address],
            when && [t('dashboards.delivery.detailUpdated'), new Date(when).toLocaleString()],
          ].filter(Boolean);
          return (
            <>
              <View style={styles.detailStatusRow}>
                <Text style={styles.detailLabel}>{t('dashboards.delivery.detailStatus')}</Text>
                <StatusBadge status={historyPickup.status} label={formatStatus(historyPickup.status)} />
              </View>
              {rows.map(([label, value]) => (
                <View key={label} style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{label}</Text>
                  <Text style={styles.detailValue}>{value}</Text>
                </View>
              ))}
            </>
          );
        })()}
      </CustomModal>

      <DeliveryMapModal
        visible={!!mapAddress}
        address={mapAddress}
        coords={mapCoords}
        onClose={() => {
          setMapAddress(null);
          setMapCoords(null);
        }}
      />

      <ProofPreviewModal
        visible={pickupProofVisible}
        orderLabel={activePickup ? `#${shortId(activePickup.id)}` : ''}
        photo={pickupPhoto}
        busy={pickupBusy}
        title={t('dashboards.delivery.confirmPickupTitle')}
        confirmIdleLabel={t('dashboards.delivery.confirmPickupTitle')}
        onPickPhoto={pickPickupPhoto}
        onConfirm={confirmPickupCompletion}
        onCancel={() => { if (!pickupBusy) { setPickupProofVisible(false); setActivePickup(null); setPickupPhoto(null); } }}
      />

      <BottomNavBar
        tabs={RIDER_TABS}
        activeTab={activeBottomTab}
        onTabPress={handleBottomTabPress}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 16, paddingBottom: 8 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontFamily: fonts.heading, fontSize: rf(fontSize.title), color: colors.ink },
  subtitle: { fontFamily: fonts.body, fontSize: rf(fontSize.md), color: colors.inkSoft, marginTop: 2 },

  content: { padding: 16, paddingBottom: 40 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { fontFamily: fonts.heading, fontSize: rf(fontSize.xl), color: colors.ink, marginBottom: 10 },
  seeAllText: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), color: PRIMARY },
  emptyText: { fontFamily: fonts.body, color: colors.inkFaint, fontStyle: 'italic', marginTop: 8 },

  orderCard: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border, ...shadowCard },
  // History list: compact card (number + status, then View Details).
  historyCard: { backgroundColor: colors.surface, borderRadius: radius.card, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.border, ...shadowCard },
  historyDetailsBtn: { ...actionBtn, ...actionBtnOutline, marginTop: spacing.md },
  // Pickup details modal rows.
  detailStatusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  detailRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  detailLabel: { fontFamily: fonts.body, fontSize: rf(fontSize.xs), color: colors.inkFaint },
  detailValue: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.md), color: colors.ink, marginTop: 2 },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  orderId: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.lg), color: colors.ink },
  orderTotal: { fontFamily: fonts.heading, fontSize: rf(fontSize.xl), color: PRIMARY, marginBottom: 4 },
  rowMeta: { fontFamily: fonts.body, fontSize: rf(fontSize.md), color: colors.inkSoft, marginTop: 2 },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  routeBtn: { ...actionBtn, ...actionBtnOutline, flex: 1 },
  routeBtnText: { ...actionBtnText, color: PRIMARY },

  button: { paddingVertical: 14, borderRadius: radius.ctrl, alignItems: 'center', marginTop: 4 },
  buttonPrimary: { backgroundColor: PRIMARY },
  buttonPrimaryText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(fontSize.lg) },
  buttonDisabled: { opacity: 0.6 },

  detailsBtn: { ...actionBtn, ...actionBtnOutline, flex: 1 },
  detailsBtnText: { ...actionBtnText, color: PRIMARY },

  buttonRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  flexButton: { flex: 1 },
  navigateBtn: { ...actionBtn, ...actionBtnPrimary, flex: 1 },
  navigateBtnText: { ...actionBtnText, color: '#fff' },
});
