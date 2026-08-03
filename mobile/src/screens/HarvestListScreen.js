import { useState, useEffect, useCallback } from 'react';
import {
  Text, View, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, StyleSheet, RefreshControl, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../api/client';
import EmptyState from '../components/EmptyState';
import { showAlert, confirmAction } from '../lib/ui';
import { useTranslation } from '../i18n/useTranslation';

const PRIMARY = '#2e7d32';

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

export default function HarvestListScreen({ navigation }) {
  const { t } = useTranslation();
  const [harvests, setHarvests] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const loadHarvests = useCallback(async () => {
    try {
      const data = await api.get('/api/harvests');
      setHarvests(Array.isArray(data) ? data : []);
    } catch (err) {
      showAlert(t('common.error'), err.message);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadHarvests();
      setLoading(false);
    })();
  }, [loadHarvests]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadHarvests();
    setRefreshing(false);
  };

  const editHarvest = (harvest) => {
    navigation.navigate('FarmerDashboard', { editHarvest: harvest });
  };

  const deleteHarvest = (harvest) => {
    confirmAction(
      t('harvestList.deleteConfirmTitle'),
      t('harvestList.deleteConfirmMessage', { name: harvest.vegetable_name, qty: harvest.quantity_kg }),
      async () => {
        setBusyId(harvest.id);
        try {
          await api.delete(`/api/harvests/${harvest.id}`);
          setHarvests((prev) => prev.filter((h) => h.id !== harvest.id));
        } catch (err) {
          showAlert(t('common.error'), err.message);
        } finally {
          setBusyId(null);
        }
      }
    );
  };

  const requestPickup = async (harvest) => {
    setBusyId(harvest.id);
    try {
      await api.post('/api/pickup-requests', { harvest_id: harvest.id, note: null });
      showAlert(t('harvestList.pickupRequestedTitle'), t('harvestList.pickupRequestedMessage', { name: harvest.vegetable_name, qty: harvest.quantity_kg }));
    } catch (err) {
      showAlert(t('common.error'), err.message);
    } finally {
      setBusyId(null);
    }
  };

  // Filtered harvest list based on search bar
  const filteredHarvests = harvests.filter((h) =>
    h.vegetable_name?.toLowerCase().includes(searchQuery.toLowerCase().trim())
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.back}>‹ {t('common.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('harvestList.title')}</Text>
        <View style={{ width: 50 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Search Input Bar (Marketplace Style) */}
        <View style={styles.searchRow}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder={t('harvestList.searchPlaceholder')}
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

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={PRIMARY} />
          </View>
        ) : filteredHarvests.length === 0 ? (
          <EmptyState
            icon="🥬"
            title={t('harvestList.emptyTitle')}
            message={t('harvestList.emptyMessage')}
          />
        ) : (
          /* 2-Column Marketplace Grid Layout */
          <View style={styles.marketplaceGrid}>
            {filteredHarvests.map((h) => {
              const tile = getVegetableTile(h.vegetable_name);
              const busy = busyId === h.id;
              return (
                <View key={String(h.id)} style={styles.productCard}>
                  {/* Soft Icon Tile */}
                  <View style={[styles.tileContainer, { backgroundColor: tile.bg }]}>
                    <Text style={styles.tileIcon}>{tile.icon}</Text>
                  </View>

                  {/* Title */}
                  <Text style={styles.cropTitle} numberOfLines={1}>
                    {h.vegetable_name}
                  </Text>

                  {/* Stock Pill Badge */}
                  <View style={styles.stockBadge}>
                    <Text style={styles.stockBadgeText}>{t('harvestList.kgInStock', { qty: h.quantity_kg })}</Text>
                  </View>

                  {/* Status Pill */}
                  <Text style={styles.statusLabel}>
                    {h.status === 'available' ? t('harvestList.statusAvailable') : h.status}
                  </Text>

                  {/* Action Buttons */}
                  <View style={styles.actionButtonsCol}>
                    <TouchableOpacity
                      style={styles.manageBtn}
                      onPress={() => editHarvest(h)}
                      disabled={busy}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.manageBtnText}>{t('harvestList.editBtn')}</Text>
                    </TouchableOpacity>

                    {h.status === 'available' && (
                      <TouchableOpacity
                        style={styles.pickupBtn}
                        onPress={() => requestPickup(h)}
                        disabled={busy}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.pickupBtnText}>{t('harvestList.pickupBtn')}</Text>
                      </TouchableOpacity>
                    )}

                    <TouchableOpacity
                      style={styles.deleteBtn}
                      onPress={() => deleteHarvest(h)}
                      disabled={busy}
                      activeOpacity={0.85}
                    >
                      {busy ? (
                        <ActivityIndicator color="#c62828" size="small" />
                      ) : (
                        <Text style={styles.deleteBtnText}>{t('harvestList.deleteBtn')}</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8faf8' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', minHeight: 200 },
  content: { padding: 16, paddingBottom: 40, flexGrow: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  back: { color: PRIMARY, fontSize: 16, fontWeight: '600', width: 50 },
  title: { fontSize: 18, fontWeight: '700', color: PRIMARY },

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

  // 2-Column Marketplace Grid
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
    padding: 12,
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
    width: 64,
    height: 64,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  tileIcon: { fontSize: 32 },
  cropTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 4,
    textAlign: 'center',
  },
  stockBadge: {
    backgroundColor: '#e8f5e9',
    borderRadius: 10,
    paddingVertical: 2,
    paddingHorizontal: 8,
    marginBottom: 6,
  },
  stockBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: PRIMARY,
  },
  statusLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: PRIMARY,
    marginBottom: 10,
  },

  actionButtonsCol: { width: '100%', gap: 6 },
  manageBtn: {
    width: '100%',
    backgroundColor: PRIMARY,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  manageBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 12 },
  pickupBtn: {
    width: '100%',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: PRIMARY,
    borderRadius: 8,
    paddingVertical: 7,
    alignItems: 'center',
  },
  pickupBtnText: { color: PRIMARY, fontWeight: '700', fontSize: 12 },
  deleteBtn: {
    width: '100%',
    backgroundColor: '#fff5f5',
    borderWidth: 1,
    borderColor: '#ffcdd2',
    borderRadius: 8,
    paddingVertical: 7,
    alignItems: 'center',
  },
  deleteBtnText: { color: '#c62828', fontWeight: '700', fontSize: 12 },
});
