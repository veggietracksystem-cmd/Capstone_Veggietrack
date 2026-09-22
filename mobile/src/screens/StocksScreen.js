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
import { SegmentedTabs } from '../components/ui/SegmentedTabs';
import StatusBadge from '../components/ui/StatusBadge';
import BatchPhotoField from '../components/BatchPhotoField';
import CustomModal from '../components/CustomModal';
import BottomNavBar, { useBottomNavSpace } from '../components/BottomNavBar';
import ScreenHeader from '../components/ScreenHeader';
import { showAlert, confirmAction, peso } from '../lib/ui';
import { friendlyError } from '../lib/errorMessages';
import { colors, control, fontSize, fonts, radius, shadowCard, spacing } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { localizeVegetableName } from '../lib/vegetableNames';
import { isVegetable, VEGETABLE_VALIDATION_MESSAGE } from '../lib/vegetables';
import { getVegetableTile } from '../lib/vegetableIcons';
import VegetableImage from '../components/VegetableImage';

const PRIMARY = colors.leaf700;

const DISTRIBUTOR_TABS_KEYS = [
  { id: 'home', iconName: 'home-outline', labelKey: 'dashboards.distributor.tabHome' },
  { id: 'orders', iconName: 'clipboard-outline', labelKey: 'dashboards.distributor.tabOrders' },
  { id: 'stocks', iconName: 'archive-outline', labelKey: 'dashboards.distributor.tabStocks' },
  { id: 'inventory', iconName: 'cube-outline', labelKey: 'dashboards.distributor.tabInventory' },
  { id: 'profile', iconName: 'person-outline', labelKey: 'dashboards.distributor.tabProfile' },
];

export default function StocksScreen({ navigation }) {
  const navSpace = useBottomNavSpace();
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
  // Batches = physical stock received from farmers (not yet listed). Products
  // = already-listed catalog shown to retailers. Same underlying records
  // (`/api/products`), just filtered by status — matches the prototype's
  // Batches/Products segmented control without any new fetch.
  const [seg, setSeg] = useState('batches');
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

  // Add Product — the direct-creation entry point for POST /api/products
  // (independent of the pickup-intake flow above: this batch is listed
  // immediately, not received as 'received' first).
  const [addProductVisible, setAddProductVisible] = useState(false);
  const [addVegName, setAddVegName] = useState('');
  const [addPrice, setAddPrice] = useState('');
  const [addStock, setAddStock] = useState('');
  const [addPhotoUrl, setAddPhotoUrl] = useState('');
  const [addPhotoState, setAddPhotoState] = useState('ready');
  const [addBusy, setAddBusy] = useState(false);

  const loadBatches = useCallback(async () => {
    const isCurrent = beginRead('loadBatches');
    try {
      const data = await api.get('/api/products');
      if (!isCurrent()) return;
      setBatches(Array.isArray(data) ? data : []);
    } catch (err) {
      if (!isCurrent()) return;
      showAlert(t('common.error'), friendlyError(err));
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
      showAlert('Not available yet', 'Batch photos can’t be saved right now. Please try again later.');
      return;
    }
    showAlert(t('common.error'), friendlyError(err));
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
      showAlert(t('common.error'), friendlyError(err));
    } finally {
      requestLock.release('BusyId');
      setBusyId(null);
    }
  };

  const onAddToProductList = (batch) => {
    if (!batch.batch_photo_url) {
      showAlert(t('common.error'), 'Please add a recent photo first. Tap Edit to upload or take one.');
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
      showAlert(t('common.error'), batchPhotoState === 'uploading' ? 'Please wait for the photo to finish uploading.' : 'Please add a recent photo of this batch before saving.');
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
      showAlert(t('common.error'), 'Listed batches need a photo so retailers can see what they are ordering. Remove it from the product list first.');
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

  const openAddProduct = () => {
    setAddVegName(''); setAddPrice(''); setAddStock('');
    setAddPhotoUrl(''); setAddPhotoState('ready');
    setAddProductVisible(true);
  };

  const submitAddProduct = async () => {
    const name = addVegName.trim();
    const price = Number(addPrice);
    const stock = Number(addStock);
    if (!name) { showAlert(t('common.error'), t('stocks.vegetableNameRequired')); return; }
    if (!isVegetable(name)) { showAlert(t('common.error'), VEGETABLE_VALIDATION_MESSAGE); return; }
    if (!price || price <= 0 || !Number.isFinite(price)) { showAlert(t('common.error'), t('stocks.priceRequired')); return; }
    if (!stock || stock <= 0 || !Number.isFinite(stock)) { showAlert(t('common.error'), t('stocks.stockRequired')); return; }
    if (!addPhotoUrl || addPhotoState !== 'ready') {
      showAlert(t('common.error'), addPhotoState === 'uploading' ? 'Please wait for the recent batch photo to finish uploading.' : t('stocks.photoRequired'));
      return;
    }
    if (!requestLock.acquire('addProduct')) return;
    setAddBusy(true);
    try {
      const { product } = await api.post('/api/products', {
        vegetable_name: name, price_per_kg: price, stock_kg: stock, batch_photo_url: addPhotoUrl,
      });
      beginRead('loadBatches');
      setBatches((prev) => [product, ...prev]);
      setAddProductVisible(false);
      showAlert(t('common.success'), t('stocks.addProductSuccess'));
    } catch (err) {
      showBatchPhotoError(err);
    } finally {
      requestLock.release('addProduct');
      setAddBusy(false);
    }
  };

  // Trailing badge matches the prototype's per-segment badge: Batches shows
  // whether the required batch photo has been captured yet; Products shows
  // the retailer-facing stock level. Both are derived from fields already
  // on the record — no new data.
  const renderBadge = (b) => {
    if (isListable(b.status)) {
      return <StatusBadge status={b.batch_photo_url ? 'completed' : 'pending'} label={b.batch_photo_url ? t('stocks.photoCaptured') : t('stocks.photoMissing')} />;
    }
    const isLowStock = b.stock_kg != null && b.stock_kg <= 10 && b.stock_kg > 0;
    return (
      <StatusBadge
        status={b.status === 'sold_out' ? 'cancelled' : isLowStock ? 'pending' : 'active'}
        label={b.status === 'sold_out' ? t('stocks.statusSoldOut') : isLowStock ? t('stocks.statusLowStock') : t('stocks.statusActive')}
      />
    );
  };

  // List rows always use the vegetable illustration; the distributor's
  // uploaded photo is shown in the View / Edit modal instead.
  const renderTile = (b, large = false) => {
    const tile = getVegetableTile(b.vegetable_name);
    return (
      <View style={[large ? styles.tileLg : styles.tile, { backgroundColor: tile.bg }]}>
        <VegetableImage source={tile.source} style={large ? styles.tileIconLg : styles.tileIcon} fallbackSize={rf(large ? 26 : 20)} />
      </View>
    );
  };

  const renderDetails = (b) => (
    <>
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
    </>
  );

  const renderItem = ({ item: b }) => {
    const busy = busyId != null;
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          {renderTile(b)}
          <Text style={[styles.product, { flex: 1 }]} numberOfLines={1}>{localizeVegetableName(b.vegetable_name, language)}</Text>
          {renderBadge(b)}
        </View>

        {renderDetails(b)}

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
          <Text style={styles.editBtnText}>{isListable(b.status) ? t('common.edit') : 'View / Edit'}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader
        title={t('stocks.title')}
        right={
          <TouchableOpacity
            onPress={openAddProduct}
            accessibilityRole="button"
            accessibilityLabel={t('stocks.addProductBtn')}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.addProductBtn}
          >
            <Text style={styles.addProductBtnText}>+</Text>
          </TouchableOpacity>
        }
      />

      <SegmentedTabs
        style={styles.segmented}
        value={seg}
        onChange={setSeg}
        options={[
          { value: 'batches', label: t('stocks.batchesSegLabel') },
          { value: 'products', label: t('stocks.productsSegLabel') },
        ]}
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={PRIMARY} />
        </View>
      ) : (
        <FlatList
          data={batches.filter((b) => (seg === 'batches' ? isListable(b.status) : !isListable(b.status)))}
          keyExtractor={(b) => String(b.id)}
          renderItem={renderItem}
          contentContainerStyle={[styles.content, { paddingBottom: navSpace }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <EmptyState
              iconElement={<MaterialCommunityIcons name="package-variant" size={rf(44)} color={colors.inkFaint} />}
              title={seg === 'batches' ? t('stocks.emptyTitleBatches') : t('stocks.emptyTitleProducts')}
              message={t('stocks.emptyMessage')}
            />
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
          placeholder={t('stocks.priceLabel')} placeholderTextColor={colors.placeholder}
          keyboardType="decimal-pad"
        />
      </CustomModal>

      <CustomModal
        visible={!!editingBatch}
        title={isListable(editingBatch?.status) ? 'Edit Batch' : 'View / Edit Product'}
        confirmLabel={isListable(editingBatch?.status) ? 'Save Batch' : 'Save Changes'}
        onConfirm={saveBatchPhoto}
        onCancel={() => setEditingBatch(null)}
        busy={photoBusy}
      >
        {!!editingBatch && (
          <View style={styles.detailCard}>
            <View style={styles.cardHeader}>
              {renderTile(editingBatch, true)}
              <Text style={[styles.product, { flex: 1 }]} numberOfLines={2}>{localizeVegetableName(editingBatch.vegetable_name, language)}</Text>
              {renderBadge(editingBatch)}
            </View>
            {renderDetails(editingBatch)}
          </View>
        )}
        <BatchPhotoField label={t('stocks.batchPhotoLabel')} value={batchPhotoUrl} onChange={setBatchPhotoUrl} onStateChange={setBatchPhotoState} disabled={photoBusy} />
        {!isListable(editingBatch?.status) && <>
          <Text style={styles.editPriceLabel}>{t('productList.priceLabel')}</Text>
          <TextInput style={styles.priceInput} value={editPriceInput} onChangeText={setEditPriceInput} placeholder={t('stocks.priceLabel')} placeholderTextColor={colors.placeholder} keyboardType="decimal-pad" editable={!photoBusy} />
        </>}
        {!!batchPhotoUrl && isListable(editingBatch?.status) && <TouchableOpacity onPress={removeBatchPhoto} disabled={photoBusy} style={styles.removePhotoBtn}>
          <Text style={styles.removePhotoText}>Remove photo</Text>
        </TouchableOpacity>}
      </CustomModal>

      <CustomModal
        visible={addProductVisible}
        title={t('stocks.addProductModalTitle')}
        confirmLabel={t('stocks.addProductBtn')}
        onConfirm={submitAddProduct}
        onCancel={() => setAddProductVisible(false)}
        busy={addBusy}
      >
        <Text style={styles.editPriceLabel}>{t('stocks.vegetableNameLabel')}</Text>
        <TextInput
          style={styles.priceInput}
          value={addVegName}
          onChangeText={setAddVegName}
          placeholder={t('stocks.vegetableNamePlaceholder')} placeholderTextColor={colors.placeholder}
          editable={!addBusy}
        />
        <Text style={styles.editPriceLabel}>{t('stocks.priceLabel')}</Text>
        <TextInput
          style={styles.priceInput}
          value={addPrice}
          onChangeText={setAddPrice}
          placeholder={t('stocks.priceLabel')}
          keyboardType="decimal-pad"
          editable={!addBusy}
        />
        <Text style={styles.editPriceLabel}>{t('stocks.stockLabel')}</Text>
        <TextInput
          style={styles.priceInput}
          value={addStock}
          onChangeText={setAddStock}
          placeholder={t('stocks.stockLabel')} placeholderTextColor={colors.placeholder}
          keyboardType="decimal-pad"
          editable={!addBusy}
        />
        <BatchPhotoField label={t('stocks.batchPhotoLabel')} value={addPhotoUrl} onChange={setAddPhotoUrl} onStateChange={setAddPhotoState} disabled={addBusy} />
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

  addProductBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: PRIMARY, alignItems: 'center', justifyContent: 'center' },
  addProductBtnText: { color: '#fff', fontSize: rf(fontSize.title), fontFamily: fonts.bodySemiBold, lineHeight: rf(22), textAlign: 'center' },

  // Same spacing as the other Distributor filter tabs.
  segmented: { marginHorizontal: spacing.lg, marginTop: spacing.lg, marginBottom: 0 },

  card: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 14, marginBottom: 12, ...shadowCard },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'space-between', marginBottom: 8 },
  tile: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tileIcon: { width: 34, height: 34 },
  tileLg: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  tileIconLg: { width: 40, height: 40 },
  detailCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.ctrl, padding: 12, marginBottom: 14 },
  product: { fontSize: rf(fontSize.lg), fontFamily: fonts.bodySemiBold, color: colors.ink },

  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  label: { fontSize: rf(fontSize.sm), color: colors.inkFaint },
  value: { fontSize: rf(fontSize.sm), color: colors.ink, fontFamily: fonts.bodySemiBold },

  addBtn: { marginTop: 10, backgroundColor: PRIMARY, borderRadius: radius.ctrl, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', minHeight: control.height  },
  addBtnDisabled: { opacity: 0.6 },
  addBtnText: { color: '#fff', fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.md), textAlign: 'center' },
  editBtn: { marginTop: 8, borderWidth: 1, borderColor: PRIMARY, borderRadius: radius.ctrl, paddingVertical: 9, alignItems: 'center', justifyContent: 'center', minHeight: control.height  },
  editBtnText: { color: PRIMARY, fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.md), textAlign: 'center' },

  modalHint: { fontSize: rf(fontSize.sm), color: colors.inkFaint, marginBottom: 10 },
  priceInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.ctrl, paddingHorizontal: 12, paddingVertical: 10, fontSize: rf(fontSize.lg) },
  editPriceLabel: { fontFamily: fonts.bodySemiBold, color: colors.ink, marginTop: 14, marginBottom: 7 },
  removePhotoBtn: { alignSelf: 'flex-start', marginTop: 4, paddingVertical: 6, minHeight: control.heightSm },
  removePhotoText: { fontFamily: fonts.bodySemiBold, color: colors.danger, fontSize: rf(fontSize.sm) },
});
