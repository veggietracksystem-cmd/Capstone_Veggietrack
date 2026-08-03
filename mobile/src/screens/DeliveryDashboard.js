import { useState, useEffect, useCallback } from 'react';
import {
  Text, View, ScrollView, TouchableOpacity,
  ActivityIndicator, StyleSheet, Platform, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import api from '../api/client';
import { readThrough } from '../offline/cache';
import { uploadToCloudinary } from '../lib/cloudinary';
import { useAuth } from '../context/AuthContext';
import LogoutButton from '../components/LogoutButton';
import NotificationBell from '../components/NotificationBell';
import MessagesButton from '../components/MessagesButton';
import ProfileButton from '../components/ProfileButton';
import OfflineBanner from '../components/OfflineBanner';
import DeliveryMapModal from '../components/DeliveryMapModal';
import EmptyState from '../components/EmptyState';
import ProofPreviewModal from '../components/ProofPreviewModal';
import BottomNavBar from '../components/BottomNavBar';
import { showAlert, peso, shortId } from '../lib/ui';
import { colors, fonts, radius, shadowCard } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';

const PRIMARY = colors.leaf700;

function statusColor(status) {
  switch (status) {
    case 'assigned': return '#1976d2';
    case 'in_transit': return '#7b1fa2';
    case 'delivered': return PRIMARY;
    case 'pending': return colors.gold500;
    default: return '#607d8b';
  }
}

// The embedded deliveries relation comes back as an array; take the first record.
function getDelivery(order) {
  if (Array.isArray(order.deliveries)) return order.deliveries[0] || null;
  return order.deliveries || null; // tolerate a single object too
}

// Effective status prefers the delivery record's status, falling back to the order's.
function effectiveStatus(order) {
  const d = getDelivery(order);
  return d?.status || order.status || 'pending';
}

// Delivery progression ranking, used to enable/disable the progress buttons
// (Issue 10): assigned → picked_up → in_transit → delivered.
const STATUS_RANK = { pending: 0, approved: 0, assigned: 0, picked_up: 1, in_transit: 2, delivered: 3 };

function matchesFilter(order, filter) {
  const s = effectiveStatus(order);
  if (filter === 'all') return true;
  if (filter === 'completed') return s === 'delivered';
  if (filter === 'cancelled') return s === 'cancelled';
  // active = anything not yet finished
  return s !== 'delivered' && s !== 'cancelled';
}

export default function DeliveryDashboard({ navigation, route }) {
  const { user } = useAuth();
  const { t } = useTranslation();

  const RIDER_TABS = [
    { id: 'home', iconName: 'home-outline', label: t('dashboards.delivery.tabHome') },
    { id: 'tasks', iconName: 'clipboard-outline', label: t('dashboards.delivery.tabTasks') },
    { id: 'map', iconName: 'map-outline', label: t('dashboards.delivery.tabMap') },
    { id: 'history', iconName: 'time-outline', label: t('dashboards.delivery.tabHistory') },
    { id: 'profile', iconName: 'person-outline', label: t('dashboards.delivery.tabProfile') },
  ];

  const FILTERS = [
    { key: 'all', label: t('dashboards.delivery.filterAll') },
    { key: 'active', label: t('dashboards.delivery.filterActive') },
    { key: 'completed', label: t('dashboards.delivery.filterCompleted') },
    { key: 'cancelled', label: t('dashboards.delivery.filterCancelled') },
  ];

  const [orders, setOrders] = useState([]);
  const [pickups, setPickups] = useState([]);
  const [mode, setMode] = useState('deliveries'); // 'deliveries' | 'pickups'
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [photos, setPhotos] = useState({}); // { [orderId]: pickedAsset }
  const [confirmOrder, setConfirmOrder] = useState(null); // order shown in the confirm-delivery modal
  const [offline, setOffline] = useState(false);
  const [mapAddress, setMapAddress] = useState(null); // address shown in the map modal
  const [mapCoords, setMapCoords] = useState(null); // coordinates shown in the map modal
  const [filter, setFilter] = useState('active'); // summary-card filter (default: active work)

  useEffect(() => {
    if (route.params?.filter) {
      setFilter(route.params.filter);
    }
  }, [route.params?.filter]);

  const loadPickups = useCallback(async () => {
    try {
      const data = await api.get('/api/pickup-requests');
      setPickups(Array.isArray(data) ? data : []);
    } catch {
      // silent
    }
  }, []);

  const loadOrders = useCallback(async () => {
    const { list, source } = await readThrough('delivery_orders_cache', () =>
      api.get('/api/delivery/orders')
    );
    setOrders(list);
    setOffline(source === 'cache');
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadOrders(), loadPickups()]);
    setLoading(false);
  }, [loadOrders, loadPickups]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadOrders(), loadPickups()]);
    setRefreshing(false);
  };

  const handleMarkPickedUp = async (pickupId) => {
    setBusyId(pickupId);
    try {
      await api.post(`/api/pickup-requests/${pickupId}/pickup`);
      await Promise.all([loadOrders(), loadPickups()]);
      showAlert(t('common.success'), t('dashboards.delivery.pickedUpSuccessMessage'));
    } catch (err) {
      showAlert(t('common.error'), err.message);
    } finally {
      setBusyId(null);
    }
  };

  // Capture proof of delivery: camera on native, file/library picker on web.
  const pickPhoto = async (orderId) => {
    try {
      let result;
      if (Platform.OS === 'web') {
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.6,
        });
      } else {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          showAlert(t('dashboards.delivery.permissionNeededTitle'), t('dashboards.delivery.cameraPermissionMessage'));
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          quality: 0.6,
        });
      }

      if (!result.canceled && result.assets?.length) {
        setPhotos((prev) => ({ ...prev, [orderId]: result.assets[0] }));
      }
    } catch (err) {
      showAlert(t('common.error'), err.message || t('dashboards.delivery.cameraErrorFallback'));
    }
  };

  const clearPhoto = (orderId) => {
    setPhotos((prev) => {
      const next = { ...prev };
      delete next[orderId];
      return next;
    });
  };

  // Issue 10: advance the delivery (picked_up / in_transit). The backend mirrors
  // the status onto the order so the retailer/distributor trackers move live.
  const updateDeliveryStatus = async (order, newStatus) => {
    const delivery = getDelivery(order);
    if (!delivery || !delivery.id) {
      showAlert(t('dashboards.delivery.missingDeliveryTitle'), t('dashboards.delivery.pullToRefreshRetry'));
      return;
    }
    setBusyId(order.id);
    try {
      await api.put(`/api/deliveries/${delivery.id}/status`, { status: newStatus });
      await loadOrders();
    } catch (err) {
      showAlert(t('common.error'), err.message);
    } finally {
      setBusyId(null);
    }
  };

  const markDelivered = async (order) => {
    const delivery = getDelivery(order);
    if (!delivery || !delivery.id) {
      showAlert(
        t('dashboards.delivery.missingDeliveryTitle'),
        t('dashboards.delivery.missingDeliveryIdMessage')
      );
      return;
    }

    setBusyId(order.id);
    try {
      // If a proof photo was attached, upload it to Cloudinary first.
      let proofUrl;
      const asset = photos[order.id];
      if (asset) {
        proofUrl = await uploadToCloudinary(asset);
      }

      // NOTE: uses the DELIVERY record id, not the order id.
      await api.put(`/api/deliveries/${delivery.id}/complete`,
        proofUrl ? { proof_photo_url: proofUrl } : {});

      clearPhoto(order.id);
      setConfirmOrder(null); // close the confirm modal
      // Reload so the order moves into the "Completed" bucket (counts stay accurate).
      await loadOrders();
      showAlert(t('dashboards.delivery.deliveredTitle'), t('dashboards.delivery.deliveredMessage', { id: shortId(order.id) }));
    } catch (err) {
      showAlert(t('common.error'), err.message);
    } finally {
      setBusyId(null);
    }
  };

  // Counts for the summary cards + the list the user currently sees.
  const counts = {
    all: orders.length,
    active: orders.filter((o) => matchesFilter(o, 'active')).length,
    completed: orders.filter((o) => matchesFilter(o, 'completed')).length,
    cancelled: orders.filter((o) => matchesFilter(o, 'cancelled')).length,
  };
  const visibleOrders = orders.filter((o) => matchesFilter(o, filter));

  const [activeBottomTab, setActiveBottomTab] = useState('home');

  const handleBottomTabPress = (tab) => {
    setActiveBottomTab(tab.id);
    if (tab.id === 'profile') {
      navigation.navigate('Profile');
    } else if (tab.id === 'tasks') {
      setFilter('active');
    } else if (tab.id === 'history') {
      setFilter('completed');
    } else if (tab.id === 'home') {
      setFilter('all');
    } else if (tab.id === 'map') {
      if (visibleOrders.length > 0 && visibleOrders[0].delivery_address) {
        setMapAddress(visibleOrders[0].delivery_address);
        if (visibleOrders[0].latitude && visibleOrders[0].longitude) {
          setMapCoords({
            latitude: Number(visibleOrders[0].latitude),
            longitude: Number(visibleOrders[0].longitude),
          });
        }
      }
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Minimal Top Navigation Bar */}
      <View style={styles.minimalHeader}>
        <Text style={styles.minimalTitle}>{t('dashboards.delivery.title')}</Text>
        <NotificationBell />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 90 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <OfflineBanner offline={offline} />

        {/* Mode Segmented Controls */}
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tabButton, mode === 'deliveries' && styles.tabButtonActive]}
            onPress={() => setMode('deliveries')}
          >
            <Text style={[styles.tabButtonText, mode === 'deliveries' && styles.tabButtonTextActive]}>
              {t('dashboards.delivery.modeDeliveries')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabButton, mode === 'pickups' && styles.tabButtonActive]}
            onPress={() => setMode('pickups')}
          >
            <Text style={[styles.tabButtonText, mode === 'pickups' && styles.tabButtonTextActive]}>
              {t('dashboards.delivery.modePickups')}
            </Text>
          </TouchableOpacity>
        </View>

        {mode === 'deliveries' && (
          <View>
            {/* Order summary cards — tap to filter the list below */}
            <View style={styles.summaryRow}>
              {FILTERS.map((f) => {
                const selected = filter === f.key;
                return (
                  <TouchableOpacity
                    key={f.key}
                    style={[styles.summaryCard, selected && styles.summaryCardActive]}
                    onPress={() => setFilter(f.key)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.summaryCount, selected && styles.summaryTextActive]}>
                      {counts[f.key]}
                    </Text>
                    <Text style={[styles.summaryLabel, selected && styles.summaryTextActive]}>
                      {f.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.sectionTitle}>{t('dashboards.delivery.myDeliveries')}</Text>

            {loading ? (
              <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />
            ) : visibleOrders.length === 0 ? (
              <EmptyState
                icon="🚚"
                title={t('dashboards.delivery.noDeliveriesTitle', { filter: filter === 'all' ? '' : `${FILTERS.find((f) => f.key === filter)?.label} ` })}
                message={t('dashboards.delivery.noDeliveriesMessage')}
              />
            ) : (
              visibleOrders.map((order) => {
                const delivery = getDelivery(order);
                const busy = busyId === order.id;
                const items = order.order_items || [];
                const rank = STATUS_RANK[effectiveStatus(order)] ?? 0;
                const finished = effectiveStatus(order) === 'delivered' || effectiveStatus(order) === 'cancelled';

                return (
                  <View key={order.id} style={styles.orderCard}>
                    <View style={styles.orderHeader}>
                      <Text style={styles.orderId}>{t('dashboards.distributor.orderNumber', { id: shortId(order.id) })}</Text>
                      <View style={[styles.statusBadge, { backgroundColor: statusColor(delivery?.status || order.status) }]}>
                        <Text style={styles.statusBadgeText}>{delivery?.status || order.status}</Text>
                      </View>
                    </View>

                    <Text style={styles.orderTotal}>{peso(order.total_amount)}</Text>

                    <Text style={[styles.rowMeta, { fontWeight: '700', marginTop: 6 }]}>{t('dashboards.delivery.pickupFromWarehouse')}</Text>
                    <View style={styles.addressRow}>
                      <Text style={[styles.rowMeta, { flex: 1 }]}>🏢 {order.distributor_address}</Text>
                      <TouchableOpacity
                        style={styles.routeBtn}
                        onPress={() => {
                          setMapAddress(order.distributor_address);
                          setMapCoords(order.distributor_coords);
                        }}
                      >
                        <Text style={styles.routeBtnText}>{t('dashboards.delivery.viewRoute')}</Text>
                      </TouchableOpacity>
                    </View>

                    <Text style={[styles.rowMeta, { fontWeight: '700', marginTop: 6 }]}>{t('dashboards.delivery.deliverToRetailer')}</Text>
                    <View style={styles.addressRow}>
                      <Text style={[styles.rowMeta, { flex: 1 }]}>📍 {order.retailer_address}</Text>
                      <TouchableOpacity
                        style={styles.routeBtn}
                        onPress={() => {
                          setMapAddress(order.retailer_address);
                          setMapCoords(order.retailer_coords);
                        }}
                      >
                        <Text style={styles.routeBtnText}>{t('dashboards.delivery.viewRoute')}</Text>
                      </TouchableOpacity>
                    </View>

                    {order.preferred_schedule ? (
                      <Text style={styles.rowMeta}>{t('dashboards.delivery.scheduleLabel', { schedule: order.preferred_schedule })}</Text>
                    ) : null}

                    {effectiveStatus(order) !== 'delivered' && effectiveStatus(order) !== 'cancelled' ? (
                      <View style={styles.trackRow}>
                        <Text style={styles.etaText}>{t('dashboards.delivery.etaText')}</Text>
                        <View style={[styles.liveDot, { backgroundColor: statusColor(effectiveStatus(order)) }]} />
                        <Text style={[styles.liveStatus, { color: statusColor(effectiveStatus(order)) }]}>
                          {effectiveStatus(order) === 'in_transit' ? t('dashboards.delivery.liveStatusInTransit') : t('dashboards.delivery.liveStatusLive')}
                        </Text>
                      </View>
                    ) : null}

                    <View style={styles.itemsBox}>
                      {items.length === 0 ? (
                        <Text style={styles.rowMeta}>{t('dashboards.delivery.noItemDetails')}</Text>
                      ) : (
                        items.map((it, i) => (
                          <Text key={i} style={styles.itemLine}>
                            • {it.vegetable_name} — {it.quantity_kg}kg @ {peso(it.price_at_order)}
                          </Text>
                        ))
                      )}
                    </View>

                    {!finished && (
                      <View style={styles.progressRow}>
                        <TouchableOpacity
                          style={[styles.progressBtn, rank >= 1 && styles.progressBtnDone, (busy || rank >= 1) && styles.buttonDisabled]}
                          onPress={() => updateDeliveryStatus(order, 'picked_up')}
                          disabled={busy || rank >= 1}
                        >
                          <Text style={[styles.progressBtnText, rank >= 1 && styles.progressBtnTextDone]}>
                            {rank >= 1 ? t('dashboards.delivery.pickedUpDone') : t('dashboards.delivery.pickedUpTodo')}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.progressBtn, rank >= 2 && styles.progressBtnDone, (busy || rank >= 2 || rank < 1) && styles.buttonDisabled]}
                          onPress={() => updateDeliveryStatus(order, 'in_transit')}
                          disabled={busy || rank >= 2 || rank < 1}
                        >
                          <Text style={[styles.progressBtnText, rank >= 2 && styles.progressBtnTextDone]}>
                            {rank >= 2 ? t('dashboards.delivery.inTransitDone') : t('dashboards.delivery.inTransitTodo')}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    <TouchableOpacity
                      style={[styles.button, styles.buttonPrimary, busy && styles.buttonDisabled]}
                      onPress={() => setConfirmOrder(order)}
                      disabled={busy}
                    >
                      {busy
                        ? <ActivityIndicator color="#fff" />
                        : <Text style={styles.buttonPrimaryText}>{t('dashboards.delivery.markDelivered')}</Text>}
                    </TouchableOpacity>
                  </View>
                );
              })
            )}
          </View>
        )}

        {mode === 'pickups' && (
          <View>
            <Text style={styles.sectionTitle}>{t('dashboards.delivery.farmerPickups')}</Text>
            {loading ? (
              <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />
            ) : pickups.length === 0 ? (
              <EmptyState
                icon="🚜"
                title={t('dashboards.delivery.noAssignedPickupsTitle')}
                message={t('dashboards.delivery.noAssignedPickupsMessage')}
              />
            ) : (
              pickups.map((pickup) => {
                const harvest = pickup.harvests;
                const isAssigned = pickup.status === 'assigned';
                const busy = busyId === pickup.id;

                return (
                  <View key={pickup.id} style={styles.orderCard}>
                    <View style={styles.orderHeader}>
                      <Text style={styles.orderId}>{t('dashboards.delivery.pickupNumber', { id: shortId(pickup.id) })}</Text>
                      <View style={[styles.statusBadge, { backgroundColor: isAssigned ? '#1976d2' : PRIMARY }]}>
                        <Text style={styles.statusBadgeText}>{pickup.status}</Text>
                      </View>
                    </View>

                    <Text style={[styles.rowMeta, { fontWeight: '700', marginTop: 4 }]}>{t('dashboards.delivery.farmerDetails')}</Text>
                    <Text style={styles.rowMeta}>👨‍🌾 {pickup.farmer_name || t('dashboards.delivery.farmerFallback')}</Text>
                    <Text style={styles.rowMeta}>
                      🌾 {harvest?.vegetable_name || t('dashboards.delivery.vegetablesFallback')} — {harvest?.quantity_kg || 0} kg
                    </Text>

                    {pickup.farmer_address ? (
                      <View style={styles.addressRow}>
                        <Text style={[styles.rowMeta, { flex: 1 }]}>📍 {pickup.farmer_address}</Text>
                        <TouchableOpacity
                          style={styles.routeBtn}
                          onPress={() => {
                            setMapAddress(pickup.farmer_address);
                            setMapCoords(pickup.farmer_coords);
                          }}
                        >
                          <Text style={styles.routeBtnText}>{t('dashboards.delivery.viewRoute')}</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}

                    {isAssigned && (
                      <TouchableOpacity
                        style={[styles.button, styles.buttonPrimary, { marginTop: 12 }, busy && styles.buttonDisabled]}
                        onPress={() => handleMarkPickedUp(pickup.id)}
                        disabled={busy}
                      >
                        {busy ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <Text style={styles.buttonPrimaryText}>{t('dashboards.delivery.markPickedUpBtn')}</Text>
                        )}
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })
            )}
          </View>
        )}
      </ScrollView>

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
        visible={!!confirmOrder}
        orderLabel={confirmOrder ? `#${shortId(confirmOrder.id)}` : ''}
        photo={confirmOrder ? photos[confirmOrder.id] : null}
        busy={!!confirmOrder && busyId === confirmOrder.id}
        onPickPhoto={() => confirmOrder && pickPhoto(confirmOrder.id)}
        onConfirm={() => confirmOrder && markDelivered(confirmOrder)}
        onCancel={() => setConfirmOrder(null)}
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

  content: { padding: 16, paddingBottom: 40 },
  sectionTitle: { fontFamily: fonts.heading, fontSize: 17, color: colors.ink, marginBottom: 10 },
  emptyText: { fontFamily: fonts.body, color: colors.inkFaint, fontStyle: 'italic', marginTop: 8 },

  // Order summary / filter cards
  summaryRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  summaryCard: { flex: 1, backgroundColor: colors.card, borderRadius: radius.ctrl, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: colors.border, ...shadowCard },
  summaryCardActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  summaryCount: { fontFamily: fonts.heading, fontSize: 19, color: PRIMARY },
  summaryLabel: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.inkSoft, marginTop: 2 },
  summaryTextActive: { color: '#fff' },

  // ETA + live status indicator
  trackRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  etaText: { fontFamily: fonts.body, fontSize: 13.5, color: colors.inkSoft, flex: 1 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  liveStatus: { fontFamily: fonts.bodyBold, fontSize: 13, textTransform: 'capitalize' },

  orderCard: { backgroundColor: colors.card, borderRadius: radius.card, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border, ...shadowCard },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  orderId: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  orderTotal: { fontFamily: fonts.heading, fontSize: 17, color: PRIMARY, marginBottom: 4 },
  rowMeta: { fontFamily: fonts.body, fontSize: 13.5, color: colors.inkSoft, marginTop: 2 },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  routeBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.ctrl, borderWidth: 1.4, borderColor: PRIMARY },
  routeBtnText: { fontFamily: fonts.bodySemiBold, color: PRIMARY, fontSize: 13 },

  statusBadge: { paddingVertical: 3, paddingHorizontal: 10, borderRadius: 12 },
  statusBadgeText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: 12, textTransform: 'capitalize' },

  itemsBox: { backgroundColor: colors.leaf50, borderRadius: radius.ctrl, padding: 10, marginVertical: 10 },
  itemLine: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft, marginBottom: 2 },

  // Issue 10: progress (picked up / in transit) buttons
  progressRow: { flexDirection: 'row', gap: 10, marginTop: 8, marginBottom: 4 },
  progressBtn: { flex: 1, paddingVertical: 11, borderRadius: radius.ctrl, alignItems: 'center', borderWidth: 1.5, borderColor: PRIMARY, backgroundColor: colors.card },
  progressBtnDone: { backgroundColor: colors.leaf100 },
  progressBtnText: { fontFamily: fonts.bodyBold, color: PRIMARY, fontSize: 13.5 },
  progressBtnTextDone: { color: PRIMARY },

  button: { paddingVertical: 14, borderRadius: radius.ctrl, alignItems: 'center', marginTop: 4 },
  buttonPrimary: { backgroundColor: PRIMARY },
  buttonPrimaryText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: 15.5 },
  buttonDisabled: { opacity: 0.6 },
  tabContainer: { flexDirection: 'row', backgroundColor: colors.leaf50, borderRadius: radius.ctrl, padding: 4, marginBottom: 16 },
  tabButton: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  tabButtonActive: { backgroundColor: colors.card, ...shadowCard },
  tabButtonText: { fontFamily: fonts.bodySemiBold, color: colors.inkSoft, fontSize: 14 },
  tabButtonTextActive: { color: PRIMARY },
});
