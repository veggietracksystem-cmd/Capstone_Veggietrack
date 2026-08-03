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
import OfflineBanner from '../components/OfflineBanner';
import ImageViewerModal from '../components/ImageViewerModal';
import SchedulePicker from '../components/SchedulePicker';
import OrderStepIndicator from '../components/OrderStepIndicator';
import EmptyState from '../components/EmptyState';
import { showAlert, peso, shortId } from '../lib/ui';
import { colors, fonts, radius, shadowCard } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';
import { CATEGORIES, getCategory } from '../lib/vegetables';

const PRIMARY = colors.leaf700;

function statusColor(status) {
  switch (status) {
    case 'pending': return colors.gold500;
    case 'approved':
    case 'assigned': return '#1976d2';
    case 'in_transit': return '#7b1fa2';
    case 'delivered': return PRIMARY;
    case 'cancelled': return colors.danger;
    default: return '#607d8b';
  }
}

export default function RetailerDashboard({ navigation, route }) {
  const { user } = useAuth();
  const { t } = useTranslation();

  const RETAILER_TABS = [
    { id: 'home', iconName: 'home-outline', label: t('dashboards.retailer.tabHome') },
    { id: 'browse', iconName: 'leaf-outline', label: t('dashboards.retailer.tabBrowse') },
    { id: 'orders', iconName: 'receipt-outline', label: t('dashboards.retailer.tabOrders') },
    { id: 'track', iconName: 'map-outline', label: t('dashboards.retailer.tabTrack') },
    { id: 'profile', iconName: 'person-outline', label: t('dashboards.retailer.tabProfile') },
  ];
  const [tab, setTab] = useState('shop'); // 'shop' | 'orders'
  const [activeBottomTab, setActiveBottomTab] = useState('home');

  const handleBottomTabPress = (tab) => {
    setActiveBottomTab(tab.id);
    if (tab.id === 'profile') {
      navigation.navigate('Profile');
    } else if (tab.id === 'browse') {
      setTab('shop');
    } else if (tab.id === 'orders') {
      setTab('orders');
    } else if (tab.id === 'track') {
      setTab('orders');
    } else if (tab.id === 'home') {
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
      showAlert(t('dashboards.retailer.outOfStockTitle'), t('dashboards.retailer.outOfStockMessage', { name: product.vegetable_name }));
      return;
    }
    setCart((prev) => {
      const existing = prev.find((c) => c.product_id === product.id);
      if (existing) {
        if (existing.quantity >= product.stock_kg) {
          showAlert(t('dashboards.retailer.limitReachedTitle'), t('dashboards.retailer.limitReachedMessage', { qty: product.stock_kg, name: product.vegetable_name }));
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
          showAlert(t('dashboards.retailer.limitReachedTitle'), t('dashboards.retailer.limitReachedMessage', { qty: c.stock, name: c.name }));
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
      showAlert(t('dashboards.retailer.emptyCartTitle'), t('dashboards.retailer.emptyCartMessage'));
      return;
    }
    if (!address.trim()) {
      showAlert(t('common.error'), t('dashboards.retailer.enterAddress'));
      return;
    }
    // Issue 11: preferred schedule is now required.
    if (!schedule) {
      showAlert(t('common.error'), t('dashboards.retailer.selectSchedule'));
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
      showAlert(t('dashboards.retailer.orderSuccessTitle'), t('dashboards.retailer.orderSuccessMessage'));
      setTab('orders');
    } catch (err) {
      // Issue 4: surface the exact backend error message.
      console.error('[placeOrder] failed:', err);
      showAlert(t('dashboards.retailer.orderFailedTitle'), err?.message || t('dashboards.retailer.orderFailedFallback'));
    } finally {
      setPlacing(false);
    }
  };

  const cancelOrder = async (orderId) => {
    const confirm = await new Promise((resolve) => {
      if (Platform.OS === 'web') {
        resolve(window.confirm(t('dashboards.retailer.cancelOrderMessage')));
      } else {
        Alert.alert(
          t('dashboards.retailer.cancelOrderTitle'),
          t('dashboards.retailer.cancelOrderMessage'),
          [
            { text: t('dashboards.retailer.cancelNo'), onPress: () => resolve(false), style: 'cancel' },
            { text: t('dashboards.retailer.cancelYes'), onPress: () => resolve(true), style: 'destructive' },
          ]
        );
      }
    });

    if (!confirm) return;

    try {
      await api.put(`/api/orders/${orderId}/cancel`);
      showAlert(t('dashboards.retailer.orderSuccessTitle'), t('dashboards.retailer.orderCancelledMessage'));
      await loadOrders(); // Refresh order list
    } catch (err) {
      showAlert(t('common.error'), err.message);
    }
  };


  return (
    <SafeAreaView style={styles.container}>
      {/* Minimal Top Navigation Bar */}
      <View style={styles.minimalHeader}>
        <Text style={styles.minimalTitle}>{t('dashboards.retailer.storeTitle')}</Text>
        <NotificationBell />
      </View>

      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, tab === 'shop' && styles.tabActive]}
          onPress={() => setTab('shop')}
        >
          <Text style={[styles.tabText, tab === 'shop' && styles.tabTextActive]}>
            {t('dashboards.retailer.shopTab')}{totalItems ? ` (${totalItems})` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'orders' && styles.tabActive]}
          onPress={() => setTab('orders')}
        >
          <Text style={[styles.tabText, tab === 'orders' && styles.tabTextActive]}>{t('dashboards.retailer.myOrdersTab')}</Text>
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
  const { t } = useTranslation();
  const [category, setCategory] = useState('All');

  if (loading) return <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />;

  // Local, case-insensitive filter by vegetable name + category.
  const query = searchQuery.trim().toLowerCase();
  const filteredProducts = products.filter((p) => {
    const matchesQuery = !query || p.vegetable_name?.toLowerCase().includes(query);
    const matchesCategory = category === 'All' || getCategory(p.vegetable_name) === category;
    return matchesQuery && matchesCategory;
  });

  return (
    <View>
      {/* Search bar */}
      <View style={styles.searchRow}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder={t('dashboards.retailer.searchPlaceholder')}
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

      {/* Category filter chips */}
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

      {/* Products */}
      <Text style={styles.sectionTitle}>{t('dashboards.retailer.availableProducts')}</Text>
      {products.length === 0 ? (
        <EmptyState
          icon="🥬"
          title={t('dashboards.retailer.noProductsTitle')}
          message={t('dashboards.retailer.noProductsMessage')}
        />
      ) : filteredProducts.length === 0 ? (
        <Text style={styles.emptyText}>
          {query
            ? t('dashboards.retailer.noMatchQuery', { query: searchQuery.trim() })
            : t('dashboards.retailer.noMatchCategory', { category: t(`categories.${category}`) })}
        </Text>
      ) : (
        filteredProducts.map((p) => (
          <View key={p.id} style={styles.rowCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{p.vegetable_name}</Text>
              <Text style={styles.rowMeta}>
                {peso(p.price_per_kg)} / kg · {t('dashboards.retailer.kgAvailable', { qty: p.stock_kg })}
                {p.harvest_date ? `\n${t('dashboards.retailer.harvested', { date: new Date(p.harvest_date).toLocaleDateString() })}` : ''}
              </Text>
            </View>
            <TouchableOpacity style={styles.smallBtnFilled} onPress={() => onAdd(p)}>
              <Text style={styles.smallBtnFilledText}>{t('dashboards.retailer.addToCart')}</Text>
            </TouchableOpacity>
          </View>
        ))
      )}

      {/* Cart */}
      <Text style={[styles.sectionTitle, { marginTop: 20 }]}>
        {t('dashboards.retailer.cart')} {totalItems ? `· ${totalItems} kg` : ''}
      </Text>
      {cart.length === 0 ? (
        <Text style={styles.emptyText}>{t('dashboards.retailer.cartEmpty')}</Text>
      ) : (
        <View>
          {cart.map((c) => (
            <View key={c.product_id} style={styles.cartCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{c.name}</Text>
                <Text style={styles.rowMeta}>{peso(c.price)} / kg · {t('dashboards.retailer.subtotal', { amount: peso(c.price * c.quantity) })}</Text>
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
            <Text style={styles.summaryLabel}>{t('dashboards.retailer.total', { qty: totalItems })}</Text>
            <Text style={styles.summaryTotal}>{peso(totalAmount)}</Text>
          </View>

          {/* Order form */}
          <Text style={styles.fieldLabel}>{t('dashboards.retailer.deliveryAddressLabel')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('dashboards.retailer.deliveryAddressPlaceholder')}
            value={address}
            onChangeText={setAddress}
            editable={!placing}
            multiline
          />
          <Text style={styles.fieldLabel}>{t('dashboards.retailer.preferredTimeLabel')}</Text>
          <SchedulePicker value={schedule} onChange={setSchedule} disabled={placing} />

          <TouchableOpacity
            style={[styles.button, styles.buttonPrimary, placing && styles.buttonDisabled, { marginTop: 16 }]}
            onPress={onPlaceOrder}
            disabled={placing}
          >
            {placing
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.buttonPrimaryText}>{t('dashboards.retailer.placeOrder', { amount: peso(totalAmount) })}</Text>}
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
  const { t } = useTranslation();

  if (loading) return <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />;

  if (orders.length === 0) {
    return (
      <EmptyState
        icon="🧾"
        title={t('dashboards.retailer.noOrdersTitle')}
        message={t('dashboards.retailer.noOrdersMessage')}
      />
    );
  }

  return (
    <View>
      <Text style={styles.sectionTitle}>{t('dashboards.retailer.myOrders')}</Text>
      {orders.map((o) => (
        <View key={o.id} style={styles.orderCard}>
          <View style={styles.orderHeader}>
            <Text style={styles.orderId}>{t('dashboards.retailer.orderNumber', { id: shortId(o.id) })}</Text>
            <View style={[styles.statusBadge, { backgroundColor: statusColor(o.status) }]}>
              <Text style={styles.statusBadgeText}>{o.status}</Text>
            </View>
          </View>
          <Text style={styles.orderTotal}>{peso(o.total_amount)}</Text>
          {o.delivery_address ? (
            <Text style={styles.rowMeta}>{t('dashboards.retailer.deliverTo', { address: o.delivery_address })}</Text>
          ) : null}
          {o.preferred_schedule ? (
            <Text style={styles.rowMeta}>{t('dashboards.retailer.schedule', { schedule: o.preferred_schedule })}</Text>
          ) : null}

          {/* Issue 16: visual progress (Pending → Approved → Out for Delivery → Delivered).
              Cancelled orders skip the tracker; the status badge above already conveys it. */}
          {o.status === 'cancelled' ? (
            <Text style={styles.cancelledNote}>{t('dashboards.retailer.orderCancelledNote')}</Text>
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
              <Text style={styles.proofText}>{t('dashboards.retailer.proofOfDelivery')}</Text>
            </TouchableOpacity>
          )}

          {/* Cancel Order - only for pending status */}
          {o.status === 'pending' && (
            <TouchableOpacity
              style={[styles.trackBtn, styles.cancelBtn]}
              onPress={() => onCancel(o.id)}
              activeOpacity={0.8}
            >
              <Text style={styles.cancelBtnText}>{t('dashboards.retailer.cancelOrderBtn')}</Text>
            </TouchableOpacity>
          )}

          {/* Track Order — opens the map tracking screen for this order. */}
          {o.status !== 'pending' && o.status !== 'cancelled' && (
            <TouchableOpacity
              style={styles.trackBtn}
              onPress={() => onTrack(o)}
              activeOpacity={0.8}
            >
              <Text style={styles.trackBtnText}>{t('dashboards.retailer.trackOrderBtn')}</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgScreen },

  minimalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.bgScreen,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  minimalTitle: { fontFamily: fonts.heading, fontSize: 19, color: colors.ink },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 16, paddingBottom: 8 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontFamily: fonts.heading, fontSize: 22, color: colors.ink },
  subtitle: { fontFamily: fonts.body, fontSize: 13.5, color: colors.inkSoft, marginTop: 2 },

  tabs: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 8, backgroundColor: colors.leaf50, borderRadius: radius.ctrl, padding: 4 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  tabActive: { backgroundColor: PRIMARY },
  tabText: { fontFamily: fonts.bodySemiBold, color: PRIMARY },
  tabTextActive: { color: '#fff' },

  content: { padding: 16, paddingBottom: 40 },

  sectionTitle: { fontFamily: fonts.heading, fontSize: 17, color: colors.ink, marginBottom: 10 },
  emptyText: { fontFamily: fonts.body, color: colors.inkFaint, fontStyle: 'italic', marginTop: 8 },

  // Search bar
  searchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.ctrl, borderWidth: 1.4, borderColor: colors.border, paddingHorizontal: 12, marginBottom: 16 },
  searchIcon: { fontSize: 16, marginRight: 8 },
  searchInput: { flex: 1, paddingVertical: Platform.OS === 'ios' ? 12 : 8, fontFamily: fonts.body, fontSize: 15, color: colors.ink },
  searchClear: { fontSize: 16, color: colors.inkFaint, paddingLeft: 8 },

  filterChipRow: { gap: 8, paddingBottom: 16 },
  filterChip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  filterChipActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  filterChipText: { fontFamily: fonts.body, color: colors.inkSoft, fontSize: 13 },
  filterChipTextActive: { fontFamily: fonts.bodySemiBold, color: '#fff' },

  rowCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.border, ...shadowCard },
  rowTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink, textTransform: 'capitalize' },
  rowMeta: { fontFamily: fonts.body, fontSize: 13.5, color: colors.inkSoft, marginTop: 2 },

  smallBtnFilled: { backgroundColor: PRIMARY, paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.ctrl },
  smallBtnFilledText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: 13 },

  cartCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 14, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: colors.border, ...shadowCard },
  qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyBtn: { width: 32, height: 32, borderRadius: 8, borderWidth: 1.4, borderColor: PRIMARY, alignItems: 'center', justifyContent: 'center' },
  qtyBtnText: { fontFamily: fonts.bodyBold, color: PRIMARY, fontSize: 18 },
  qtyValue: { minWidth: 24, textAlign: 'center', fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  removeBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: '#FBEAE8', alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
  removeBtnText: { fontFamily: fonts.bodyBold, color: colors.danger, fontSize: 14 },

  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, marginTop: 4, borderTopWidth: 1, borderTopColor: colors.border },
  summaryLabel: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  summaryTotal: { fontFamily: fonts.heading, fontSize: 19, color: PRIMARY },

  fieldLabel: { fontFamily: fonts.bodySemiBold, fontSize: 12.5, color: colors.inkSoft, marginTop: 10, marginBottom: 6 },
  input: { backgroundColor: colors.card, borderRadius: radius.ctrl, padding: 12, fontFamily: fonts.body, fontSize: 15, borderWidth: 1.4, borderColor: colors.border, color: colors.ink },

  button: { paddingVertical: 14, borderRadius: radius.ctrl, alignItems: 'center' },
  buttonPrimary: { backgroundColor: PRIMARY },
  buttonPrimaryText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: 15.5 },
  buttonDisabled: { opacity: 0.6 },

  orderCard: { backgroundColor: colors.card, borderRadius: radius.card, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border, ...shadowCard },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  orderId: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  orderTotal: { fontFamily: fonts.heading, fontSize: 17, color: PRIMARY, marginBottom: 4 },
  statusBadge: { paddingVertical: 3, paddingHorizontal: 10, borderRadius: 12 },
  statusBadgeText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: 12, textTransform: 'capitalize' },
  itemsBox: { backgroundColor: colors.leaf50, borderRadius: radius.ctrl, padding: 10, marginTop: 8 },
  itemLine: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft, marginBottom: 2 },
  cancelledNote: { fontFamily: fonts.body, fontSize: 13, color: colors.danger, fontStyle: 'italic', marginTop: 8 },
  proofRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, backgroundColor: colors.leaf50, borderRadius: radius.ctrl, padding: 8 },
  proofThumb: { width: 48, height: 48, borderRadius: 6, backgroundColor: colors.border },
  proofText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: PRIMARY },
  trackBtn: { marginTop: 10, paddingVertical: 10, borderRadius: radius.ctrl, alignItems: 'center', borderWidth: 1.4, borderColor: PRIMARY },
  trackBtnText: { fontFamily: fonts.bodyBold, color: PRIMARY, fontSize: 13.5 },
  cancelBtn: { borderColor: colors.danger, backgroundColor: colors.card },
  cancelBtnText: { fontFamily: fonts.bodyBold, color: colors.danger, fontSize: 13.5 },
});
