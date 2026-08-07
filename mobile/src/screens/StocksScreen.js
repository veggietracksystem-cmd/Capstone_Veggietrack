import { rf } from '../lib/responsive';
import { useState, useEffect, useCallback } from 'react';
import {
  Text, View, FlatList, TouchableOpacity,
  ActivityIndicator, StyleSheet, RefreshControl, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../api/client';
import EmptyState from '../components/EmptyState';
import CustomModal from '../components/CustomModal';
import BottomNavBar from '../components/BottomNavBar';
import { showAlert, peso } from '../lib/ui';
import { colors, fonts, radius, shadowCard } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';
import { localizeVegetableName } from '../lib/vegetableNames';

const PRIMARY = colors.leaf700;

const STATUS_STYLE = {
  received: { bg: '#FFF3E0', fg: '#E65100' },
  listed: { bg: '#E8F5E9', fg: '#1E4E09' },
  sold_out: { bg: '#FFEBEE', fg: '#C62828' },
};

const DISTRIBUTOR_TABS_KEYS = [
  { id: 'home', iconName: 'home-outline', labelKey: 'dashboards.distributor.tabHome' },
  { id: 'orders', iconName: 'clipboard-outline', labelKey: 'dashboards.distributor.tabOrders' },
  { id: 'stocks', iconName: 'archive-outline', labelKey: 'dashboards.distributor.tabStocks' },
  { id: 'inventory', iconName: 'cube-outline', labelKey: 'dashboards.distributor.tabInventory' },
  { id: 'profile', iconName: 'person-outline', labelKey: 'dashboards.distributor.tabProfile' },
];

export default function StocksScreen({ navigation }) {
  const { t, language } = useTranslation();
  const DISTRIBUTOR_TABS = DISTRIBUTOR_TABS_KEYS.map((tab) => ({ ...tab, label: t(tab.labelKey) }));
  const handleBottomTabPress = (tab) => {
    if (tab.id === 'stocks') return;
    if (tab.id === 'inventory') navigation.navigate('DistributorInventoryReport');
    else if (tab.id === 'profile') navigation.navigate('Profile');
    else if (tab.id === 'orders') navigation.navigate('DistributorDashboard', { tab: 'orders' });
    else if (tab.id === 'home') navigation.navigate('DistributorDashboard', { tab: 'home' });
  };
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState(null);

  // Price prompt — only shown when a vegetable has no existing listed price yet.
  const [priceBatch, setPriceBatch] = useState(null);
  const [priceInput, setPriceInput] = useState('');
  const [priceBusy, setPriceBusy] = useState(false);

  const loadBatches = useCallback(async () => {
    try {
      const data = await api.get('/api/products');
      setBatches(Array.isArray(data) ? data : []);
    } catch (err) {
      showAlert(t('common.error'), err.message);
    }
  }, [t]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadBatches();
      setLoading(false);
    })();
  }, [loadBatches]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadBatches();
    setRefreshing(false);
  };

  // Anything not already listed/sold_out counts as "received" — covers both
  // the normal state and legacy batches from before the status column existed.
  const isListable = (status) => status !== 'listed' && status !== 'sold_out';

  const statusLabel = (status) => {
    if (status === 'listed') return t('stocks.statusListed');
    if (status === 'sold_out') return t('stocks.statusSoldOut');
    return t('stocks.statusReceived');
  };

  const submitListing = async (batch, price) => {
    setBusyId(batch.id);
    try {
      const { product } = await api.put(`/api/products/${batch.id}/list`, { price_per_kg: price });
      setBatches((prev) => prev.map((b) => (b.id === batch.id ? { ...b, ...product } : b)));
    } catch (err) {
      showAlert(t('common.error'), err.message);
    } finally {
      setBusyId(null);
    }
  };

  const onAddToProductList = (batch) => {
    const sibling = batches.find(
      (b) => b.vegetable_name === batch.vegetable_name && !isListable(b.status)
    );
    if (sibling) {
      submitListing(batch, sibling.price_per_kg);
      return;
    }
    setPriceBatch(batch);
    setPriceInput('');
  };

  const confirmPrice = async () => {
    const price = Number(priceInput);
    if (!price || price <= 0) {
      showAlert(t('common.error'), t('stocks.priceRequired'));
      return;
    }
    setPriceBusy(true);
    await submitListing(priceBatch, price);
    setPriceBusy(false);
    setPriceBatch(null);
  };

  const renderItem = ({ item: b }) => {
    const busy = busyId === b.id;
    const statusStyle = STATUS_STYLE[b.status] || STATUS_STYLE.received;
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.product}>{localizeVegetableName(b.vegetable_name, language)}</Text>
          <View style={[styles.statusPill, { backgroundColor: statusStyle.bg }]}>
            <Text style={[styles.statusPillText, { color: statusStyle.fg }]}>{statusLabel(b.status)}</Text>
          </View>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>{t('stocks.farmerName')}</Text>
          <Text style={styles.value}>{b.farmer_name || '—'}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>{t('stocks.harvestDate')}</Text>
          <Text style={styles.value}>{b.harvest_date ? new Date(b.harvest_date).toLocaleDateString() : '—'}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>{t('stocks.quantity')}</Text>
          <Text style={styles.value}>
            {b.stock_kg} kg{!isListable(b.status) && b.quantity_received != null ? ` / ${b.quantity_received} kg` : ''}
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>{t('stocks.pickupDate')}</Text>
          <Text style={styles.value}>{b.pickup_date ? new Date(b.pickup_date).toLocaleDateString() : '—'}</Text>
        </View>
        {!isListable(b.status) && b.price_per_kg != null && (
          <View style={styles.row}>
            <Text style={styles.label}>{t('productList.priceLabel')}</Text>
            <Text style={styles.value}>{peso(b.price_per_kg)} / kg</Text>
          </View>
        )}

        {isListable(b.status) && (
          <TouchableOpacity
            style={[styles.addBtn, busy && styles.addBtnDisabled]}
            onPress={() => onAddToProductList(b)}
            disabled={busy}
          >
            {busy
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={styles.addBtnText}>{t('stocks.addToProductList')}</Text>}
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.back}>‹ {t('common.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('stocks.title')}</Text>
        <View style={{ width: 50 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={PRIMARY} />
        </View>
      ) : (
        <FlatList
          data={batches}
          keyExtractor={(b) => String(b.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <EmptyState icon="📦" title={t('stocks.emptyTitle')} message={t('stocks.emptyMessage')} />
          }
        />
      )}

      <CustomModal
        visible={!!priceBatch}
        title={t('stocks.priceModalTitle', { name: localizeVegetableName(priceBatch?.vegetable_name, language) })}
        confirmLabel={t('stocks.addToProductList')}
        onConfirm={confirmPrice}
        onCancel={() => setPriceBatch(null)}
        busy={priceBusy}
      >
        <Text style={styles.modalHint}>{t('stocks.priceModalHint')}</Text>
        <TextInput
          style={styles.priceInput}
          value={priceInput}
          onChangeText={setPriceInput}
          placeholder={t('stocks.priceLabel')}
          keyboardType="decimal-pad"
        />
      </CustomModal>

      <BottomNavBar
        tabs={DISTRIBUTOR_TABS}
        activeTab="stocks"
        onTabPress={handleBottomTabPress}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgScreen },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 16, paddingBottom: 100, flexGrow: 1 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  back: { color: PRIMARY, fontSize: rf(16), fontFamily: fonts.bodySemiBold, width: 50 },
  title: { fontSize: rf(20), fontFamily: fonts.heading, color: PRIMARY },

  card: { backgroundColor: colors.card, borderRadius: radius.card, padding: 14, marginBottom: 12, ...shadowCard },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  product: { fontSize: rf(16), fontFamily: fonts.bodySemiBold, color: colors.ink },

  statusPill: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12 },
  statusPillText: { fontSize: rf(12), fontFamily: fonts.bodySemiBold },

  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  label: { fontSize: rf(13), color: colors.inkFaint },
  value: { fontSize: rf(13), color: colors.ink, fontFamily: fonts.bodySemiBold },

  addBtn: { marginTop: 10, backgroundColor: PRIMARY, borderRadius: radius.ctrl, paddingVertical: 10, alignItems: 'center' },
  addBtnDisabled: { opacity: 0.6 },
  addBtnText: { color: '#fff', fontFamily: fonts.bodySemiBold, fontSize: rf(14) },

  modalHint: { fontSize: rf(13), color: colors.inkFaint, marginBottom: 10 },
  priceInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.ctrl, paddingHorizontal: 12, paddingVertical: 10, fontSize: rf(15) },
});
