import useLatestRequest from '../hooks/useLatestRequest';
import useRefreshOnFocus from '../hooks/useRefreshOnFocus';
import useRequestLock from '../hooks/useRequestLock';
import useStockAlerts from '../hooks/useStockAlerts';
import { rf } from '../lib/responsive';
import { useState, useEffect, useCallback } from 'react';
import {
  Text, View, FlatList, TouchableOpacity,
  ActivityIndicator, StyleSheet, RefreshControl, } from 'react-native';
import TextInput from '../components/AppTextInput';
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
import { colors, control, fontSize, fonts, radius, shadowCard, spacing, actionBtn, actionBtnOutline, actionBtnDanger, actionBtnText } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { localizeVegetableName, vegetableKey } from '../lib/vegetableNames';
import { isVegetable } from '../lib/vegetables';
import { getVegetableTile } from '../lib/vegetableIcons';
import VegetableImage from '../components/VegetableImage';
import BatchDateField from '../components/BatchDateField';
import { titleCaseWords } from '../lib/textFormat';

const PRIMARY = colors.leaf700;

const DISTRIBUTOR_TABS_KEYS = [
  { id: 'home', iconName: 'home-outline', labelKey: 'dashboards.distributor.tabHome' },
  { id: 'orders', iconName: 'clipboard-outline', labelKey: 'dashboards.distributor.tabOrders' },
  { id: 'stocks', iconName: 'archive-outline', labelKey: 'dashboards.distributor.tabStocks' },
  { id: 'inventory', iconName: 'cube-outline', labelKey: 'dashboards.distributor.tabInventory' },
  { id: 'profile', iconName: 'person-outline', labelKey: 'dashboards.distributor.tabProfile' },
];

export default function StocksScreen({ navigation, route }) {
  const navSpace = useBottomNavSpace();
  const beginRead = useLatestRequest();
  const requestLock = useRequestLock();
  const { t, tc, language } = useTranslation();
  const DISTRIBUTOR_TABS = DISTRIBUTOR_TABS_KEYS.map((tab) => ({ ...tab, label: t(tab.labelKey) }));
  const handleBottomTabPress = (tab) => {
    if (tab.id === 'stocks') return;
    if (tab.id === 'inventory') navigation.navigate('DistributorInventoryReport');
    else if (tab.id === 'profile') navigation.navigate('Profile');
    else if (tab.id === 'orders') navigation.navigate('DistributorDashboard', { tab: 'orders' });
    else if (tab.id === 'home') navigation.navigate('DistributorDashboard', { tab: 'home' });
  };
  const [seg, setSeg] = useState('batches');
  const stockAlerts = useStockAlerts();
  const alertFor = (b) => stockAlerts.alerts.find((alert) => alert.batch_id === b.id);
  // Home's Stock Alert shortcut opens Stocks showing only the alerted batches.
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [batches, setBatches] = useState([]);
  // Batch waiting for the Discard confirmation.
  const [discarding, setDiscarding] = useState(null);
  const [discardBusy, setDiscardBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const [priceBatch, setPriceBatch] = useState(null);
  const [priceInput, setPriceInput] = useState('');
  const [priceBusy, setPriceBusy] = useState(false);
  const [editingBatch, setEditingBatch] = useState(null);
  const [batchPhotoUrl, setBatchPhotoUrl] = useState('');
  const [batchPhotoState, setBatchPhotoState] = useState('ready');
  const [editPriceInput, setEditPriceInput] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);

  const [addProductVisible, setAddProductVisible] = useState(false);
  const [addVegName, setAddVegName] = useState('');
  const [addPrice, setAddPrice] = useState('');
  const [addStock, setAddStock] = useState('');
  const [addFarmerName, setAddFarmerName] = useState('');
  const [addHarvestDate, setAddHarvestDate] = useState('');
  const [addPickupDate, setAddPickupDate] = useState('');
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
    await Promise.all([loadBatches(), stockAlerts.reload()]);
    setRefreshing(false);
  };

  const isListable = (status) => status == null || status === 'received';
  const hasStock = (b) => Number.isFinite(Number(b.stock_kg)) && Number(b.stock_kg) > 0;
  // All batches of a vegetable share the current listed price.
  const onSaleSibling = (name) => batches.find(
    (b) => b.status === 'listed' && hasStock(b) && vegetableKey(b.vegetable_name) === vegetableKey(name)
  );
  const showBatchPhotoError = (err) => {
    if (err?.status === 404) {
      showAlert(t('cmp2.notAvailableYet'), t('cmp2.batchPhotoCantSave'));
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
      showAlert(t('common.error'), t('cmp2.photoFirst'));
      return;
    }
    const sibling = onSaleSibling(batch.vegetable_name);
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

  const showStockAlerts = route?.params?.showStockAlerts;
  useEffect(() => {
    if (!showStockAlerts) return;
    setAlertsOnly(true);
    navigation.setParams?.({ showStockAlerts: undefined });
  }, [showStockAlerts]);

  // Discard: all remaining stock of the batch goes to Spoiled Products. It is no
  // longer sold and does not return to Stocks.
  const confirmDiscard = async () => {
    if (!discarding || !requestLock.acquire('discard')) return;
    setDiscardBusy(true);
    try {
      const result = await api.post(`/api/products/${discarding.id}/discard`);
      setDiscarding(null);
      await Promise.all([loadBatches(), stockAlerts.reload()]);
      showAlert(t('discard.doneTitle'), result?.spoilage?.reason === 'past_limit' ? t('discard.pastLimitMessage') : t('discard.doneMessage'));
    } catch (err) {
      showAlert(t('common.error'), friendlyError(err));
      await loadBatches();
    } finally {
      requestLock.release('discard');
      setDiscardBusy(false);
    }
  };
  const saveBatchPhoto = async () => {
    if (!batchPhotoUrl || batchPhotoState !== 'ready') {
      showAlert(t('common.error'), batchPhotoState === 'uploading' ? t('cmp2.photoWait') : t('cmp2.photoBeforeSave'));
      return;
    }
    const canEditPrice = editingBatch?.status === 'listed';
    const price = Number(editPriceInput);
    if (canEditPrice && (!Number.isFinite(price) || price <= 0)) {
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
      showAlert(t('common.error'), t('cmp2.listedNeedPhoto'));
      return;
    }
    confirmAction(t('cmp2.removeBatchPhotoTitle'), t('cmp2.removeBatchPhotoMsg'), async () => {
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
    if (!Number.isFinite(price) || price <= 0) {
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
    setAddVegName(''); setAddPrice(''); setAddStock(''); setAddFarmerName('');
    setAddHarvestDate(''); setAddPickupDate('');
    setAddPhotoUrl(''); setAddPhotoState('ready');
    setAddProductVisible(true);
  };

  const changeHarvestDate = (day) => {
    setAddHarvestDate(day);
    if (addPickupDate && addPickupDate < day) setAddPickupDate('');
  };

  const addSibling = isVegetable(addVegName.trim()) ? onSaleSibling(addVegName.trim()) : null;

  const submitAddProduct = async () => {
    const name = addVegName.trim();
    const price = addSibling ? Number(addSibling.price_per_kg) : Number(addPrice);
    const stock = Number(addStock);
    if (!name) { showAlert(t('common.error'), t('stocks.vegetableNameRequired')); return; }
    if (!isVegetable(name)) { showAlert(t('common.error'), t('dashboards.farmer.vegetableOnlyValidation')); return; }
    if (!price || price <= 0 || !Number.isFinite(price)) { showAlert(t('common.error'), t('stocks.priceRequired')); return; }
    if (!stock || stock <= 0 || !Number.isFinite(stock)) { showAlert(t('common.error'), t('stocks.stockRequired')); return; }
    if (!addHarvestDate) { showAlert(t('common.error'), t('stocks.harvestDateRequired')); return; }
    if (!addPickupDate) { showAlert(t('common.error'), t('stocks.pickupDateRequired')); return; }
    if (addPickupDate < addHarvestDate) { showAlert(t('common.error'), t('stocks.pickupBeforeHarvest')); return; }
    if (!addPhotoUrl || addPhotoState !== 'ready') {
      showAlert(t('common.error'), addPhotoState === 'uploading' ? t('cmp2.photoWaitRecent') : t('stocks.photoRequired'));
      return;
    }
    if (!requestLock.acquire('addProduct')) return;
    setAddBusy(true);
    try {
      const { product } = await api.post('/api/products', {
        vegetable_name: name, price_per_kg: price, stock_kg: stock, batch_photo_url: addPhotoUrl,
        // Optional; the backend stores a blank name as empty.
        farmer_name: addFarmerName.trim() || null, harvest_date: addHarvestDate, pickup_date: addPickupDate,
      });
      beginRead('loadBatches');
      setBatches((prev) => [{ ...product, farmer_name: product.farmer_name || null }, ...prev]);
      setAddProductVisible(false);
      showAlert(t('common.success'), t('stocks.addProductSuccess'));
    } catch (err) {
      showBatchPhotoError(err);
    } finally {
      requestLock.release('addProduct');
      setAddBusy(false);
    }
  };

  const renderBadge = (b) => {
    // Past the 7-day limit: kept in stock, not sold, waiting for the distributor.
    if (b.past_limit) return <StatusBadge status="pending" label={t('stocks.statusNeedsReview')} />;
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
      {b.days_in_stock != null && (
        <View style={styles.row}>
          <Text style={styles.label}>{t('stocks.daysInStock')}</Text>
          <Text style={[styles.value, b.days_in_stock >= 7 && styles.valueWarning]}>
            {b.past_limit ? t('stocks.pastLimit') : b.days_in_stock >= 7 ? t('stocks.lastDayToSell') : t('stocks.daysOfSeven', { days: b.days_in_stock })}
          </Text>
        </View>
      )}
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
    const alert = alertFor(b);
    return (
      <View style={[styles.card, alert && styles.cardAlert]}>
        {!!alert && (
          <View style={styles.alertStrip}>
            <Ionicons name="alert-circle" size={rf(16)} color={colors.gold700} />
            <Text style={styles.alertStripText}>{alert.past_limit ? t('stockAlerts.pastLimitTitle') : t('stockAlerts.title')}</Text>
          </View>
        )}
        <View style={styles.cardHeader}>
          {renderTile(b)}
          <Text style={[styles.product, { flex: 1 }]} numberOfLines={1}>{localizeVegetableName(b.vegetable_name, language)}</Text>
          {renderBadge(b)}
        </View>

        {renderDetails(b)}

        {isListable(b.status) && !b.past_limit && (
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
        <View style={styles.cardActions}>
          <TouchableOpacity style={[styles.editBtn, styles.cardAction]} onPress={() => openEdit(b)} disabled={busy}>
            <Text style={styles.editBtnText}>{isListable(b.status) ? t('common.edit') : t('stocks.viewEditBtn')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.discardBtn, styles.cardAction]} onPress={() => setDiscarding(b)} disabled={busy}
            accessibilityRole="button" accessibilityLabel={t('discard.button')}>
            <Text style={styles.discardBtnText}>{t('discard.button')}</Text>
          </TouchableOpacity>
        </View>
        {/* Keep Selling is for the last sellable day; past the limit only Discard remains. */}
        {!!alert && !alert.past_limit && (
          <TouchableOpacity style={styles.keepBtn} onPress={() => stockAlerts.keep(b.id)} disabled={busy} accessibilityRole="button">
            <Text style={styles.keepBtnText}>{t('stockAlerts.keepSelling')}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  // The filter ends by itself once every alerted batch is resolved.
  const alertedBatches = batches.filter((b) => hasStock(b) && alertFor(b));
  const filteringAlerts = alertsOnly && (!stockAlerts.loaded || alertedBatches.length > 0);
  const listData = filteringAlerts
    ? alertedBatches
    : batches.filter((b) => hasStock(b) && (seg === 'batches' ? isListable(b.status) : b.status === 'listed'));
  useEffect(() => {
    if (alertsOnly && stockAlerts.loaded && !loading && alertedBatches.length === 0) setAlertsOnly(false);
  }, [alertsOnly, stockAlerts.loaded, loading, alertedBatches.length]);

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

      {filteringAlerts ? (
        <View style={styles.alertBanner} accessibilityRole="summary">
          <View style={styles.alertBannerHead}>
            <Ionicons name="alert-circle-outline" size={rf(20)} color={colors.gold700} />
            <Text style={styles.alertBannerTitle}>{tc('stockAlerts.needAttention', alertedBatches.length)}</Text>
          </View>
          <Text style={styles.alertBannerText}>{t('stockAlerts.subtitle')}</Text>
          <TouchableOpacity onPress={() => setAlertsOnly(false)} accessibilityRole="button" style={styles.showAllBtn}>
            <Text style={styles.showAllText}>{t('stockAlerts.showAll')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <SegmentedTabs
          style={styles.segmented}
          value={seg}
          onChange={setSeg}
          options={[
            { value: 'batches', label: t('stocks.batchesSegLabel') },
            { value: 'products', label: t('stocks.productsSegLabel') },
          ]}
        />
      )}

      {loading || (filteringAlerts && !stockAlerts.loaded) ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={PRIMARY} />
        </View>
      ) : (
        <FlatList
          data={listData}
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
        visible={!!discarding}
        title={t('discard.title')}
        confirmLabel={t('discard.button')}
        onConfirm={confirmDiscard}
        cancelLabel={t('common.cancel')}
        onCancel={() => setDiscarding(null)}
        busy={discardBusy}
        danger
      >
        {!!discarding && (
          <Text style={styles.discardText}>
            {t('discard.confirm', { kg: Number(discarding.stock_kg), name: localizeVegetableName(discarding.vegetable_name, language) })}
          </Text>
        )}
      </CustomModal>

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
        title={isListable(editingBatch?.status) ? t('cmp2.editBatch') : t('cmp2.viewEditProduct')}
        confirmLabel={isListable(editingBatch?.status) ? t('cmp2.saveBatch') : t('cmp2.saveChanges')}
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
          <Text style={styles.removePhotoText}>{t('cmp.removePhoto')}</Text>
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
                    autoCapitalize="words"
          onChangeText={(v) => setAddVegName(titleCaseWords(v))}
          placeholder={t('stocks.vegetableNamePlaceholder')} placeholderTextColor={colors.placeholder}
          editable={!addBusy}
        />
        <Text style={styles.editPriceLabel}>{t('stocks.priceLabel')}</Text>
        <TextInput
          style={[styles.priceInput, addSibling && styles.inputLocked]}
          value={addSibling ? String(addSibling.price_per_kg) : addPrice}
          onChangeText={setAddPrice}
          placeholder={t('stocks.priceLabel')}
          keyboardType="decimal-pad"
          editable={!addBusy && !addSibling}
        />
        {!!addSibling && <Text style={styles.fieldHint}>{t('stocks.priceSharedHint')}</Text>}
        <Text style={styles.editPriceLabel}>{t('stocks.stockLabel')}</Text>
        <TextInput
          style={styles.priceInput}
          value={addStock}
          onChangeText={setAddStock}
          placeholder={t('stocks.stockLabel')} placeholderTextColor={colors.placeholder}
          keyboardType="decimal-pad"
          editable={!addBusy}
        />

        <Text style={styles.editPriceLabel}>{t('stocks.farmerName')}</Text>
        <TextInput
          style={styles.priceInput}
          value={addFarmerName}
          onChangeText={setAddFarmerName}
          placeholder={t('stocks.farmerPlaceholder')} placeholderTextColor={colors.placeholder}
          autoCapitalize="words"
          maxLength={120}
          editable={!addBusy}
        />

        <Text style={styles.editPriceLabel}>{t('stocks.harvestDate')}</Text>
        <BatchDateField value={addHarvestDate} onChange={changeHarvestDate} disabled={addBusy} />
        <Text style={styles.editPriceLabel}>{t('stocks.pickupDate')}</Text>
        <BatchDateField value={addPickupDate} onChange={setAddPickupDate} minDate={addHarvestDate || undefined} disabled={addBusy} />

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

  segmented: { marginHorizontal: spacing.lg, marginTop: spacing.lg, marginBottom: 0 },

  card: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.border, ...shadowCard },
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
  editBtn: { ...actionBtn, ...actionBtnOutline, marginTop: 8 },
  editBtnText: { ...actionBtnText, color: PRIMARY },
  cardActions: { flexDirection: 'row', gap: spacing.sm },
  cardAction: { flex: 1 },
  discardBtn: { ...actionBtn, ...actionBtnDanger, marginTop: 8 },
  discardBtnText: { ...actionBtnText, color: colors.danger },
  valueWarning: { color: colors.gold700, fontFamily: fonts.bodyBold },

  cardAlert: { borderColor: colors.gold500, borderWidth: 1.5, backgroundColor: colors.gold100 },
  alertStrip: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  alertStripText: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.sm), color: colors.gold700 },
  keepBtn: { ...actionBtn, ...actionBtnOutline, marginTop: 8 },
  keepBtnText: { ...actionBtnText, color: PRIMARY },
  alertBanner: {
    marginHorizontal: spacing.lg, marginTop: spacing.lg, padding: 14, borderRadius: radius.card,
    backgroundColor: colors.gold100, borderWidth: 1, borderColor: colors.gold500,
  },
  alertBannerHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  alertBannerTitle: { flex: 1, fontFamily: fonts.bodyBold, fontSize: rf(fontSize.lg), color: colors.ink },
  alertBannerText: { fontFamily: fonts.body, fontSize: rf(fontSize.sm), color: colors.inkSoft, marginTop: 4 },
  showAllBtn: { alignSelf: 'flex-start', marginTop: 8, paddingVertical: 6, minHeight: control.heightSm, justifyContent: 'center' },
  showAllText: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), color: PRIMARY },

  modalHint: { fontSize: rf(fontSize.sm), color: colors.inkFaint, marginBottom: 10 },
  discardText: { fontFamily: fonts.body, fontSize: rf(fontSize.md), color: colors.ink, lineHeight: rf(21) },
  priceInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.ctrl, paddingHorizontal: 12, paddingVertical: 10, fontSize: rf(fontSize.lg) },
  editPriceLabel: { fontFamily: fonts.bodySemiBold, color: colors.ink, marginTop: 14, marginBottom: 7 },
  inputLocked: { backgroundColor: colors.bgScreen, color: colors.inkSoft },
  fieldHint: { fontSize: rf(fontSize.sm), color: colors.inkFaint, marginTop: 6 },
  removePhotoBtn: { alignSelf: 'flex-start', marginTop: 4, paddingVertical: 6, minHeight: control.heightSm },
  removePhotoText: { fontFamily: fonts.bodySemiBold, color: colors.danger, fontSize: rf(fontSize.sm) },
});
