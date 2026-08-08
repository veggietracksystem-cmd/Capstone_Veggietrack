import { rf } from '../lib/responsive';
import { useState, useEffect, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import api from '../api/client';
import OrderStepIndicator from '../components/OrderStepIndicator';
import { useTranslation } from '../i18n/useTranslation';
import { buildStaticMapHtml } from '../lib/leafletMapHtml';

const PRIMARY = '#1E4E09';
const POLL_MS = 10000; // Issue 11: refresh order status every 10s while visible

// Fallback when the delivery address can't be geocoded (San Pablo City, Laguna).
const SAN_PABLO = { latitude: 14.0683, longitude: 121.3256 };

function statusColor(status) {
  switch (status) {
    case 'pending': return '#f9a825';
    case 'approved':
    case 'assigned': return '#1976d2';
    case 'in_transit': return '#7b1fa2';
    case 'delivered': return PRIMARY;
    case 'cancelled': return '#c62828';
    default: return '#607d8b';
  }
}

// Very rough "ETA" placeholder keyed off status (no routing API wired up yet).
function mockEta(status, t) {
  switch (status) {
    case 'delivered': return t('orderTracking.etaDelivered');
    case 'in_transit': return t('orderTracking.etaInTransit');
    case 'assigned':
    case 'approved': return t('orderTracking.etaDispatched');
    default: return t('orderTracking.etaAwaitingDispatch');
  }
}

// Reachable via navigation.navigate('OrderTracking', { orderId, deliveryAddress, orderStatus }).
export default function OrderTrackingScreen({ route, navigation }) {
  const { t } = useTranslation();
  const { orderId, deliveryAddress: initialAddress, orderStatus = 'pending' } = route.params || {};

  const [address, setAddress] = useState(initialAddress || '');
  const [loading, setLoading] = useState(true);
  const [destination, setDestination] = useState(null);
  const [geocodeFailed, setGeocodeFailed] = useState(false);
  // Live status: seed from the param, then keep it fresh by polling (Issue 11).
  const [status, setStatus] = useState(orderStatus);

  // Poll this order's status every 10s so the tracker advances in near-real-time
  // as the rider marks picked up / in transit / delivered. Stops on unmount.
  useEffect(() => {
    if (!orderId) return undefined;
    let active = true;
    const fetchStatus = async () => {
      try {
        const order = await api.get(`/api/orders/${orderId}`);
        if (active) {
          if (order?.status) setStatus(order.status);
          if (order?.delivery_address) setAddress(order.delivery_address);
        }
      } catch {
        // Ignore transient errors; keep the last known status.
      }
    };
    fetchStatus();
    const id = setInterval(fetchStatus, POLL_MS);
    return () => { active = false; clearInterval(id); };
  }, [orderId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setGeocodeFailed(false);
      try {
        let activeAddr = address;
        if (!activeAddr && orderId) {
          const order = await api.get(`/api/orders/${orderId}`);
          activeAddr = order?.delivery_address;
          if (activeAddr && !cancelled) setAddress(activeAddr);
        }

        if (activeAddr) {
          // expo-location's built-in geocoder — no extra dependency or API key.
          const geo = await Location.geocodeAsync(activeAddr);
          if (!cancelled && geo && geo[0]) {
            setDestination({ latitude: geo[0].latitude, longitude: geo[0].longitude });
          } else if (!cancelled) {
            setGeocodeFailed(true);
            setDestination(SAN_PABLO);
          }
        } else if (!cancelled) {
          setDestination(SAN_PABLO);
        }
      } catch {
        if (!cancelled) { setGeocodeFailed(true); setDestination(SAN_PABLO); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [address, orderId]);

  const anchor = destination || SAN_PABLO;
  const [webviewError, setWebviewError] = useState(null);

  const html = useMemo(() => buildStaticMapHtml({
    centerLat: anchor.latitude,
    centerLng: anchor.longitude,
    zoom: 14,
    markers: destination
      ? [{ lat: destination.latitude, lng: destination.longitude, color: '#d32f2f', popup: address || 'Delivery address' }]
      : [],
  }), [anchor.latitude, anchor.longitude, destination, address]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>‹ {t('common.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          {orderId ? t('orderTracking.orderNumber', { id: String(orderId).slice(0, 8) }) : t('orderTracking.titleFallback')}
        </Text>
        <View style={{ width: 50 }} />
      </View>

      {/* Status + ETA banner */}
      <View style={styles.infoBar}>
        <View style={[styles.statusBadge, { backgroundColor: statusColor(status) }]}>
          <Text style={styles.statusBadgeText}>{String(status).replace(/_/g, ' ')}</Text>
        </View>
        <Text style={styles.eta}>{t('orderTracking.etaLabel', { eta: mockEta(status, t) })}</Text>
      </View>
      {address ? <Text style={styles.addr}>📍 {address}</Text> : null}

      {/* Issue 11: Shopee-like progress stepper, kept live by the poll above. */}
      {status !== 'cancelled' ? (
        <View style={styles.stepperWrap}>
          <OrderStepIndicator status={status} />
        </View>
      ) : null}

      {loading ? (
        <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />
      ) : (
        <>
          <WebView
            key={`${anchor.latitude},${anchor.longitude}`}
            originWhitelist={['*']}
            source={{ html }}
            style={styles.map}
            onError={() => setWebviewError('Could not load the map. Check your internet connection.')}
          />
          {webviewError ? <Text style={styles.note}>{webviewError}</Text> : null}
          {geocodeFailed ? (
            <Text style={styles.note}>
              {t('orderTracking.geocodeFailedNative')}
            </Text>
          ) : null}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  back: { color: PRIMARY, fontSize: rf(16), fontWeight: '600', width: 50 },
  title: { fontSize: rf(17), fontWeight: '700', color: '#222', flex: 1, textAlign: 'center' },
  infoBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 6 },
  statusBadge: { paddingVertical: 3, paddingHorizontal: 12, borderRadius: 12 },
  statusBadgeText: { color: '#fff', fontSize: rf(13), fontWeight: '600', textTransform: 'capitalize' },
  eta: { fontSize: rf(14), color: '#555' },
  addr: { fontSize: rf(14), color: '#555', paddingHorizontal: 16, marginBottom: 8 },
  stepperWrap: { paddingHorizontal: 12, paddingBottom: 10 },
  map: { flex: 1 },
  note: { color: '#888', fontSize: rf(13), padding: 12, fontStyle: 'italic' },
});
