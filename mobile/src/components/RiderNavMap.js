import { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import DeliveryMapFrame from './DeliveryMapFrame';
import { coordinate } from '../lib/trackingGeometry';
import { useTranslation } from '../i18n/useTranslation';
import { rf } from '../lib/responsive';
import { colors, fonts, fontSize, shadowCard } from '../theme/appTheme';

const FOLLOW_ZOOM = 17;

// Full-height map for the rider's navigation screen. It reuses the app's one
// Leaflet/OpenStreetMap map document and follows the rider's live position;
// dragging the map pauses following until the rider taps Recenter.
export default function RiderNavMap({ tracking, position, route, completed, toWarehouse, recenterBottom = 24 }) {
  const { t } = useTranslation();
  const [follow, setFollow] = useState(true), [fitToken, setFitToken] = useState(0);
  const [ready, setReady] = useState(false), [mapError, setMapError] = useState(''), [retry, setRetry] = useState(0);
  const nav = tracking?.rider_view || {};
  const rider = coordinate(position) || null;
  // Only the stop the rider is heading to gets a marker.
  const target = toWarehouse ? nav.pickup_location : nav.delivery_location;
  const targetPoint = { ...(target || {}), ...coordinate(target), name: target?.name || t(toWarehouse ? 'nav.toWarehouse' : 'nav.toRetailer') };
  const idle = { name: '' };
  const data = useMemo(() => ({
    origin: toWarehouse ? targetPoint : idle,
    destination: toWarehouse ? idle : targetPoint,
    rider: rider ? { ...rider, name: t('cmp.deliveryRider'), live: true, label: '', accuracy: position?.accuracy } : { name: '' },
    route: route || [], completed: completed || [],
    nav: true, follow: true, followZoom: FOLLOW_ZOOM, autoRecenter: follow, fitToken,
    focusPoints: [toWarehouse ? targetPoint : idle, toWarehouse ? idle : targetPoint, rider || idle],
    tileConfig: tracking?.map_config,
  }), [tracking?.map_config, rider?.latitude, rider?.longitude, position?.accuracy, route, completed, toWarehouse,
    targetPoint.latitude, targetPoint.longitude, follow, fitToken, t]);
  const onEvent = event => {
    if (event.type === 'ready') { setReady(true); setMapError(''); }
    if (event.type === 'error') { setReady(true); setMapError(event.message || t('nav.mapProblem')); }
    if (event.type === 'manual-pan') setFollow(false);
  };
  return (
    <View style={StyleSheet.absoluteFill}>
      <DeliveryMapFrame key={retry} data={data} onEvent={onEvent} />
      {!ready && <View style={[styles.loading, { pointerEvents: 'none' }]}><ActivityIndicator color={colors.leaf700} /></View>}
      {!!mapError && (
        <TouchableOpacity accessibilityRole="button" style={styles.mapError} onPress={() => { setRetry(v => v + 1); setMapError(''); setReady(false); }}>
          <Text style={styles.mapErrorText}>{t('nav.mapProblem')}</Text>
        </TouchableOpacity>
      )}
      {!follow && (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('nav.recenter')} activeOpacity={0.85}
          style={[styles.recenter, { bottom: recenterBottom }]} onPress={() => { setFollow(true); setFitToken(v => v + 1); }}>
          <MaterialCommunityIcons name="crosshairs-gps" size={rf(22)} color={colors.leaf700} />
          <Text style={styles.recenterText}>{t('nav.recenter')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.leaf50 },
  mapError: { position: 'absolute', top: 120, left: 16, right: 16, padding: 12, borderRadius: 10, backgroundColor: colors.gold100 },
  mapErrorText: { fontFamily: fonts.bodyMedium, fontSize: rf(fontSize.sm), color: colors.gold700, textAlign: 'center' },
  recenter: { position: 'absolute', right: 16, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 24, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, ...shadowCard },
  recenterText: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), color: colors.leaf700 },
});
