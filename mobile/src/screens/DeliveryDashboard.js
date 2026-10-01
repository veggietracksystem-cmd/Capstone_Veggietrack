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
import ScreenHeader from '../components/ScreenHeader';
import HomeHeaderActions from '../components/HomeHeaderActions';
import OfflineBanner from '../components/OfflineBanner';
import ProofPreviewModal from '../components/ProofPreviewModal';
import EmptyState from '../components/EmptyState';
import CustomModal from '../components/CustomModal';
import { SegmentedTabs } from '../components/ui/SegmentedTabs';
import StatusBadge from '../components/ui/StatusBadge';
import BottomNavBar, { useBottomNavSpace } from '../components/BottomNavBar';
import { showAlert, peso, shortId } from '../lib/ui';
import { friendlyError } from '../lib/errorMessages';
import { effectiveOrderStatus, isClosedOrderStatus } from '../lib/orderStatus';
import { colors, fontSize, fonts, radius, shadowCard, spacing, actionBtn, actionBtnOutline, actionBtnPrimary, actionBtnText } from '../theme/appTheme';
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

export function statusColor(status) {
  switch (status) {
    case 'assigned': return colors.info;
    case 'in_transit': return colors.purple;
    case 'delivered': return PRIMARY;
    case 'pending': return colors.gold500;
    case 'unsuccessful': return colors.danger;
    default: return colors.soil600;
  }
}

const STATUS_LABEL_KEYS = ['pending', 'approved', 'assigned', 'otw', 'picked_up', 'in_transit', 'delivered', 'completed', 'cancelled', 'unsuccessful'];

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

// Same status every role sees (lib/orderStatus).
export const effectiveStatus = effectiveOrderStatus;

// Delivery progression ranking used to enable the progress buttons:
// assigned → picked_up → in_transit → delivered.
export const STATUS_RANK = { pending: 0, approved: 0, assigned: 0, picked_up: 1, in_transit: 2, delivered: 3 };

function matchesFilter(order, filter) {
  const s = effectiveStatus(order);
  if (filter === 'all') return true;
  if (filter === 'completed') return s === 'delivered';
  if (filter === 'cancelled') return s === 'cancelled';
  return !isClosedOrderStatus(s);
}

// Maps the `filter` route param ('all' | 'active' | 'completed') onto a bottom tab.
function tabForLegacyFilter(filter) {
  if (filter === 'active') return 'tasks';
  if (filter === 'completed') return 'history';
  return 'home';
}

export default function DeliveryDashboard({ navigation, route }) {
  const navSpace = useBottomNavSpace();
  const beginRead = useLatestRequest();
  const requestLock = useRequestLock();
  const { t, tc, language } = useTranslation();

  const RIDER_TABS = [
    { id: 'home', iconName: 'home-outline', label: t('dashboards.delivery.tabHome') },
    { id: 'tasks', iconName: 'clipboard-outline', label: t('dashboards.delivery.tabTasks') },
    { id: 'history', iconName: 'time-outline', label: t('dashboards.delivery.tabHistory') },
    { id: 'profile', iconName: 'person-outline', label: t('dashboards.delivery.tabProfile') },
  ];

  const [orders, setOrders] = useState([]);
  const [pickups, setPickups] = useState([]);
  // Publish the rider's position while a pickup is outstanding, since pickups are
  // confirmed on this screen (PickupNavigationScreen publishes while it is open).
  // No delivery_id is sent because the position belongs to a pickup, not an order.
  const hasOutstandingPickup = pickups.some((p) => p.status === 'assigned' || p.status === 'otw');
  useRiderLocation(null, hasOutstandingPickup);
  // 'deliveries' | 'pickups' — only relevant on the Tasks & History tabs.
  const [mode, setMode] = useState('deliveries');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [activeBottomTab, setActiveBottomTab] = useState('home');
  const [historyPickup, setHistoryPickup] = useState(null);

  useEffect(() => {
    if (route.params?.filter) {
      setActiveBottomTab(tabForLegacyFilter(route.params.filter));
      setMode('deliveries');
    }
    // Params object is new on every navigate, so a repeated filter still applies.
  }, [route.params]);

  // Throws on failure so the caller decides whether to show an error; background
  // refreshes stay silent.
  const loadPickups = useCallback(async () => {
    const isCurrent = beginRead('loadPickups');
    const data = await api.get('/api/pickup-requests');
    if (!isCurrent()) return;
    setPickups(Array.isArray(data) ? data : []);
  }, []);

  const loadOrders = useCallback(async () => {
    const isCurrent = beginRead('loadOrders');
    const { list } = await readThrough('delivery_orders_cache', () =>
      api.get('/api/delivery/orders')
    );
    if (!isCurrent()) return;
    setOrders(list);
  }, []);

  // Only the first load shows the spinner; later refreshes update the lists in place.
  const hasLoaded = useRef(false);
  const loadAll = useCallback(async ({ silent = hasLoaded.current } = {}) => {
    if (!silent) setLoading(true);
    try { await Promise.all([loadOrders(), loadPickups()]); }
    catch (err) { if (!silent) showAlert(t('common.error'), friendlyError(err)); }
    finally {
      hasLoaded.current = true;
      setLoading(false);
    }
  }, [loadOrders, loadPickups]);

  const { syncState } = useAutoSync('delivery-dashboard', () => loadAll({ silent: true }));

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Refresh when the screen regains focus (e.g. after a status change in
  // DeliveryDetails), keeping the selected tab. The first focus is covered by loadAll.
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

  // Proof of pickup uses the same photo and GPS capture flow as delivery completion.
  const [pickupProofVisible, setPickupProofVisible] = useState(false);
  const [pickupPhoto, setPickupPhoto] = useState(null);
  const [activePickup, setActivePickup] = useState(null);
  const [pickupBusy, setPickupBusy] = useState(false);
  const pickupSubmissionRef = useRef(null);
  const pickupActionRef = useRef(null);

  const acquirePickupLocation = async () => currentProofLocation(t);

  // "On the way" is optional; a pickup can be completed directly from 'assigned'.
  const handleStartPickup = async (pickupId) => {
    if (!requestLock.acquire('BusyId') || busyId != null) return;
    setBusyId(pickupId);
    try {
      await api.put(`/api/pickup-requests/${pickupId}/status`, { status: 'otw' });
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
    if (pickupActionRef.current || busyId != null) return;
    pickupActionRef.current = 'location'; setBusyId(pickup.id);
    try {
      await acquirePickupLocation();
      setActivePickup(pickup);
      setPickupPhoto(null);
      pickupSubmissionRef.current = null;
      setPickupProofVisible(true);
    } catch (err) {
      showAlert(t('common.error'), friendlyError(err));
    } finally {
      pickupActionRef.current = null; setBusyId(null);
    }
  };

  const pickPickupPhoto = async () => {
    if (pickupActionRef.current) return;
    pickupActionRef.current = 'photo'; setPickupBusy(true);
    try {
      if (activePickup) await kvSet(PENDING_PICKUP_PHOTO_KEY, { pickup: activePickup, at: Date.now() });
      const selected = await captureProofPhoto(t, ImagePicker, Platform.OS, setPickupPhoto);
      if (selected) setPickupPhoto(selected);
    } catch (err) {
      if (err.selectedPhoto) setPickupPhoto(err.selectedPhoto);
      showAlert(t('common.error'), friendlyError(err, t('dashboards.delivery.cameraErrorFallback')));
    } finally {
      pickupActionRef.current = null; setPickupBusy(false);
      await kvSet(PENDING_PICKUP_PHOTO_KEY, null);
    }
  };

  // If Android restarted the app while the camera was open, reopen the proof screen
  // for the same pickup with the captured photo.
  const [recoveredPhoto, setRecoveredPhoto] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pending = await kvGet(PENDING_PICKUP_PHOTO_KEY);
      let asset = null;
    try { asset = await recoverPendingProofPhoto(ImagePicker, Platform.OS); } catch { /* No recoverable photo. */ }
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
    if (!pickup) return;
    pickupSubmissionRef.current = null;
    setActivePickup(pickup);
    setPickupPhoto(asset);
    setPickupProofVisible(true);
    currentProofLocation(t)
      .then((pod) => setPickupPhoto((current) => (current === asset ? { ...asset, pod } : current)))
      // Confirm takes a fresh location anyway; the preview just lacks it.
      .catch(() => {});
  }, [recoveredPhoto, loading, pickups]);

  const confirmPickupCompletion = async () => {
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
      await pickupSubmissionRef.current.controller.submit({ photo: pickupPhoto, getLocation: acquirePickupLocation });
      beginRead('loadPickups');
      setPickups(prev => prev.map(p => p.id === pickupId ? { ...p, status: 'picked_up' } : p));
      setPickupProofVisible(false);
      setPickupPhoto(null);
      setActivePickup(null);
      await loadAll({ silent: true });
      showAlert(t('common.success'), t('dashboards.delivery.pickedUpSuccessMessage'));
    } catch (err) {
      showAlert(t('common.error'), proofFailureMessage(err));
    } finally {
      pickupActionRef.current = null; setPickupBusy(false);
    }
  };

  // Deliveries: active (still open) vs history (delivered, cancelled or unsuccessful).
  const activeOrders = orders.filter((o) => matchesFilter(o, 'active'));
  const historyOrders = orders.filter((o) => isClosedOrderStatus(effectiveStatus(o)));
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

  // History card: number, status and View Details. Orders open DeliveryDetails;
  // pickups open the details modal.
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
          {actionable && <TouchableOpacity style={styles.routeBtn} activeOpacity={0.8}
            onPress={() => navigation.navigate('PickupNavigation', { pickupId: pickup.id, pickup })}>
            <Text style={styles.routeBtnText}>{t('dashboards.delivery.navigateBtn')}</Text>
          </TouchableOpacity>}
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
      <ScreenHeader
        title={activeBottomTab === 'tasks' ? t('dashboards.delivery.tabTasks')
          : activeBottomTab === 'history' ? t('dashboards.delivery.tabHistory')
          : t('dashboards.delivery.tabHome')}
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
  historyCard: { backgroundColor: colors.surface, borderRadius: radius.card, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.border, ...shadowCard },
  historyDetailsBtn: { ...actionBtn, ...actionBtnOutline, marginTop: spacing.md },
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
