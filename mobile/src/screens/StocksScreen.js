import useLatestRequest from '../hooks/useLatestRequest';
import useRefreshOnFocus from '../hooks/useRefreshOnFocus';
import useRequestLock from '../hooks/useRequestLock';
import { rf } from '../lib/responsive';
import { useState, useEffect, useCallback } from 'react';
import {
  Text, View, FlatList, TouchableOpacity,
  ActivityIndicator, StyleSheet, RefreshControl, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../api/client';
import EmptyState from '../components/EmptyState';
import BatchPhotoField from '../components/BatchPhotoField';
import CustomModal from '../components/CustomModal';
import BottomNavBar from '../components/BottomNavBar';
import { showAlert, confirmAction, peso } from '../lib/ui';
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
  const beginRead = useLatestRequest();
  const requestLock = useRequestLock();
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
  const [editingBatch, setEditingBatch] = useState(null);
  const [batchPhotoUrl, setBatchPhotoUrl] = useState('');
  const [batchPhotoState, setBatchPhotoState] = useState('ready');
  const [editPriceInput, setEditPriceInput] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);

  const loadBatches = useCallback(async () => {
    const isCurrent = beginRead('loadBatches');
    try {
      const data = await api.get('/api/products');
      if (!isCurrent()) return;
      setBatches(Array.isArray(data) ? data : []);
    } catch (err) {
      if (!isCurrent()) return;
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

  useRefreshOnFocus(loadBatches);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadBatches();
    setRefreshing(false);
  };

  // Anything not already listed/sold_out counts as "received" — covers both
  // the normal state and legacy batches from before the status column existed.
  const isListable = (status) => status !== 'listed' && status !== 'sold_out';
  const showBatchPhotoError = (err) => {
    if (err?.status === 404) {
      showAlert('Backend update required', 'The connected VeggieTrack server does not yet support batch photos. Deploy the latest backend, then try again.');
      return;
    }
    showAlert(t('common.error'), err.message);
  };

  const statusLabel = (status) => {
    if (status === 'listed') return t('stocks.statusListed');
    if (status === 'sold_out') return t('stocks.statusSoldOut');
    return t('stocks.statusReceived');
  };

  const submitListing = async (batch, price) => {
    if (!requestLock.acquire('BusyId')) return;
    setBusyId(batch.id);
    try {
      const { product } = await api.put(`/api/products/${batch.id}/list`, { price_per_kg: price });
      beginRead('loadBatches');
      setBatches((prev) => prev.map((b) => (b.id === batch.id ? { ...b, ...product } : b)));
      return true;
    } catch (err) {
      showAlert(t('common.error'), err.message);
    } finally {
      requestLock.release('BusyId');
      setBusyId(null);
    }
  };

  const onAddToProductList = (batch) => {
    if (!batch.batch_photo_url) {
      showAlert(t('common.error'), 'A recent batch photo is required. Select Edit to upload or take one before listing this batch.');
      return;
    }
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

  const openEdit = (batch) => {
    setEditingBatch(batch);
    setBatchPhotoUrl(batch.batch_photo_url || '');
    setBatchPhotoState('ready');
    setEditPriceInput(batch.price_per_kg != null ? String(batch.price_per_kg) : '');
  };
  const saveBatchPhoto = async () => {
    if (!batchPhotoUrl || batchPhotoState !== 'ready') {
      showAlert(t('common.error'), batchPhotoState === 'uploading' ? 'Please wait for the recent batch photo to finish uploading.' : 'A recent batch photo is required before this batch can be saved.');
      return;
    }
    const canEditPrice = !isListable(editingBatch?.status);
    const price = Number(editPriceInput);
    if (canEditPrice && (!price || price <= 0)) {
      showAlert(t('common.error'), t('stocks.priceRequired'));
      return;
    }
    if (!editingBatch || !requestLock.acquire('batchPhoto')) return;
    setPhotoBusy(true);
    try {
      const { product } = await api.put(`/api/products/${editingBatch.id}/batch-photo`, { batch_photo_url: batchPhotoUrl });
      setBatches(prev => prev.map(b => b.id === product.id ? { ...b, ...product } : b));
      if (canEditPrice) {
        const { products } = await api.put(`/api/products/${editingBatch.id}`, { price_per_kg: price });
        if (Array.isArray(products)) setBatches(prev => prev.map(b => products.find(p => p.id === b.id) || b));
      }
      setEditingBatch(null);
    } catch (err) { showBatchPhotoError(err); }
    finally { requestLock.release('batchPhoto'); setPhotoBusy(false); }
  };
  const removeBatchPhoto = () => {
    if (!editingBatch || !isListable(editingBatch.status)) {
      showAlert(t('common.error'), 'Listed batches must keep their photo so retailers can see the product they are ordering. Unlist it first to remove the photo.');
      return;
    }
    confirmAction('Remove batch photo', 'This batch will need a new recent photo before it can be listed.', async () => {
      if (!requestLock.acquire('removeBatchPhoto')) return;
      setPhotoBusy(true);
      try {
        const { product } = await api.delete(`/api/products/${editingBatch.id}/batch-photo`);
        setBatchPhotoUrl('');
        setBatches(prev => prev.map(b => b.id === product.id ? { ...b, ...product } : b));
      } catch (err) { showBatchPhotoError(err); }
      finally { requestLock.release('removeBatchPhoto'); setPhotoBusy(false); }
    });
  };

  const confirmPrice = async () => {
    const price = Number(priceInput);
    if (!price || price <= 0) {
      showAlert(t('common.error'), t('stocks.priceRequired'));
      return;
    }
    if (!priceBatch || !requestLock.acquire('priceConfirm')) return;
    setPriceBusy(true);
    try {
      const saved = await submitListing(priceBatch, price);
      if (saved) setPriceBatch(null);
    } finally {
      requestLock.release('priceConfirm');
      setPriceBusy(false);
    }
  };

  const renderItem = ({ item: b }) => {
    const busy = busyId != null;
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
        <TouchableOpacity style={styles.editBtn} onPress={() => openEdit(b)} disabled={busy}>
          <Text style={styles.editBtnText}>Edit</Text>
        </TouchableOpacity>
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

      <CustomModal visible={!!editingBatch} title={`Edit ${localizeVegetableName(editingBatch?.vegetable_name, language)}`} confirmLabel="Save Batch" onConfirm={saveBatchPhoto} onCancel={() => setEditingBatch(null)} busy={photoBusy}>
        <BatchPhotoField value={batchPhotoUrl} onChange={setBatchPhotoUrl} onStateChange={setBatchPhotoState} disabled={photoBusy} />
        {!isListable(editingBatch?.status) && <>
          <Text style={styles.editPriceLabel}>{t('productList.priceLabel')}</Text>
          <TextInput style={styles.priceInput} value={editPriceInput} onChangeText={setEditPriceInput} placeholder={t('stocks.priceLabel')} keyboardType="decimal-pad" editable={!photoBusy} />
        </>}
        {!!batchPhotoUrl && isListable(editingBatch?.status) && <TouchableOpacity onPress={removeBatchPhoto} disabled={photoBusy} style={styles.removePhotoBtn}>
          <Text style={styles.removePhotoText}>Remove photo</Text>
        </TouchableOpacity>}
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
  editBtn: { marginTop: 8, borderWidth: 1, borderColor: PRIMARY, borderRadius: radius.ctrl, paddingVertical: 9, alignItems: 'center' },
  editBtnText: { color: PRIMARY, fontFamily: fonts.bodySemiBold, fontSize: rf(14) },

  modalHint: { fontSize: rf(13), color: colors.inkFaint, marginBottom: 10 },
  priceInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.ctrl, paddingHorizontal: 12, paddingVertical: 10, fontSize: rf(15) },
  editPriceLabel: { fontFamily: fonts.bodySemiBold, color: colors.ink, marginTop: 14, marginBottom: 7 },
  removePhotoBtn: { alignSelf: 'flex-start', marginTop: 4, paddingVertical: 6 },
  removePhotoText: { fontFamily: fonts.bodySemiBold, color: colors.danger, fontSize: rf(13) },
});
