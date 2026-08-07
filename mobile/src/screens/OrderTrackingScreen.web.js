import { rf } from '../lib/responsive';
import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../api/client';
import OrderStepIndicator from '../components/OrderStepIndicator';
import { useTranslation } from '../i18n/useTranslation';

const PRIMARY = '#1E4E09';
const POLL_MS = 10000;
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

function mockEta(status, t) {
  switch (status) {
    case 'delivered': return t('orderTracking.etaDelivered');
    case 'in_transit': return t('orderTracking.etaInTransit');
    case 'assigned':
    case 'approved': return t('orderTracking.etaDispatched');
    default: return t('orderTracking.etaAwaitingDispatch');
  }
}

export default function OrderTrackingScreen({ route, navigation }) {
  const { t } = useTranslation();
  const { orderId, deliveryAddress: initialAddress, orderStatus = 'pending' } = route.params || {};
  const [status, setStatus] = useState(orderStatus);
  const [address, setAddress] = useState(initialAddress || '');
  const [loading, setLoading] = useState(true);
  const [destination, setDestination] = useState(null);
  const [geocodeFailed, setGeocodeFailed] = useState(false);
  const [leafletLoaded, setLeafletLoaded] = useState(false);

  // Poll order status every 10s
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
      } catch { /* keep last known */ }
    };
    fetchStatus();
    const id = setInterval(fetchStatus, POLL_MS);
    return () => { active = false; clearInterval(id); };
  }, [orderId]);

  // Load Leaflet CDN script dynamically on web
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (window.L) {
      setLeafletLoaded(true);
      return;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => setLeafletLoaded(true);
    document.head.appendChild(script);
  }, []);

  // Geocoding: Fetch coordinates
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
          // Use OpenStreetMap Nominatim for free geocoding
          const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(activeAddr)}`);
          const data = await res.json();
          if (!cancelled && data && data[0]) {
            setDestination({
              latitude: parseFloat(data[0].lat),
              longitude: parseFloat(data[0].lon)
            });
          } else if (!cancelled) {
            setGeocodeFailed(true);
            setDestination(SAN_PABLO);
          }
        } else if (!cancelled) {
          setDestination(SAN_PABLO);
        }
      } catch (err) {
        console.warn('[TrackingWeb] Geocoding failed:', err);
        if (!cancelled) {
          setGeocodeFailed(true);
          setDestination(SAN_PABLO);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [address, orderId]);

  // Initialize and update Leaflet Map
  useEffect(() => {
    if (!leafletLoaded || !destination || Platform.OS !== 'web') return;

    const container = document.getElementById('leaflet-map');
    if (!container) return;

    const map = window.L.map('leaflet-map').setView([destination.latitude, destination.longitude], 14);

    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    const marker = window.L.marker([destination.latitude, destination.longitude]).addTo(map);
    if (address) {
      marker.bindPopup(`<b>Delivery Address</b><br>${address}`).openPopup();
    }

    return () => {
      map.remove();
    };
  }, [leafletLoaded, destination, address]);

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

      <View style={styles.infoBar}>
        <View style={[styles.statusBadge, { backgroundColor: statusColor(status) }]}>
          <Text style={styles.statusBadgeText}>{String(status).replace(/_/g, ' ')}</Text>
        </View>
        <Text style={styles.eta}>{t('orderTracking.etaLabel', { eta: mockEta(status, t) })}</Text>
      </View>
      {address ? <Text style={styles.addr}>📍 {address}</Text> : null}

      {status !== 'cancelled' ? (
        <View style={styles.stepperWrap}>
          <OrderStepIndicator status={status} />
        </View>
      ) : null}

      {loading ? (
        <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />
      ) : (
        <View style={styles.mapContainer}>
          {Platform.OS === 'web' ? (
            <div id="leaflet-map" style={{ width: '100%', height: '100%', borderRadius: '12px' }} />
          ) : (
            <Text style={styles.errorMsg}>{t('orderTracking.mapUnavailable')}</Text>
          )}
          {geocodeFailed ? (
            <Text style={styles.note}>
              {t('orderTracking.geocodeFailedWeb')}
            </Text>
          ) : null}
        </View>
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
  mapContainer: { flex: 1, margin: 16, borderRadius: 12, overflow: 'hidden', borderHeight: 1, borderColor: '#eee', backgroundColor: '#f9f9f9', minHeight: 300 },
  errorMsg: { textAlign: 'center', padding: 40, color: '#888' },
  note: { color: '#e65100', fontSize: rf(12), padding: 10, fontStyle: 'italic', backgroundColor: '#fff3e0', textAlign: 'center' },
});
