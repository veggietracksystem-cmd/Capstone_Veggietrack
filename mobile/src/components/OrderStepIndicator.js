import { View, Text, StyleSheet } from 'react-native';
import { colors, fonts } from '../theme/appTheme';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '../i18n/useTranslation';

const PRIMARY = colors.leaf700;
const GREY = colors.border;
const GREY_TEXT = colors.inkFaint;

// Order lifecycle, in sequence. `key` matches the backend status string.
const STEP_KEYS = [
  { key: 'pending', labelKey: 'orderStatus.pending' },
  { key: 'approved', labelKey: 'orderStatus.approved' },
  { key: 'picked_up', labelKey: 'orderStatus.pickedUp' },
  { key: 'in_transit', labelKey: 'orderStatus.inTransit' },
  { key: 'delivered', labelKey: 'orderStatus.delivered' },
];

// Statuses the backend may send that map onto a step above.
const STATUS_ALIASES = {
  assigned: 'approved',       // assigned-but-not-moving sits at the Approved step
  out_for_delivery: 'in_transit',
  completed: 'delivered',
};

function stepIndexFor(status) {
  const normalized = STATUS_ALIASES[status] || status;
  const i = STEP_KEYS.findIndex((s) => s.key === normalized);
  return i; // -1 if unknown (e.g. cancelled) → nothing highlighted
}

/**
 * Horizontal step indicator for an order's progress.
 * Pending → Approved → Out for Delivery → Delivered.
 *
 * Current + past steps are filled green; future steps are greyed out.
 * For terminal/unknown statuses (e.g. "cancelled") nothing is filled and the
 * caller should still render the status badge for context.
 */
export default function OrderStepIndicator({ status }) {
  const { t } = useTranslation();
  const current = stepIndexFor(status);

  return (
    <View style={styles.wrap}>
     {/* Line lives in its own layer behind the step columns (each column is its own
         stacking context on web, so a per-column line would cover the previous circle). */}
     <View style={styles.track} pointerEvents="none">
       <View style={[styles.trackFill, { width: `${Math.max(0, current) / (STEP_KEYS.length - 1) * 100}%` }]} />
     </View>
     <View style={styles.row}>
      {STEP_KEYS.map((step, i) => {
        const done = current >= 0 && i <= current;
        const isCurrent = i === current;
        return (
          <View key={step.key} style={styles.stepCol}>
            <View style={[styles.circle, done && styles.circleDone, isCurrent && styles.circleCurrent]}>
              {done ? (
                <Ionicons name="checkmark" size={CHECK_SIZE} color="#fff" style={styles.check} />
              ) : (
                <Text style={styles.circleText}>{i + 1}</Text>
              )}
            </View>

            <Text style={[styles.label, done && styles.labelDone]} numberOfLines={2}>
              {t(step.labelKey)}
            </Text>
          </View>
        );
      })}
     </View>
    </View>
  );
}

const CIRCLE = 22;
const CHECK_SIZE = 14;
const LINE = 1.5;

const styles = StyleSheet.create({
  wrap: { marginTop: 4, marginBottom: 2, paddingHorizontal: 4 },
  row: { position: 'relative', zIndex: 1, flexDirection: 'row', alignItems: 'flex-start' },
  stepCol: { flex: 1, alignItems: 'center' },

  // Grey track spans first-circle center to last-circle center (columns are equal width,
  // so those centers sit 10% in from each edge), vertically centered on the circles.
  track: { position: 'absolute', top: (CIRCLE - LINE) / 2, left: '10%', right: '10%', height: LINE, backgroundColor: GREY },
  trackFill: { height: LINE, backgroundColor: PRIMARY },

  circle: { width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE / 2, backgroundColor: colors.card, borderWidth: 1.5, borderColor: GREY, alignItems: 'center', justifyContent: 'center' },
  circleDone: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  circleCurrent: { borderColor: PRIMARY },
  // Fixed-size, unpadded glyph boxes so the icon/number sit at the true center of the circle.
  circleText: { fontFamily: fonts.bodyBold, fontSize: 11, lineHeight: 13, color: GREY_TEXT, textAlign: 'center', includeFontPadding: false },
  check: { width: CHECK_SIZE, height: CHECK_SIZE, lineHeight: CHECK_SIZE, textAlign: 'center' },

  label: { fontFamily: fonts.body, fontSize: 10, color: GREY_TEXT, textAlign: 'center', marginTop: 4, lineHeight: 12 },
  labelDone: { fontFamily: fonts.bodySemiBold, color: PRIMARY },
});
