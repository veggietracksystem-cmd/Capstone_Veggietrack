import { useState, useEffect, useCallback } from 'react';
import {
  Text, View, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, StyleSheet, RefreshControl, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../api/client';
import {
  fetchHarvests, queueHarvest, syncPending, getQueue, onReconnect,
} from '../offline/harvestStore';
import { readThrough } from '../offline/cache';
import { useAuth } from '../context/AuthContext';
import NotificationBell from '../components/NotificationBell';
import BottomNavBar from '../components/BottomNavBar';
import { showAlert, peso } from '../lib/ui';

const PRIMARY = '#2e7d32';

const FARMER_TABS = [
  { id: 'home', icon: '🏠', label: 'Home' },
  { id: 'harvests', icon: '🌾', label: 'Harvests' },
  { id: 'pickups', icon: '🚚', label: 'Pickups' },
  { id: 'history', icon: '📜', label: 'History' },
  { id: 'profile', icon: '👤', label: 'Profile' },
];

const STATUS_OPTIONS = ['available', 'reserved', 'picked_up'];

// Marketplace vegetable tile colors & icons (aligned with reference design)
const VEG_TILES = {
  tomato: { icon: '🍅', bg: '#ffebee' },
  eggplant: { icon: '🍆', bg: '#f3e5f5' },
  beans: { icon: '🌿', bg: '#e8f5e9' },
  squash: { icon: '🎃', bg: '#fff3e0' },
  carrot: { icon: '🥕', bg: '#fff3e0' },
  potato: { icon: '🥔', bg: '#fbe9e7' },
  corn: { icon: '🌽', bg: '#fffde7' },
  pepper: { icon: '🌶️', bg: '#ffebee' },
  cucumber: { icon: '🥒', bg: '#e8f5e9' },
  onion: { icon: '🧅', bg: '#f3e5f5' },
  lettuce: { icon: '🥬', bg: '#e8f5e9' },
};

function getVegetableTile(name) {
  const key = String(name || '').toLowerCase();
  const match = Object.keys(VEG_TILES).find((k) => key.includes(k));
  return match ? VEG_TILES[match] : { icon: '🥬', bg: '#e8f5e9' };
}

export default function FarmerDashboard({ navigation, route }) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('home');
  const [searchQuery, setSearchQuery] = useState('');

  const [harvests, setHarvests] = useState([]);
  const [pickupRequests, setPickupRequests] = useState([]);
  const [latestPayment, setLatestPayment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [vegetableName, setVegetableName] = useState('');
  const [quantityKg, setQuantityKg] = useState('');
  const [status, setStatus] = useState('available');
  const [submitting, setSubmitting] = useState(false);

  const refreshPendingCount = useCallback(async () => {
    setPendingCount((await getQueue()).length);
  }, []);

  const loadHarvests = useCallback(async () => {
    const { list, source } = await fetchHarvests();
    setHarvests(list);
    setOffline(source === 'cache');
    await refreshPendingCount();
  }, [refreshPendingCount]);

  const loadPickupRequests = useCallback(async () => {
    const { list } = await readThrough('pickup_requests_cache', () =>
      api.get('/api/pickup-requests')
    );
    setPickupRequests(list);
  }, []);

  const loadLatestPayment = useCallback(async () => {
    try {
      const data = await api.get('/api/farmer/latest-payment');
      setLatestPayment(data?.payment ?? data ?? null);
    } catch {
      setLatestPayment(null);
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
      await Promise.all([loadHarvests(), loadPickupRequests(), loadLatestPayment()]);
      await trySync();
      setLoading(false);
    })();

    const unsubscribe = onReconnect(() => { trySync(); });
    return unsubscribe;
  }, [loadHarvests, loadPickupRequests, loadLatestPayment, trySync]);

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

  // KPI Calculations
  const readyHarvestKg = harvests
    .filter((h) => h.status === 'available')
    .reduce((sum, h) => sum + Number(h.quantity_kg || 0), 0);
  const pendingPickups = pickupRequests.filter((p) => p.status === 'requested');
  const nextPickup = pendingPickups.length
    ? (pendingPickups[0].harvests?.vegetable_name || 'Requested')
    : 'None';
  const pendingPickupCount = pendingPickups.length;
  const latestPaymentLabel = latestPayment?.amount != null ? peso(latestPayment.amount) : '—';

  // Form helpers
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

  useEffect(() => {
    const h = route?.params?.editHarvest;
    if (h) {
      openEditForm(h);
      navigation?.setParams?.({ editHarvest: undefined });
    }
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

      const optimistic = await queueHarvest(mutation);
      setHarvests(optimistic);
      await refreshPendingCount();
      resetForm();
      setShowForm(false);

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

  const requestPickup = async (harvest) => {
    const label = harvest
      ? `${harvest.vegetable_name} (${harvest.quantity_kg}kg)`
      : 'available harvests';
    try {
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
      showAlert(`Weekly Report (${report.total_harvests} harvests)`, body);
    } catch (err) {
      showAlert('Error', err.message);
    }
  };

  const handleTabPress = (tab) => {
    setActiveTab(tab.id);
    if (tab.id === 'history') {
      navigation.navigate('HarvestList');
    } else if (tab.id === 'profile') {
      navigation.navigate('Profile');
    } else if (tab.id === 'harvests') {
      openAddForm();
    }
  };

  // Filtered harvest list based on search bar
  const filteredHarvests = harvests.filter((h) =>
    h.vegetable_name?.toLowerCase().includes(searchQuery.toLowerCase().trim())
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Minimal Top Navigation Header */}
      <View style={styles.minimalHeader}>
        <Text style={styles.minimalTitle}>Farmer Hub</Text>
        <NotificationBell />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 90 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Search Bar (Marketplace Reference Design) */}
        <View style={styles.searchRow}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search crops or vegetables..."
            placeholderTextColor="#999"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Text style={styles.searchClear}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Banner for Offline / Pending Sync */}
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

        {/* Section Header */}
        <View style={styles.sectionHeader}>
          <Text style={styles.marketplaceTitle}>Marketplace Inventory</Text>
          <Text style={styles.marketplaceSubtitle}>Manage your fresh crops & stock levels</Text>
        </View>

        {/* Compact KPI Summary Cards */}
        <View style={styles.kpiGrid}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Ready Harvest</Text>
            <Text style={styles.kpiValue}>{readyHarvestKg} kg</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Next Pickup</Text>
            <Text style={styles.kpiValueSmall} numberOfLines={1}>{nextPickup}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Pending Pickups</Text>
            <Text style={styles.kpiValue}>{pendingPickupCount}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Latest Payment</Text>
            <Text style={styles.kpiValue}>{latestPaymentLabel}</Text>
          </View>
        </View>

        {/* Action Button Row */}
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.primaryActionBtn} onPress={openAddForm} activeOpacity={0.85}>
            <Text style={styles.primaryActionText}>+ Add Harvest</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryActionBtn} onPress={() => requestPickup(null)} activeOpacity={0.85}>
            <Text style={styles.secondaryActionText}>📦 Request Pickup</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryActionBtn} onPress={weeklyReport} activeOpacity={0.85}>
            <Text style={styles.secondaryActionText}>📊 Weekly Report</Text>
          </TouchableOpacity>
        </View>

        {/* Add / Edit Harvest Form */}
        {showForm && (
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>
              {editingId ? '✏️ Edit Harvest' : '🌱 Log New Harvest'}
            </Text>

            <Text style={styles.fieldLabel}>Vegetable Name</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., Beans, Eggplant, Tomato"
              value={vegetableName}
              onChangeText={setVegetableName}
              editable={!submitting}
            />

            <Text style={styles.fieldLabel}>Quantity (kg)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., 70"
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

        {/* 2-Column Marketplace Grid Layout (Matching Reference Design) */}
        {filteredHarvests.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>🥬</Text>
            <Text style={styles.emptyTitle}>No harvests found</Text>
            <Text style={styles.emptySubtitle}>Log your fresh vegetables to manage them here.</Text>
          </View>
        ) : (
          <View style={styles.marketplaceGrid}>
            {filteredHarvests.map((h) => {
              const tile = getVegetableTile(h.vegetable_name);
              return (
                <View key={String(h.id)} style={styles.productCard}>
                  {/* Soft-tinted Icon Tile Container */}
                  <View style={[styles.tileContainer, { backgroundColor: tile.bg }]}>
                    <Text style={styles.tileIcon}>{tile.icon}</Text>
                  </View>

                  {/* Vegetable Name */}
                  <Text style={styles.cropTitle} numberOfLines={1}>
                    {h.vegetable_name}
                  </Text>

                  {/* Stock Pill Badge */}
                  <View style={styles.stockBadge}>
                    <Text style={styles.stockBadgeText}>{h.quantity_kg} kg in stock</Text>
                  </View>

                  {/* Status / Price Label */}
                  <Text style={styles.cropStatusLabel}>
                    {h.status === 'available' ? 'Available' : h.status}
                  </Text>

                  {/* Primary Green "Manage" Button */}
                  <TouchableOpacity
                    style={styles.manageBtn}
                    onPress={() => openEditForm(h)}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.manageBtnText}>Manage</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}

        {/* Marketplace Footer Banner (Matching "More products coming soon" in Screenshot) */}
        <View style={styles.marketplaceBanner}>
          <View style={styles.bannerIconBadge}>
            <Text style={styles.bannerIconText}>⚡</Text>
          </View>
          <Text style={styles.bannerTitle}>More produce additions coming soon</Text>
          <Text style={styles.bannerSubtitle}>Check back later or log new harvests as your crops mature.</Text>
        </View>

      </ScrollView>

      <BottomNavBar
        tabs={FARMER_TABS}
        activeTab={activeTab}
        onTabPress={handleTabPress}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8faf8' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8faf8' },
  content: { padding: 16 },

  minimalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  minimalTitle: { fontSize: 18, fontWeight: '700', color: PRIMARY },

  // Search Row
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 14,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  searchIcon: { fontSize: 16, marginRight: 8 },
  searchInput: {
    flex: 1,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    fontSize: 15,
    color: '#1a1a1a',
  },
  searchClear: { fontSize: 16, color: '#999', paddingLeft: 8 },

  // Header Title
  sectionHeader: { marginBottom: 12 },
  marketplaceTitle: { fontSize: 22, fontWeight: '800', color: '#1a1a1a' },
  marketplaceSubtitle: { fontSize: 13, color: '#666', marginTop: 2 },

  // KPI Grid
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  kpiCard: {
    flexGrow: 1,
    flexBasis: '47%',
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e8f0e8',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  kpiLabel: { fontSize: 12, color: '#666', fontWeight: '500', marginBottom: 4 },
  kpiValue: { fontSize: 18, fontWeight: '700', color: PRIMARY },
  kpiValueSmall: { fontSize: 13, fontWeight: '600', color: '#333' },

  // Action Row
  actionRow: { flexDirection: 'row', gap: 8, marginBottom: 16, flexWrap: 'wrap' },
  primaryActionBtn: {
    flex: 1,
    backgroundColor: PRIMARY,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionText: { color: '#ffffff', fontWeight: '700', fontSize: 14 },
  secondaryActionBtn: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: PRIMARY,
  },
  secondaryActionText: { color: PRIMARY, fontWeight: '600', fontSize: 13 },

  // Form Card
  formCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  formTitle: { fontSize: 18, fontWeight: '700', color: PRIMARY, marginBottom: 12 },
  fieldLabel: { fontSize: 13, color: '#444', fontWeight: '600', marginBottom: 6, marginTop: 8 },
  input: { backgroundColor: '#f8faf8', borderRadius: 10, padding: 12, fontSize: 15, borderWidth: 1, borderColor: '#ddd' },
  statusRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: '#ccc', backgroundColor: '#f8faf8' },
  chipActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  chipText: { color: '#555', fontSize: 13 },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  formButtons: { flexDirection: 'row', gap: 10, marginTop: 16 },
  button: { flex: 1, paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  buttonPrimary: { backgroundColor: PRIMARY },
  buttonPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  buttonOutline: { borderWidth: 1, borderColor: PRIMARY },
  buttonOutlineText: { color: PRIMARY, fontWeight: '600', fontSize: 15 },
  buttonDisabled: { opacity: 0.6 },

  // 2-Column Marketplace Grid (Reference Screenshot)
  marketplaceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 14,
    marginBottom: 20,
  },
  productCard: {
    width: '48%',
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#edf2ed',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 5,
    elevation: 2,
    alignItems: 'center',
  },
  tileContainer: {
    width: 72,
    height: 72,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  tileIcon: { fontSize: 36 },
  cropTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 6,
    textAlign: 'center',
  },
  stockBadge: {
    backgroundColor: '#e8f5e9',
    borderRadius: 10,
    paddingVertical: 3,
    paddingHorizontal: 8,
    marginBottom: 8,
  },
  stockBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: PRIMARY,
  },
  cropStatusLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: PRIMARY,
    marginBottom: 12,
  },
  manageBtn: {
    width: '100%',
    backgroundColor: PRIMARY,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manageBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },

  // Marketplace Banner (Reference Screenshot)
  marketplaceBanner: {
    backgroundColor: '#edf7ed',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#c8e6c9',
    marginTop: 8,
  },
  bannerIconBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#a5d6a7',
  },
  bannerIconText: { fontSize: 20 },
  bannerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: PRIMARY,
    marginBottom: 4,
    textAlign: 'center',
  },
  bannerSubtitle: {
    fontSize: 12,
    color: '#555',
    textAlign: 'center',
    lineHeight: 18,
  },

  emptyContainer: { padding: 30, alignItems: 'center' },
  emptyIcon: { fontSize: 40, marginBottom: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#333' },
  emptySubtitle: { fontSize: 13, color: '#777', marginTop: 4, textAlign: 'center' },

  banner: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, marginBottom: 14 },
  bannerOffline: { backgroundColor: '#fff8e1', borderWidth: 1, borderColor: '#f9a825' },
  bannerPending: { backgroundColor: '#e3f2fd', borderWidth: 1, borderColor: '#1976d2' },
  bannerText: { fontSize: 13, color: '#444' },
});
