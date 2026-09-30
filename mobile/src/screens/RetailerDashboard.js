import useRequestLock from '../hooks/useRequestLock';
import useLatestRequest from '../hooks/useLatestRequest';
import useRefreshOnFocus from '../hooks/useRefreshOnFocus';
import { readCart, saveCart, subscribeCart, reconcileCart } from '../lib/cartStore';
import { rf } from '../lib/responsive';
import { useState, useEffect, useCallback } from 'react';
import { SharedScreenTransition } from '../lib/motion';
import {
  Text, View, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet, Platform, RefreshControl,
} from 'react-native';
import TextInput from '../components/AppTextInput';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../api/client';
import { readThrough } from '../offline/cache';
import { useAuth } from '../context/AuthContext';
import ScreenHeader from '../components/ScreenHeader';
import HomeHeaderActions from '../components/HomeHeaderActions';
import BottomNavBar, { useBottomNavSpace } from '../components/BottomNavBar';
import OfflineBanner from '../components/OfflineBanner';
import CustomModal from '../components/CustomModal';
import StatusBadge from '../components/ui/StatusBadge';
import EmptyState from '../components/EmptyState';
import AddToCartFlyOverlay from '../components/AddToCartFlyOverlay';
import VegetableImage from '../components/VegetableImage';
import { getVegetableTile, getVegetableIcon } from '../lib/vegetableIcons';
import { localizeVegetableName, vegetableKey } from '../lib/vegetableNames';
import { showAlert, confirmAction, peso, shortId } from '../lib/ui';
import { friendlyError } from '../lib/errorMessages';
import { isClosedOrderStatus } from '../lib/orderStatus';
import { colors, fontSize, fonts, radius, shadowCard, actionBtn, actionBtnOutline, actionBtnPrimary, actionBtnDanger, actionBtnText } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';
import { useAutoSync } from '../sync/SyncProvider';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import RemoteImage from '../components/RemoteImage';

const PRIMARY = colors.leaf700;

const BOTTOM_TAB_FOR = { shop: 'home', cart: 'cart', orders: 'orders' };

export function statusColor(status) {
  switch (status) {
    case 'pending': return colors.gold500;
    case 'approved':
    case 'assigned': return colors.info;
    case 'in_transit': return colors.purple;
    case 'delivered': return PRIMARY;
    case 'cancelled':
    case 'unsuccessful': return colors.danger;
    default: return colors.soil600;
  }
}

// The embedded deliveries relation comes back as an array; take the first record.
export function getDelivery(order) {
  if (Array.isArray(order.deliveries)) return order.deliveries[0] || null;
  return order.deliveries || null;
}

const HISTORY_AFTER_DAYS = 5;

export function isOldCompleted(order) {
  if (order.status !== 'delivered') return false;
  const deliveredAt = getDelivery(order)?.delivered_at;
  if (!deliveredAt) return false;
  const ageMs = Date.now() - new Date(deliveredAt).getTime();
  return ageMs > HISTORY_AFTER_DAYS * 24 * 60 * 60 * 1000;
}

export default function RetailerDashboard({ navigation, route }) {
  const navSpace = useBottomNavSpace();
  const beginRead = useLatestRequest();
  const requestLock = useRequestLock();
  const [cancelling, setCancelling] = useState(false);
  const { user } = useAuth();
  const { t, language } = useTranslation();

  const [tab, setTab] = useState('shop');
  const activeBottomTab = BOTTOM_TAB_FOR[tab] || 'home';

  const handleBottomTabPress = (tab) => {
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
    }
    // Params object is new on every navigate, so a repeated tab still applies.
  }, [route.params]);

  useEffect(() => {
    if (route.params?.orderPlaced) {
      setCart([]);
      setAddress(user?.store_location || '');
      Promise.all([loadOrders(), loadProducts()]);
      navigation.setParams({ orderPlaced: false, tab: undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.orderPlaced]);

  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [cart, setCart] = useState([]);
  const [cartReady, setCartReady] = useState(false);
  const [freshProducts, setFreshProducts] = useState(null);
  useEffect(() => {
    let active = true;
    setCartReady(false);
    setCart([]);
    readCart(user.id).then(saved => { if (active) { setCart(saved); setCartReady(true); } })
      .catch(() => { if (active) showAlert(t('common.error'), t('checkout.cartStorageError')); });
    const unsubscribe = subscribeCart(user.id, setCart);
    return () => { active = false; unsubscribe(); };
  }, [user.id]);
  useEffect(() => {
    if (cartReady) saveCart(user.id, cart).catch(() => showAlert(t('common.error'), t('checkout.cartStorageError')));
  }, [cart, cartReady, user.id]);
  useEffect(() => {
    if (cartReady && freshProducts) setCart(previous => reconcileCart(previous, freshProducts));
  }, [cartReady, freshProducts]);
  const [address, setAddress] = useState('');
  const [flights, setFlights] = useState([]);
  const [cartIconTarget, setCartIconTarget] = useState(null);

  const handleTabMeasure = (tabId, rect) => {
    if (tabId === 'cart') {
      setCartIconTarget({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
    }
  };

  useEffect(() => {
    if (user?.store_location && !address) {
      setAddress(user.store_location);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.store_location]);

  const [orders, setOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(true);

  const [refreshing, setRefreshing] = useState(false);
  const [shopOffline, setShopOffline] = useState(false);
  const [ordersOffline, setOrdersOffline] = useState(false);
  const [selectedVegetable, setSelectedVegetable] = useState(null);
  const selectedProduct = products.find((product) => vegetableKey(product.vegetable_name) === selectedVegetable) || null;

  const loadProducts = useCallback(async () => {
    const isCurrent = beginRead('loadProducts');
    const { list, source } = await readThrough('available_products_cache', () =>
      api.get('/api/products/available')
    );
    if (!isCurrent()) return;
    setProducts(list);
    if (source === 'network') setFreshProducts(list);
    setShopOffline(source === 'cache');
  }, []);

  const loadOrders = useCallback(async () => {
    const isCurrent = beginRead('loadOrders');
    const { list, source } = await readThrough('my_orders_cache', () =>
      api.get('/api/orders')
    );
    if (!isCurrent()) return;
    setOrders(list);
    setOrdersOffline(source === 'cache');
  }, []);

  const { syncState } = useAutoSync('retailer-dashboard', useCallback(async () => {
    await Promise.all([loadProducts(), loadOrders()]);
  }, [loadProducts, loadOrders]));

  useEffect(() => {
    (async () => {
      setLoadingProducts(true);
      setLoadingOrders(true);
      await Promise.all([loadProducts(), loadOrders()]);
      setLoadingProducts(false);
      setLoadingOrders(false);
    })();
  }, [loadProducts, loadOrders]);

  useRefreshOnFocus(() => Promise.all([loadProducts(), loadOrders()]));

  const onRefresh = async () => {
    if (!requestLock.acquire('refresh')) return;
    setRefreshing(true);
    try {
      if (tab === 'shop' || tab === 'cart') await loadProducts();
      else if (tab === 'orders') await loadOrders();
    } catch (err) {
      showAlert(t('common.error'), friendlyError(err));
    } finally {
      requestLock.release('refresh');
      setRefreshing(false);
    }
  };

  // Cart entries identify vegetables; the backend chooses FIFO batches at checkout.
  const addToCart = (product, touchEvent) => {
    if (!cartReady || !product) return;
    const stock = Number(product.available_kg);
    const key = vegetableKey(product.vegetable_name);
    if (!Number.isFinite(stock) || stock <= 0) {
      showAlert(t('dashboards.retailer.outOfStockTitle'), t('dashboards.retailer.outOfStockMessage', { name: localizeVegetableName(product.vegetable_name, language) }));
      return;
    }
    setCart((prev) => {
      const existing = prev.find((c) => vegetableKey(c.vegetable_name) === key);
      if (existing) {
        if (existing.quantity >= stock) {
          showAlert(t('dashboards.retailer.limitReachedTitle'), t('dashboards.retailer.limitReachedMessage', { qty: product.available_kg, name: localizeVegetableName(product.vegetable_name, language) }));
          return prev;
        }
        return prev.map((c) =>
          vegetableKey(c.vegetable_name) === key ? { ...c, quantity: Math.min(Number(c.quantity) + 1, stock), stock, price: Number(product.price_per_kg) } : c
        );
      }
      return [
        ...prev,
        {
          vegetable_name: product.vegetable_name,
          name: product.vegetable_name,
          price: Number(product.price_per_kg),
          quantity: Math.min(1, stock),
          stock,
        },
      ];
    });

    const startX = touchEvent?.pageX;
    const startY = touchEvent?.pageY;
    if (typeof startX === 'number' && typeof startY === 'number') {
      const flightId = `${Date.now()}-${Math.random()}`;
      setFlights((prev) => [
        ...prev,
        { id: flightId, startX, startY, source: getVegetableIcon(product.vegetable_name) },
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
        if (next <= 0) return [];
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

  const goToCheckout = () => {
    if (cart.length === 0) {
      showAlert(t('dashboards.retailer.emptyCartTitle'), t('dashboards.retailer.emptyCartMessage'));
      return;
    }
    if (!cartReady || totalItems < 5) {
      showAlert(t('common.error'), t('checkout.minimumWeight'));
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
        if (!requestLock.acquire('cancel')) return;
        setCancelling(true);
        try {
          await api.put(`/api/orders/${orderId}/cancel`);
          showAlert(t('dashboards.retailer.orderSuccessTitle'), t('dashboards.retailer.orderCancelledMessage'));
      beginRead('loadOrders');
          setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'cancelled' } : o));
          await Promise.all([loadOrders(), loadProducts()]);
        } catch (err) {
          showAlert(t('common.error'), friendlyError(err));
        } finally {
          requestLock.release('cancel');
          setCancelling(false);
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
      <ScreenHeader
        title={tab === 'cart' ? t('dashboards.retailer.tabCart') : tab === 'orders' ? t('dashboards.retailer.tabOrders') : t('dashboards.retailer.tabHome')}
        right={tab === 'shop' ? <HomeHeaderActions /> : null}
      />

      <SharedScreenTransition style={{ flex: 1 }} visible>
        <ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.content, { paddingBottom: navSpace }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <OfflineBanner offline={syncState === 'offline' && (tab === 'shop' ? shopOffline : tab === 'orders' ? ordersOffline : false)} />

        {tab === 'shop' && (
          <HomeTab
            loading={loadingProducts}
            products={products}
            orders={orders}
            cart={cart}
            searchQuery={searchQuery} setSearchQuery={setSearchQuery}
            onAdd={addToCart}
            onSelect={(product) => setSelectedVegetable(vegetableKey(product.vegetable_name))}
            onTrackOrder={(o) => navigation.navigate('ShopeeTracking', { orderId: o.id })}
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
              cancelling={cancelling}
              onCancel={cancelOrder}
              onViewDetails={(o) => navigation.navigate('OrderDetails', { order: o })}
              onViewHistory={() => navigation.navigate('OrderHistory')}
            />
          )}
        </ScrollView>
      </SharedScreenTransition>

      <BottomNavBar
        tabs={RETAILER_TABS}
        activeTab={activeBottomTab}
        onTabPress={handleBottomTabPress}
        onTabMeasure={handleTabMeasure}
      />
      <AddToCartFlyOverlay flights={flights} target={cartIconTarget} onDone={removeFlight} />
      <CustomModal visible={!!selectedProduct} title={selectedProduct ? localizeVegetableName(selectedProduct.vegetable_name, language) : ''}
        cancelLabel={t('common.close')} onCancel={() => setSelectedVegetable(null)}
        confirmLabel={t('dashboards.retailer.addToCart')} onConfirm={() => { addToCart(selectedProduct); setSelectedVegetable(null); }}
        confirmDisabled={!(selectedProduct?.available_kg > 0)}>
        <ProductPhotos key={`${selectedProduct?.vegetable_name}:${selectedProduct?.batch_photos?.join('|') || selectedProduct?.batch_photo_url || ''}`} product={selectedProduct} />
        <Text style={styles.productModalPrice}>{peso(selectedProduct?.price_per_kg)} / kg</Text>
        <Text style={styles.productModalMeta}>
          {selectedProduct?.available_kg > 0
            ? t('dashboards.retailer.kgAvailable', { qty: selectedProduct.available_kg })
            : t('dashboards.retailer.outOfStockTitle')}
        </Text>
        <Text style={styles.productModalHint}>{t('cmp.addToCartHint')}</Text>
      </CustomModal>
    </SafeAreaView>
  );
}

// Photos follow FIFO batch order. Older cached responses contain only one URL.
function ProductPhotos({ product }) {
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  const photos = product?.batch_photos?.length
    ? product.batch_photos
    : (product?.batch_photo_url ? [product.batch_photo_url] : []);

  if (photos.length === 0) {
    const tile = getVegetableTile(product?.vegetable_name);
    return (
      <View style={[styles.productModalFallback, { backgroundColor: tile.bg }]}>
        <VegetableImage source={tile.source} style={styles.productModalIcon} fallbackSize={rf(72)} />
      </View>
    );
  }

  const onScroll = (e) => {
    if (width > 0) setPage(Math.round(e.nativeEvent.contentOffset.x / width));
  };
  return (
    <View>
      <View style={styles.productModalPager} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 && (
          <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}
            scrollEnabled={photos.length > 1} onScroll={onScroll} scrollEventThrottle={32}>
            {photos.map((uri) => (
              <RemoteImage key={uri} uri={uri} style={[styles.productModalPhoto, { width }]} resizeMode="cover" />
            ))}
          </ScrollView>
        )}
      </View>
      {photos.length > 1 && (
        <View style={styles.photoDots} accessibilityLabel={`${page + 1} / ${photos.length}`}>
          {photos.map((uri, i) => <View key={uri} style={[styles.photoDot, i === page && styles.photoDotActive]} />)}
        </View>
      )}
    </View>
  );
}

function HomeTab({ loading, products, orders, cart, searchQuery, setSearchQuery, onAdd, onSelect, onTrackOrder }) {
  const { t, language } = useTranslation();

  if (loading) return <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />;

  const query = searchQuery.trim().toLowerCase();
  const filteredProducts = products.filter(
    (p) => !query || [p.vegetable_name, localizeVegetableName(p.vegetable_name, 'en'), localizeVegetableName(p.vegetable_name, 'tl')]
      .some((name) => String(name || '').toLowerCase().includes(query))
  );

  const activeOrder = (orders || []).find((o) => !isClosedOrderStatus(o.status));

  return (
    <View>
      <View style={styles.searchRow}>
        <Ionicons name="search-outline" size={rf(19)} color="#999" />
        <TextInput
          style={styles.searchInput}
          placeholder={t('dashboards.retailer.searchPlaceholder')} placeholderTextColor={colors.placeholder}
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle-outline" size={rf(20)} color="#999" />
          </TouchableOpacity>
        )}
      </View>

      <Text style={styles.sectionTitle}>{t('dashboards.retailer.availableProducts')}</Text>
      {products.length === 0 ? (
        <EmptyState
          iconElement={<MaterialCommunityIcons name="sprout" size={rf(44)} color={colors.inkFaint} />}
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
            const isOut = !(Number(p.available_kg) > 0);
            const inCartQty = (cart || []).find((c) => vegetableKey(c.vegetable_name) === vegetableKey(p.vegetable_name))?.quantity;
            return (
              <TouchableOpacity key={p.vegetable_name} style={styles.kpiCard} onPress={() => onSelect(p)} activeOpacity={0.82} accessibilityRole="button" accessibilityLabel={`View ${p.vegetable_name} details`}>
                <View style={[styles.kpiIconWrap, { backgroundColor: tile.bg }]}>
                  <VegetableImage source={tile.source} style={styles.kpiIcon} fallbackSize={rf(26)} />
                </View>
                <Text style={styles.kpiName} numberOfLines={1}>{localizeVegetableName(p.vegetable_name, language)}</Text>
                <Text style={styles.kpiMeta}>
                  {isOut ? t('dashboards.retailer.outOfStockTitle') : t('dashboards.retailer.kgAvailable', { qty: p.available_kg })}
                </Text>
                <View style={styles.kpiBottomRow}>
                  <Text style={styles.kpiPrice}>{peso(p.price_per_kg)}/kg</Text>
                  <TouchableOpacity
                    style={[styles.kpiAddCircle, isOut && styles.kpiAddCircleDisabled]}
                    disabled={isOut}
                    onPress={(e) => { e.stopPropagation?.(); onAdd(p, e.nativeEvent); }}
                    accessibilityLabel={t('dashboards.retailer.addToCart')}
                  >
                    <Text style={styles.kpiAddCircleText}>{inCartQty || '+'}</Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {!!activeOrder && (
        <View style={styles.activeOrderSection}>
          <Text style={styles.sectionTitle}>{t('ordy.activeOrder')}</Text>
          <TouchableOpacity style={styles.activeOrderCard} onPress={() => onTrackOrder(activeOrder)} activeOpacity={0.85}>
            <View style={styles.activeOrderHeader}>
              <Text style={styles.activeOrderTitle}>{t('dashboards.retailer.orderNumber', { id: shortId(activeOrder.id) })}</Text>
              <StatusBadge status={activeOrder.status} />
            </View>
            <Text style={styles.activeOrderSub}>
              {activeOrder.delivery_personnel_name
                ? t('dashboards.retailer.riderLabel', { name: activeOrder.delivery_personnel_name })
                : t('dashboards.retailer.awaitingRider')}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function CartTab({ cart, totalItems, totalAmount, onChangeQty, onRemove, onCheckout }) {
  const { t, language } = useTranslation();

  if (cart.length === 0) {
    return (
      <EmptyState
        iconElement={<Ionicons name="cart-outline" size={rf(44)} color={colors.inkFaint} />}
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
              <VegetableImage source={tile.source} style={styles.rowTileIcon} fallbackSize={rf(22)} />
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
                <Ionicons name="close" size={rf(18)} color={colors.danger} />
              </TouchableOpacity>
            </View>
          </View>
        );
      })}

      <View style={styles.summaryRow}>
        <Text style={styles.summaryLabel}>{t('dashboards.retailer.total', { qty: totalItems })}</Text>
        <Text style={styles.summaryTotal}>{peso(totalAmount)}</Text>
      </View>

      {totalItems < 5 && <Text style={{ color: colors.danger }}>{t('checkout.minimumWeight')}</Text>}
      <TouchableOpacity
        style={[styles.button, styles.buttonPrimary, { marginTop: 16, opacity: totalItems < 5 ? 0.5 : 1 }]}
        onPress={onCheckout}
        disabled={totalItems < 5}
      >
        <Text style={styles.buttonPrimaryText}>{t('dashboards.retailer.placeOrder', { amount: peso(totalAmount) })}</Text>
      </TouchableOpacity>
    </View>
  );
}

export function getProofUrl(order) {
  const delivery = Array.isArray(order.deliveries) ? order.deliveries[0] : order.deliveries;
  return delivery?.proof_photo_url || null;
}

function OrdersTab({ loading, cancelling, orders, onCancel, onViewDetails, onViewHistory }) {
  const { t } = useTranslation();

  if (loading) return <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />;

  const activeOrders = orders.filter((o) => !isOldCompleted(o));

  if (activeOrders.length === 0) {
    return (
      <View>
        <EmptyState
          iconElement={<Ionicons name="receipt-outline" size={rf(44)} color={colors.inkFaint} />}
          title={t('dashboards.retailer.noOrdersTitle')}
          message={t('dashboards.retailer.noOrdersMessage')}
        />
        <HistoryCard onPress={onViewHistory} />
      </View>
    );
  }

  return (
    <View>
      <Text style={[styles.sectionTitle, styles.ordersHeaderTitle]}>{t('dashboards.retailer.myOrders')}</Text>
      {activeOrders.map((o) => (
        <View key={o.id} style={styles.orderCard}>
          <View style={styles.orderHeader}>
            <Text style={styles.orderId}>{t('dashboards.retailer.orderNumber', { id: shortId(o.id) })}</Text>
            <StatusBadge status={o.status} />
          </View>
          <Text style={styles.orderTotal}>{peso(o.total_amount)}</Text>

          {o.status === 'pending' && (
            <TouchableOpacity
              style={[styles.trackBtn, styles.cancelBtn]}
              disabled={cancelling}
              onPress={() => onCancel(o.id)}
              activeOpacity={0.8}
            >
              <Text style={styles.cancelBtnText}>{t('dashboards.retailer.cancelOrderBtn')}</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.trackBtn, styles.detailsBtn]}
            onPress={() => onViewDetails(o)}
            activeOpacity={0.8}
          >
            <Text style={styles.detailsBtnText}>{t('dashboards.retailer.viewDetailsBtn')}</Text>
          </TouchableOpacity>
        </View>
      ))}
      <HistoryCard onPress={onViewHistory} />
    </View>
  );
}

function HistoryCard({ onPress }) {
  const { t } = useTranslation();
  return (
    <TouchableOpacity style={styles.historyCard} onPress={onPress} activeOpacity={0.8} accessibilityRole="button">
      <View style={styles.historyIconBox}>
        <Ionicons name="time-outline" size={rf(20)} color={PRIMARY} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.historyTitle}>{t('dashboards.retailer.viewHistoryBtn')}</Text>
        <Text style={styles.historySub}>{t('ordx.historySub')}</Text>
      </View>
      <Ionicons name="chevron-forward" size={rf(18)} color={colors.inkFaint} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 16, paddingBottom: 8 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontFamily: fonts.heading, fontSize: rf(fontSize.title), color: colors.ink },
  subtitle: { fontFamily: fonts.body, fontSize: rf(fontSize.md), color: colors.inkSoft, marginTop: 2 },

  content: { padding: 16, paddingBottom: 40 },

  sectionTitle: { fontFamily: fonts.heading, fontSize: rf(fontSize.xl), color: colors.ink, marginBottom: 10 },
  emptyText: { fontFamily: fonts.body, color: colors.inkFaint, fontStyle: 'italic', marginTop: 8 },

  activeOrderSection: { marginTop: 20 },
  activeOrderCard: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 16, borderWidth: 1, borderColor: colors.border, gap: 6, ...shadowCard },
  activeOrderHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  activeOrderTitle: { flexShrink: 1, fontFamily: fonts.bodyBold, fontSize: rf(fontSize.lg), color: colors.ink },
  activeOrderSub: { fontFamily: fonts.body, fontSize: rf(fontSize.md), color: colors.inkSoft },

  searchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.ctrl, borderWidth: 1.4, borderColor: colors.border, paddingHorizontal: 12, marginBottom: 16 },
  searchIcon: { fontSize: rf(fontSize.lg), marginRight: 8 },
  searchInput: { flex: 1, paddingVertical: Platform.OS === 'ios' ? 12 : 8, fontFamily: fonts.body, fontSize: rf(fontSize.lg), color: colors.ink },
  searchClear: { fontSize: rf(fontSize.lg), color: colors.inkFaint, paddingLeft: 8 },

  rowCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.border, gap: 12, ...shadowCard },
  rowTile: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowTileIcon: { width: 30, height: 30 },
  rowTitle: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.lg), color: colors.ink, textTransform: 'capitalize' },
  rowMeta: { fontFamily: fonts.body, fontSize: rf(fontSize.md), color: colors.inkSoft, marginTop: 2 },

  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  kpiCard: {
    width: '47%', backgroundColor: colors.surface, borderRadius: radius.card, padding: 10,
    borderWidth: 1, borderColor: colors.border, ...shadowCard,
  },
  kpiIconWrap: { width: '100%', height: 72, borderRadius: radius.ctrl, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  kpiIcon: { width: 40, height: 40 },
  kpiName: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.md), color: colors.ink, textTransform: 'capitalize' },
  kpiMeta: { fontFamily: fonts.body, fontSize: rf(fontSize.sm), color: colors.inkSoft, marginTop: 2, marginBottom: 8 },
  kpiBottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kpiPrice: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), color: colors.leaf900 || PRIMARY },
  kpiAddCircle: { width: 26, height: 26, borderRadius: 13, backgroundColor: PRIMARY, alignItems: 'center', justifyContent: 'center' },
  kpiAddCircleDisabled: { backgroundColor: colors.soil300 },
  kpiAddCircleText: { fontFamily: fonts.bodyBold, color: '#fff', fontSize: rf(fontSize.md) },
  productModalPhoto: { width: '100%', height: 210, borderRadius: radius.ctrl, backgroundColor: colors.leaf50 },
  productModalPager: { height: 210, borderRadius: radius.ctrl, overflow: 'hidden', backgroundColor: colors.leaf50 },
  photoDots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 8 },
  photoDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.soil300 },
  photoDotActive: { backgroundColor: PRIMARY },
  productModalFallback: { height: 160, borderRadius: radius.ctrl, alignItems: 'center', justifyContent: 'center' },
  productModalIcon: { width: 90, height: 90 },
  productModalPrice: { fontFamily: fonts.heading, fontSize: rf(fontSize.title), color: PRIMARY, marginTop: 12 },
  productModalMeta: { fontFamily: fonts.bodySemiBold, color: colors.inkSoft, marginTop: 4 },
  productModalHint: { fontFamily: fonts.body, color: colors.inkSoft, fontSize: rf(fontSize.sm), marginTop: 10 },

  smallBtnFilled: { ...actionBtn, ...actionBtnPrimary },
  smallBtnFilledText: { ...actionBtnText, color: '#fff' },

  cartCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 14, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: colors.border, gap: 12, ...shadowCard },
  qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyBtn: { width: 32, height: 32, borderRadius: 8, borderWidth: 1.4, borderColor: PRIMARY, alignItems: 'center', justifyContent: 'center' },
  qtyBtnText: { fontFamily: fonts.bodyBold, color: PRIMARY, fontSize: rf(fontSize.xl), textAlign: 'center' },
  qtyValue: { minWidth: 24, textAlign: 'center', fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.lg), color: colors.ink },
  removeBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: colors.dangerSoft, alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
  removeBtnText: { fontFamily: fonts.bodyBold, color: colors.danger, fontSize: rf(fontSize.md), textAlign: 'center' },

  summaryRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, marginTop: 8,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, ...shadowCard,
  },
  summaryLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.lg), color: colors.ink },
  summaryTotal: { fontFamily: fonts.heading, fontSize: rf(fontSize.title), color: PRIMARY },

  fieldLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), color: colors.labelInk, marginTop: 10, marginBottom: 6 },
  input: { backgroundColor: colors.card, borderRadius: radius.ctrl, padding: 12, fontFamily: fonts.body, fontSize: rf(fontSize.lg), borderWidth: 1.4, borderColor: colors.border, color: colors.ink },

  button: { paddingVertical: 14, borderRadius: radius.ctrl, alignItems: 'center' },
  buttonPrimary: { backgroundColor: PRIMARY },
  buttonPrimaryText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(fontSize.lg) },
  buttonDisabled: { opacity: 0.6 },

  orderCard: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border, ...shadowCard },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  orderId: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.lg), color: colors.ink },
  orderTotal: { fontFamily: fonts.heading, fontSize: rf(fontSize.xl), color: PRIMARY, marginBottom: 4 },
  trackBtn: { ...actionBtn, ...actionBtnOutline, marginTop: 10 },
  trackBtnText: { ...actionBtnText, color: PRIMARY },
  cancelBtn: { ...actionBtnDanger },
  cancelBtnText: { ...actionBtnText, color: colors.danger },
  detailsBtn: { ...actionBtnOutline, minHeight: 44, paddingVertical: 10 },
  detailsBtnText: { ...actionBtnText, fontSize: 14, color: PRIMARY },

  ordersHeaderTitle: { marginBottom: 10 },
  historyCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12, backgroundColor: colors.leaf50, borderRadius: radius.card, padding: 14, borderWidth: 1, borderColor: colors.leaf100 },
  historyIconBox: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.leaf100, alignItems: 'center', justifyContent: 'center' },
  historyTitle: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.md), color: colors.ink },
  historySub: { fontFamily: fonts.body, fontSize: rf(fontSize.sm), color: colors.inkSoft, marginTop: 2 },
});
