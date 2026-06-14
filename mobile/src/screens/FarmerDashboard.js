import { useState, useEffect, useCallback } from 'react';
import {
  Text, View, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, StyleSheet, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../api/client';
import {
  fetchHarvests, queueHarvest, syncPending, getQueue, onReconnect,
} from '../offline/harvestStore';
import { readThrough } from '../offline/cache';
import { useAuth } from '../context/AuthContext';
import LogoutButton from '../components/LogoutButton';
import NotificationBell from '../components/NotificationBell';
import MessagesButton from '../components/MessagesButton';
import ProfileButton from '../components/ProfileButton';
import { showAlert, peso } from '../lib/ui';

const PRIMARY = '#2e7d32';
const STATUS_OPTIONS = ['available', 'reserved', 'picked_up'];

export default function FarmerDashboard({ navigation, route }) {
  const { user } = useAuth();

  const [harvests, setHarvests] = useState([]);
  const [pickupRequests, setPickupRequests] = useState([]);
  const [latestPayment, setLatestPayment] = useState(null); // null until known; — if no endpoint/data
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  // UI sections
  const [showForm, setShowForm] = useState(false);

  // Form state (shared by add + edit; editingId === null means "add")
  const [editingId, setEditingId] = useState(null);
  const [vegetableName, setVegetableName] = useState('');
  const [quantityKg, setQuantityKg] = useState('');
  const [status, setStatus] = useState('available');
  const [submitting, setSubmitting] = useState(false);

  const refreshPendingCount = useCallback(async () => {
    setPendingCount((await getQueue()).length);
  }, []);

  // Read-through: shows cached data instantly, updates from network if reachable.
  const loadHarvests = useCallback(async () => {
    const { list, source } = await fetchHarvests();
    setHarvests(list);
    setOffline(source === 'cache');
    await refreshPendingCount();
  }, [refreshPendingCount]);

  // Pickup requests feed the summary cards; network-only (read-through cache).
  const loadPickupRequests = useCallback(async () => {
    const { list } = await readThrough('pickup_requests_cache', () =>
      api.get('/api/pickup-requests')
    );
    setPickupRequests(list);
  }, []);

  // Latest payment received from a distributor.
  // TODO(backend): GET /api/farmer/latest-payment does not exist yet — it should
  // return the most recent payment ({ amount, recorded_at }) for this farmer.
  // Until then this fails (e.g. 404) and the card shows "—".
  const loadLatestPayment = useCallback(async () => {
    try {
      const data = await api.get('/api/farmer/latest-payment');
      setLatestPayment(data?.payment ?? data ?? null);
    } catch {
      setLatestPayment(null); // endpoint missing / no payments yet
    }
  }, []);

  // Flush queued writes, then reload to reconcile with the server.
  const trySync = useCallback(async () => {
    const result = await syncPending();
    if (result.synced > 0) await loadHarvests();
    await refreshPendingCount();
    return result;
  }, [loadHarvests, refreshPendingCount]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadHarvests(), loadPickupRequests(), loadLatestPayment()]);
      await trySync(); // push anything queued from a previous offline session
      setLoading(false);
    })();

    // Auto-sync when connectivity returns.
    const unsubscribe = onReconnect(() => { trySync(); });
    return unsubscribe;
  }, [loadHarvests, loadPickupRequests, loadLatestPayment, trySync]);

  // Refresh summary data when returning to this screen (e.g. after editing or
  // deleting on HarvestListScreen) so the cards stay in sync.
  useEffect(() => {
    if (!navigation?.addListener) return undefined;
    return navigation.addListener('focus', () => {
      loadHarvests();
      loadPickupRequests();
    });
  }, [navigation, loadHarvests, loadPickupRequests]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadHarvests(), loadPickupRequests(), loadLatestPayment()]);
    await trySync();
    setRefreshing(false);
  };

  // ---- Summary card values (real data) ----
  const readyHarvestKg = harvests
    .filter((h) => h.status === 'available')
    .reduce((sum, h) => sum + Number(h.quantity_kg || 0), 0);
  const pendingPickups = pickupRequests.filter((p) => p.status === 'requested');
  // Most recent outstanding pickup request, if any.
  const nextPickup = pendingPickups.length
    ? (pendingPickups[0].harvests?.vegetable_name || 'Requested')
    : 'None';
  const pendingPickupCount = pendingPickups.length;
  // "—" when no endpoint/data yet (see loadLatestPayment TODO).
  const latestPaymentLabel = latestPayment?.amount != null ? peso(latestPayment.amount) : '—';

  // ---- Form helpers ----
  const resetForm = () => {
    setEditingId(null);
    setVegetableName('');
    setQuantityKg('');
    setStatus('available');
  };

  const openAddForm = () => {
    resetForm();
    setShowForm(true);
  };

  const openEditForm = (harvest) => {
    setEditingId(harvest.id);
    setVegetableName(harvest.vegetable_name);
    setQuantityKg(String(harvest.quantity_kg));
    setStatus(harvest.status || 'available');
    setShowForm(true);
  };

  // HarvestListScreen's "Edit" action navigates here with an editHarvest param.
  // Open the form pre-filled, then clear the param so it doesn't re-trigger.
  useEffect(() => {
    const h = route?.params?.editHarvest;
    if (h) {
      openEditForm(h);
      navigation?.setParams?.({ editHarvest: undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params?.editHarvest]);

  const submitForm = async () => {
    const name = vegetableName.trim();
    const qty = parseFloat(quantityKg);

    if (!name) {
      showAlert('Error', 'Enter a vegetable name.');
      return;
    }
    if (isNaN(qty) || qty <= 0) {
      showAlert('Error', 'Enter a quantity in kg greater than 0.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = { vegetable_name: name, quantity_kg: qty, status };
      const mutation = editingId
        ? { type: 'edit', id: editingId, payload }
        : { type: 'add', payload };

      // 1) Write locally + update the UI immediately (works offline).
      const optimistic = await queueHarvest(mutation);
      setHarvests(optimistic);
      await refreshPendingCount();
      resetForm();
      setShowForm(false);

      // 2) Try to push to the server now; if offline this just stays queued.
      const result = await trySync();
      if (result.offline || result.remaining > 0) {
        showAlert('Saved offline', 'Your change is saved on this device and will sync when you’re back online.');
      }
    } catch (err) {
      showAlert('Error', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Request Pickup -> notifies all distributors (online action).
  const requestPickup = async (harvest) => {
    const label = harvest
      ? `${harvest.vegetable_name} (${harvest.quantity_kg}kg)`
      : 'available harvests';
    try {
      // Unsynced local harvests have a temporary q- id; don't send it as a real FK.
      const harvest_id = harvest && !String(harvest.id).startsWith('q-') ? harvest.id : null;
      await api.post('/api/pickup-requests', { harvest_id, note: harvest ? null : 'All available harvests' });
      await loadPickupRequests();
      showAlert('Pickup Requested', `Distributors have been notified for ${label}.`);
    } catch (err) {
      showAlert('Error', err.message);
    }
  };

  const weeklyReport = async () => {
    try {
      const report = await api.get('/api/harvests/weekly-report');
      const lines = Object.entries(report.summary || {}).map(
        ([veg, info]) => `• ${veg}: ${info.total_kg}kg (${info.count}x)`
      );
      const body = lines.length
        ? lines.join('\n')
        : 'No harvests recorded in the last 7 days.';
      showAlert(
        `Weekly Report (${report.total_harvests} harvests)`,
        body
      );
    } catch (err) {
      showAlert('Error', err.message);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Farmer Dashboard</Text>
            <Text style={styles.subtitle}>Welcome, {user?.name || user?.phone}</Text>
          </View>
          <View style={styles.headerRight}>
            <ProfileButton />
            <MessagesButton />
            <NotificationBell />
            <LogoutButton />
          </View>
        </View>

        {/* Offline / pending-sync banner */}
        {(offline || pendingCount > 0) && (
          <View style={[styles.banner, offline ? styles.bannerOffline : styles.bannerPending]}>
            <Text style={styles.bannerText}>
              {offline ? '⚠ Offline — showing saved data. ' : '🔄 '}
              {pendingCount > 0
                ? `${pendingCount} change${pendingCount > 1 ? 's' : ''} waiting to sync.`
                : 'Will sync automatically when online.'}
            </Text>
          </View>
        )}

        {/* Summary cards (real data). Wraps to a 2-column grid. */}
        <View style={styles.cardsRow}>
          <SummaryCard label="Ready Harvest" value={`${readyHarvestKg} kg`} />
          <SummaryCard label="Next Pickup" value={nextPickup} small />
          <SummaryCard label="Pending Pickups" value={`${pendingPickupCount}`} />
          <SummaryCard label="Latest Payment" value={latestPaymentLabel} />
        </View>

        {/* Action buttons */}
        <View style={styles.actions}>
          <ActionButton label="Add Harvest Update" onPress={openAddForm} primary />
          <ActionButton label="View All Harvests" onPress={() => navigation.navigate('HarvestList')} />
          <ActionButton label="Request Pickup" onPress={() => requestPickup(null)} />
          <ActionButton label="Weekly Report" onPress={weeklyReport} />
        </View>

        {/* Add / Edit form */}
        {showForm && (
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>
              {editingId ? 'Edit Harvest' : 'Add Harvest Update'}
            </Text>

            <Text style={styles.fieldLabel}>Vegetable name</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., Tomato"
              value={vegetableName}
              onChangeText={setVegetableName}
              editable={!submitting}
            />

            <Text style={styles.fieldLabel}>Quantity (kg)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., 25"
              value={quantityKg}
              onChangeText={setQuantityKg}
              keyboardType="numeric"
              editable={!submitting}
            />

            <Text style={styles.fieldLabel}>Status</Text>
            <View style={styles.statusRow}>
              {STATUS_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt}
                  style={[styles.chip, status === opt && styles.chipActive]}
                  onPress={() => setStatus(opt)}
                  disabled={submitting}
                >
                  <Text style={[styles.chipText, status === opt && styles.chipTextActive]}>
                    {opt}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.formButtons}>
              <TouchableOpacity
                style={[styles.button, styles.buttonPrimary, submitting && styles.buttonDisabled]}
                onPress={submitForm}
                disabled={submitting}
              >
                {submitting
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.buttonPrimaryText}>{editingId ? 'Save Changes' : 'Add Harvest'}</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.buttonOutline]}
                onPress={() => { resetForm(); setShowForm(false); }}
                disabled={submitting}
              >
                <Text style={styles.buttonOutlineText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

// ---- Small presentational components ----
function SummaryCard({ label, value, small }) {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, small && styles.summaryValueSmall]}>{value}</Text>
    </View>
  );
}

function ActionButton({ label, onPress, primary }) {
  return (
    <TouchableOpacity
      style={[styles.actionBtn, primary && styles.actionBtnPrimary]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Text style={[styles.actionBtnText, primary && styles.actionBtnTextPrimary]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5' },
  content: { padding: 16, paddingBottom: 40 },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 24, fontWeight: 'bold', color: PRIMARY },
  subtitle: { fontSize: 14, color: '#555', marginTop: 2 },

  cardsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  summaryCard: { flexGrow: 1, flexBasis: '47%', backgroundColor: '#fff', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#eee' },
  summaryLabel: { fontSize: 12, color: '#777', marginBottom: 6 },
  summaryValue: { fontSize: 18, fontWeight: '700', color: PRIMARY },
  summaryValueSmall: { fontSize: 13, color: '#333' },

  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  actionBtn: { flexGrow: 1, flexBasis: '47%', backgroundColor: '#fff', borderRadius: 10, paddingVertical: 14, paddingHorizontal: 12, borderWidth: 1, borderColor: PRIMARY, alignItems: 'center' },
  actionBtnPrimary: { backgroundColor: PRIMARY },
  actionBtnText: { color: PRIMARY, fontWeight: '600', fontSize: 14, textAlign: 'center' },
  actionBtnTextPrimary: { color: '#fff' },

  formCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#eee' },
  formTitle: { fontSize: 18, fontWeight: '700', color: PRIMARY, marginBottom: 12 },
  fieldLabel: { fontSize: 13, color: '#555', marginBottom: 6, marginTop: 6 },
  input: { backgroundColor: '#fafafa', borderRadius: 8, padding: 12, fontSize: 16, borderWidth: 1, borderColor: '#ddd' },
  statusRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: '#ccc', backgroundColor: '#fafafa' },
  chipActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  chipText: { color: '#555', fontSize: 13 },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  formButtons: { flexDirection: 'row', gap: 10, marginTop: 16 },
  button: { flex: 1, paddingVertical: 14, borderRadius: 8, alignItems: 'center' },
  buttonPrimary: { backgroundColor: PRIMARY },
  buttonPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  buttonOutline: { borderWidth: 1, borderColor: PRIMARY },
  buttonOutlineText: { color: PRIMARY, fontWeight: '600', fontSize: 16 },
  buttonDisabled: { opacity: 0.6 },

  recordsSection: { marginTop: 4 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#333', marginBottom: 10 },
  emptyText: { color: '#888', fontStyle: 'italic' },
  recordCard: { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#eee' },
  recordInfo: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  icon: { fontSize: 22 },
  recordVeg: { fontSize: 16, fontWeight: '700', color: '#222' },
  recordMeta: { fontSize: 14, color: '#555' },
  statusBadge: { paddingVertical: 2, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1 },
  statusBadgeText: { fontSize: 12, color: '#333' },
  pendingBadge: { paddingVertical: 2, paddingHorizontal: 8, borderRadius: 10, backgroundColor: '#fff3e0', borderWidth: 1, borderColor: '#fb8c00' },
  pendingBadgeText: { fontSize: 11, color: '#e65100', fontWeight: '600' },

  banner: { borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 14 },
  bannerOffline: { backgroundColor: '#fff8e1', borderWidth: 1, borderColor: '#f9a825' },
  bannerPending: { backgroundColor: '#e3f2fd', borderWidth: 1, borderColor: '#1976d2' },
  bannerText: { fontSize: 13, color: '#444' },
  recordActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  smallBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: PRIMARY },
  smallBtnText: { color: PRIMARY, fontWeight: '600', fontSize: 13 },
});
