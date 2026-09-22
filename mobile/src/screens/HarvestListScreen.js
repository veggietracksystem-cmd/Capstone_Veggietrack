import { queueHarvest, syncPending } from '../offline/harvestStore';
import useLatestRequest from '../hooks/useLatestRequest';
import useRefreshOnFocus from '../hooks/useRefreshOnFocus';
import useRequestLock from '../hooks/useRequestLock';
import { rf } from '../lib/responsive';
import { useState, useEffect, useCallback } from 'react';
import {
  Text, View, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet, RefreshControl, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '../api/client';
import EmptyState from '../components/EmptyState';
import ScreenHeader from '../components/ScreenHeader';
import StatusBadge from '../components/ui/StatusBadge';
import { showAlert, confirmAction } from '../lib/ui';
import { friendlyError } from '../lib/errorMessages';
import { useTranslation } from '../i18n/useTranslation';
import { getVegetableTile } from '../lib/vegetableIcons';
import VegetableImage from '../components/VegetableImage';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, fonts, fontSize, radius, shadowCard } from '../theme/appTheme';
import RemoteImage from '../components/RemoteImage';

const PRIMARY = colors.leaf700;

export default function HarvestListScreen({ navigation }) {
  // Screen skips the bottom safe-area edge, so pad the scroll content instead.
  const insets = useSafeAreaInsets();
  const beginRead = useLatestRequest();
  const requestLock = useRequestLock();
  const { t } = useTranslation();
  const [harvests, setHarvests] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const loadHarvests = useCallback(async () => {
    const isCurrent = beginRead('loadHarvests');
    try {
      const data = await api.get('/api/harvests');
      if (!isCurrent()) return;
      setHarvests(Array.isArray(data) ? data : []);
    } catch (err) {
      if (!isCurrent()) return;
      showAlert(t('common.error'), friendlyError(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadHarvests();
      setLoading(false);
    })();
  }, [loadHarvests]);

  useRefreshOnFocus(loadHarvests);

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
        if (!requestLock.acquire('BusyId')) return;
        setBusyId(harvest.id);
        try {
          await api.delete(`/api/harvests/${harvest.id}`);
          beginRead('loadHarvests');
          setHarvests((prev) => prev.filter((h) => h.id !== harvest.id));
        } catch (err) {
          showAlert(t('common.error'), friendlyError(err));
        } finally {
          requestLock.release('BusyId');
          setBusyId(null);
        }
      }
    );
  };

  const requestPickup = async (harvest) => {
    if (!requestLock.acquire('BusyId')) return;
    setBusyId(harvest.id);
    try {
      await api.post('/api/pickup-requests', { harvest_id: harvest.id, note: null });
      beginRead('loadHarvests');
      setHarvests(prev => prev.map(h => h.id === harvest.id ? { ...h, status: 'for_pickup' } : h));
      await queueHarvest({ type: 'edit', id: harvest.id, payload: { status: 'for_pickup' } });
      await syncPending();
      showAlert(t('harvestList.pickupRequestedTitle'), t('harvestList.pickupRequestedMessage', { name: harvest.vegetable_name, qty: harvest.quantity_kg }));
    } catch (err) {
      showAlert(t('common.error'), friendlyError(err));
    } finally {
      requestLock.release('BusyId');
      setBusyId(null);
    }
  };

  // Filtered harvest list based on search bar
  const filteredHarvests = harvests.filter((h) =>
    h.vegetable_name?.toLowerCase().includes(searchQuery.toLowerCase().trim())
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScreenHeader title={t('harvestList.title')} onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 24 + insets.bottom }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Search Input Bar (Marketplace Style) */}
        <View style={styles.searchRow}>
          <Ionicons name="search-outline" size={rf(19)} color={colors.inkFaint} />
          <TextInput
            style={styles.searchInput}
            placeholder={t('harvestList.searchPlaceholder')}
            placeholderTextColor={colors.placeholder}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle-outline" size={rf(20)} color={colors.inkFaint} />
            </TouchableOpacity>
          ) : null}
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={PRIMARY} />
          </View>
        ) : filteredHarvests.length === 0 ? (
          <EmptyState
            iconElement={<MaterialCommunityIcons name="sprout" size={rf(44)} color="#9aa39a" />}
            title={t('harvestList.emptyTitle')}
            message={t('harvestList.emptyMessage')}
          />
        ) : (
          /* 2-Column Marketplace Grid Layout */
          <View style={styles.marketplaceGrid}>
            {filteredHarvests.map((h) => {
              const tile = getVegetableTile(h.vegetable_name);
              const busy = busyId != null;
              return (
                <View key={String(h.id)} style={styles.productCard}>
                  {/* Photo (if uploaded) or soft icon tile */}
                  {h.image_url ? (
                    <RemoteImage uri={h.image_url} style={styles.tileContainer} resizeMode="cover" />
                  ) : (
                    <View style={[styles.tileContainer, { backgroundColor: tile.bg }]}>
                      <VegetableImage source={tile.source} style={styles.tileIcon} fallbackSize={rf(32)} />
                    </View>
                  )}

                  {/* Title */}
                  <Text style={styles.cropTitle} numberOfLines={1}>
                    {h.vegetable_name}
                  </Text>

                  {/* Stock Pill Badge */}
                  <View style={styles.stockBadge}>
                    <Text style={styles.stockBadgeText}>{t('harvestList.kgInStock', { qty: h.quantity_kg })}</Text>
                  </View>

                  {/* Status Pill */}
                  <View style={styles.statusPillWrap}>
                    <StatusBadge status={h.status} label={h.status === 'available' ? t('harvestList.statusAvailable') : undefined} />
                  </View>

                  {/* Action Buttons */}
                  <View style={styles.actionButtonsCol}>
                    <TouchableOpacity
                      style={styles.manageBtn}
                      onPress={() => editHarvest(h)}
                      disabled={busy}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="create-outline" size={rf(16)} color="#fff" />
                      <Text style={styles.manageBtnText}>{t('harvestList.editBtn')}</Text>
                    </TouchableOpacity>

                    {h.status === 'available' && (
                      <TouchableOpacity
                        style={styles.pickupBtn}
                        onPress={() => requestPickup(h)}
                        disabled={busy}
                        activeOpacity={0.85}
                      >
                        <MaterialCommunityIcons name="truck-delivery-outline" size={rf(16)} color={PRIMARY} />
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
                        <>
                          <Ionicons name="trash-outline" size={rf(16)} color="#c62828" />
                          <Text style={styles.deleteBtnText}>{t('harvestList.deleteBtn')}</Text>
                        </>
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
  container: { flex: 1, backgroundColor: colors.bgScreen },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', minHeight: 200 },
  content: { padding: 16, paddingBottom: 40, flexGrow: 1 },

  // Search Row
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.ctrl,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  searchIcon: { fontSize: rf(16), marginRight: 8 },
  searchInput: {
    flex: 1,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    fontFamily: fonts.body,
    fontSize: rf(fontSize.lg),
    color: colors.ink,
  },
  searchClear: { fontSize: rf(16), color: colors.inkFaint, paddingLeft: 8 },

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
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    ...shadowCard,
  },
  tileContainer: {
    width: 64,
    height: 64,
    borderRadius: radius.ctrl,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  tileIcon: { width: 72, height: 72 },
  cropTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: rf(fontSize.lg),
    color: colors.ink,
    marginBottom: 4,
    textAlign: 'center',
  },
  stockBadge: {
    backgroundColor: colors.leaf100,
    borderRadius: 10,
    paddingVertical: 2,
    paddingHorizontal: 8,
    marginBottom: 6,
  },
  stockBadgeText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: rf(fontSize.xs),
    color: PRIMARY,
  },
  statusPillWrap: { marginBottom: 10, alignItems: 'center' },

  actionButtonsCol: { width: '100%', gap: 6 },
  manageBtn: {
    width: '100%',
    flexDirection: 'row',
    gap: 6,
    backgroundColor: PRIMARY,
    borderRadius: radius.ctrl,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manageBtnText: { color: '#fff', fontFamily: fonts.bodyBold, fontSize: rf(fontSize.sm), textAlign: 'center' },
  pickupBtn: {
    width: '100%',
    flexDirection: 'row',
    gap: 6,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: PRIMARY,
    borderRadius: radius.ctrl,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickupBtnText: { color: PRIMARY, fontFamily: fonts.bodyBold, fontSize: rf(fontSize.sm), textAlign: 'center' },
  deleteBtn: {
    width: '100%',
    flexDirection: 'row',
    gap: 6,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.dangerSoft,
    borderRadius: radius.ctrl,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnText: { color: colors.danger, fontFamily: fonts.bodyBold, fontSize: rf(fontSize.sm), textAlign: 'center' },
});
