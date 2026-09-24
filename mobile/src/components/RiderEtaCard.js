import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatEta } from '../lib/formatEta';
import { coordinate } from '../lib/trackingGeometry';
import { activeJourney, isLivePosition, liveEtaSeconds } from '../lib/trackingJourney';
import { useTranslation } from '../i18n/useTranslation';
import { rf } from '../lib/responsive';
import { colors, fonts, fontSize, radius } from '../theme/appTheme';

function arrivalClock(etaSeconds) {
  try {
    return new Date(Date.now() + etaSeconds * 1000).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' });
  } catch { return null; }
}

// Always-visible "when will the rider arrive" summary for an order. `data` is the
// /api/delivery/tracking payload; without it (or a rider) the card explains why.
export default function RiderEtaCard({ data, status, style }) {
  const { t } = useTranslation();
  const current = data?.status || status;
  if (current === 'cancelled') return null;
  let icon = 'time-outline', headline, detail;
  if (current === 'delivered' || current === 'completed') {
    icon = 'checkmark-circle-outline'; headline = t('orderTracking.etaDelivered');
  } else {
    const view = data?.retailer_view || {};
    const journey = activeJourney(data);
    const position = coordinate(view.rider) ? view.rider : null;
    const live = isLivePosition(position);
    const liveSeconds = liveEtaSeconds(journey, { live });
    const estimate = journey.estimatedRouteSeconds;
    const eta = liveSeconds ?? (Number.isFinite(Number(estimate)) && estimate !== null && estimate !== '' ? Number(estimate) : null);
    if (eta != null && journey.phase === 'delivery') {
      const text = formatEta(eta), clock = arrivalClock(eta);
      headline = liveSeconds != null ? t('orderTracking.etaLive', { eta: text }) : t('orderTracking.etaEstimated', { eta: text });
      if (clock) detail = t('orderTracking.etaArrivesAround', { time: clock });
    } else if (['picked_up', 'in_transit', 'out_for_delivery'].includes(current)) {
      headline = t('orderTracking.etaWaitingRider');
    } else {
      headline = t('orderTracking.etaNotStarted');
    }
  }
  return (
    <View style={[styles.card, style]} accessibilityRole="summary" accessibilityLiveRegion="polite">
      <Ionicons name={icon} size={rf(26)} color={colors.leaf700} />
      <View style={styles.text}>
        <Text style={styles.title}>{t('orderTracking.etaTitle')}</Text>
        <Text style={styles.headline}>{headline}</Text>
        {!!detail && <Text style={styles.detail}>{detail}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.card, backgroundColor: colors.leaf50, borderWidth: 1, borderColor: colors.leaf100 },
  text: { flex: 1 },
  title: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.xs), color: colors.inkSoft, textTransform: 'uppercase' },
  headline: { fontFamily: fonts.heading, fontSize: rf(fontSize.lg), color: colors.leaf700 },
  detail: { fontFamily: fonts.body, fontSize: rf(fontSize.sm), color: colors.inkSoft, marginTop: 2 },
});
