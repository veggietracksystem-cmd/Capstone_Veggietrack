import { useState, useEffect, useCallback } from 'react';
import {
  Text, View, ScrollView, TextInput, TouchableOpacity, Image,
  ActivityIndicator, StyleSheet, Platform, RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import api from '../api/client';
import { readThrough } from '../offline/cache';
import { useAuth } from '../context/AuthContext';
import LogoutButton from '../components/LogoutButton';
import NotificationBell from '../components/NotificationBell';
import BottomNavBar from '../components/BottomNavBar';

const PRIMARY = '#2e7d32';

const RETAILER_TABS = [
  { id: 'home', icon: '🏠', label: 'Home' },
  { id: 'browse', icon: '🥬', label: 'Browse' },
  { id: 'orders', icon: '📦', label: 'Orders' },
  { id: 'track', icon: '🗺️', label: 'Track' },
  { id: 'profile', icon: '👤', label: 'Profile' },
];

export default function RetailerDashboard({ navigation, route }) {
  const { user } = useAuth();
  const [tab, setTab] = useState('shop'); // 'shop' | 'orders'
  const [activeBottomTab, setActiveBottomTab] = useState('home');

  const handleBottomTabPress = (t) => {
    setActiveBottomTab(t.id);
    if (t.id === 'profile') {
      navigation.navigate('Profile');
    } else if (t.id === 'browse') {
      setTab('shop');
    } else if (t.id === 'orders') {
      setTab('orders');
    } else if (t.id === 'track') {
      setTab('orders');
    } else if (t.id === 'home') {
      setTab('shop');
    }
  };

  useEffect(() => {
    if (route.params?.tab) {
      setTab(route.params.tab);
    }
  }, [route.params?.tab]);

  // ----- Products + cart -----
  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [searchQuery, setSearchQuery] = useState(''); // filters the product list locally
  const [cart, setCart] = useState([]); // { product_id, name, price, quantity, stock }
  const [address, setAddress] = useState('');
  const [schedule, setSchedule] = useState(''); // ISO-ish "YYYY-MM-DDTHH:mm" from SchedulePicker
  const [placing, setPlacing] = useState(false);

  // Issue 10: pre-fill the delivery address with the retailer's store_location
  // from registration. Runs once when it becomes available; the field stays
  // editable so the user can override it for a one-off delivery.
  useEffect(() => {
    if (user?.store_location && !address) {
      setAddress(user.store_location);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.store_location]);

  // ----- My orders -----
  const [orders, setOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(true);

  const [refreshing, setRefreshing] = useState(false);
  const [shopOffline, setShopOffline] = useState(false);
  const [ordersOffline, setOrdersOffline] = useState(false);
  const [isConnected, setIsConnected] = useState(true); // real device connectivity
  const [proofUri, setProofUri] = useState(null); // proof-of-delivery image being viewed

  // Track real connectivity so the offline banner only shows when truly offline.
  // A slow/failed request alone (source === 'cache') must NOT flag us as offline.
  useEffect(() => {
    const apply = (state) =>
      setIsConnected(state.isConnected !== false && state.isInternetReachable !== false);
    NetInfo.fetch().then(apply);
    const unsubscribe = NetInfo.addEventListener(apply);
    return unsubscribe;
  }, []);

  // ---------- Loaders (read-through cache; placing an order stays online) ----------
  const loadProducts = useCallback(async () => {
    const { list, source } = await readThrough('available_products_cache', () =>
      api.get('/api/products/available')
    );
    setProducts(list);
    setShopOffline(source === 'cache');
  }, []);

  const loadOrders = useCallback(async () => {
    const { list, source } = await readThrough('my_orders_cache', () =>
      api.get('/api/orders')
    );
    setOrders(list);
    setOrdersOffline(source === 'cache');
  }, []);

  useEffect(() => {
    (async () => {
      setLoadingProducts(true);
      setLoadingOrders(true);
      await Promise.all([loadProducts(), loadOrders()]);
      setLoadingProducts(false);
      setLoadingOrders(false);
    })();
  }, [loadProducts, loadOrders]);

  // Issue 10: poll My Orders every 30s so the progress stepper advances live as
  // the rider updates status (picked up / in transit / delivered).
  useEffect(() => {
    const id = setInterval(() => { loadOrders(); }, 30000);
    return () => clearInterval(id);
  }, [loadOrders]);

  const onRefresh = async () => {
    setRefreshing(true);
    if (tab === 'shop') await loadProducts();
    else await loadOrders();
    setRefreshing(false);
  };

  // ---------- Cart ----------
  const addToCart = (product) => {
    if (product.stock_kg <= 0) {
      showAlert('Out of stock', `${product.vegetable_name} is currently unavailable.`);
      return;
    }
    setCart((prev) => {
      const existing = prev.find((c) => c.product_id === product.id);
      if (existing) {
        if (existing.quantity >= product.stock_kg) {
          showAlert('Limit reached', `Only ${product.stock_kg}kg of ${product.vegetable_name} available.`);
          return prev;
        }
        return prev.map((c) =>
          c.product_id === product.id ? { ...c, quantity: c.quantity + 1 } : c
        );
      }
      return [
        ...prev,
        {
          product_id: product.id,
          name: product.vegetable_name,
          price: Number(product.price_per_kg),
          quantity: 1,
          stock: Number(product.stock_kg),
        },
      ];
    });
  };

  const changeQty = (productId, delta) => {
    setCart((prev) =>
      prev.flatMap((c) => {
        if (c.product_id !== productId) return [c];
        const next = c.quantity + delta;
        if (next <= 0) return []; // remove
        if (next > c.stock) {
          showAlert('Limit reached', `Only ${c.stock}kg of ${c.name} available.`);
          return [c];
        }
        return [{ ...c, quantity: next }];
      })
    );
  };

  const removeFromCart = (productId) => {
    setCart((prev) => prev.filter((c) => c.product_id !== productId));
  };

  const totalItems = cart.reduce((s, c) => s + c.quantity, 0);
  const totalAmount = cart.reduce((s, c) => s + c.price * c.quantity, 0);

  // ---------- Place order ----------
  const placeOrder = async () => {
    if (cart.length === 0) {
      showAlert('Empty cart', 'Add at least one product before ordering.');
      return;
    }
    if (!address.trim()) {
      showAlert('Error', 'Enter a delivery address.');
      return;
    }
    // Issue 11: preferred schedule is now required.
    if (!schedule) {
      showAlert('Error', 'Select a preferred delivery date and time.');
      return;
    }

    // Issue 4: build the payload once so we can log exactly what's sent.
    const payload = {
      items: cart.map((c) => ({ product_id: c.product_id, quantity_kg: c.quantity })),
      delivery_address: address.trim(),
      preferred_schedule: schedule, // "YYYY-MM-DDTHH:mm" from SchedulePicker
    };
    console.log('[placeOrder] cart:', cart);
    console.log('[placeOrder] payload:', JSON.stringify(payload));

    setPlacing(true);
    try {
      const res = await api.post('/api/orders', payload);
      console.log('[placeOrder] success response:', JSON.stringify(res));

      setCart([]);
      // Reset back to the store_location default (Issue 10), not blank.
      setAddress(user?.store_location || '');
      setSchedule('');
      await Promise.all([loadOrders(), loadProducts()]); // refresh orders + stock
      showAlert('Success', 'Your order has been placed.');
      setTab('orders');
    } catch (err) {
      // Issue 4: surface the exact backend error message.
      console.error('[placeOrder] failed:', err);
      showAlert('Order failed', err?.message || 'Something went wrong placing your order.');
    } finally {
      setPlacing(false);
    }
  };

  const cancelOrder = async (orderId) => {
    const confirm = await new Promise((resolve) => {
      if (Platform.OS === 'web') {
        resolve(window.confirm('Are you sure you want to cancel this order?'));
      } else {
        Alert.alert(
          'Cancel Order',
          'Are you sure you want to cancel this order?',
          [
            { text: 'No', onPress: () => resolve(false), style: 'cancel' },
            { text: 'Yes, Cancel', onPress: () => resolve(true), style: 'destructive' },
          ]
        );
      }
    });

    if (!confirm) return;

    try {
      await api.put(`/api/orders/${orderId}/cancel`);
      showAlert('Success', 'Order cancelled successfully.');
      await loadOrders(); // Refresh order list
    } catch (err) {
      showAlert('Error', err.message);
    }
  };


  return (
    <SafeAreaView style={styles.container}>
      {/* Minimal Top Navigation Bar */}
      <View style={styles.minimalHeader}>
        <Text style={styles.minimalTitle}>Retailer Store</Text>
        <NotificationBell />
      </View>

      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, tab === 'shop' && styles.tabActive]}
          onPress={() => setTab('shop')}
        >
          <Text style={[styles.tabText, tab === 'shop' && styles.tabTextActive]}>
            Shop{totalItems ? ` (${totalItems})` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'orders' && styles.tabActive]}
          onPress={() => setTab('orders')}
        >
          <Text style={[styles.tabText, tab === 'orders' && styles.tabTextActive]}>My Orders</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 90 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Only flag offline when the device is actually disconnected AND we're
            falling back to cached data — not merely because a request was slow. */}
        <OfflineBanner offline={!isConnected && (tab === 'shop' ? shopOffline : ordersOffline)} />

        {tab === 'shop' ? (
          <ShopTab
            loading={loadingProducts}
            products={products}
            searchQuery={searchQuery} setSearchQuery={setSearchQuery}
            cart={cart}
            totalItems={totalItems}
            totalAmount={totalAmount}
            address={address} setAddress={setAddress}
            schedule={schedule} setSchedule={setSchedule}
            placing={placing}
            onAdd={addToCart}
            onChangeQty={changeQty}
            onRemove={removeFromCart}
            onPlaceOrder={placeOrder}
          />
        ) : (
          <OrdersTab
            loading={loadingOrders}
            orders={orders}
            onViewProof={setProofUri}
            onTrack={(o) => navigation.navigate('OrderTracking', {
              orderId: o.id,
              deliveryAddress: o.delivery_address,
              orderStatus: o.status,
            })}
            onCancel={cancelOrder}
          />
        )}
      </ScrollView>

      <ImageViewerModal
        uri={proofUri}
        visible={!!proofUri}
        onClose={() => setProofUri(null)}
      />
      <BottomNavBar
        tabs={RETAILER_TABS}
        activeTab={activeBottomTab}
        onTabPress={handleBottomTabPress}
      />
    </SafeAreaView>
  );
}

// ================= Shop tab =================
function ShopTab({
  loading, products, searchQuery, setSearchQuery, cart, totalItems, totalAmount,
  address, setAddress, schedule, setSchedule, placing,
  onAdd, onChangeQty, onRemove, onPlaceOrder,
}) {
  if (loading) return <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />;

  // Local, case-insensitive filter by vegetable name.
  const query = searchQuery.trim().toLowerCase();
  const filteredProducts = query
    ? products.filter((p) => p.vegetable_name?.toLowerCase().includes(query))
    : products;

  return (
    <View>
      {/* Search bar */}
      <View style={styles.searchRow}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search vegetables..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.searchClear}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Products */}
      <Text style={styles.sectionTitle}>Available Products</Text>
      {products.length === 0 ? (
        <EmptyState
          icon="🥬"
          title="No products available"
          message="Check back soon — distributors haven’t listed anything yet."
        />
      ) : filteredProducts.length === 0 ? (
        <Text style={styles.emptyText}>No vegetables match “{searchQuery.trim()}”.</Text>
      ) : (
        filteredProducts.map((p) => (
          <View key={p.id} style={styles.rowCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{p.vegetable_name}</Text>
              <Text style={styles.rowMeta}>
                {peso(p.price_per_kg)} / kg · {p.stock_kg} kg available
                {p.harvest_date ? `\n📅 Harvested: ${new Date(p.harvest_date).toLocaleDateString()}` : ''}
              </Text>
            </View>
            <TouchableOpacity style={styles.smallBtnFilled} onPress={() => onAdd(p)}>
              <Text style={styles.smallBtnFilledText}>Add to Cart</Text>
            </TouchableOpacity>
          </View>
        ))
      )}

      {/* Cart */}
      <Text style={[styles.sectionTitle, { marginTop: 20 }]}>
        Cart {totalItems ? `· ${totalItems} kg` : ''}
      </Text>
      {cart.length === 0 ? (
        <Text style={styles.emptyText}>Your cart is empty.</Text>
      ) : (
        <View>
          {cart.map((c) => (
            <View key={c.product_id} style={styles.cartCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{c.name}</Text>
                <Text style={styles.rowMeta}>{peso(c.price)} / kg · subtotal {peso(c.price * c.quantity)}</Text>
              </View>
              <View style={styles.qtyControls}>
                <TouchableOpacity style={styles.qtyBtn} onPress={() => onChangeQty(c.product_id, -1)}>
                  <Text style={styles.qtyBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.qtyValue}>{c.quantity}</Text>
                <TouchableOpacity style={styles.qtyBtn} onPress={() => onChangeQty(c.product_id, 1)}>
                  <Text style={styles.qtyBtnText}>+</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.removeBtn} onPress={() => onRemove(c.product_id)}>
                  <Text style={styles.removeBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}

          {/* Summary */}
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Total ({totalItems} kg)</Text>
            <Text style={styles.summaryTotal}>{peso(totalAmount)}</Text>
          </View>

          {/* Order form */}
          <Text style={styles.fieldLabel}>Delivery address * (from your store location — editable)</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g., 123 Market St, Baguio City"
            value={address}
            onChangeText={setAddress}
            editable={!placing}
            multiline
          />
          <Text style={styles.fieldLabel}>Preferred delivery time *</Text>
          <SchedulePicker value={schedule} onChange={setSchedule} disabled={placing} />

          <TouchableOpacity
            style={[styles.button, styles.buttonPrimary, placing && styles.buttonDisabled, { marginTop: 16 }]}
            onPress={onPlaceOrder}
            disabled={placing}
          >
            {placing
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.buttonPrimaryText}>Place Order · {peso(totalAmount)}</Text>}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ================= My Orders tab =================
function getProofUrl(order) {
  const delivery = Array.isArray(order.deliveries) ? order.deliveries[0] : order.deliveries;
  return delivery?.proof_photo_url || null;
}

function OrdersTab({ loading, orders, onViewProof, onTrack, onCancel }) {
  if (loading) return <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />;

  if (orders.length === 0) {
    return (
      <EmptyState
        icon="🧾"
        title="No orders yet"
        message="Head to the Shop tab to place your first order."
      />
    );
  }

  return (
    <View>
      <Text style={styles.sectionTitle}>My Orders</Text>
      {orders.map((o) => (
        <View key={o.id} style={styles.orderCard}>
          <View style={styles.orderHeader}>
            <Text style={styles.orderId}>Order #{shortId(o.id)}</Text>
            <View style={[styles.statusBadge, { backgroundColor: statusColor(o.status) }]}>
              <Text style={styles.statusBadgeText}>{o.status}</Text>
            </View>
          </View>
          <Text style={styles.orderTotal}>{peso(o.total_amount)}</Text>
          {o.delivery_address ? (
            <Text style={styles.rowMeta}>Deliver to: {o.delivery_address}</Text>
          ) : null}
          {o.preferred_schedule ? (
            <Text style={styles.rowMeta}>Schedule: {o.preferred_schedule}</Text>
          ) : null}

          {/* Issue 16: visual progress (Pending → Approved → Out for Delivery → Delivered).
              Cancelled orders skip the tracker; the status badge above already conveys it. */}
          {o.status === 'cancelled' ? (
            <Text style={styles.cancelledNote}>This order was cancelled.</Text>
          ) : (
            <OrderStepIndicator status={o.status} />
          )}

          {Array.isArray(o.order_items) && o.order_items.length > 0 && (
            <View style={styles.itemsBox}>
              {o.order_items.map((it, i) => (
                <Text key={i} style={styles.itemLine}>
                  • {it.vegetable_name} — {it.quantity_kg}kg @ {peso(it.price_at_order)}
                </Text>
              ))}
            </View>
          )}

          {getProofUrl(o) && (
            <TouchableOpacity
              style={styles.proofRow}
              onPress={() => onViewProof(getProofUrl(o))}
              activeOpacity={0.8}
            >
              <Image source={{ uri: getProofUrl(o) }} style={styles.proofThumb} />
              <Text style={styles.proofText}>📷 Proof of delivery — tap to view</Text>
            </TouchableOpacity>
          )}

          {/* Cancel Order - only for pending status */}
          {o.status === 'pending' && (
            <TouchableOpacity
              style={[styles.trackBtn, styles.cancelBtn]}
              onPress={() => onCancel(o.id)}
              activeOpacity={0.8}
            >
              <Text style={styles.cancelBtnText}>❌ Cancel Order</Text>
            </TouchableOpacity>
          )}

          {/* Track Order — opens the map tracking screen for this order. */}
          {o.status !== 'pending' && o.status !== 'cancelled' && (
            <TouchableOpacity
              style={styles.trackBtn}
              onPress={() => onTrack(o)}
              activeOpacity={0.8}
            >
              <Text style={styles.trackBtnText}>🗺️  Track Order</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  minimalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#eeeeee',
  },
  minimalTitle: { fontSize: 18, fontWeight: '700', color: PRIMARY },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 16, paddingBottom: 8 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 24, fontWeight: 'bold', color: PRIMARY },
  subtitle: { fontSize: 14, color: '#555', marginTop: 2 },

  tabs: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 8, backgroundColor: '#e8f0e9', borderRadius: 10, padding: 4 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  tabActive: { backgroundColor: PRIMARY },
  tabText: { color: PRIMARY, fontWeight: '600' },
  tabTextActive: { color: '#fff' },

  content: { padding: 16, paddingBottom: 40 },

  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#333', marginBottom: 10 },
  emptyText: { color: '#888', fontStyle: 'italic', marginTop: 8 },

  // Search bar
  searchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#ddd', paddingHorizontal: 12, marginBottom: 16 },
  searchIcon: { fontSize: 16, marginRight: 8 },
  searchInput: { flex: 1, paddingVertical: Platform.OS === 'ios' ? 12 : 8, fontSize: 16, color: '#222' },
  searchClear: { fontSize: 16, color: '#999', paddingLeft: 8 },

  rowCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#eee' },
  rowTitle: { fontSize: 16, fontWeight: '700', color: '#222' },
  rowMeta: { fontSize: 14, color: '#555', marginTop: 2 },

  smallBtnFilled: { backgroundColor: PRIMARY, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8 },
  smallBtnFilledText: { color: '#fff', fontWeight: '600', fontSize: 13 },

  cartCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#eee' },
  qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyBtn: { width: 32, height: 32, borderRadius: 8, borderWidth: 1, borderColor: PRIMARY, alignItems: 'center', justifyContent: 'center' },
  qtyBtnText: { color: PRIMARY, fontSize: 18, fontWeight: '700' },
  qtyValue: { minWidth: 24, textAlign: 'center', fontSize: 16, fontWeight: '600', color: '#222' },
  removeBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: '#fdecea', alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
  removeBtnText: { color: '#c62828', fontSize: 14, fontWeight: '700' },

  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, marginTop: 4, borderTopWidth: 1, borderTopColor: '#eee' },
  summaryLabel: { fontSize: 16, color: '#333', fontWeight: '600' },
  summaryTotal: { fontSize: 20, fontWeight: '700', color: PRIMARY },

  fieldLabel: { fontSize: 13, color: '#555', marginTop: 10, marginBottom: 6 },
  input: { backgroundColor: '#fff', borderRadius: 8, padding: 12, fontSize: 16, borderWidth: 1, borderColor: '#ddd' },

  button: { paddingVertical: 14, borderRadius: 8, alignItems: 'center' },
  buttonPrimary: { backgroundColor: PRIMARY },
  buttonPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  buttonDisabled: { opacity: 0.6 },

  orderCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#eee' },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  orderId: { fontSize: 16, fontWeight: '700', color: '#222' },
  orderTotal: { fontSize: 18, fontWeight: '700', color: PRIMARY, marginBottom: 4 },
  statusBadge: { paddingVertical: 3, paddingHorizontal: 10, borderRadius: 12 },
  statusBadgeText: { color: '#fff', fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },
  itemsBox: { backgroundColor: '#fafafa', borderRadius: 8, padding: 10, marginTop: 8 },
  itemLine: { fontSize: 13, color: '#444', marginBottom: 2 },
  cancelledNote: { fontSize: 13, color: '#c62828', fontStyle: 'italic', marginTop: 8 },
  proofRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, backgroundColor: '#f1f8e9', borderRadius: 8, padding: 8 },
  proofThumb: { width: 48, height: 48, borderRadius: 6, backgroundColor: '#ddd' },
  proofText: { fontSize: 13, color: PRIMARY, fontWeight: '600' },
  trackBtn: { marginTop: 10, paddingVertical: 10, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: PRIMARY },
  trackBtnText: { color: PRIMARY, fontWeight: '700', fontSize: 14 },
  cancelBtn: { borderColor: '#c62828', backgroundColor: '#fff' },
  cancelBtnText: { color: '#c62828', fontWeight: '700', fontSize: 14 },
});
