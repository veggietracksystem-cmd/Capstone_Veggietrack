import { rf } from '../lib/responsive';
import { useState, useEffect, useCallback } from 'react';
import {
  Text, View, FlatList, ScrollView, TouchableOpacity, Modal,
  ActivityIndicator, StyleSheet, RefreshControl, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../api/client';
import EmptyState from '../components/EmptyState';
import { showAlert, confirmAction, peso } from '../lib/ui';
import { CATEGORIES, getCategory } from '../lib/vegetables';
import { getVegetableTile } from '../lib/vegetableIcons';
import { localizeVegetableName } from '../lib/vegetableNames';
import { colors, fonts, radius, shadowCard } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';

const PRIMARY = colors.leaf700;

export default function ProductListScreen({ navigation }) {
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
    try {
      const data = await api.get('/api/products/listings');
      setListings(Array.isArray(data) ? data : []);
    } catch (err) {
      showAlert(t('common.error'), err.message);
    }
  }, [t]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadListings();
      setLoading(false);
    })();
  }, [loadListings]);

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
    setSavingPrice(true);
    try {
      // Any batch of this vegetable works — the backend cascades the price
      // change across every listed/sold-out batch sharing the name.
      await api.put(`/api/products/${activeListing.id}`, { price_per_kg: priceNum });
      await loadListings();
    } catch (err) {
      showAlert(t('common.error'), err.message);
    } finally {
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
    setSavingQty(true);
    try {
      await api.put(`/api/products/${activeListing.id}/reduce-quantity`, { new_total_kg: qtyNum });
      await loadListings();
    } catch (err) {
      showAlert(t('common.error'), err.message);
    } finally {
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
        setRemoving(true);
        try {
          await api.put(`/api/products/${target.id}/unlist`);
          await loadListings();
        } catch (err) {
          showAlert(t('common.error'), err.message || t('productList.removeFailed'));
        } finally {
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
          <Text style={styles.productTileIcon}>{tile.icon}</Text>
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
        <TouchableOpacity style={styles.smallBtn} onPress={() => openEditModal(l)}>
          <Text style={styles.smallBtnText}>{t('productList.editBtn')}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const modalTile = activeListing ? getVegetableTile(activeListing.vegetable_name) : null;
  const modalIsSoldOut = activeListing?.status === 'Sold Out';

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.back}>‹ {t('common.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('productList.title')}</Text>
        <View style={{ width: 50 }} />
      </View>

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
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filterChipRow}
              >
                {CATEGORIES.map((c) => (
                  <TouchableOpacity
                    key={c}
                    style={[styles.filterChip, category === c && styles.filterChipActive]}
                    onPress={() => setCategory(c)}
                  >
                    <Text style={[styles.filterChipText, category === c && styles.filterChipTextActive]}>
                      {t(`categories.${c}`)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )
          }
          ListEmptyComponent={
            <EmptyState
              icon="📦"
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
        <View style={styles.modalBackdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={closeEditModal} />

          <View style={styles.modalCard}>
            <TouchableOpacity
              style={styles.modalCloseBtn}
              onPress={closeEditModal}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.modalCloseText}>✕</Text>
            </TouchableOpacity>

            {activeListing ? (
              <>
                <View style={styles.modalHeader}>
                  <View style={[styles.productTile, styles.modalTile, { backgroundColor: modalTile.bg }]}>
                    <Text style={styles.modalTileIcon}>{modalTile.icon}</Text>
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
                    disabled={savingPrice}
                  >
                    {savingPrice ? <ActivityIndicator size="small" color={PRIMARY} /> : <Text style={styles.smallBtnText}>{t('common.save')}</Text>}
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={[styles.removeBtn, removing && styles.btnDisabled]}
                  onPress={removeProduct}
                  disabled={removing}
                >
                  {removing
                    ? <ActivityIndicator size="small" color={colors.danger} />
                    : <Text style={styles.removeBtnText}>{t('productList.removeBtn')}</Text>}
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 16, paddingBottom: 40, flexGrow: 1 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  back: { color: PRIMARY, fontSize: rf(16), fontWeight: '600', width: 50 },
  title: { fontSize: rf(20), fontWeight: 'bold', color: PRIMARY },

  filterChipRow: { gap: 8, paddingBottom: 16 },
  filterChip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: '#ccc', backgroundColor: '#f8faf8' },
  filterChipActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  filterChipText: { color: '#555', fontSize: rf(13) },
  filterChipTextActive: { color: '#fff', fontWeight: '600' },

  rowCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderRadius: radius.card, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.border, ...shadowCard },
  productTile: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  productTileIcon: { fontSize: rf(22) },
  rowTitle: { fontFamily: fonts.bodyBold, fontSize: rf(16), color: colors.ink, textTransform: 'capitalize' },
  rowMeta: { fontFamily: fonts.body, fontSize: rf(13.5), color: colors.inkSoft, marginTop: 2 },

  smallBtn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: radius.ctrl, borderWidth: 1.4, borderColor: PRIMARY, alignItems: 'center', justifyContent: 'center' },
  smallBtnText: { fontFamily: fonts.bodySemiBold, color: PRIMARY, fontSize: rf(13) },
  btnDisabled: { opacity: 0.5 },

  // Edit modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(20,17,16,0.42)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: { width: '100%', maxWidth: 380, backgroundColor: colors.bgScreen, borderRadius: radius.card, padding: 22, ...shadowCard },
  modalCloseBtn: { position: 'absolute', top: 14, right: 14, width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.leaf50, zIndex: 1 },
  modalCloseText: { fontFamily: fonts.bodyBold, fontSize: rf(15), color: colors.inkSoft },

  modalHeader: { alignItems: 'center', marginBottom: 18, marginTop: 4 },
  modalTile: { width: 60, height: 60, borderRadius: 16, marginBottom: 10 },
  modalTileIcon: { fontSize: rf(30) },
  modalVegName: { fontFamily: fonts.headingBold, fontSize: rf(18), color: colors.ink, textTransform: 'capitalize', textAlign: 'center' },

  modalLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(13), color: colors.inkSoft, marginTop: 12, marginBottom: 6 },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modalInput: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.ctrl, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.body, fontSize: rf(14), color: colors.ink, backgroundColor: colors.card },
  modalInputDisabled: { opacity: 0.5 },

  removeBtn: { marginTop: 22, borderWidth: 1.4, borderColor: colors.danger, borderRadius: radius.ctrl, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  removeBtnText: { fontFamily: fonts.bodySemiBold, color: colors.danger, fontSize: rf(14) },
});
