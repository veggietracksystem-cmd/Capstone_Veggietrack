import { TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { rf } from '../../lib/responsive';
import { colors, radius } from '../../theme/appTheme';
import { useTranslation } from '../../i18n/useTranslation';

// The one close button every modal uses: a compact rounded outlined square with
// an X, at the modal's top-right. Use it instead of a "Close" text button.
// `tone="light"` is the same shape for modals that sit on a dark backdrop.
// Pass `style` only to position it (e.g. absolute top/right).
export default function ModalCloseButton({ onPress, disabled = false, tone = 'default', style }) {
  const { t } = useTranslation();
  const light = tone === 'light';
  return (
    <TouchableOpacity
      style={[styles.button, light && styles.buttonLight, style]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      accessibilityRole="button"
      accessibilityLabel={t('common.close')}
    >
      <Ionicons name="close" size={rf(18)} color={light ? '#fff' : colors.soil800} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 38, height: 38, borderRadius: radius.ctrl, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  buttonLight: { backgroundColor: 'rgba(255,255,255,0.15)', borderColor: 'rgba(255,255,255,0.4)' },
});
