import { rf } from '../lib/responsive';
import { useState, useEffect, useCallback } from 'react';
import {
  Text, View, ScrollView, TextInput, TouchableOpacity, Image,
  ActivityIndicator, StyleSheet, Platform, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import api from '../api/client';
import { readThrough } from '../offline/cache';
import { useAuth } from '../context/AuthContext';
import LogoutButton from '../components/LogoutButton';
import NotificationBell from '../components/NotificationBell';
import MessagesIcon from '../components/MessagesIcon';
import BottomNavBar from '../components/BottomNavBar';
import OfflineBanner from '../components/OfflineBanner';
import ImageViewerModal from '../components/ImageViewerModal';
import OrderStepIndicator from '../components/OrderStepIndicator';
import EmptyState from '../components/EmptyState';
import AddToCartFlyOverlay from '../components/AddToCartFlyOverlay';
import { getVegetableTile, getVegetableIcon } from '../lib/vegetableIcons';
import { localizeVegetableName } from '../lib/vegetableNames';
import { showAlert, confirmAction, peso, shortId } from '../lib/ui';
import { colors, fonts, radius, shadowCard } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';

const PRIMARY = colors.leaf700;

// Maps the internal content-tab id (used by `tab` state / route params) to
// the bottom nav's tab id, so the highlighted icon always matches what's
// actually on screen (e.g. after OrderConfirmationScreen navigates back with
// `tab: 'shop'`).
const BOTTOM_TAB_FOR = { shop: 'home', cart: 'cart', orders: 'orders' };

export function statusColor(status) {
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

// The embedded deliveries relation comes back as an array; take the first record.
export function getDelivery(order) {
  if (Array.isArray(order.deliveries)) return order.deliveries[0] || null;
  return order.deliveries || null;
}

const HISTORY_AFTER_DAYS = 5;

// An order "graduates" into History once it's been delivered for more than
// HISTORY_AFTER_DAYS — the Orders tab stays focused on active/recent orders.
export function isOldCompleted(order) {
  if (order.status !== 'delivered') return false;
  const deliveredAt = getDelivery(order)?.delivered_at;
  if (!deliveredAt) return false;
  const ageMs = Date.now() - new Date(deliveredAt).getTime();
  return ageMs > HISTORY_AFTER_DAYS * 24 * 60 * 60 * 1000;
}

export default function RetailerDashboard({ navigation, route }) {
  const { user } = useAuth();
  const { t, language } = useTranslation();

  const [tab, setTab] = useState('shop'); // 'shop' (Home/browse) | 'cart' | 'orders'
  const [activeBottomTab, setActiveBottomTab] = useState('home');

  const handleBottomTabPress = (tab) => {
    setActiveBottomTab(tab.id);
    if (tab.id === 'profile') {
      navigation.navigate('Profile');
    } else if (tab.id === 'cart') {
      setTab('cart');
    } else if (tab.id === 'orders') {
      setTab('orders');
    } else if (tab.id === 'home') {
      setTab('shop');
    }
  };

  useEffect(() => {
    if (route.params?.tab) {
      setTab(route.params.tab);
      setActiveBottomTab(BOTTOM_TAB_FOR[route.params.tab] || 'home');
    }
  }, [route.params?.tab]);

  // Checkout now happens on a separate OrderConfirmation screen. When it
  // finishes placing an order, it navigates back here with `orderPlaced: true`
  // instead of passing a callback through navigation params.
  useEffect(() => {
    if (route.params?.orderPlaced) {
      setCart([]);
      setAddress(user?.store_location || '');
      Promise.all([loadOrders(), loadProducts()]);
      navigation.setParams({ orderPlaced: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.orderPlaced]);

  // ----- Products + cart -----
  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [searchQuery, setSearchQuery] = useState(''); // filters the product list locally
  const [cart, setCart] = useState([]); // { product_id, name, price, quantity, stock }
  const [address, setAddress] = useState('');
  const [flights, setFlights] = useState([]); // in-flight "add to cart" fly-to-cart animations
  const [cartIconTarget, setCartIconTarget] = useState(null); // measured on-screen center of the Cart tab icon

  const handleTabMeasure = (tabId, rect) => {
    if (tabId === 'cart') {
      setCartIconTarget({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
    }
  };

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
    else if (tab === 'orders') await loadOrders();
    setRefreshing(false);
  };

  // ---------- Cart ----------
  // Cart is keyed by vegetable_name, not a batch/product id — the retailer
  // never picks a batch; the backend resolves FIFO batches at order time.
  const addToCart = (product, touchEvent) => {
    if (product.available_kg <= 0) {
      showAlert(t('dashboards.retailer.outOfStockTitle'), t('dashboards.retailer.outOfStockMessage', { name: localizeVegetableName(product.vegetable_name, language) }));
      return;
    }
    setCart((prev) => {
      const existing = prev.find((c) => c.vegetable_name === product.vegetable_name);
      if (existing) {
        if (existing.quantity >= product.available_kg) {
          showAlert(t('dashboards.retailer.limitReachedTitle'), t('dashboards.retailer.limitReachedMessage', { qty: product.available_kg, name: localizeVegetableName(product.vegetable_name, language) }));
          return prev;
        }
        return prev.map((c) =>
          c.vegetable_name === product.vegetable_name ? { ...c, quantity: c.quantity + 1 } : c
        );
      }
      return [
        ...prev,
        {
          vegetable_name: product.vegetable_name,
          name: product.vegetable_name,
          price: Number(product.price_per_kg),
          quantity: 1,
          stock: Number(product.available_kg),
        },
      ];
    });

    // Fire the "flying to cart" confirmation animation from the tap point.
    const startX = touchEvent?.pageX;
    const startY = touchEvent?.pageY;
    if (typeof startX === 'number' && typeof startY === 'number') {
      const flightId = `${Date.now()}-${Math.random()}`;
      setFlights((prev) => [
        ...prev,
        { id: flightId, startX, startY, icon: getVegetableIcon(product.vegetable_name) },
      ]);
    }
  };

  const removeFlight = (flightId) => {
    setFlights((prev) => prev.filter((f) => f.id !== flightId));
  };

  const changeQty = (vegetableName, delta) => {
    setCart((prev) =>
      prev.flatMap((c) => {
        if (c.vegetable_name !== vegetableName) return [c];
        const next = c.quantity + delta;
        if (next <= 0) return []; // remove
        if (next > c.stock) {
          showAlert(t('dashboards.retailer.limitReachedTitle'), t('dashboards.retailer.limitReachedMessage', { qty: c.stock, name: localizeVegetableName(c.name, language) }));
          return [c];
        }
        return [{ ...c, quantity: next }];
      })
    );
  };

  const removeFromCart = (vegetableName) => {
    setCart((prev) => prev.filter((c) => c.vegetable_name !== vegetableName));
  };

  const totalItems = cart.reduce((s, c) => s + c.quantity, 0);
  const totalAmount = cart.reduce((s, c) => s + c.price * c.quantity, 0);

  // ---------- Checkout ----------
  // The Cart tab no longer collects address/schedule or submits the order
  // directly — it hands the cart snapshot off to OrderConfirmationScreen,
  // which owns those fields and the actual /api/orders submission.
  const goToCheckout = () => {
    if (cart.length === 0) {
      showAlert(t('dashboards.retailer.emptyCartTitle'), t('dashboards.retailer.emptyCartMessage'));
      return;
    }
    navigation.navigate('OrderConfirmation', {
      cart,
      totalItems,
      totalAmount,
      defaultAddress: address,
    });
  };

  const cancelOrder = (orderId) => {
    confirmAction(
      t('dashboards.retailer.cancelOrderTitle'),
      t('dashboards.retailer.cancelOrderMessage'),
      async () => {
        try {
          await api.put(`/api/orders/${orderId}/cancel`);
          showAlert(t('dashboards.retailer.orderSuccessTitle'), t('dashboards.retailer.orderCancelledMessage'));
          await loadOrders(); // Refresh order list
        } catch (err) {
          showAlert(t('common.error'), err.message);
        }
      }
    );
  };


  const RETAILER_TABS = [
    { id: 'home', iconName: 'home-outline', label: t('dashboards.retailer.tabHome') },
    { id: 'cart', iconName: 'cart-outline', label: t('dashboards.retailer.tabCart'), badge: totalItems },
    { id: 'orders', iconName: 'receipt-outline', label: t('dashboards.retailer.tabOrders') },
    { id: 'profile', iconName: 'person-outline', label: t('dashboards.retailer.tabProfile') },
  ];

  return (
    <SafeAreaView style={styles.container}>
      {/* Minimal Top Navigation Bar */}
      <View style={styles.minimalHeader}>
        <Text style={styles.minimalTitle}>{t('dashboards.retailer.storeTitle')}</Text>
        <View style={styles.headerIcons}>
          <MessagesIcon />
          <NotificationBell />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 90 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Only flag offline when the device is actually disconnected AND we're
            falling back to cached data — not merely because a request was slow. */}
        <OfflineBanner offline={!isConnected && (tab === 'shop' ? shopOffline : tab === 'orders' ? ordersOffline : false)} />

        {tab === 'shop' && (
          <HomeTab
            loading={loadingProducts}
            products={products}
            searchQuery={searchQuery} setSearchQuery={setSearchQuery}
            onAdd={addToCart}
          />
        )}

        {tab === 'cart' && (
          <CartTab
            cart={cart}
            totalItems={totalItems}
            totalAmount={totalAmount}
            onChangeQty={changeQty}
            onRemove={removeFromCart}
            onCheckout={goToCheckout}
          />
        )}

        {tab === 'orders' && (
          <OrdersTab
            loading={loadingOrders}
            orders={orders}
            onViewProof={setProofUri}
           onTrack={(o) => navigation.navigate('ShopeeTracking', {
    orderId: o.id,
})}
            onCancel={cancelOrder}
            onViewDetails={(o) => navigation.navigate('OrderDetails', { order: o })}
            onViewHistory={() => navigation.navigate('OrderHistory')}
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
        onTabMeasure={handleTabMeasure}
      />
      <AddToCartFlyOverlay flights={flights} target={cartIconTarget} onDone={removeFlight} />
    </SafeAreaView>
  );
}

// ================= Home tab (browse only) =================
function HomeTab({ loading, products, searchQuery, setSearchQuery, onAdd }) {
  const { t, language } = useTranslation();

  if (loading) return <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />;

  // Local, case-insensitive filter by vegetable name.
  const query = searchQuery.trim().toLowerCase();
  const filteredProducts = products.filter(
    (p) => !query || p.vegetable_name?.toLowerCase().includes(query)
  );

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
          {t('dashboards.retailer.noMatchQuery', { query: searchQuery.trim() })}
        </Text>
      ) : (
        <View style={styles.kpiGrid}>
          {filteredProducts.map((p) => {
            const tile = getVegetableTile(p.vegetable_name);
            return (
              <View key={p.vegetable_name} style={styles.kpiCard}>
                <View style={[styles.kpiIconWrap, { backgroundColor: tile.bg }]}>
                  <Text style={styles.kpiIcon}>{tile.icon}</Text>
                </View>
                <Text style={styles.kpiName} numberOfLines={1}>{localizeVegetableName(p.vegetable_name, language)}</Text>
                <Text style={styles.kpiPrice}>{peso(p.price_per_kg)} / kg</Text>
                <Text style={styles.kpiMeta}>{t('dashboards.retailer.kgAvailable', { qty: p.available_kg })}</Text>
                <TouchableOpacity style={styles.kpiAddBtn} onPress={(e) => onAdd(p, e.nativeEvent)}>
                  <Text style={styles.kpiAddBtnText}>{t('dashboards.retailer.addToCart')}</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ================= Cart tab (review only — checkout moved to OrderConfirmationScreen) =================
function CartTab({ cart, totalItems, totalAmount, onChangeQty, onRemove, onCheckout }) {
  const { t, language } = useTranslation();

  if (cart.length === 0) {
    return (
      <EmptyState
        icon="🛒"
        title={t('dashboards.retailer.cart')}
        message={t('dashboards.retailer.cartEmpty')}
      />
    );
  }

  return (
    <View>
      <Text style={styles.sectionTitle}>
        {t('dashboards.retailer.cart')} {totalItems ? `· ${totalItems} kg` : ''}
      </Text>
      {cart.map((c) => {
        const tile = getVegetableTile(c.vegetable_name);
        return (
          <View key={c.vegetable_name} style={styles.cartCard}>
            <View style={[styles.rowTile, { backgroundColor: tile.bg }]}>
              <Text style={styles.rowTileIcon}>{tile.icon}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{localizeVegetableName(c.name, language)}</Text>
              <Text style={styles.rowMeta}>{peso(c.price)} / kg · {t('dashboards.retailer.subtotal', { amount: peso(c.price * c.quantity) })}</Text>
            </View>
            <View style={styles.qtyControls}>
              <TouchableOpacity style={styles.qtyBtn} onPress={() => onChangeQty(c.vegetable_name, -1)}>
                <Text style={styles.qtyBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.qtyValue}>{c.quantity}</Text>
              <TouchableOpacity style={styles.qtyBtn} onPress={() => onChangeQty(c.vegetable_name, 1)}>
                <Text style={styles.qtyBtnText}>+</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.removeBtn} onPress={() => onRemove(c.vegetable_name)}>
                <Text style={styles.removeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}

      {/* Summary */}
      <View style={styles.summaryRow}>
        <Text style={styles.summaryLabel}>{t('dashboards.retailer.total', { qty: totalItems })}</Text>
        <Text style={styles.summaryTotal}>{peso(totalAmount)}</Text>
      </View>

      <TouchableOpacity
        style={[styles.button, styles.buttonPrimary, { marginTop: 16 }]}
        onPress={onCheckout}
      >
        <Text style={styles.buttonPrimaryText}>{t('dashboards.retailer.placeOrder', { amount: peso(totalAmount) })}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ================= My Orders tab =================
export function getProofUrl(order) {
  const delivery = Array.isArray(order.deliveries) ? order.deliveries[0] : order.deliveries;
  return delivery?.proof_photo_url || null;
}

function OrdersTab({ loading, orders, onViewProof, onTrack, onCancel, onViewDetails, onViewHistory }) {
  const { t, language } = useTranslation();

  if (loading) return <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />;

  const activeOrders = orders.filter((o) => !isOldCompleted(o));

  if (activeOrders.length === 0) {
    return (
      <View>
        <TouchableOpacity style={styles.viewHistoryBtn} onPress={onViewHistory} activeOpacity={0.8}>
          <Text style={styles.viewHistoryBtnText}>{t('dashboards.retailer.viewHistoryBtn')}</Text>
        </TouchableOpacity>
        <EmptyState
          icon="🧾"
          title={t('dashboards.retailer.noOrdersTitle')}
          message={t('dashboards.retailer.noOrdersMessage')}
        />
      </View>
    );
  }

  return (
    <View>
      <View style={styles.ordersHeaderRow}>
        <Text style={styles.sectionTitle}>{t('dashboards.retailer.myOrders')}</Text>
        <TouchableOpacity style={styles.viewHistoryBtn} onPress={onViewHistory} activeOpacity={0.8}>
          <Text style={styles.viewHistoryBtnText}>{t('dashboards.retailer.viewHistoryBtn')}</Text>
        </TouchableOpacity>
      </View>
      {activeOrders.map((o) => (
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
                  • {localizeVegetableName(it.vegetable_name, language)} — {it.quantity_kg}kg @ {peso(it.price_at_order)}
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

          {/* View Details — full order breakdown (items, address, schedule, tracking). */}
          <TouchableOpacity
            style={[styles.trackBtn, styles.detailsBtn]}
            onPress={() => onViewDetails(o)}
            activeOpacity={0.8}
          >
            <Text style={styles.detailsBtnText}>{t('dashboards.retailer.viewDetailsBtn')}</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgScreen },

  headerIcons: { flexDirection: 'row', alignItems: 'center' },

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
  minimalTitle: { fontFamily: fonts.heading, fontSize: rf(19), color: colors.ink },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 16, paddingBottom: 8 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontFamily: fonts.heading, fontSize: rf(22), color: colors.ink },
  subtitle: { fontFamily: fonts.body, fontSize: rf(13.5), color: colors.inkSoft, marginTop: 2 },

  content: { padding: 16, paddingBottom: 40 },

  sectionTitle: { fontFamily: fonts.heading, fontSize: rf(17), color: colors.ink, marginBottom: 10 },
  emptyText: { fontFamily: fonts.body, color: colors.inkFaint, fontStyle: 'italic', marginTop: 8 },

  // Search bar
  searchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.ctrl, borderWidth: 1.4, borderColor: colors.border, paddingHorizontal: 12, marginBottom: 16 },
  searchIcon: { fontSize: rf(16), marginRight: 8 },
  searchInput: { flex: 1, paddingVertical: Platform.OS === 'ios' ? 12 : 8, fontFamily: fonts.body, fontSize: rf(15), color: colors.ink },
  searchClear: { fontSize: rf(16), color: colors.inkFaint, paddingLeft: 8 },

  rowCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.border, gap: 12, ...shadowCard },
  rowTile: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowTileIcon: { fontSize: rf(22) },
  rowTitle: { fontFamily: fonts.bodyBold, fontSize: rf(15), color: colors.ink, textTransform: 'capitalize' },
  rowMeta: { fontFamily: fonts.body, fontSize: rf(13.5), color: colors.inkSoft, marginTop: 2 },

  // Home tab: KPI-style product grid (2 columns).
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  kpiCard: {
    width: '47%', backgroundColor: colors.card, borderRadius: radius.card, padding: 14,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center', ...shadowCard,
  },
  kpiIconWrap: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  kpiIcon: { fontSize: rf(26) },
  kpiName: { fontFamily: fonts.bodyBold, fontSize: rf(14.5), color: colors.ink, textTransform: 'capitalize', textAlign: 'center' },
  kpiPrice: { fontFamily: fonts.bodySemiBold, fontSize: rf(13), color: PRIMARY, marginTop: 4, textAlign: 'center' },
  kpiMeta: { fontFamily: fonts.body, fontSize: rf(12), color: colors.inkSoft, marginTop: 2, textAlign: 'center' },
  kpiAddBtn: { marginTop: 10, backgroundColor: PRIMARY, paddingVertical: 8, paddingHorizontal: 16, borderRadius: radius.ctrl, alignSelf: 'stretch' },
  kpiAddBtnText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(13), textAlign: 'center' },

  smallBtnFilled: { backgroundColor: PRIMARY, paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.ctrl },
  smallBtnFilledText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(13) },

  cartCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 14, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: colors.border, gap: 12, ...shadowCard },
  qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyBtn: { width: 32, height: 32, borderRadius: 8, borderWidth: 1.4, borderColor: PRIMARY, alignItems: 'center', justifyContent: 'center' },
  qtyBtnText: { fontFamily: fonts.bodyBold, color: PRIMARY, fontSize: rf(18) },
  qtyValue: { minWidth: 24, textAlign: 'center', fontFamily: fonts.bodySemiBold, fontSize: rf(15), color: colors.ink },
  removeBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: '#FBEAE8', alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
  removeBtnText: { fontFamily: fonts.bodyBold, color: colors.danger, fontSize: rf(14) },

  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, marginTop: 4, borderTopWidth: 1, borderTopColor: colors.border },
  summaryLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(15), color: colors.ink },
  summaryTotal: { fontFamily: fonts.heading, fontSize: rf(19), color: PRIMARY },

  fieldLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(12.5), color: colors.inkSoft, marginTop: 10, marginBottom: 6 },
  input: { backgroundColor: colors.card, borderRadius: radius.ctrl, padding: 12, fontFamily: fonts.body, fontSize: rf(15), borderWidth: 1.4, borderColor: colors.border, color: colors.ink },

  button: { paddingVertical: 14, borderRadius: radius.ctrl, alignItems: 'center' },
  buttonPrimary: { backgroundColor: PRIMARY },
  buttonPrimaryText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(15.5) },
  buttonDisabled: { opacity: 0.6 },

  orderCard: { backgroundColor: colors.card, borderRadius: radius.card, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border, ...shadowCard },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  orderId: { fontFamily: fonts.bodyBold, fontSize: rf(15), color: colors.ink },
  orderTotal: { fontFamily: fonts.heading, fontSize: rf(17), color: PRIMARY, marginBottom: 4 },
  statusBadge: { paddingVertical: 3, paddingHorizontal: 10, borderRadius: 12 },
  statusBadgeText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(12), textTransform: 'capitalize' },
  itemsBox: { backgroundColor: colors.leaf50, borderRadius: radius.ctrl, padding: 10, marginTop: 8 },
  itemLine: { fontFamily: fonts.body, fontSize: rf(13), color: colors.inkSoft, marginBottom: 2 },
  cancelledNote: { fontFamily: fonts.body, fontSize: rf(13), color: colors.danger, fontStyle: 'italic', marginTop: 8 },
  proofRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, backgroundColor: colors.leaf50, borderRadius: radius.ctrl, padding: 8 },
  proofThumb: { width: 48, height: 48, borderRadius: 6, backgroundColor: colors.border },
  proofText: { fontFamily: fonts.bodySemiBold, fontSize: rf(13), color: PRIMARY },
  trackBtn: { marginTop: 10, paddingVertical: 10, borderRadius: radius.ctrl, alignItems: 'center', borderWidth: 1.4, borderColor: PRIMARY },
  trackBtnText: { fontFamily: fonts.bodyBold, color: PRIMARY, fontSize: rf(13.5) },
  cancelBtn: { borderColor: colors.danger, backgroundColor: colors.card },
  cancelBtnText: { fontFamily: fonts.bodyBold, color: colors.danger, fontSize: rf(13.5) },
  detailsBtn: { borderColor: colors.border, backgroundColor: colors.leaf50 },
  detailsBtnText: { fontFamily: fonts.bodyBold, color: colors.inkSoft, fontSize: rf(13.5) },

  ordersHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  viewHistoryBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.ctrl, borderWidth: 1.4, borderColor: PRIMARY },
  viewHistoryBtnText: { fontFamily: fonts.bodySemiBold, color: PRIMARY, fontSize: rf(13) },
});
