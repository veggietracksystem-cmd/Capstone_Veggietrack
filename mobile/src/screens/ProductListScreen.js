import useLatestRequest from '../hooks/useLatestRequest';
import useRefreshOnFocus from '../hooks/useRefreshOnFocus';
import useRequestLock from '../hooks/useRequestLock';
import { rf } from '../lib/responsive';
import { useState, useEffect, useCallback } from 'react';
import {
  Text, View, FlatList, ScrollView, TouchableOpacity, Modal,
  ActivityIndicator, StyleSheet, RefreshControl, KeyboardAvoidingView, Platform,
} from 'react-native';
import TextInput from '../components/AppTextInput';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../api/client';
import EmptyState from '../components/EmptyState';
import { FilterChips } from '../components/ui/SegmentedTabs';
import ScreenHeader from '../components/ScreenHeader';
import { showAlert, confirmAction, peso } from '../lib/ui';
import { friendlyError } from '../lib/errorMessages';
import { CATEGORIES, getCategory } from '../lib/vegetables';
import { getVegetableTile } from '../lib/vegetableIcons';
import VegetableImage from '../components/VegetableImage';
import { localizeVegetableName } from '../lib/vegetableNames';
import { colors, control, fontSize, fonts, radius, shadowCard, actionBtn, actionBtnOutline } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

const PRIMARY = colors.leaf700;

export default function ProductListScreen({ navigation }) {
  const beginRead = useLatestRequest();
  const requestLock = useRequestLock();
  const { t, language } = useTranslation();
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [category, setCategory] = useState('All');

  // The listing currently open in the edit modal, addressed by vegetable
  // name so it always reflects the latest data after a reload.
  const [activeVeg, setActiveVeg] = useState(null);
  const [priceInput, setPriceInput] = useState('');
  const [qtyInput, setQtyInput] = useState('');
  const [savingPrice, setSavingPrice] = useState(false);
  const [savingQty, setSavingQty] = useState(false);
  const [removing, setRemoving] = useState(false);

  const displayedListings = category === 'All'
    ? listings
    : listings.filter((l) => getCategory(l.vegetable_name) === category);

  const activeListing = activeVeg ? listings.find((l) => l.vegetable_name === activeVeg) : null;

  const loadListings = useCallback(async () => {
    const isCurrent = beginRead('loadListings');
    try {
      const data = await api.get('/api/products/listings');
      if (!isCurrent()) return;
      setListings(Array.isArray(data) ? data : []);
    } catch (err) {
      if (!isCurrent()) return;
      showAlert(t('common.error'), friendlyError(err));
    }
  }, [t]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadListings();
      setLoading(false);
    })();
  }, [loadListings]);

  useRefreshOnFocus(loadListings);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadListings();
    setRefreshing(false);
  };

  const openEditModal = (listing) => {
    setActiveVeg(listing.vegetable_name);
    setPriceInput(String(listing.price_per_kg ?? ''));
    setQtyInput(String(listing.available_kg ?? ''));
  };

  const closeEditModal = () => {
    if (savingPrice || savingQty || removing) return;
    setActiveVeg(null);
  };

  const savePrice = async () => {
    if (!activeListing) return;
    const priceNum = parseFloat(priceInput);
    if (isNaN(priceNum) || priceNum <= 0) {
      showAlert(t('common.error'), t('dashboards.distributor.enterValidPrice'));
      return;
    }
    if (!requestLock.acquire('productEdit')) return;
    setSavingPrice(true);
    try {
      // Any batch of this vegetable works — the backend cascades the price
      // change across every listed/sold-out batch sharing the name.
      await api.put(`/api/products/${activeListing.id}`, { price_per_kg: priceNum });
      await loadListings();
    } catch (err) {
      showAlert(t('common.error'), friendlyError(err));
    } finally {
      requestLock.release('productEdit');
      setSavingPrice(false);
    }
  };

  const saveQty = async () => {
    if (!activeListing) return;
    const qtyNum = parseFloat(qtyInput);
    if (isNaN(qtyNum) || qtyNum < 0) {
      showAlert(t('common.error'), t('productList.invalidQuantity'));
      return;
    }
    if (qtyNum >= activeListing.available_kg) {
      showAlert(t('common.error'), t('productList.quantityMustBeLess', { qty: activeListing.available_kg }));
      return;
    }
    if (!requestLock.acquire('productEdit')) return;
    setSavingQty(true);
    try {
      await api.put(`/api/products/${activeListing.id}/reduce-quantity`, { new_total_kg: qtyNum });
      await loadListings();
    } catch (err) {
      showAlert(t('common.error'), friendlyError(err));
    } finally {
      requestLock.release('productEdit');
      setSavingQty(false);
    }
  };

  const removeProduct = () => {
    if (!activeListing) return;
    // Capture the target and close the edit modal *before* showing the confirm
    // dialog — stacking two native Modals (this one on top of the edit modal)
    // is unreliable on Android/iOS and can silently eat the Confirm tap.
    const target = activeListing;
    const label = localizeVegetableName(target.vegetable_name, language);
    setActiveVeg(null);
    confirmAction(
      t('productList.removeConfirmTitle'),
      t('productList.removeConfirmMessage', { name: label }),
      async () => {
        if (!requestLock.acquire('productEdit')) return;
        setRemoving(true);
        try {
          await api.put(`/api/products/${target.id}/unlist`);
          await loadListings();
        } catch (err) {
          showAlert(t('common.error'), friendlyError(err, t('productList.removeFailed')));
        } finally {
          requestLock.release('productEdit');
          setRemoving(false);
        }
      }
    );
  };

  const renderItem = ({ item: l }) => {
    const isSoldOut = l.status === 'Sold Out';
    const tile = getVegetableTile(l.vegetable_name);
    return (
      <View style={styles.rowCard}>
        <View style={[styles.productTile, { backgroundColor: tile.bg }]}>
          <VegetableImage source={tile.source} style={styles.productTileIcon} fallbackSize={rf(22)} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>{localizeVegetableName(l.vegetable_name, language)}</Text>
          <Text style={styles.rowMeta}>
            {peso(l.price_per_kg)} / kg · {isSoldOut ? (
              <Text style={{ color: colors.danger, fontWeight: '700' }}>{t('productList.outOfStock')}</Text>
            ) : (
              t('productList.kgInStock', { qty: l.available_kg })
            )}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.smallBtn}
          onPress={() => openEditModal(l)}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Text style={styles.smallBtnText}>{t('productList.editBtn')}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const modalTile = activeListing ? getVegetableTile(activeListing.vegetable_name) : null;
  const modalIsSoldOut = activeListing?.status === 'Sold Out';

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader title={t('productList.title')} onBack={() => navigation.goBack()} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={PRIMARY} />
        </View>
      ) : (
        <FlatList
          data={displayedListings}
          keyExtractor={(l) => l.vegetable_name}
          renderItem={renderItem}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListHeaderComponent={
            listings.length === 0 ? null : (
              <FilterChips
                value={category}
                onChange={setCategory}
                options={CATEGORIES.map((c) => ({ value: c, label: t(`categories.${c}`) }))}
              />
            )
          }
          ListEmptyComponent={
            <EmptyState
              iconElement={<MaterialCommunityIcons name="package-variant" size={rf(44)} color={colors.inkFaint} />}
              title={listings.length === 0
                ? t('productList.emptyTitleNone')
                : t('productList.emptyTitleFiltered', { category: t(`categories.${category}`) })}
              message={listings.length === 0
                ? t('productList.emptyMessageNoneStocks')
                : t('productList.emptyMessageFiltered')}
            />
          }
        />
      )}

      <Modal
        visible={!!activeListing}
        transparent
        animationType="fade"
        onRequestClose={closeEditModal}
      >
        <KeyboardAvoidingView style={styles.modalKav} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalBackdrop}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={closeEditModal} />

            <View style={styles.modalCard}>
              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={closeEditModal}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={rf(22)} color={colors.ink} />
              </TouchableOpacity>

              {activeListing ? (
                <ScrollView
                  style={styles.modalScroll}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                  <View style={styles.modalHeader}>
                    <View style={[styles.productTile, styles.modalTile, { backgroundColor: modalTile.bg }]}>
                      <VegetableImage source={modalTile.source} style={styles.modalTileIcon} fallbackSize={rf(30)} />
                    </View>
                    <Text style={styles.modalVegName}>{localizeVegetableName(activeListing.vegetable_name, language)}</Text>
                  </View>

                  <Text style={styles.modalLabel}>{t('productList.newQuantityLabel')}</Text>
                  <View style={styles.editRow}>
                    <TextInput
                      style={[styles.modalInput, modalIsSoldOut && styles.modalInputDisabled]}
                      value={qtyInput}
                      onChangeText={setQtyInput}
                      keyboardType="decimal-pad"
                      editable={!modalIsSoldOut && !savingQty}
                    />
                    <TouchableOpacity
                      style={[styles.smallBtn, (savingQty || modalIsSoldOut) && styles.btnDisabled]}
                      onPress={saveQty}
                      disabled={savingQty || modalIsSoldOut}
                    >
                      {savingQty ? <ActivityIndicator size="small" color={PRIMARY} /> : <Text style={styles.smallBtnText}>{t('common.save')}</Text>}
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.modalLabel}>{t('productList.priceLabel')}</Text>
                  <View style={styles.editRow}>
                    <TextInput
                      style={styles.modalInput}
                      value={priceInput}
                      onChangeText={setPriceInput}
                      keyboardType="decimal-pad"
                      editable={!savingPrice}
                    />
                    <TouchableOpacity
                      style={[styles.smallBtn, savingPrice && styles.btnDisabled]}
                      onPress={savePrice}
                      disabled={savingPrice || savingQty || removing}
                    >
                      {savingPrice ? <ActivityIndicator size="small" color={PRIMARY} /> : <Text style={styles.smallBtnText}>{t('common.save')}</Text>}
                    </TouchableOpacity>
                  </View>

                  <TouchableOpacity
                    style={[styles.removeBtn, removing && styles.btnDisabled]}
                    onPress={removeProduct}
                    disabled={savingPrice || savingQty || removing}
                  >
                    {removing
                      ? <ActivityIndicator size="small" color={colors.danger} />
                      : <Text style={styles.removeBtnText}>{t('productList.removeBtn')}</Text>}
                  </TouchableOpacity>
                </ScrollView>
              ) : null}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgScreen },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 16, paddingBottom: 40, flexGrow: 1 },


  rowCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radius.card, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.border, ...shadowCard },
  productTile: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  productTileIcon: { width: 34, height: 34 },
  rowTitle: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.lg), color: colors.ink, textTransform: 'capitalize' },
  rowMeta: { fontFamily: fonts.body, fontSize: rf(fontSize.md), color: colors.inkSoft, marginTop: 2 },

  // Matches the Distributor module's Edit action button exactly (compact
  // outlined green pill) so Edit looks the same everywhere it appears.
  smallBtn: { ...actionBtn, ...actionBtnOutline },
  smallBtnText: { fontFamily: fonts.bodySemiBold, color: PRIMARY, fontSize: rf(fontSize.sm), textAlign: 'center' },
  btnDisabled: { opacity: 0.5 },

  // Edit modal
  modalKav: { flex: 1 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(20,17,16,0.42)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: { width: '100%', maxWidth: 380, maxHeight: '90%', backgroundColor: colors.bgScreen, borderRadius: radius.card, padding: 22, ...shadowCard },
  modalScroll: { flexGrow: 0, flexShrink: 1 },
  modalCloseBtn: { position: 'absolute', top: 14, right: 14, width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.leaf50, zIndex: 1 },
  modalCloseText: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.lg), color: colors.inkSoft },

  modalHeader: { alignItems: 'center', marginBottom: 18, marginTop: 4 },
  modalTile: { width: 60, height: 60, borderRadius: 16, marginBottom: 10 },
  modalTileIcon: { width: 48, height: 48 },
  modalVegName: { fontFamily: fonts.headingBold, fontSize: rf(fontSize.xl), color: colors.ink, textTransform: 'capitalize', textAlign: 'center' },

  modalLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), color: colors.inkSoft, marginTop: 12, marginBottom: 6 },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modalInput: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.ctrl, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.body, fontSize: rf(fontSize.md), color: colors.ink, backgroundColor: colors.card },
  modalInputDisabled: { opacity: 0.5 },

  removeBtn: { marginTop: 22, borderWidth: 1.4, borderColor: colors.danger, borderRadius: radius.ctrl, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', minHeight: control.height },
  removeBtnText: { fontFamily: fonts.bodySemiBold, color: colors.danger, fontSize: rf(fontSize.md), textAlign: 'center' },
});
