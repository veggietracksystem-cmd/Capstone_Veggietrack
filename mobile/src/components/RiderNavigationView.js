import { rf } from '../lib/responsive';
import { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from '../i18n/useTranslation';
import RiderNavMap from './RiderNavMap';
import TrackingErrorBoundary from './TrackingErrorBoundary';
import { coordinate, routePoints } from '../lib/trackingGeometry';
import { guide, distanceLabel } from '../lib/turnGuidance';
import { formatEta } from '../lib/formatEta';
import { colors, fonts, fontSize, radius, shadowCard } from '../theme/appTheme';

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

function instruction(t, g) {
  const key = g.kind === 'roundabout' && g.exit ? 'roundaboutExit' : g.kind;
  const params = { d: distanceLabel(g.turnDistance), exit: g.exit };
  const action = t(`nav.now.${key}`, params);
  const arriving = g.kind.startsWith('arrive');
  const onto = g.road && !arriving ? t('nav.onto', { road: g.road }) : null;
  if (g.far && !arriving) return { primary: t('nav.in.straight', params), secondary: [t('nav.then', { action }), onto].filter(Boolean).join(' · ') };
  return { primary: g.turnDistance < 30 ? action : t(`nav.in.${key}`, params), secondary: onto };
}

/**
 * Turn-by-turn navigation body shared by delivery and farm-pickup navigation:
 * full-screen map, instruction banner, remaining distance and ETA. Screens supply
 * the tracking data, the rider's live GPS and their own actions (children, or a
 * function of { arrived }) for the bottom panel.
 */
export default function RiderNavigationView({
  tracking, loading, trackingError, onRetryRoute,
  position, gpsError, onRetryGps,
  target, targetKind, destinationLabel, arrivedHint, onBack, children,
}) {
  const safe = useSafeAreaInsets();
  const { t } = useTranslation();
  // Measured overlay sizes; the map keeps markers and the route clear of them.
  const [bannerBottom, setBannerBottom] = useState(0), [panelHeight, setPanelHeight] = useState(0);
  const nav = tracking?.rider_view || {};
  const points = useMemo(() => routePoints(nav.full_route), [nav.full_route]);
  const current = coordinate(position) || (nav.current_location?.live ? coordinate(nav.current_location) : null);
  const guidance = useMemo(() => guide({ steps: nav.route_steps, points, position: current }),
    [nav.route_steps, points, current?.latitude, current?.longitude]);
  const completed = guidance.status === 'ok' || guidance.status === 'arrived' ? guidance.completed : undefined;

  let banner = null, retry = null, icon = 'navigation-variant';
  if (gpsError && !current) { banner = { primary: gpsError }; retry = onRetryGps; icon = 'map-marker-off'; }
  else if (!current) banner = { primary: t('nav.findingLocation') };
  else if (tracking && !coordinate(target)) { banner = { primary: t('nav.noDestination') }; icon = 'map-marker-question'; }
  else if (guidance.status === 'ok' || guidance.status === 'arrived') {
    const g = guidance;
    banner = g.status === 'arrived' ? { primary: t('nav.now.arrive'), secondary: arrivedHint } : instruction(t, g);
    icon = ICONS[g.status === 'arrived' ? 'arrive' : g.kind] || 'arrow-up';
  } else if (guidance.status === 'off-route') banner = { primary: t('nav.offRoute') };
  else if (nav.navigation_error?.includes('unavailable') || (trackingError && !nav.full_route)) { banner = { primary: t('nav.routeUnavailable') }; retry = onRetryRoute; icon = 'map-marker-alert'; }
  else banner = { primary: t('nav.waitingRoute') };

  const arrived = guidance.status === 'arrived';
  const showValues = guidance.status === 'ok' || arrived;
  const etaText = showValues && guidance.etaSeconds != null
    ? [formatEta(arrived ? 0 : guidance.etaSeconds), !arrived && arrivalClock(guidance.etaSeconds)].filter(Boolean).join(' · ')
    : t('nav.etaUnavailable');
  const remainingText = showValues ? (arrived ? '0 m' : distanceLabel(guidance.remainingMeters)) : '—';

  if (loading && !tracking) return <ActivityIndicator style={{ padding: 30 }} color={colors.leaf700} />;
  return (
    <TrackingErrorBoundary onBack={onBack}>
      <View style={styles.body}>
        <RiderNavMap tracking={tracking} position={current} route={points} completed={completed}
          target={target} targetKind={targetKind} targetName={destinationLabel}
          insets={{ top: bannerBottom, bottom: panelHeight }} />

        {/* Only the banner itself takes touches; the map around it stays draggable. */}
        <View style={[styles.top, { pointerEvents: 'box-none' }]}
          onLayout={event => { const { y, height } = event.nativeEvent.layout; setBannerBottom(Math.ceil(y + height)); }}>
          <View style={styles.instruction} accessibilityRole="alert" accessibilityLiveRegion="polite">
            <View style={styles.iconBox}><MaterialCommunityIcons name={icon} size={rf(26)} color="#fff" /></View>
            <View style={styles.instructionText}>
              <Text style={styles.primary} numberOfLines={3}>{banner.primary}</Text>
              {!!banner.secondary && <Text style={styles.secondary} numberOfLines={2}>{banner.secondary}</Text>}
            </View>
            {!!retry && <TouchableOpacity accessibilityRole="button" onPress={retry} style={styles.retry}><Text style={styles.retryText}>{t('nav.retry')}</Text></TouchableOpacity>}
          </View>
          {!!gpsError && !!current && (
            <TouchableOpacity accessibilityRole="button" activeOpacity={0.85} onPress={onRetryGps} disabled={!onRetryGps}>
              <Text style={styles.notice}>{t('nav.shareProblem')} <Text style={styles.noticeAction}>{t('nav.retry')}</Text></Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={[styles.panel, { paddingBottom: 12 + safe.bottom }]} onLayout={event => setPanelHeight(Math.ceil(event.nativeEvent.layout.height))}>
          <View style={styles.values}>
            <View style={styles.value}><Text style={styles.label}>{t('nav.remaining')}</Text><Text style={styles.number}>{remainingText}</Text></View>
            <View style={styles.divider} />
            <View style={styles.value}><Text style={styles.label}>{t('nav.eta')}</Text><Text style={[styles.number, !showValues && styles.muted]} numberOfLines={2}>{etaText}</Text></View>
          </View>
          <Text style={styles.destination} numberOfLines={2}>{destinationLabel}{target?.address ? ` · ${target.address}` : ''}</Text>
          {typeof children === 'function' ? children({ arrived }) : children}
        </View>
      </View>
    </TrackingErrorBoundary>
  );
}

// Shared button styles so screen-specific actions look the same in both flows.
export const navActionStyles = StyleSheet.create({
  action: { paddingVertical: 14, borderRadius: radius.ctrl, alignItems: 'center', borderWidth: 1.5, borderColor: colors.leaf700, backgroundColor: colors.bgScreen },
  actionPrimary: { backgroundColor: colors.leaf700 },
  actionText: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.md), color: colors.leaf700 },
  actionTextPrimary: { color: '#fff' },
  error: { fontFamily: fonts.bodyMedium, fontSize: rf(fontSize.sm), color: colors.gold700, padding: 8, backgroundColor: colors.gold100, borderRadius: radius.ctrl, textAlign: 'center' },
});

const styles = StyleSheet.create({
  body: { flex: 1 },
  top: { position: 'absolute', top: 8, left: 10, right: 10, gap: 6 },
  instruction: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: radius.card, backgroundColor: colors.leaf700, ...shadowCard },
  iconBox: { width: rf(40), height: rf(40), borderRadius: radius.ctrl, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  instructionText: { flex: 1, minWidth: 0 },
  primary: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.lg), color: '#fff' },
  secondary: { fontFamily: fonts.body, fontSize: rf(fontSize.xs), color: colors.leaf100, marginTop: 1 },
  retry: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.ctrl, backgroundColor: '#fff' },
  retryText: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), color: colors.leaf700 },
  notice: { fontFamily: fonts.bodyMedium, fontSize: rf(fontSize.xs), color: colors.gold700, backgroundColor: colors.gold100, padding: 8, borderRadius: radius.ctrl },
  noticeAction: { fontFamily: fonts.bodyBold, textDecorationLine: 'underline' },
  panel: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, gap: 8, backgroundColor: colors.bgScreen, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderBottomWidth: 0, borderColor: colors.border, ...shadowCard },
  values: { flexDirection: 'row', alignItems: 'center' },
  value: { flex: 1, alignItems: 'center' },
  divider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.border },
  label: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.xs), color: colors.inkSoft, textTransform: 'uppercase' },
  number: { fontFamily: fonts.heading, fontSize: rf(fontSize.xl), color: colors.leaf700, textAlign: 'center' },
  muted: { fontFamily: fonts.bodyMedium, fontSize: rf(fontSize.md), color: colors.inkSoft },
  destination: { fontFamily: fonts.body, fontSize: rf(fontSize.sm), color: colors.inkSoft, textAlign: 'center' },
});
