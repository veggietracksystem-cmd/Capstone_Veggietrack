import { rf } from '../lib/responsive';
import { useState, useEffect, useCallback } from 'react';
import {
  Text, View, ScrollView, TouchableOpacity,
  ActivityIndicator, StyleSheet, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../api/client';
import { readThrough } from '../offline/cache';
import { useAuth } from '../context/AuthContext';
import LogoutButton from '../components/LogoutButton';
import NotificationBell from '../components/NotificationBell';
import MessagesIcon from '../components/MessagesIcon';
import ProfileButton from '../components/ProfileButton';
import OfflineBanner from '../components/OfflineBanner';
import DeliveryMapModal from '../components/DeliveryMapModal';
import EmptyState from '../components/EmptyState';
import BottomNavBar from '../components/BottomNavBar';
import { showAlert, peso, shortId } from '../lib/ui';
import { colors, fonts, radius, shadowCard } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';
import { localizeVegetableName } from '../lib/vegetableNames';

const PRIMARY = colors.leaf700;

export function statusColor(status) {
  switch (status) {
    case 'assigned': return '#1976d2';
    case 'in_transit': return '#7b1fa2';
    case 'delivered': return PRIMARY;
    case 'pending': return colors.gold500;
    default: return '#607d8b';
  }
}

const STATUS_LABELS = {
  pending: 'Pending',
  approved: 'Approved',
  assigned: 'Assigned',
  picked_up: 'Picked Up',
  in_transit: 'In Transit',
  delivered: 'Completed',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

// Never show raw db values (snake_case) in the UI — always a friendly label.
export function formatStatus(status) {
  if (!status) return '';
  if (STATUS_LABELS[status]) return STATUS_LABELS[status];
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
  const { user } = useAuth();
  const { t, language } = useTranslation();

  const RIDER_TABS = [
    { id: 'home', iconName: 'home-outline', label: t('dashboards.delivery.tabHome') },
    { id: 'tasks', iconName: 'clipboard-outline', label: t('dashboards.delivery.tabTasks') },
    { id: 'history', iconName: 'time-outline', label: t('dashboards.delivery.tabHistory') },
    { id: 'profile', iconName: 'person-outline', label: t('dashboards.delivery.tabProfile') },
  ];

  const [orders, setOrders] = useState([]);
  const [pickups, setPickups] = useState([]);
  // 'deliveries' | 'pickups' — only relevant on the Tasks & History tabs.
  const [mode, setMode] = useState('deliveries');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [offline, setOffline] = useState(false);
  const [mapAddress, setMapAddress] = useState(null); // address shown in the map modal (Farmer Pickups mode)
  const [mapCoords, setMapCoords] = useState(null); // coordinates shown in the map modal (Farmer Pickups mode)
  // Which bottom-nav tab's content is showing. This is the single source of
  // truth for what's on screen — Home, Tasks and History each render their
  // own distinct content below instead of sharing one filtered list.
  const [activeBottomTab, setActiveBottomTab] = useState('home');

  useEffect(() => {
    if (route.params?.filter) {
      setActiveBottomTab(tabForLegacyFilter(route.params.filter));
      setMode('deliveries');
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

  // Refresh whenever this screen regains focus (e.g. returning from
  // DeliveryDetails after a status change or a reject), so a delivery that
  // was rejected or just marked delivered disappears immediately instead of
  // waiting for a manual pull-to-refresh. Returning to the screen also resets
  // back to the Home tab rather than whatever tab was selected before
  // navigating away.
  useEffect(() => {
    if (!navigation?.addListener) return undefined;
    return navigation.addListener('focus', () => {
      setActiveBottomTab('home');
      setMode('deliveries');
      loadOrders();
    });
  }, [navigation, loadOrders]);

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

  // Deliveries: active (not yet completed/cancelled) vs history (finished).
  const activeOrders = orders.filter((o) => matchesFilter(o, 'active'));
  const historyOrders = orders.filter((o) => {
    const s = effectiveStatus(o);
    return s === 'delivered' || s === 'cancelled';
  });
  // Pickups: still assigned (actionable) vs already picked up (history).
  const activePickups = pickups.filter((p) => p.status === 'assigned');
  const pickupHistory = pickups.filter((p) => p.status !== 'assigned');

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
        <View style={[styles.statusBadge, { backgroundColor: statusColor(status) }]}>
          <Text style={styles.statusBadgeText}>{formatStatus(status)}</Text>
        </View>
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
            <Text style={styles.navigateBtnText}>🗺️ Navigate</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

  const ModeToggle = () => (
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
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Minimal Top Navigation Bar */}
      <View style={styles.minimalHeader}>
        <Text style={styles.minimalTitle}>{t('dashboards.delivery.title')}</Text>
        <View style={styles.headerIcons}>
          <MessagesIcon />
          <NotificationBell />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 90 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <OfflineBanner offline={offline} />

        {activeBottomTab === 'home' && (
          <View>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>{t('dashboards.delivery.homeActiveDeliveries')}</Text>
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
                icon="🚚"
                title={t('dashboards.delivery.noDeliveriesTitle', { filter: '' })}
                message={t('dashboards.delivery.noDeliveriesMessage')}
              />
            ) : (
              activeOrders.slice(0, 3).map(renderOrderCard)
            )}

            <View style={[styles.sectionHead, { marginTop: 8 }]}>
              <Text style={styles.sectionTitle}>{t('dashboards.delivery.homePendingPickups')}</Text>
              {activePickups.length > 3 && (
                <TouchableOpacity onPress={() => goToTasks('pickups')} activeOpacity={0.7}>
                  <Text style={styles.seeAllText}>{t('dashboards.delivery.seeAllBtn')}</Text>
                </TouchableOpacity>
              )}
            </View>
            {loading ? null : activePickups.length === 0 ? (
              <EmptyState
                icon="🚜"
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
            <ModeToggle />

            {mode === 'deliveries' ? (
              <>
                <Text style={styles.sectionTitle}>{t('dashboards.delivery.myDeliveries')}</Text>
                {loading ? (
                  <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />
                ) : activeOrders.length === 0 ? (
                  <EmptyState
                    icon="🚚"
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
                    icon="🚜"
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
            <ModeToggle />

            {mode === 'deliveries' ? (
              <>
                <Text style={styles.sectionTitle}>{t('dashboards.delivery.deliveryHistoryTitle')}</Text>
                {loading ? (
                  <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />
                ) : historyOrders.length === 0 ? (
                  <EmptyState
                    icon="🚚"
                    title={t('dashboards.delivery.noHistoryTitle')}
                    message={t('dashboards.delivery.noHistoryMessage')}
                  />
                ) : (
                  historyOrders.map(renderOrderCard)
                )}
              </>
            ) : (
              <>
                <Text style={styles.sectionTitle}>{t('dashboards.delivery.pickupHistoryTitle')}</Text>
                {loading ? (
                  <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />
                ) : pickupHistory.length === 0 ? (
                  <EmptyState
                    icon="🚜"
                    title={t('dashboards.delivery.noPickupHistoryTitle')}
                    message={t('dashboards.delivery.noPickupHistoryMessage')}
                  />
                ) : (
                  pickupHistory.map((p) => renderPickupCard(p, { actionable: false }))
                )}
              </>
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

  content: { padding: 16, paddingBottom: 40 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { fontFamily: fonts.heading, fontSize: rf(17), color: colors.ink, marginBottom: 10 },
  seeAllText: { fontFamily: fonts.bodySemiBold, fontSize: rf(13), color: PRIMARY },
  emptyText: { fontFamily: fonts.body, color: colors.inkFaint, fontStyle: 'italic', marginTop: 8 },

  orderCard: { backgroundColor: colors.card, borderRadius: radius.card, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border, ...shadowCard },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  orderId: { fontFamily: fonts.bodyBold, fontSize: rf(15), color: colors.ink },
  orderTotal: { fontFamily: fonts.heading, fontSize: rf(17), color: PRIMARY, marginBottom: 4 },
  rowMeta: { fontFamily: fonts.body, fontSize: rf(13.5), color: colors.inkSoft, marginTop: 2 },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  routeBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.ctrl, borderWidth: 1.4, borderColor: PRIMARY },
  routeBtnText: { fontFamily: fonts.bodySemiBold, color: PRIMARY, fontSize: rf(13) },

  statusBadge: { paddingVertical: 3, paddingHorizontal: 10, borderRadius: 12 },
  statusBadgeText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(12), textTransform: 'capitalize' },

  button: { paddingVertical: 14, borderRadius: radius.ctrl, alignItems: 'center', marginTop: 4 },
  buttonPrimary: { backgroundColor: PRIMARY },
  buttonPrimaryText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(15.5) },
  buttonDisabled: { opacity: 0.6 },

  detailsBtn: { paddingVertical: 11, borderRadius: radius.ctrl, alignItems: 'center', marginTop: 8, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.leaf50 },
  detailsBtnText: { fontFamily: fonts.bodyBold, color: colors.inkSoft, fontSize: rf(13.5) },

  tabContainer: { flexDirection: 'row', backgroundColor: colors.leaf50, borderRadius: radius.ctrl, padding: 4, marginBottom: 16 },
  tabButton: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  tabButtonActive: { backgroundColor: colors.card, ...shadowCard },
  tabButtonText: { fontFamily: fonts.bodySemiBold, color: colors.inkSoft, fontSize: rf(14) },
  tabButtonTextActive: { color: PRIMARY },
  tabButtonTextActive: { color: PRIMARY },

// ===== NEW STYLES FOR NAVIGATE BUTTON =====
buttonRow: {
  flexDirection: 'row',
  gap: 10,
  marginTop: 8,
},
flexButton: {
  flex: 1,
},
navigateBtn: {
  backgroundColor: '#2196f3',
  borderColor: '#2196f3',
  flex: 1,
},
navigateBtnText: {
  fontFamily: fonts.bodyBold,
  color: '#fff',
  fontSize: rf(13.5),
},
// ===== END NEW STYLES =====
});
