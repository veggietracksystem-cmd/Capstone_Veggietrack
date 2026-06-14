import { useState, useEffect, useCallback } from 'react';
import {
  Text, View, FlatList, TouchableOpacity,
  ActivityIndicator, StyleSheet, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../api/client';
import EmptyState from '../components/EmptyState';
import { showAlert, confirmAction, peso } from '../lib/ui';

const PRIMARY = '#2e7d32';

export default function ProductListScreen({ navigation }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const loadProducts = useCallback(async () => {
    try {
      const data = await api.get('/api/products');
      setProducts(Array.isArray(data) ? data : []);
    } catch (err) {
      showAlert('Error', err.message);
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
      'Delete Product',
      `Remove ${product.vegetable_name} from your inventory? This can’t be undone.`,
      async () => {
        setBusyId(product.id);
        try {
          await api.delete(`/api/products/${product.id}`);
          setProducts((prev) => prev.filter((p) => p.id !== product.id));
        } catch (err) {
          showAlert('Error', err.message);
        } finally {
          setBusyId(null);
        }
      }
    );
  };

  const renderItem = ({ item: p }) => {
    const busy = busyId === p.id;
    return (
      <View style={styles.rowCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>{p.vegetable_name}</Text>
          <Text style={styles.rowMeta}>{peso(p.price_per_kg)} / kg · {p.stock_kg} kg in stock</Text>
        </View>
        <View style={styles.rowActions}>
          <TouchableOpacity style={styles.smallBtn} onPress={() => editProduct(p)} disabled={busy}>
            <Text style={styles.smallBtnText}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.smallBtn, styles.deleteBtn]} onPress={() => deleteProduct(p)} disabled={busy}>
            {busy
              ? <ActivityIndicator color="#c62828" size="small" />
              : <Text style={styles.deleteBtnText}>Delete</Text>}
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
          <Text style={styles.back}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>All Products</Text>
        <View style={{ width: 50 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={PRIMARY} />
        </View>
      ) : (
        <FlatList
          data={products}
          keyExtractor={(p) => String(p.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <EmptyState
              icon="📦"
              title="No products yet"
              message="Add a product from your dashboard to start selling to retailers."
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

  rowCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#eee' },
  rowTitle: { fontSize: 16, fontWeight: '700', color: '#222' },
  rowMeta: { fontSize: 14, color: '#555', marginTop: 2 },

  rowActions: { flexDirection: 'row', gap: 8 },
  smallBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: PRIMARY },
  smallBtnText: { color: PRIMARY, fontWeight: '600', fontSize: 13 },
  deleteBtn: { borderColor: '#c62828' },
  deleteBtnText: { color: '#c62828', fontWeight: '600', fontSize: 13 },
});
