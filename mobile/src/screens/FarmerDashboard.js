import { rf } from '../lib/responsive';
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Text, View, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, StyleSheet, RefreshControl, Platform, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import api from '../api/client';
import {
  fetchHarvests, queueHarvest, syncPending, getQueue, onReconnect,
} from '../offline/harvestStore';
import { useAuth } from '../context/AuthContext';
import NotificationBell from '../components/NotificationBell';
import BottomNavBar from '../components/BottomNavBar';
import BottomSheet from '../components/BottomSheet';
import FarmerProfileTab from './FarmerProfileTab';
import MessagesScreen from './MessagesScreen';
import { showAlert, confirmAction } from '../lib/ui';
import { colors, fonts, radius, shadowCard } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';
import { isVegetable, VEGETABLE_VALIDATION_MESSAGE } from '../lib/vegetables';
import { getVegetableIcon } from '../lib/vegetableIcons';
import { localizeVegetableName } from '../lib/vegetableNames';
import { exportReportPdf, printReport } from '../lib/reportPdf';

// Manually selectable only — 'for_pickup'/'picked_up' are system-driven states
// set automatically by the pickup request/completion workflow, not by the farmer.
const STATUS_OPTIONS = ['available', 'reserved'];

const getVegEmoji = getVegetableIcon;

function getStatusPillStyle(status, t) {
  switch (status) {
    case 'available': return { label: t('dashboards.farmer.statusAvailable'), bg: '#EAF2FB', color: '#1E5A96' };
    case 'reserved': return { label: t('dashboards.farmer.statusReserved'), bg: '#EAF2FB', color: '#1E5A96' };
    case 'for_pickup': return { label: t('dashboards.farmer.statusForPickup'), bg: colors.gold100, color: colors.gold700 };
    case 'picked_up': return { label: t('dashboards.farmer.statusPickedUp'), bg: colors.leaf100, color: colors.leaf900 || colors.leaf700 };
    default: return { label: status || t('dashboards.farmer.statusUnknown'), bg: colors.leaf100, color: colors.leaf700 };
  }
}

// Once a pickup has been requested ('for_pickup') or completed ('picked_up'),
// the harvest is locked — no more edits/deletes, to preserve inventory
// integrity (mirrors the server-side guard in PUT/DELETE /api/harvests/:id).
function isHarvestLocked(status) {
  return status === 'for_pickup' || status === 'picked_up';
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Inventory/weekly report table columns — shared by the Weekly Report sheet,
// the History sheet, and PDF export so all three stay in sync.
const REPORT_COLUMNS_META = [
  { key: 'harvest_date', labelKey: 'dashboards.farmer.tableHarvestDate', width: 92 },
  { key: 'pickup_date', labelKey: 'dashboards.farmer.tablePickupDate', width: 92 },
  { key: 'vegetable_name', labelKey: 'dashboards.farmer.tableVegetable', width: 104 },
  { key: 'quantity_kg', labelKey: 'dashboards.farmer.tableQuantity', width: 74 },
  { key: 'status', labelKey: 'dashboards.farmer.tableStatus', width: 116 },
  { key: 'rider_name', labelKey: 'dashboards.farmer.tableRider', width: 104 },
  { key: 'distributor_name', labelKey: 'dashboards.farmer.tableDistributor', width: 116 },
];

// Formats a raw report row (from the API) into display-ready strings, reused
// by both the on-screen table and the PDF export so they never drift apart.
function formatReportRow(r, language) {
  return {
    harvest_date: formatDate(r.harvest_date),
    pickup_date: r.pickup_date ? formatDate(r.pickup_date) : '—',
    vegetable_name: localizeVegetableName(r.vegetable_name, language),
    quantity_kg: `${r.quantity_kg} kg`,
    status: r.status,
    rider_name: r.rider_name || '—',
    distributor_name: r.distributor_name || '—',
  };
}

// Generic table renderer for the report sheets: fixed-width columns inside a
// horizontally-scrollable wrapper so all 7 columns fit on any screen size.
function ReportTable({ columns, rows, emptyLabel }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={styles.reportWrap}>
        <View style={styles.reportHeaderRow}>
          {columns.map((c) => (
            <Text key={c.key} style={[styles.reportHeaderCell, { width: c.width }]} numberOfLines={1}>{c.label}</Text>
          ))}
        </View>
        {rows.length === 0 ? (
          <Text style={styles.emptySubtitle}>{emptyLabel}</Text>
        ) : (
          rows.map((r, i) => (
            <View key={i} style={styles.reportRow}>
              {columns.map((c) => (
                <Text key={c.key} style={[styles.reportCell, { width: c.width }]} numberOfLines={1}>{r[c.key] ?? '—'}</Text>
              ))}
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

// Monday-anchored week key/label helpers (used by the Weekly report + History sheets).
function weekKeyOf(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const day = d.getDay();
  const diffToMonday = (day === 0 ? -6 : 1) - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10);
}
function weekRangeLabel(mondayKey) {
  const monday = new Date(mondayKey);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const opts = { month: 'short', day: 'numeric' };
  return `${monday.toLocaleDateString(undefined, opts)}–${sunday.toLocaleDateString(undefined, { day: 'numeric' })}`;
}
// Groups already-fetched report rows (from GET /api/harvests/weekly-report)
// by week, keeping the full row objects — used by the History sheet so each
// past week can render as a real table, not just a per-vegetable kg total.
function buildWeeklyRowBuckets(rows) {
  const weeks = {};
  rows.forEach((r) => {
    const key = weekKeyOf(r.harvest_date);
    if (!key) return;
    if (!weeks[key]) weeks[key] = { key, rows: [], totalKg: 0 };
    weeks[key].rows.push(r);
    weeks[key].totalKg += Number(r.quantity_kg) || 0;
  });
  return Object.values(weeks).sort((a, b) => b.key.localeCompare(a.key));
}

function buildWeeklyBuckets(harvests) {
  const weeks = {};
  harvests.forEach((h) => {
    const key = weekKeyOf(h.recorded_at);
    if (!key) return;
    if (!weeks[key]) weeks[key] = { key, totalKg: 0, byVeg: {} };
    const w = weeks[key];
    const qty = Number(h.quantity_kg) || 0;
    w.totalKg += qty;
    const veg = h.vegetable_name || 'Unknown';
    if (!w.byVeg[veg]) w.byVeg[veg] = { harvestedKg: 0, pickedUpKg: 0 };
    w.byVeg[veg].harvestedKg += qty;
    if (h.status === 'picked_up') w.byVeg[veg].pickedUpKg += qty;
  });
  return Object.values(weeks).sort((a, b) => b.key.localeCompare(a.key));
}

export default function FarmerDashboard({ navigation, route }) {
  const { user } = useAuth();
  const { t, language } = useTranslation();
  const [activeTab, setActiveTab] = useState('home');
  const [messagesUnreadCount, setMessagesUnreadCount] = useState(0);

  const FARMER_TABS = useMemo(() => ([
    { id: 'home', iconName: 'home-outline', label: t('dashboards.farmer.tabHome') },
    { id: 'harvest', iconName: 'leaf-outline', label: t('dashboards.farmer.tabHarvestNew') },
    { id: 'messages', iconName: 'mail-outline', label: t('dashboards.farmer.tabMessagesNew'), badge: messagesUnreadCount },
    { id: 'pickup', iconName: 'truck-outline', iconSet: 'material', label: t('dashboards.farmer.tabPickupNew') },
    { id: 'profile', iconName: 'person-outline', label: t('dashboards.farmer.tabProfile') },
  ]), [t, messagesUnreadCount]);

  const STATUS_LABELS = useMemo(() => ({
    available: t('dashboards.farmer.statusAvailable'),
    reserved: t('dashboards.farmer.statusReserved'),
    for_pickup: t('dashboards.farmer.statusForPickup'),
    picked_up: t('dashboards.farmer.statusPickedUp'),
  }), [t]);

  const [harvests, setHarvests] = useState([]);
  const [notifUnreadCount, setNotifUnreadCount] = useState(0);
  const [distributorName, setDistributorName] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  // Add-harvest sheet
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [vegetableName, setVegetableName] = useState('');
  const [quantityKg, setQuantityKg] = useState('');
  const [status, setStatus] = useState('available');
  const [submitting, setSubmitting] = useState(false);

  // Weekly report table (flat, one row per harvest — fetched on open)
  const [weeklyReportRows, setWeeklyReportRows] = useState([]);
  const [loadingWeeklyReport, setLoadingWeeklyReport] = useState(false);

  // Edit modal (per-row "Edit", separate from the add sheet)
  const [editHarvestId, setEditHarvestId] = useState(null);
  const [editVegetableName, setEditVegetableName] = useState('');
  const [editQuantityKg, setEditQuantityKg] = useState('');
  const [editStatus, setEditStatus] = useState('available');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [busyId, setBusyId] = useState(null);

  // Weekly report / history sheets (Harvest tab)
  const [showWeeklySheet, setShowWeeklySheet] = useState(false);
  const [showHistorySheet, setShowHistorySheet] = useState(false);
  const [expandedHistoryKey, setExpandedHistoryKey] = useState(null);
  // Full-history report table (one row per harvest, all-time — fetched once,
  // the first time the History sheet is opened).
  const [historyReportRows, setHistoryReportRows] = useState([]);
  const [loadingHistoryReport, setLoadingHistoryReport] = useState(false);
  const [historyReportLoaded, setHistoryReportLoaded] = useState(false);
  const [exportingReport, setExportingReport] = useState(false);

  // Pick-up tab: multi-select cart
  const [cart, setCart] = useState({}); // { [harvestId]: true }
  const [showCartSheet, setShowCartSheet] = useState(false);
  const [showConfirmSheet, setShowConfirmSheet] = useState(false);
  const [submittingPickup, setSubmittingPickup] = useState(false);

  const refreshPendingCount = useCallback(async () => {
    setPendingCount((await getQueue()).length);
  }, []);

  const loadHarvests = useCallback(async () => {
    const { list, source } = await fetchHarvests();
    setHarvests(list);
    setOffline(source === 'cache');
    await refreshPendingCount();
  }, [refreshPendingCount]);

  const loadMessagesUnreadCount = useCallback(async () => {
    try {
      const { count } = await api.get('/api/messages/unread-count');
      setMessagesUnreadCount(count || 0);
    } catch {
      setMessagesUnreadCount(0);
    }
  }, []);

  const loadNotifUnreadCount = useCallback(async () => {
    try {
      const data = await api.get('/api/notifications');
      const list = Array.isArray(data) ? data : [];
      setNotifUnreadCount(list.filter((n) => !n.is_read).length);
    } catch {
      setNotifUnreadCount(0);
    }
  }, []);

  // There's only one distributor in the system; used to label the Weekly
  // report table's "Distributor" column without a dedicated backend join.
  const loadDistributorName = useCallback(async () => {
    try {
      const contacts = await api.get('/api/messages/contacts');
      const d = Array.isArray(contacts) ? contacts.find((c) => c.role === 'distributor') : null;
      setDistributorName(d?.full_name || null);
    } catch {
      setDistributorName(null);
    }
  }, []);

  const trySync = useCallback(async () => {
    const result = await syncPending();
    if (result.synced > 0) await loadHarvests();
    await refreshPendingCount();
    return result;
  }, [loadHarvests, refreshPendingCount]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadHarvests(), loadMessagesUnreadCount(), loadNotifUnreadCount(), loadDistributorName()]);
      await trySync();
      setLoading(false);
    })();

    const unsubscribe = onReconnect(() => { trySync(); });
    return unsubscribe;
  }, [loadHarvests, loadMessagesUnreadCount, loadNotifUnreadCount, loadDistributorName, trySync]);

  // Poll unread messages so the Messages tab badge updates without needing
  // to leave and refocus the screen (mirrors MessagesIcon's poll for the
  // other dashboards, which don't have a farmer-style embedded tab).
  useEffect(() => {
    const id = setInterval(loadMessagesUnreadCount, 30000);
    return () => clearInterval(id);
  }, [loadMessagesUnreadCount]);

  useEffect(() => {
    if (!navigation?.addListener) return undefined;
    return navigation.addListener('focus', () => {
      loadHarvests();
      loadMessagesUnreadCount();
      loadNotifUnreadCount();
    });
  }, [navigation, loadHarvests, loadMessagesUnreadCount, loadNotifUnreadCount]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadHarvests(), loadMessagesUnreadCount(), loadNotifUnreadCount()]);
    await trySync();
    setRefreshing(false);
  };

  useEffect(() => {
    const h = route?.params?.editHarvest;
    if (h) {
      openEditForm(h);
      setActiveTab('harvest');
      navigation?.setParams?.({ editHarvest: undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params?.editHarvest]);

  // ---- KPI calculations ----
  const thisWeekKey = useMemo(() => weekKeyOf(new Date().toISOString()), []);
  const lastWeekKey = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return weekKeyOf(d.toISOString());
  }, []);
  const editingHarvestLocked = isHarvestLocked(harvests.find((h) => h.id === editHarvestId)?.status);
  const weeklyBuckets = useMemo(() => buildWeeklyBuckets(harvests), [harvests]);
  const thisWeekBucket = weeklyBuckets.find((w) => w.key === thisWeekKey);
  const lastWeekBucket = weeklyBuckets.find((w) => w.key === lastWeekKey);
  const thisWeekKg = thisWeekBucket?.totalKg || 0;
  const lastWeekKg = lastWeekBucket?.totalKg || 0;
  const weekDelta = thisWeekKg - lastWeekKg;
  const harvestWeavePct = Math.min(100, Math.round((thisWeekKg / 200) * 100));

  const pendingPickupHarvests = harvests.filter((h) => h.status === 'for_pickup');
  const pendingPickupKg = pendingPickupHarvests.reduce((s, h) => s + Number(h.quantity_kg || 0), 0);
  const totalHarvestKg = harvests.reduce((s, h) => s + Number(h.quantity_kg || 0), 0);
  const pendingWeavePct = totalHarvestKg > 0 ? Math.min(100, Math.round((pendingPickupKg / totalHarvestKg) * 100)) : 0;

  const availableHarvests = useMemo(() => harvests.filter((h) => h.status === 'available'), [harvests]);

  // ---- Weekly report table (online-only, fetched when the sheet opens) ----
  const openWeeklyReport = async () => {
    setShowWeeklySheet(true);
    setLoadingWeeklyReport(true);
    try {
      const r = await api.get('/api/harvests/weekly-report');
      setWeeklyReportRows(Array.isArray(r?.details) ? r.details : []);
    } catch (err) {
      showAlert('Error', err.message);
      setWeeklyReportRows([]);
    } finally {
      setLoadingWeeklyReport(false);
    }
  };

  // ---- Full history report (fetched once, cached in state) ----
  const openHistoryReport = async () => {
    setShowWeeklySheet(false);
    setShowHistorySheet(true);
    if (historyReportLoaded) return;
    setLoadingHistoryReport(true);
    try {
      const r = await api.get('/api/harvests/weekly-report?range=all');
      setHistoryReportRows(Array.isArray(r?.details) ? r.details : []);
      setHistoryReportLoaded(true);
    } catch (err) {
      showAlert(t('common.error'), err.message);
    } finally {
      setLoadingHistoryReport(false);
    }
  };

  const reportColumns = REPORT_COLUMNS_META.map((c) => ({ key: c.key, label: t(c.labelKey), width: c.width }));

  const handleExportReport = async (title, rows, doPrint) => {
    setExportingReport(true);
    try {
      const formatted = rows.map((r) => formatReportRow(r, language));
      if (doPrint) await printReport(title, reportColumns, formatted);
      else await exportReportPdf(title, reportColumns, formatted);
    } catch (err) {
      showAlert(t('common.error'), err.message);
    } finally {
      setExportingReport(false);
    }
  };

  // ---- Add-harvest sheet ----
  const resetAddForm = () => {
    setVegetableName('');
    setQuantityKg('');
    setStatus('available');
  };
  const openAddSheet = () => {
    resetAddForm();
    setShowAddSheet(true);
  };
  const submitAddForm = async () => {
    const name = vegetableName.trim();
    const qty = parseFloat(quantityKg);
    if (!name) { showAlert('Error', t('dashboards.farmer.enterVegetableName')); return; }
    if (!isVegetable(name)) { showAlert('Error', VEGETABLE_VALIDATION_MESSAGE); return; }
    if (isNaN(qty) || qty <= 0) { showAlert('Error', t('dashboards.farmer.enterValidQuantity')); return; }
    setSubmitting(true);
    try {
      const payload = { vegetable_name: name, quantity_kg: qty, status };
      // No harvest_date sent — the backend stamps recorded_at automatically
      // at the moment of submission; it's never farmer-editable.
      const optimistic = await queueHarvest({ type: 'add', payload });
      setHarvests(optimistic);
      await refreshPendingCount();
      resetAddForm();
      setShowAddSheet(false);
      const result = await trySync();
      if (result.offline || result.remaining > 0) {
        showAlert(t('dashboards.farmer.savedOfflineTitle'), t('dashboards.farmer.savedOfflineMessage'));
      }
    } catch (err) {
      showAlert('Error', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // ---- Edit modal ----
  const openEditForm = (harvest) => {
    setEditHarvestId(harvest.id);
    setEditVegetableName(harvest.vegetable_name);
    setEditQuantityKg(String(harvest.quantity_kg));
    setEditStatus(harvest.status || 'available');
  };
  const closeEditModal = () => {
    setEditHarvestId(null);
    setEditVegetableName('');
    setEditQuantityKg('');
    setEditStatus('available');
  };
  const decrementEditQty = () => {
    setEditQuantityKg((prev) => String(Math.max(0, Math.round((parseFloat(prev) || 0) - 1))));
  };
  const incrementEditQty = () => {
    setEditQuantityKg((prev) => String(Math.round((parseFloat(prev) || 0) + 1)));
  };
  const submitEditForm = async () => {
    const name = editVegetableName.trim();
    const qty = parseFloat(editQuantityKg);
    if (!name) { showAlert('Error', t('dashboards.farmer.enterVegetableName')); return; }
    if (!isVegetable(name)) { showAlert('Error', VEGETABLE_VALIDATION_MESSAGE); return; }
    if (isNaN(qty) || qty <= 0) { showAlert('Error', t('dashboards.farmer.enterValidQuantity')); return; }
    setEditSubmitting(true);
    try {
      const payload = { vegetable_name: name, quantity_kg: qty, status: editStatus };
      const optimistic = await queueHarvest({ type: 'edit', id: editHarvestId, payload });
      setHarvests(optimistic);
      await refreshPendingCount();
      closeEditModal();
      const result = await trySync();
      if (result.offline || result.remaining > 0) {
        showAlert(t('dashboards.farmer.savedOfflineTitle'), t('dashboards.farmer.savedOfflineMessage'));
      }
    } catch (err) {
      showAlert('Error', err.message);
    } finally {
      setEditSubmitting(false);
    }
  };
  const deleteHarvest = (harvest) => {
    confirmAction(
      t('dashboards.farmer.deleteHarvestTitle'),
      t('dashboards.farmer.deleteHarvestMessage', { name: localizeVegetableName(harvest.vegetable_name, language), qty: harvest.quantity_kg }),
      async () => {
        setBusyId(harvest.id);
        try {
          await api.delete(`/api/harvests/${harvest.id}`);
          setHarvests((prev) => prev.filter((h) => h.id !== harvest.id));
          closeEditModal();
        } catch (err) {
          showAlert('Error', err.message);
        } finally {
          setBusyId(null);
        }
      }
    );
  };

  // ---- Pick-up tab: cart ----
  const toggleCartItem = (id) => {
    setCart((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = true;
      return next;
    });
  };
  const cartIds = Object.keys(cart);
  const cartHarvests = availableHarvests.filter((h) => cart[h.id]);
  const cartTotalKg = cartHarvests.reduce((s, h) => s + Number(h.quantity_kg || 0), 0);
  const removeFromCart = (id) => {
    setCart((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };
  const submitPickupRequest = async () => {
    if (cartHarvests.length === 0) { showAlert('Error', t('dashboards.farmer.selectAtLeastOneVeg')); return; }
    setSubmittingPickup(true);
    try {
      for (const h of cartHarvests) {
        // This is what actually makes the request visible to the distributor
        // (GET /api/pickup-requests) — must be online, can't be offline-queued.
        // eslint-disable-next-line no-await-in-loop
        await api.post('/api/pickup-requests', { harvest_id: h.id });
        // eslint-disable-next-line no-await-in-loop
        const optimistic = await queueHarvest({ type: 'edit', id: h.id, payload: { status: 'for_pickup' } });
        setHarvests(optimistic);
      }
      await refreshPendingCount();
      setCart({});
      setShowCartSheet(false);
      await trySync();
      setShowConfirmSheet(true);
    } catch (err) {
      showAlert('Error', err.message);
    } finally {
      setSubmittingPickup(false);
    }
  };

  const handleTabPress = (tab) => setActiveTab(tab.id);

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={colors.leaf700} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.bodyFlex}>
        {activeTab === 'notifications' ? (
          <View style={styles.bodyFlex}>
            <View style={styles.topbar}>
              <TouchableOpacity onPress={() => setActiveTab('home')} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="arrow-back" size={rf(20)} color={colors.ink} />
              </TouchableOpacity>
              <Text style={styles.notifHeaderTitle}>{t('dashboards.farmer.notificationsTitle')}</Text>
              <View style={{ width: 20 }} />
            </View>
            <NotificationBell fullScreen />
          </View>
        ) : activeTab === 'profile' ? (
          <View style={[styles.bodyFlex, styles.content]}>
            <View style={styles.topbar}><Text style={styles.pageTitle}>{t('dashboards.farmer.tabProfile')}</Text></View>
            <FarmerProfileTab navigation={navigation} />
          </View>
        ) : activeTab === 'messages' ? (
          // BottomNavBar is position:absolute (see BottomNavBar.js) so it doesn't
          // reserve layout space — every other tab compensates with bottom
          // padding/margin. Without it here, the message input row renders right
          // at the screen edge and the nav bar paints over it, hiding it entirely.
          <View style={[styles.bodyFlex, styles.content, { paddingBottom: 90 }]}>
            <MessagesScreen embedded navigation={navigation} />
          </View>
        ) : (
          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={[styles.content, { paddingBottom: 90 }]}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            showsVerticalScrollIndicator={false}
          >
            {activeTab === 'pickup' ? (
              <>
                <View style={styles.topbar}>
                  <View>
                    <Text style={styles.pageTitle}>{t('dashboards.farmer.tabPickupNew')}</Text>
                    <Text style={styles.pageSubtitle}>{t('dashboards.farmer.selectReadyMsg')}</Text>
                  </View>
                </View>

                {availableHarvests.length === 0 ? (
                  <View style={styles.emptyContainer}>
                    <MaterialCommunityIcons name="truck-outline" size={rf(40)} color={colors.inkFaint} />
                    <Text style={styles.emptyTitle}>{t('dashboards.farmer.nothingAvailableYetTitle')}</Text>
                    <Text style={styles.emptySubtitle}>{t('dashboards.farmer.nothingAvailableYetMsg')}</Text>
                  </View>
                ) : (
                  availableHarvests.map((h) => {
                    const selected = !!cart[h.id];
                    return (
                      <View key={String(h.id)} style={styles.vegCard}>
                        <View style={styles.vegEmoji}><Text style={{ fontSize: rf(20) }}>{getVegEmoji(h.vegetable_name)}</Text></View>
                        <View style={styles.vegInfo}>
                          <Text style={styles.vegName} numberOfLines={1}>{localizeVegetableName(h.vegetable_name, language)}</Text>
                          <Text style={styles.vegMeta}>{t('dashboards.farmer.harvestedMeta', { qty: h.quantity_kg, date: formatDate(h.recorded_at) })}</Text>
                        </View>
                        <TouchableOpacity
                          style={[styles.selectToggle, selected && styles.selectToggleOn]}
                          onPress={() => toggleCartItem(h.id)}
                          activeOpacity={0.8}
                        >
                          <Text style={[styles.selectToggleText, selected && styles.selectToggleTextOn]}>
                            {selected ? t('dashboards.farmer.selectedBtn') : t('dashboards.farmer.selectBtn')}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })
                )}
              </>
            ) : activeTab === 'harvest' ? (
              <>
                <View style={styles.topbar}>
                  <View>
                    <Text style={styles.pageTitle}>{t('dashboards.farmer.tabHarvestNew')}</Text>
                    <Text style={styles.pageSubtitle}>{t('dashboards.farmer.yourRecordedHarvests')}</Text>
                  </View>
                </View>

                <TouchableOpacity style={styles.btnOutlineBlock} onPress={openWeeklyReport} activeOpacity={0.8}>
                  <Ionicons name="calendar-outline" size={rf(16)} color={colors.leaf700} />
                  <Text style={styles.btnOutlineText}>{t('dashboards.farmer.weeklyReportDash', { range: weekRangeLabel(thisWeekKey) })}</Text>
                </TouchableOpacity>

                <View style={styles.sectionHead}>
                  <Text style={styles.sectionHeadTitle}>{t('dashboards.farmer.recentRecords')}</Text>
                </View>

                {harvests.length === 0 ? (
                  <View style={styles.emptyContainer}>
                    <Ionicons name="leaf-outline" size={rf(40)} color={colors.inkFaint} />
                    <Text style={styles.emptyTitle}>{t('dashboards.farmer.noHarvestsYetTitle')}</Text>
                    <Text style={styles.emptySubtitle}>{t('dashboards.farmer.noHarvestsYetMsg')}</Text>
                  </View>
                ) : (
                  harvests.map((h) => {
                    const pill = getStatusPillStyle(h.status, t);
                    return (
                      <View key={String(h.id)} style={styles.vegCard}>
                        <View style={styles.vegEmoji}><Text style={{ fontSize: rf(20) }}>{getVegEmoji(h.vegetable_name)}</Text></View>
                        <View style={styles.vegInfo}>
                          <Text style={styles.vegName} numberOfLines={1}>{localizeVegetableName(h.vegetable_name, language)}</Text>
                          <Text style={styles.vegMeta}>{t('dashboards.farmer.harvestedMeta', { qty: h.quantity_kg, date: formatDate(h.recorded_at) })}</Text>
                        </View>
                        <View style={[styles.pill, { backgroundColor: pill.bg }]}>
                          <Text style={[styles.pillText, { color: pill.color }]}>{pill.label}</Text>
                        </View>
                        {!isHarvestLocked(h.status) && (
                          <TouchableOpacity style={styles.editIconBtn} onPress={() => openEditForm(h)} activeOpacity={0.7}>
                            <Ionicons name="pencil-outline" size={rf(15)} color={colors.inkSoft} />
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })
                )}
              </>
            ) : (
              <>
                {/* HOME */}
                <View style={styles.topbar}>
                  <View style={[styles.statusBadge, offline ? styles.statusOffline : styles.statusOnline]}>
                    <View style={[styles.statusDot, offline ? styles.statusDotOffline : styles.statusDotOnline]} />
                    <Text style={[styles.statusLabel, offline && styles.statusLabelOffline]}>{offline ? t('dashboards.farmer.offlineStatus') : t('dashboards.farmer.onlineStatus')}</Text>
                  </View>
                  <TouchableOpacity style={styles.iconBtn} onPress={() => setActiveTab('notifications')} activeOpacity={0.7}>
                    <Ionicons name="notifications-outline" size={rf(19)} color={colors.soil800} />
                    {notifUnreadCount > 0 && <View style={styles.notifDot} />}
                  </TouchableOpacity>
                </View>

                {(offline || pendingCount > 0) && (
                  <View style={styles.syncBanner}>
                    <Ionicons name={offline ? 'cloud-offline-outline' : 'sync-outline'} size={rf(15)} color={colors.gold700} />
                    <Text style={styles.syncBannerText}>
                      {offline ? t('dashboards.farmer.offlinePrefixClean') : ''}
                      {pendingCount > 0
                        ? t('dashboards.farmer.changesWaiting', { count: pendingCount, plural: pendingCount > 1 ? 's' : '' })
                        : t('dashboards.farmer.willSyncAuto')}
                    </Text>
                  </View>
                )}

                <View style={styles.summaryGrid}>
                  <View style={styles.statCard}>
                    <View style={styles.statLabelRow}>
                      <Ionicons name="leaf-outline" size={rf(14)} color={colors.inkSoft} />
                      <Text style={styles.statLabel}>{t('dashboards.farmer.harvestThisWeekLabel')}</Text>
                    </View>
                    <Text style={styles.statValue}>{thisWeekKg} kg</Text>
                    <View style={styles.weave}><View style={[styles.weaveFill, { width: `${harvestWeavePct}%` }]} /></View>
                    <Text style={styles.statSub}>
                      {weekDelta === 0
                        ? t('dashboards.farmer.sameAsLastWeek')
                        : t('dashboards.farmer.vsLastWeek', { sign: weekDelta > 0 ? '+' : '', delta: weekDelta })}
                    </Text>
                  </View>
                  <View style={styles.statCard}>
                    <View style={styles.statLabelRow}>
                      <MaterialCommunityIcons name="truck-outline" size={rf(14)} color={colors.inkSoft} />
                      <Text style={styles.statLabel}>{t('dashboards.farmer.pendingPickupLabel')}</Text>
                    </View>
                    <Text style={styles.statValue}>{pendingPickupHarvests.length}</Text>
                    <View style={styles.weave}><View style={[styles.weaveFill, styles.weaveFillGold, { width: `${pendingWeavePct}%` }]} /></View>
                    <Text style={[styles.statSub, styles.statSubGold]}>{t('dashboards.farmer.kgAwaitingPickup', { kg: pendingPickupKg })}</Text>
                  </View>
                </View>

                <TouchableOpacity style={styles.addCta} onPress={openAddSheet} activeOpacity={0.85}>
                  <Ionicons name="add" size={rf(19)} color="#fff" />
                  <Text style={styles.addCtaText}>{t('dashboards.farmer.addHarvestVegetables')}</Text>
                </TouchableOpacity>

                <View style={styles.sectionHead}>
                  <Text style={styles.sectionHeadTitle}>{t('dashboards.farmer.readyForPickup')}</Text>
                  <TouchableOpacity style={styles.linkBtn} onPress={() => setActiveTab('pickup')} activeOpacity={0.7}>
                    <Text style={styles.linkBtnText}>{t('dashboards.farmer.seeAll')}</Text>
                    <Ionicons name="chevron-forward" size={rf(14)} color={colors.leaf700} />
                  </TouchableOpacity>
                </View>

                {availableHarvests.length === 0 ? (
                  <View style={styles.emptyContainer}>
                    <Ionicons name="leaf-outline" size={rf(36)} color={colors.inkFaint} />
                    <Text style={styles.emptyTitle}>{t('dashboards.farmer.nothingReadyYet')}</Text>
                  </View>
                ) : (
                  availableHarvests.slice(0, 3).map((h) => (
                    <View key={String(h.id)} style={styles.vegCard}>
                      <View style={styles.vegEmoji}><Text style={{ fontSize: rf(20) }}>{getVegEmoji(h.vegetable_name)}</Text></View>
                      <View style={styles.vegInfo}>
                        <Text style={styles.vegName} numberOfLines={1}>{localizeVegetableName(h.vegetable_name, language)}</Text>
                        <Text style={styles.vegMeta}>{t('dashboards.farmer.availableKg', { kg: h.quantity_kg })}</Text>
                      </View>
                      <TouchableOpacity style={styles.btnOutlineSm} onPress={() => setActiveTab('pickup')} activeOpacity={0.8}>
                        <Text style={styles.btnOutlineSmText}>{t('dashboards.farmer.requestBtn')}</Text>
                      </TouchableOpacity>
                    </View>
                  ))
                )}
              </>
            )}
          </ScrollView>
        )}
      </View>

      <BottomNavBar tabs={FARMER_TABS} activeTab={activeTab} onTabPress={handleTabPress} />

      {/* Cart bar (Pick-up tab only) */}
      {activeTab === 'pickup' && cartIds.length > 0 && (
        <View style={styles.cartBar}>
          <Text style={styles.cartBarText}>
            {t('dashboards.farmer.itemsSelected', { count: cartIds.length, plural: cartIds.length === 1 ? '' : 's', kg: cartTotalKg })}
          </Text>
          <TouchableOpacity style={styles.cartBarBtn} onPress={() => setShowCartSheet(true)} activeOpacity={0.85}>
            <Text style={styles.cartBarBtnText}>{t('dashboards.farmer.reviewBtn')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Add Harvest sheet */}
      <BottomSheet visible={showAddSheet} onClose={() => setShowAddSheet(false)} title={t('dashboards.farmer.addHarvestSheetTitle')}>
        <Text style={styles.fieldLabel}>{t('dashboards.farmer.vegetableNameFieldLabel')}</Text>
        <TextInput
          style={styles.input}
          placeholder={t('dashboards.farmer.vegetableNamePlaceholderNew')}
          placeholderTextColor={colors.inkFaint}
          value={vegetableName}
          onChangeText={setVegetableName}
          editable={!submitting}
        />
        <Text style={styles.fieldLabel}>{t('dashboards.farmer.quantityHarvestedLabel')}</Text>
        <TextInput
          style={styles.input}
          placeholder={t('dashboards.farmer.quantityPlaceholderNew')}
          placeholderTextColor={colors.inkFaint}
          value={quantityKg}
          onChangeText={setQuantityKg}
          keyboardType="numeric"
          editable={!submitting}
        />
        <Text style={styles.fieldLabel}>{t('dashboards.farmer.statusFieldLabel')}</Text>
        <View style={styles.statusRow}>
          {STATUS_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt}
              style={[styles.chip, status === opt && styles.chipActive]}
              onPress={() => setStatus(opt)}
              disabled={submitting}
            >
              <Text style={[styles.chipText, status === opt && styles.chipTextActive]}>{STATUS_LABELS[opt]}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity style={[styles.btnPrimaryBlock, submitting && styles.btnDisabled]} onPress={submitAddForm} disabled={submitting} activeOpacity={0.85}>
          {submitting ? <ActivityIndicator color="#fff" /> : (
            <>
              <Ionicons name="checkmark" size={rf(16)} color="#fff" />
              <Text style={styles.btnPrimaryBlockText}>{t('dashboards.farmer.saveHarvestBtn')}</Text>
            </>
          )}
        </TouchableOpacity>
      </BottomSheet>

      {/* Edit Harvest modal */}
      <Modal
        visible={editHarvestId !== null}
        transparent
        animationType={Platform.OS === 'web' ? 'none' : 'slide'}
        onRequestClose={closeEditModal}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={closeEditModal} />
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <TouchableOpacity onPress={closeEditModal} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="arrow-back" size={rf(20)} color={colors.ink} />
              </TouchableOpacity>
              <Text style={styles.modalTitle} numberOfLines={1}>{t('dashboards.farmer.editHarvestModalTitle', { name: editVegetableName })}</Text>
            </View>

            <Text style={styles.fieldLabel}>{t('dashboards.farmer.quantityFieldLabel')}</Text>
            <View style={styles.stepperRow}>
              <TouchableOpacity style={styles.stepperBtn} onPress={decrementEditQty} disabled={editSubmitting} activeOpacity={0.7}>
                <Text style={styles.stepperBtnText}>−</Text>
              </TouchableOpacity>
              <View style={styles.stepperValueBox}>
                <Text style={styles.stepperValueText}>{editQuantityKg || '0'} kg</Text>
              </View>
              <TouchableOpacity style={styles.stepperBtn} onPress={incrementEditQty} disabled={editSubmitting} activeOpacity={0.7}>
                <Text style={styles.stepperBtnText}>+</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.fieldLabel}>{t('dashboards.farmer.statusFieldLabel')}</Text>
            <View style={styles.statusRow}>
              {STATUS_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt}
                  style={[styles.chip, editStatus === opt && styles.chipActive]}
                  onPress={() => setEditStatus(opt)}
                  disabled={editSubmitting}
                >
                  <Text style={[styles.chipText, editStatus === opt && styles.chipTextActive]}>{STATUS_LABELS[opt]}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {editingHarvestLocked ? (
              <Text style={styles.lockedNote}>{t('dashboards.farmer.harvestLockedNote')}</Text>
            ) : (
              <View style={styles.formButtons}>
                <TouchableOpacity
                  style={[styles.btnPrimaryBlock, { flex: 1 }, editSubmitting && styles.btnDisabled]}
                  onPress={submitEditForm}
                  disabled={editSubmitting || busyId === editHarvestId}
                >
                  {editSubmitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryBlockText}>{t('dashboards.farmer.saveBtn')}</Text>}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.btnDangerBlock}
                  onPress={() => {
                    const h = harvests.find((x) => x.id === editHarvestId);
                    if (h) deleteHarvest(h);
                  }}
                  disabled={editSubmitting || busyId === editHarvestId}
                >
                  {busyId === editHarvestId ? <ActivityIndicator color={colors.danger} /> : <Text style={styles.btnDangerBlockText}>{t('dashboards.farmer.deleteBtn')}</Text>}
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Weekly report sheet — doubles as the farmer's inventory record: Harvest
          Date, Pickup Date, Vegetable, Quantity, Pickup Status, Rider, Distributor */}
      <BottomSheet visible={showWeeklySheet} onClose={() => setShowWeeklySheet(false)} title={t('dashboards.farmer.weeklyReportSheetTitle')}>
        <Text style={styles.sheetHint}>{t('dashboards.farmer.autoGenerated', { range: weekRangeLabel(thisWeekKey) })}</Text>
        {loadingWeeklyReport ? (
          <ActivityIndicator size="large" color={colors.leaf700} style={{ marginVertical: 24 }} />
        ) : (
          <ReportTable
            columns={reportColumns}
            rows={weeklyReportRows.map((r) => formatReportRow(r, language))}
            emptyLabel={t('dashboards.farmer.noHarvestsThisWeek')}
          />
        )}
        {distributorName && weeklyReportRows.some((r) => r.pickup_date) && (
          <Text style={styles.sheetHint}>{t('dashboards.farmer.distributorLabel', { name: distributorName })}</Text>
        )}
        <View style={styles.reportActionsRow}>
          <TouchableOpacity
            style={[styles.reportActionBtn, exportingReport && styles.btnDisabled]}
            onPress={() => handleExportReport(t('dashboards.farmer.weeklyReportSheetTitle'), weeklyReportRows, false)}
            disabled={exportingReport || loadingWeeklyReport}
            activeOpacity={0.8}
          >
            <Ionicons name="download-outline" size={rf(15)} color={colors.leaf700} />
            <Text style={styles.reportActionBtnText}>{t('dashboards.farmer.exportPdfBtn')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.reportActionBtn, exportingReport && styles.btnDisabled]}
            onPress={() => handleExportReport(t('dashboards.farmer.weeklyReportSheetTitle'), weeklyReportRows, true)}
            disabled={exportingReport || loadingWeeklyReport}
            activeOpacity={0.8}
          >
            <Ionicons name="print-outline" size={rf(15)} color={colors.leaf700} />
            <Text style={styles.reportActionBtnText}>{t('dashboards.farmer.printBtn')}</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.linkBtn} onPress={openHistoryReport} activeOpacity={0.7}>
          <Ionicons name="time-outline" size={rf(14)} color={colors.leaf700} />
          <Text style={styles.linkBtnText}>{t('dashboards.farmer.viewReportHistory')}</Text>
        </TouchableOpacity>
      </BottomSheet>

      {/* Report history sheet — same table layout as the weekly report, grouped by week */}
      <BottomSheet visible={showHistorySheet} onClose={() => setShowHistorySheet(false)} title={t('dashboards.farmer.reportHistoryTitle')}>
        {loadingHistoryReport ? (
          <ActivityIndicator size="large" color={colors.leaf700} style={{ marginVertical: 24 }} />
        ) : (
          <>
            <View style={styles.reportActionsRow}>
              <TouchableOpacity
                style={[styles.reportActionBtn, exportingReport && styles.btnDisabled]}
                onPress={() => handleExportReport(t('dashboards.farmer.reportHistoryTitle'), historyReportRows, false)}
                disabled={exportingReport}
                activeOpacity={0.8}
              >
                <Ionicons name="download-outline" size={rf(15)} color={colors.leaf700} />
                <Text style={styles.reportActionBtnText}>{t('dashboards.farmer.exportPdfBtn')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.reportActionBtn, exportingReport && styles.btnDisabled]}
                onPress={() => handleExportReport(t('dashboards.farmer.reportHistoryTitle'), historyReportRows, true)}
                disabled={exportingReport}
                activeOpacity={0.8}
              >
                <Ionicons name="print-outline" size={rf(15)} color={colors.leaf700} />
                <Text style={styles.reportActionBtnText}>{t('dashboards.farmer.printBtn')}</Text>
              </TouchableOpacity>
            </View>

            {buildWeeklyRowBuckets(historyReportRows).filter((w) => w.key !== thisWeekKey).length === 0 ? (
              <Text style={styles.emptySubtitle}>{t('dashboards.farmer.noPastWeeks')}</Text>
            ) : (
              buildWeeklyRowBuckets(historyReportRows).filter((w) => w.key !== thisWeekKey).map((w) => {
                const expanded = expandedHistoryKey === w.key;
                return (
                  <View key={w.key} style={{ marginBottom: 8 }}>
                    <TouchableOpacity
                      style={styles.historyRow}
                      onPress={() => setExpandedHistoryKey(expanded ? null : w.key)}
                      activeOpacity={0.7}
                    >
                      <View>
                        <Text style={styles.historyWeek}>{t('dashboards.farmer.weekOf', { range: weekRangeLabel(w.key) })}</Text>
                        <Text style={styles.historyKg}>{t('dashboards.farmer.kgHarvested', { kg: w.totalKg })}</Text>
                      </View>
                      <Ionicons name={expanded ? 'chevron-down' : 'chevron-forward'} size={rf(16)} color={colors.inkFaint} />
                    </TouchableOpacity>
                    {expanded && (
                      <ReportTable
                        columns={reportColumns}
                        rows={w.rows.map((r) => formatReportRow(r, language))}
                        emptyLabel={t('dashboards.farmer.noHarvestsThisWeek')}
                      />
                    )}
                  </View>
                );
              })
            )}
          </>
        )}
      </BottomSheet>

      {/* Cart review sheet (Pick-up tab) */}
      <BottomSheet visible={showCartSheet} onClose={() => setShowCartSheet(false)} title={t('dashboards.farmer.pickupRequestSheetTitle')}>
        {cartHarvests.map((h) => (
          <View key={String(h.id)} style={styles.vegCard}>
            <View style={styles.vegEmoji}><Text style={{ fontSize: rf(20) }}>{getVegEmoji(h.vegetable_name)}</Text></View>
            <View style={styles.vegInfo}>
              <Text style={styles.vegName} numberOfLines={1}>{localizeVegetableName(h.vegetable_name, language)}</Text>
              <Text style={styles.vegMeta}>{t('dashboards.farmer.selectedKg', { qty: h.quantity_kg })}</Text>
            </View>
            <TouchableOpacity style={styles.trashBtn} onPress={() => removeFromCart(h.id)} activeOpacity={0.7}>
              <Ionicons name="trash-outline" size={rf(16)} color={colors.inkSoft} />
            </TouchableOpacity>
          </View>
        ))}
        <View style={styles.cartTotalRow}>
          <Text style={styles.cartTotalLabel}>{t('dashboards.farmer.totalItems')}</Text>
          <Text style={styles.cartTotalValue}>{cartHarvests.length}</Text>
        </View>
        <TouchableOpacity
          style={[styles.btnPrimaryBlock, submittingPickup && styles.btnDisabled]}
          onPress={submitPickupRequest}
          disabled={submittingPickup}
          activeOpacity={0.85}
        >
          {submittingPickup ? <ActivityIndicator color="#fff" /> : (
            <>
              <MaterialCommunityIcons name="truck-outline" size={rf(16)} color="#fff" />
              <Text style={styles.btnPrimaryBlockText}>{t('dashboards.farmer.requestPickupBtnNew')}</Text>
            </>
          )}
        </TouchableOpacity>
      </BottomSheet>

      {/* Confirmation sheet */}
      <BottomSheet visible={showConfirmSheet} onClose={() => setShowConfirmSheet(false)} title="" scroll={false}>
        <View style={styles.confirmWrap}>
          <View style={styles.confirmBadge}>
            <Ionicons name="checkmark-circle" size={rf(30)} color={colors.leaf700} />
          </View>
          <Text style={styles.confirmTitle}>{t('dashboards.farmer.pickupSentTitle')}</Text>
          <Text style={styles.confirmBody}>
            {t('dashboards.farmer.pickupSentBody')}
          </Text>
          <TouchableOpacity
            style={styles.btnPrimaryBlock}
            onPress={() => { setShowConfirmSheet(false); setActiveTab('home'); }}
            activeOpacity={0.85}
          >
            <Text style={styles.btnPrimaryBlockText}>{t('dashboards.farmer.backToDashboard')}</Text>
          </TouchableOpacity>
        </View>
      </BottomSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgScreen },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bgScreen },
  bodyFlex: { flex: 1, minHeight: 0 },
  scrollArea: { flex: 1, minHeight: 0 },
  content: { padding: 16 },

  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 14 },
  pageTitle: { fontFamily: fonts.heading, fontSize: rf(20), color: colors.ink },
  pageSubtitle: { fontFamily: fonts.body, fontSize: rf(13), color: colors.inkSoft, marginTop: 2 },

  notifHeaderTitle: { fontFamily: fonts.heading, fontSize: rf(20), color: colors.ink },

  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 20 },
  statusOnline: { backgroundColor: colors.leaf100 },
  statusOffline: { backgroundColor: '#EFEAE2' },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusDotOnline: { backgroundColor: colors.leaf500 },
  statusDotOffline: { backgroundColor: colors.inkFaint },
  statusLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(13), color: colors.leaf900 || colors.leaf700 },
  statusLabelOffline: { color: colors.inkSoft },

  iconBtn: {
    width: 38, height: 38, borderRadius: radius.ctrl, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', position: 'relative',
  },
  notifDot: {
    position: 'absolute', top: 7, right: 7, width: 7, height: 7, borderRadius: 4,
    backgroundColor: colors.gold500, borderWidth: 1.5, borderColor: colors.card,
  },

  syncBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.gold100, borderRadius: 12, padding: 10, marginBottom: 14 },
  syncBannerText: { flex: 1, fontFamily: fonts.body, fontSize: rf(12), color: colors.gold700 },

  summaryGrid: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  statCard: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 14, ...shadowCard },
  statLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(12), color: colors.inkSoft },
  statValue: { fontFamily: fonts.heading, fontSize: rf(24), marginTop: 6, color: colors.ink },
  statSub: { fontFamily: fonts.bodySemiBold, fontSize: rf(11.5), marginTop: 2, color: colors.leaf700 },
  statSubGold: { color: colors.gold700 },
  weave: { marginTop: 10, height: 7, borderRadius: 6, backgroundColor: colors.leaf100, overflow: 'hidden' },
  weaveFill: { height: '100%', borderRadius: 6, backgroundColor: colors.leaf500 },
  weaveFillGold: { backgroundColor: colors.gold500 },

  addCta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.leaf700, borderRadius: 16, paddingVertical: 15, marginBottom: 6,
  },
  addCtaText: { fontFamily: fonts.heading, fontSize: rf(15.5), color: '#fff' },

  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 14 },
  sectionHeadTitle: { fontFamily: fonts.heading, fontSize: rf(16), color: colors.ink },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  linkBtnText: { fontFamily: fonts.bodySemiBold, fontSize: rf(13), color: colors.leaf700 },

  vegCard: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 14,
    padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 9,
  },
  vegEmoji: { width: 42, height: 42, borderRadius: 11, backgroundColor: colors.leaf50, alignItems: 'center', justifyContent: 'center' },
  vegInfo: { flex: 1, minWidth: 0 },
  vegName: { fontFamily: fonts.bodySemiBold, fontSize: rf(14.5), color: colors.ink, textTransform: 'capitalize' },
  vegMeta: { fontFamily: fonts.body, fontSize: rf(12), color: colors.inkSoft, marginTop: 2 },
  pill: { paddingVertical: 4, paddingHorizontal: 9, borderRadius: 20 },
  pillText: { fontFamily: fonts.bodyBold, fontSize: rf(11) },
  editIconBtn: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },

  btnOutlineSm: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1.4, borderColor: colors.leaf700 },
  btnOutlineSmText: { fontFamily: fonts.bodySemiBold, fontSize: rf(13), color: colors.leaf700 },

  btnOutlineBlock: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.card, borderWidth: 1.4, borderColor: colors.leaf700, borderRadius: radius.ctrl,
    paddingVertical: 13, marginBottom: 14,
  },
  btnOutlineText: { fontFamily: fonts.bodySemiBold, fontSize: rf(14.5), color: colors.leaf700 },

  selectToggle: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1.4, borderColor: colors.leaf700, backgroundColor: colors.card },
  selectToggleOn: { backgroundColor: colors.leaf700 },
  selectToggleText: { fontFamily: fonts.bodySemiBold, fontSize: rf(13), color: colors.leaf700 },
  selectToggleTextOn: { color: '#fff' },

  emptyContainer: { alignItems: 'center', paddingVertical: 50, paddingHorizontal: 24, gap: 6 },
  emptyTitle: { fontFamily: fonts.bodyBold, fontSize: rf(14.5), color: colors.inkSoft },
  emptySubtitle: { fontFamily: fonts.body, fontSize: rf(13), color: colors.inkFaint, textAlign: 'center' },

  cartBar: {
    position: 'absolute', left: 12, right: 12, bottom: 88, backgroundColor: colors.ink,
    borderRadius: 16, padding: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.2, shadowRadius: 16, elevation: 10,
  },
  cartBarText: { fontFamily: fonts.body, fontSize: rf(13), color: '#fff', flexShrink: 1 },
  cartBarCount: { fontFamily: fonts.bodyBold, color: colors.gold500 },
  cartBarBtn: { backgroundColor: colors.gold500, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 14 },
  cartBarBtnText: { fontFamily: fonts.bodyBold, fontSize: rf(13), color: colors.soil800 },

  fieldLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(12.5), color: colors.inkSoft, marginBottom: 6, marginTop: 8 },
  input: {
    backgroundColor: '#fff', borderRadius: radius.ctrl, borderWidth: 1.4, borderColor: colors.border,
    padding: 11, fontFamily: fonts.body, fontSize: rf(14.5), color: colors.ink,
  },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  chipActive: { backgroundColor: colors.leaf700, borderColor: colors.leaf700 },
  chipText: { fontFamily: fonts.body, color: colors.inkSoft, fontSize: rf(13) },
  chipTextActive: { fontFamily: fonts.bodySemiBold, color: '#fff' },

  btnPrimaryBlock: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.leaf700, borderRadius: radius.ctrl, paddingVertical: 13, marginTop: 16,
  },
  btnPrimaryBlockText: { fontFamily: fonts.bodySemiBold, fontSize: rf(14.5), color: '#fff' },
  btnDisabled: { opacity: 0.6 },
  btnDangerBlock: {
    flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radius.ctrl,
    paddingVertical: 13, marginTop: 16, backgroundColor: '#fff', borderWidth: 1.4, borderColor: colors.danger,
  },
  btnDangerBlockText: { fontFamily: fonts.bodySemiBold, fontSize: rf(14.5), color: colors.danger },
  formButtons: { flexDirection: 'row', gap: 10 },
  lockedNote: {
    fontFamily: fonts.body, fontSize: rf(13), color: colors.inkSoft, fontStyle: 'italic',
    marginTop: 16, backgroundColor: colors.leaf50, borderRadius: radius.ctrl, padding: 12, textAlign: 'center',
  },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(20,17,16,0.42)', justifyContent: 'flex-end', zIndex: 9999, elevation: 9999 },
  modalCard: { backgroundColor: colors.bgScreen, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 18, paddingBottom: 30 },
  modalHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 6 },
  modalTitle: { fontFamily: fonts.heading, fontSize: rf(18), color: colors.ink, flexShrink: 1 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  stepperBtn: { width: 44, height: 44, borderRadius: radius.ctrl, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  stepperBtnText: { fontFamily: fonts.bodyBold, fontSize: rf(20), color: colors.leaf700 },
  stepperValueBox: { flex: 1, backgroundColor: colors.card, borderWidth: 1.4, borderColor: colors.border, borderRadius: radius.ctrl, paddingVertical: 12, alignItems: 'center' },
  stepperValueText: { fontFamily: fonts.bodySemiBold, fontSize: rf(15), color: colors.ink },

  sheetHint: { fontFamily: fonts.body, fontSize: rf(12.5), color: colors.inkSoft, marginBottom: 12, marginTop: -4 },
  reportWrap: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.card, padding: 6 },
  reportHeaderRow: { flexDirection: 'row', borderBottomWidth: 1.5, borderBottomColor: colors.border, paddingVertical: 6, paddingHorizontal: 6 },
  reportHeaderCell: { flexGrow: 0, flexShrink: 0, fontFamily: fonts.bodyBold, fontSize: rf(10.5), color: colors.inkSoft, textTransform: 'uppercase', letterSpacing: 0.3, paddingRight: 6 },
  reportRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  reportCell: { flexGrow: 0, flexShrink: 0, fontFamily: fonts.bodyMedium, fontSize: rf(12), color: colors.ink, paddingRight: 6 },
  reportActionsRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  reportActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: radius.ctrl, borderWidth: 1.4, borderColor: colors.leaf700 },
  reportActionBtnText: { fontFamily: fonts.bodySemiBold, fontSize: rf(13), color: colors.leaf700 },

  historyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.border },
  historyWeek: { fontFamily: fonts.bodySemiBold, fontSize: rf(14), color: colors.ink },
  historyKg: { fontFamily: fonts.body, fontSize: rf(12), color: colors.inkSoft, marginTop: 2 },
  historyBreakdown: { marginTop: 10, gap: 6 },
  historyBreakdownRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, paddingHorizontal: 10, backgroundColor: colors.leaf50, borderRadius: 10 },
  historyBreakdownCrop: { fontFamily: fonts.bodySemiBold, fontSize: rf(12.5), color: colors.ink, flex: 1, marginRight: 8, textTransform: 'capitalize' },
  historyBreakdownValue: { fontFamily: fonts.bodyBold, fontSize: rf(12), color: colors.leaf700 },

  trashBtn: { width: 32, height: 32, borderRadius: 10, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  cartTotalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 2, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 6 },
  cartTotalLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(14), color: colors.ink },
  cartTotalValue: { fontFamily: fonts.bodySemiBold, fontSize: rf(14), color: colors.ink },

  confirmWrap: { alignItems: 'center', paddingVertical: 20 },
  confirmBadge: { width: 66, height: 66, borderRadius: 33, backgroundColor: colors.leaf100, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  confirmTitle: { fontFamily: fonts.heading, fontSize: rf(19), color: colors.ink, marginBottom: 8 },
  confirmBody: { fontFamily: fonts.body, fontSize: rf(13.5), color: colors.inkSoft, textAlign: 'center', maxWidth: 280, lineHeight: 19, marginBottom: 22 },
});
