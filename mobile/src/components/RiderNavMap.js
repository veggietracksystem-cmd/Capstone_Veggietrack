import { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import DeliveryMapFrame from './DeliveryMapFrame';
import { coordinate } from '../lib/trackingGeometry';
import { useTranslation } from '../i18n/useTranslation';
import { rf } from '../lib/responsive';
import { colors, fonts, fontSize, radius, shadowCard } from '../theme/appTheme';

const FOLLOW_ZOOM = 17;
// One shared empty route, so "no route yet" is not re-sent to the map on every update.
const NO_ROUTE = [];
const BUTTON = 44, GAP = 8, EDGE = 12;
const COLUMN_HEIGHT = 4 * BUTTON + 3 * GAP;

// Full-height map for rider navigation (deliveries and farm pickups).
// The camera opens on the whole route; dragging, pinching or zooming leaves it
// where the rider put it until Recenter (follow the rider) or Route overview is
// tapped. `insets` are the screen overlays (banner on top, panel at the bottom)
// so markers and the route are never placed underneath them.
// targetKind picks the stop's marker: 'hub' (warehouse), 'shop' (retailer) or 'farm'.
export default function RiderNavMap({ tracking, position, route, progress, target, targetKind, targetName, insets }) {
  const { t } = useTranslation();
  const [camera, setCamera] = useState({ mode: 'overview', token: 0 });
  const [command, setCommand] = useState({ type: null, token: 0 });
  const [mode, setMode] = useState('overview');
  const [ready, setReady] = useState(false), [mapError, setMapError] = useState(''), [retry, setRetry] = useState(0);
  const [height, setHeight] = useState(0);
  const top = insets?.top || 0, bottom = insets?.bottom || 0;
  // On short screens the four buttons form a 2 x 2 grid so they never reach the banner.
  const grid = height > 0 && height - top - bottom - 2 * EDGE < COLUMN_HEIGHT;
  const controlsWidth = (grid ? 2 * BUTTON + GAP : BUTTON) + EDGE;
  const rider = coordinate(position) || null;
  // Only the stop the rider is heading to gets a marker, at the exact routed coordinates.
  const atHub = targetKind === 'hub';
  const targetPoint = { ...(target || {}), ...coordinate(target), name: target?.name || targetName, glyph: targetKind };
  const idle = { name: '' };
  const tileUrl = tracking?.map_config?.url, tileAttribution = tracking?.map_config?.attribution;
  const data = useMemo(() => ({
    origin: atHub ? targetPoint : idle,
    destination: atHub ? idle : targetPoint,
    rider: rider ? { ...rider, name: t('cmp.deliveryRider'), live: true, label: '', accuracy: position?.accuracy } : { name: '' },
    route: route || NO_ROUTE, progress: progress || null,
    nav: true, followZoom: FOLLOW_ZOOM, camera, command,
    insets: { top, bottom, left: 0, right: controlsWidth },
    tileConfig: { url: tileUrl, attribution: tileAttribution },
  }), [tileUrl, tileAttribution, rider?.latitude, rider?.longitude, position?.accuracy, route, progress, atHub, targetKind,
    targetPoint.latitude, targetPoint.longitude, targetPoint.name, targetPoint.address, camera, command, top, bottom, controlsWidth, t]);
  const onEvent = event => {
    if (event.type === 'ready') { setReady(true); setMapError(''); }
    if (event.type === 'error') { setReady(true); setMapError(event.message || t('nav.mapProblem')); }
    if (event.type === 'camera') setMode(event.mode);
  };
  const moveCamera = next => { setMode(next); setCamera(current => ({ mode: next, token: current.token + 1 })); };
  const zoom = type => setCommand(current => ({ type, token: current.token + 1 }));
  const controls = [
    { key: 'in', icon: 'plus', label: t('nav.zoomIn'), onPress: () => zoom('zoom-in') },
    { key: 'out', icon: 'minus', label: t('nav.zoomOut'), onPress: () => zoom('zoom-out') },
    { key: 'overview', icon: 'map-marker-path', label: t('nav.routeOverview'), onPress: () => moveCamera('overview'), active: mode === 'overview' },
    { key: 'recenter', icon: 'crosshairs-gps', label: t('nav.recenter'), onPress: () => moveCamera('follow'), active: mode === 'follow', disabled: !rider },
  ];
  return (
    <View style={StyleSheet.absoluteFill} onLayout={event => setHeight(event.nativeEvent.layout.height)}>
      <DeliveryMapFrame key={retry} data={data} onEvent={onEvent} />
      {!ready && <View style={[styles.loading, { pointerEvents: 'none' }]}><ActivityIndicator color={colors.leaf700} /></View>}
      {!!mapError && (
        <TouchableOpacity accessibilityRole="button" style={[styles.mapError, { top: top + 8, right: controlsWidth + 4 }]} onPress={() => { setRetry(v => v + 1); setMapError(''); setReady(false); }}>
          <Text style={styles.mapErrorText}>{t('nav.mapProblem')}</Text>
        </TouchableOpacity>
      )}
      <View style={[styles.controls, grid && styles.controlsGrid, { bottom: bottom + EDGE, pointerEvents: 'box-none' }]}>
        {controls.map(control => (
          <TouchableOpacity key={control.key} accessibilityRole="button" accessibilityLabel={control.label}
            accessibilityState={{ selected: !!control.active, disabled: !!control.disabled }} disabled={control.disabled}
            activeOpacity={0.8} onPress={control.onPress}
            style={[styles.button, control.active && styles.buttonActive, control.disabled && styles.buttonDisabled]}>
            <MaterialCommunityIcons name={control.icon} size={rf(22)} color={control.active ? '#fff' : colors.leaf700} />
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.leaf50 },
  mapError: { position: 'absolute', left: 16, padding: 12, borderRadius: 10, backgroundColor: colors.gold100 },
  mapErrorText: { fontFamily: fonts.bodyMedium, fontSize: rf(fontSize.sm), color: colors.gold700, textAlign: 'center' },
  controls: { position: 'absolute', right: EDGE, gap: GAP, alignItems: 'center' },
  controlsGrid: { flexDirection: 'row', flexWrap: 'wrap', width: 2 * BUTTON + GAP, justifyContent: 'flex-end' },
  button: { width: BUTTON, height: BUTTON, borderRadius: radius.ctrl, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, ...shadowCard },
  buttonActive: { backgroundColor: colors.leaf700, borderColor: colors.leaf700 },
  buttonDisabled: { opacity: 0.45 },
});
