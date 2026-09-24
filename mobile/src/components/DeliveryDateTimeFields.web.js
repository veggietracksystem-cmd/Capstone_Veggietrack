import DeliveryTimeScroller from './DeliveryTimeScroller';
import { useTranslation } from '../i18n/useTranslation';
import { manilaDate } from '../lib/deliverySchedule';
import { View, Text, StyleSheet } from 'react-native';
import { colors, fonts, radius } from '../theme/appTheme';
import { rf } from '../lib/responsive';

// Web: native browser date + time pickers. On react-native-web a raw <input>
// is valid because the tree renders through react-dom. `date` defaults to
// today (set by the caller); `time` has no default and is required.
export default function DeliveryDateTimeFields({ date, onDateChange, time, onTimeChange, disabled }) {
  const { t } = useTranslation();
  return (
    <View>
      <Text style={styles.label}>{t('checkout.deliveryDate')}</Text>
      {/* eslint-disable-next-line react-native/no-raw-text */}
      <input
        type="date"
        value={date || ''}
        min={manilaDate()}
        disabled={disabled}
        onChange={(e) => onDateChange(e.target.value)}
        style={inputStyle}
      />

      <Text style={[styles.label, styles.timeLabel]}>{t('checkout.deliveryTime')}</Text>
      {/* eslint-disable-next-line react-native/no-raw-text */}
      <DeliveryTimeScroller date={date} time={time} onTimeChange={onTimeChange} disabled={disabled} />
    </View>
  );
}

const inputStyle = {
  width: '100%',
  padding: 12,
  fontSize: rf(15),
  fontFamily: 'Poppins_400Regular, sans-serif',
  borderRadius: radius.ctrl,
  border: `1.4px solid ${colors.border}`,
  backgroundColor: colors.card,
  color: colors.ink,
  boxSizing: 'border-box',
};

const styles = StyleSheet.create({
  label: { fontFamily: fonts.bodySemiBold, fontSize: rf(12.5), color: colors.labelInk, marginBottom: 8 },
  timeLabel: { marginTop: 14 },
});
