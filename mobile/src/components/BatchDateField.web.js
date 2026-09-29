import { manilaDate } from '../lib/deliverySchedule';
import { colors, radius } from '../theme/appTheme';
import { rf } from '../lib/responsive';

// Web: native browser date picker. Future days are disabled, and `minDate`
// disables earlier days. Value: 'YYYY-MM-DD'.
export default function BatchDateField({ value, onChange, minDate, disabled }) {
  return (
    // eslint-disable-next-line react-native/no-raw-text
    <input
      type="date"
      value={value || ''}
      min={minDate || undefined}
      max={manilaDate()}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      style={inputStyle}
    />
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
