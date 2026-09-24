import { rf } from '../lib/responsive';
import { useState, useEffect, useMemo } from 'react';
import {
  View, Text, Modal, TouchableOpacity, ActivityIndicator, StyleSheet,
} from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import { colors, fonts, radius } from '../theme/appTheme';
import { buildStaticMapHtml } from '../lib/leafletMapHtml';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '../i18n/useTranslation';

const PRIMARY = colors.leaf700;
// Default center (Metro Manila) used until we have the courier's position.
const FALLBACK = { latitude: 14.5995, longitude: 120.9842 };

export default function DeliveryMapModal({ visible, address, coords, onClose }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [courier, setCourier] = useState(null);
  const [destination, setDestination] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      setCourier(null);
      setDestination(null);
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          if (!cancelled) setError(t('cmp.permDenied'));
        } else {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          if (!cancelled) setCourier({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        }

        if (coords && coords.latitude && coords.longitude) {
          if (!cancelled) setDestination({ latitude: Number(coords.latitude), longitude: Number(coords.longitude) });
        } else if (address) {
          // Best-effort geocode of the free-text delivery address.
          try {
            const geo = await Location.geocodeAsync(address);
            if (!cancelled && geo && geo[0]) {
              setDestination({ latitude: geo[0].latitude, longitude: geo[0].longitude });
            }
          } catch {
            /* geocoding can fail for vague addresses; ignore */
          }
        }
      } catch (e) {
        if (!cancelled) setError(t('cmp.cantFindYou'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [visible, address, coords]);

  const anchor = courier || destination;
  const [webviewError, setWebviewError] = useState(null);

  const html = useMemo(() => {
    const center = anchor || FALLBACK;
    const markers = [];
    if (courier) markers.push({ lat: courier.latitude, lng: courier.longitude, color: PRIMARY, popup: t('cmp.popupYou') });
    if (destination) markers.push({ lat: destination.latitude, lng: destination.longitude, color: '#d32f2f', popup: t('cmp.deliveryAddress') });
    const polyline = courier && destination
      ? [{ lat: courier.latitude, lng: courier.longitude }, { lat: destination.latitude, lng: destination.longitude }]
      : null;
    return buildStaticMapHtml({
      centerLat: center.latitude,
      centerLng: center.longitude,
      zoom: anchor ? 14 : 10,
      markers,
      polyline,
      polylineColor: PRIMARY,
    });
  }, [courier, destination]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('cmp.deliveryRoute')}</Text>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <Ionicons name="close" size={rf(18)} color={colors.soil800} />
          </TouchableOpacity>
        </View>
        {address ? (
          <View style={styles.addrRow}>
            <Ionicons name="location-outline" size={rf(18)} color={PRIMARY} />
            <Text style={styles.addr}>{address}</Text>
          </View>
        ) : null}

        {loading ? (
          <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />
        ) : (
          <>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {visible ? (
              <WebView
                key={`${courier?.latitude},${courier?.longitude}-${destination?.latitude},${destination?.longitude}`}
                originWhitelist={['*']}
                source={{ html }}
                style={styles.map}
                onError={() => setWebviewError(t('cmp.mapLoadFailed'))}
              />
            ) : null}
            {webviewError ? <Text style={styles.error}>{webviewError}</Text> : null}
            {!destination && address ? (
              <Text style={styles.note}>{t('cmp.addrNotFoundYou')}</Text>
            ) : null}
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgScreen },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingTop: 48 },
  title: { fontFamily: fonts.heading, fontSize: rf(19), color: colors.ink },
  // Same small rounded outlined close button every other modal uses.
  closeBtn: {
    width: 38, height: 38, borderRadius: radius.ctrl, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  addrRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, marginBottom: 8 },
  addr: { flex: 1, fontFamily: fonts.body, fontSize: rf(13.5), color: colors.inkSoft },
  error: { fontFamily: fonts.body, color: colors.danger, paddingHorizontal: 16, marginBottom: 8 },
  note: { fontFamily: fonts.body, color: colors.inkFaint, fontSize: rf(13), padding: 12, fontStyle: 'italic' },
  map: { flex: 1 },
});
