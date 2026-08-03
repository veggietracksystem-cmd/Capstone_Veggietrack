import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from '../i18n/useTranslation';

const PRIMARY = '#2e7d32';
const GREY = '#cfd8dc';
const GREY_TEXT = '#90a4ae';

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
    <View style={styles.row}>
      {STEP_KEYS.map((step, i) => {
        const done = current >= 0 && i <= current;
        const isCurrent = i === current;
        return (
          <View key={step.key} style={styles.stepCol}>
            {/* connector line to the previous circle (skipped on first step) */}
            {i > 0 ? (
              <View style={[styles.connector, current >= 0 && i <= current ? styles.connectorDone : null]} />
            ) : null}

            <View style={[styles.circle, done && styles.circleDone, isCurrent && styles.circleCurrent]}>
              <Text style={[styles.circleText, done && styles.circleTextDone]}>
                {done ? '✓' : i + 1}
              </Text>
            </View>

            <Text style={[styles.label, done && styles.labelDone]} numberOfLines={2}>
              {t(step.labelKey)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const CIRCLE = 28;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 8, marginBottom: 4 },
  stepCol: { flex: 1, alignItems: 'center' },

  // Connector runs from the previous circle's center to this one's (center-to-center
  // is exactly one column wide), sitting at the circle's vertical center.
  connector: { position: 'absolute', top: CIRCLE / 2 - 1, left: '-50%', right: '50%', height: 2, backgroundColor: GREY },
  connectorDone: { backgroundColor: PRIMARY },

  circle: { width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE / 2, backgroundColor: '#fff', borderWidth: 2, borderColor: GREY, alignItems: 'center', justifyContent: 'center' },
  circleDone: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  circleCurrent: { borderColor: PRIMARY },
  circleText: { fontSize: 13, fontWeight: '700', color: GREY_TEXT },
  circleTextDone: { color: '#fff' },

  label: { fontSize: 11, color: GREY_TEXT, textAlign: 'center', marginTop: 6, lineHeight: 14 },
  labelDone: { color: PRIMARY, fontWeight: '600' },
});
