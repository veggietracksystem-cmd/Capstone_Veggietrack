import { useState, useEffect, useCallback } from 'react';
import {
  Text, View, FlatList, ScrollView, TouchableOpacity,
  ActivityIndicator, StyleSheet, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../api/client';
import EmptyState from '../components/EmptyState';
import { showAlert, confirmAction, peso } from '../lib/ui';
import { CATEGORIES, getCategory } from '../lib/vegetables';
import { useTranslation } from '../i18n/useTranslation';

const PRIMARY = '#2e7d32';

export default function ProductListScreen({ navigation }) {
  const { t } = useTranslation();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [category, setCategory] = useState('All');

  const displayedProducts = category === 'All'
    ? products
    : products.filter((p) => getCategory(p.vegetable_name) === category);

  const loadProducts = useCallback(async () => {
    try {
      const data = await api.get('/api/products');
      setProducts(Array.isArray(data) ? data : []);
    } catch (err) {
      showAlert(t('common.error'), err.message);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadProducts();
      setLoading(false);
    })();
  }, [loadProducts]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadProducts();
    setRefreshing(false);
  };

  // Edit reuses the Distributor dashboard's add/edit form via a navigation param.
  const editProduct = (product) => {
    navigation.navigate('DistributorDashboard', { editProduct: product });
  };

  const deleteProduct = (product) => {
    confirmAction(
      t('productList.deleteConfirmTitle'),
      t('productList.deleteConfirmMessage', { name: product.vegetable_name }),
      async () => {
        setBusyId(product.id);
        try {
          await api.delete(`/api/products/${product.id}`);
          setProducts((prev) => prev.filter((p) => p.id !== product.id));
        } catch (err) {
          showAlert(t('common.error'), err.message);
        } finally {
          setBusyId(null);
        }
      }
    );
  };

  const renderItem = ({ item: p }) => {
    const busy = busyId === p.id;
    const isOutOfStock = Number(p.stock_kg || 0) <= 0;
    return (
      <View style={styles.rowCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>{p.vegetable_name}</Text>
          <Text style={styles.rowMeta}>
            {peso(p.price_per_kg)} / kg · {isOutOfStock ? (
              <Text style={{ color: '#c62828', fontWeight: '700' }}>{t('productList.outOfStock')}</Text>
            ) : (
              t('productList.kgInStock', { qty: p.stock_kg })
            )}
            {p.harvest_date ? `\n${t('productList.harvested', { date: new Date(p.harvest_date).toLocaleDateString() })}` : ''}
          </Text>
        </View>
        <View style={styles.rowActions}>
          <TouchableOpacity style={styles.smallBtn} onPress={() => editProduct(p)} disabled={busy}>
            <Text style={styles.smallBtnText}>{t('productList.editBtn')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.smallBtn, styles.deleteBtn]} onPress={() => deleteProduct(p)} disabled={busy}>
            {busy
              ? <ActivityIndicator color="#c62828" size="small" />
              : <Text style={styles.deleteBtnText}>{t('productList.deleteBtn')}</Text>}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

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
          data={displayedProducts}
          keyExtractor={(p) => String(p.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListHeaderComponent={
            products.length === 0 ? null : (
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
              title={products.length === 0
                ? t('productList.emptyTitleNone')
                : t('productList.emptyTitleFiltered', { category: t(`categories.${category}`) })}
              message={products.length === 0
                ? t('productList.emptyMessageNone')
                : t('productList.emptyMessageFiltered')}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 16, paddingBottom: 40, flexGrow: 1 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  back: { color: PRIMARY, fontSize: 16, fontWeight: '600', width: 50 },
  title: { fontSize: 20, fontWeight: 'bold', color: PRIMARY },

  filterChipRow: { gap: 8, paddingBottom: 16 },
  filterChip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: '#ccc', backgroundColor: '#f8faf8' },
  filterChipActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  filterChipText: { color: '#555', fontSize: 13 },
  filterChipTextActive: { color: '#fff', fontWeight: '600' },

  rowCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#eee' },
  rowTitle: { fontSize: 16, fontWeight: '700', color: '#222' },
  rowMeta: { fontSize: 14, color: '#555', marginTop: 2 },

  rowActions: { flexDirection: 'row', gap: 8 },
  smallBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: PRIMARY },
  smallBtnText: { color: PRIMARY, fontWeight: '600', fontSize: 13 },
  deleteBtn: { borderColor: '#c62828' },
  deleteBtnText: { color: '#c62828', fontWeight: '600', fontSize: 13 },
});
