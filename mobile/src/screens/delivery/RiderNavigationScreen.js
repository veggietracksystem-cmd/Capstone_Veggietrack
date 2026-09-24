import { rf } from '../../lib/responsive';
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import api from '../../api/client';
import { friendlyError } from '../../lib/errorMessages';
import { useAuth } from '../../context/AuthContext';
import { isDeliveryPersonnel } from '../../lib/roles';
import { useTranslation } from '../../i18n/useTranslation';
import RiderNavMap from '../../components/RiderNavMap';
import ScreenHeader from '../../components/ScreenHeader';
import TrackingErrorBoundary from '../../components/TrackingErrorBoundary';
import useDeliveryTracking from '../../hooks/useDeliveryTracking';
import useRiderLocation from '../../hooks/useRiderLocation';
import { coordinate, routePoints } from '../../lib/trackingGeometry';
import { guide, distanceLabel } from '../../lib/turnGuidance';
import { formatEta } from '../../lib/formatEta';
import { colors, fonts, fontSize, radius, shadowCard } from '../../theme/appTheme';

const ICONS = {
  'turn-left': 'arrow-left-top', 'turn-right': 'arrow-right-top',
  'slight-left': 'arrow-top-left', 'slight-right': 'arrow-top-right',
  'sharp-left': 'arrow-left-bottom', 'sharp-right': 'arrow-right-bottom',
  uturn: 'arrow-u-left-top', straight: 'arrow-up', roundabout: 'rotate-right', merge: 'source-merge',
  'fork-left': 'arrow-top-left', 'fork-right': 'arrow-top-right',
  'arrive-left': 'flag-checkered', 'arrive-right': 'flag-checkered', arrive: 'flag-checkered',
};

function arrivalClock(seconds) {
  try { return new Date(Date.now() + seconds * 1000).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }); }
  catch { return null; }
}

// The big instruction at the top: what to do, and how far away it is.
function instruction(t, g) {
  const key = g.kind === 'roundabout' && g.exit ? 'roundaboutExit' : g.kind;
  const params = { d: distanceLabel(g.turnDistance), exit: g.exit };
  const action = t(`nav.now.${key}`, params);
  const arriving = g.kind.startsWith('arrive');
  const onto = g.road && !arriving ? t('nav.onto', { road: g.road }) : null;
  if (g.far && !arriving) return { primary: t('nav.in.straight', params), secondary: [t('nav.then', { action }), onto].filter(Boolean).join(' · ') };
  return { primary: g.turnDistance < 30 ? action : t(`nav.in.${key}`, params), secondary: onto };
}

export default function RiderNavigationScreen({ route, navigation }) {
  const insets = useSafeAreaInsets();
  const { orderId } = route.params || {};
  const { user } = useAuth(), { t } = useTranslation();
  const { data, loading, error, refresh } = useDeliveryTracking(orderId);
  const isAssigned = isDeliveryPersonnel(user) && data?.delivery_personnel_id === user?.id && !['delivered', 'cancelled'].includes(data?.status);
  // Live location is watched automatically and sent to the server; the rider never has to refresh it by hand.
  const { position, error: gpsError, refreshLocation } = useRiderLocation(orderId, isAssigned);
  const [actionError, setActionError] = useState(''), [opening, setOpening] = useState(false), [panelHeight, setPanelHeight] = useState(150);

  const nav = data?.rider_view || {};
  const toWarehouse = nav.navigation_phase === 'pickup' || (!nav.navigation_phase && !['picked_up', 'in_transit', 'delivered'].includes(data?.status));
  const target = nav.navigation_target || (toWarehouse ? nav.pickup_location : nav.delivery_location);
  const points = useMemo(() => routePoints(nav.full_route), [nav.full_route]);
  const current = coordinate(position) || (nav.current_location?.live ? coordinate(nav.current_location) : null);
  const guidance = useMemo(() => guide({ steps: nav.route_steps, points, position: current }),
    [nav.route_steps, points, current?.latitude, current?.longitude]);
  const completed = guidance.status === 'ok' || guidance.status === 'arrived' ? guidance.completed : undefined;

  // One banner at the top says what matters right now.
  let banner = null, retry = null, icon = 'navigation-variant';
  if (gpsError && !current) { banner = { primary: gpsError }; retry = () => refreshLocation().catch(() => {}); icon = 'map-marker-off'; }
  else if (!current) banner = { primary: t('nav.findingLocation') };
  else if (data && !coordinate(target)) { banner = { primary: t('nav.noDestination') }; icon = 'map-marker-question'; }
  else if (guidance.status === 'ok' || guidance.status === 'arrived') {
    const g = guidance;
    banner = g.status === 'arrived' ? { primary: t('nav.now.arrive'), secondary: t('nav.arrivedHint') } : instruction(t, g);
    icon = ICONS[g.status === 'arrived' ? 'arrive' : g.kind] || 'arrow-up';
  } else if (guidance.status === 'off-route') banner = { primary: t('nav.offRoute') };
  else if (nav.navigation_error?.includes('unavailable') || (error && !nav.full_route)) { banner = { primary: t('nav.routeUnavailable') }; retry = refresh; icon = 'map-marker-alert'; }
  else banner = { primary: t('nav.waitingRoute') };

  const arrived = guidance.status === 'arrived';
  const showValues = guidance.status === 'ok' || arrived;
  const etaText = showValues && guidance.etaSeconds != null
    ? [formatEta(arrived ? 0 : guidance.etaSeconds), !arrived && arrivalClock(guidance.etaSeconds)].filter(Boolean).join(' · ')
    : t('nav.etaUnavailable');
  const remainingText = showValues ? (arrived ? '0 m' : distanceLabel(guidance.remainingMeters)) : '—';

  const openDetails = async () => {
    setOpening(true); setActionError('');
    try {
      const orders = await api.get('/api/delivery/orders');
      const order = orders.find(item => item.id === orderId);
      if (!order) throw new Error(t('cmp2.deliveryLoadFail'));
      navigation.navigate('DeliveryDetails', { order });
    } catch (err) { setActionError(friendlyError(err)); } finally { setOpening(false); }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScreenHeader title={t('cmp.riderNav')} onBack={() => navigation.goBack()} />
      {loading && !data ? <ActivityIndicator style={{ padding: 30 }} color={colors.leaf700} /> : (
        <TrackingErrorBoundary onBack={() => navigation.goBack()}>
          <View style={styles.body}>
            <RiderNavMap tracking={data} position={current} route={points} completed={completed} toWarehouse={toWarehouse} recenterBottom={panelHeight + insets.bottom + 12} />

            <View style={styles.top} pointerEvents="box-none">
              <View style={styles.instruction} accessibilityRole="alert" accessibilityLiveRegion="polite">
                <View style={styles.iconBox}><MaterialCommunityIcons name={icon} size={rf(34)} color="#fff" /></View>
                <View style={styles.instructionText}>
                  <Text style={styles.primary}>{banner.primary}</Text>
                  {!!banner.secondary && <Text style={styles.secondary}>{banner.secondary}</Text>}
                  {!!retry && <TouchableOpacity accessibilityRole="button" onPress={retry} style={styles.retry}><Text style={styles.retryText}>{t('nav.retry')}</Text></TouchableOpacity>}
                </View>
              </View>
              {!!gpsError && !!current && <Text style={styles.notice}>{t('nav.shareProblem')}</Text>}
            </View>

            <View style={[styles.panel, { paddingBottom: 14 + insets.bottom }]} onLayout={event => setPanelHeight(event.nativeEvent.layout.height - insets.bottom)}>
              <View style={styles.values}>
                <View style={styles.value}><Text style={styles.label}>{t('nav.remaining')}</Text><Text style={styles.number}>{remainingText}</Text></View>
                <View style={styles.divider} />
                <View style={styles.value}><Text style={styles.label}>{t('nav.eta')}</Text><Text style={[styles.number, !showValues && styles.muted]} numberOfLines={2}>{etaText}</Text></View>
              </View>
              <Text style={styles.destination} numberOfLines={2}>{t(toWarehouse ? 'nav.toWarehouse' : 'nav.toRetailer')}{target?.address ? ` · ${target.address}` : ''}</Text>
              {!!actionError && <Text style={styles.error}>{actionError}</Text>}
              <TouchableOpacity accessibilityRole="button" disabled={opening} activeOpacity={0.85}
                style={[styles.action, arrived && styles.actionPrimary]} onPress={openDetails}>
                <Text style={[styles.actionText, arrived && styles.actionTextPrimary]}>{opening ? t('nav.opening') : t('nav.openDetails')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TrackingErrorBoundary>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgScreen },
  body: { flex: 1 },
  top: { position: 'absolute', top: 12, left: 12, right: 12, gap: 8 },
  instruction: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: radius.card, backgroundColor: colors.leaf700, ...shadowCard },
  iconBox: { width: rf(56), height: rf(56), borderRadius: radius.ctrl, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  instructionText: { flex: 1 },
  primary: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.xl), color: '#fff' },
  secondary: { fontFamily: fonts.body, fontSize: rf(fontSize.sm), color: colors.leaf100, marginTop: 3 },
  retry: { alignSelf: 'flex-start', marginTop: 8, paddingVertical: 6, paddingHorizontal: 14, borderRadius: radius.ctrl, backgroundColor: '#fff' },
  retryText: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), color: colors.leaf700 },
  notice: { fontFamily: fonts.bodyMedium, fontSize: rf(fontSize.xs), color: colors.gold700, backgroundColor: colors.gold100, padding: 8, borderRadius: radius.ctrl },
  panel: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 14, gap: 10, backgroundColor: colors.bgScreen, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderBottomWidth: 0, borderColor: colors.border, ...shadowCard },
  values: { flexDirection: 'row', alignItems: 'center' },
  value: { flex: 1, alignItems: 'center' },
  divider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.border },
  label: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.xs), color: colors.inkSoft, textTransform: 'uppercase' },
  number: { fontFamily: fonts.heading, fontSize: rf(fontSize.xl), color: colors.leaf700, textAlign: 'center' },
  muted: { fontFamily: fonts.bodyMedium, fontSize: rf(fontSize.md), color: colors.inkSoft },
  destination: { fontFamily: fonts.body, fontSize: rf(fontSize.sm), color: colors.inkSoft, textAlign: 'center' },
  action: { paddingVertical: 14, borderRadius: radius.ctrl, alignItems: 'center', borderWidth: 1.5, borderColor: colors.leaf700, backgroundColor: colors.bgScreen },
  actionPrimary: { backgroundColor: colors.leaf700 },
  actionText: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.md), color: colors.leaf700 },
  actionTextPrimary: { color: '#fff' },
  error: { fontFamily: fonts.bodyMedium, fontSize: rf(fontSize.sm), color: colors.gold700, padding: 8, backgroundColor: colors.gold100, borderRadius: radius.ctrl, textAlign: 'center' },
});
