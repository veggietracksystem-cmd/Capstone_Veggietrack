import { useRef, useState } from 'react';
import { View, TextInput, StyleSheet } from 'react-native';
import { rf } from '../lib/responsive';
import { colors, fonts, fontSize, radius } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';

// Visual-only boxed code entry (matches the redesign prototype's OTP boxes).
// Still just a single string value under the hood — `value`/`onChangeText`
// behave exactly like a plain TextInput for the email verification screens.
export default function OtpInput({ value = '', onChangeText, length = 6, editable = true, accessibilityLabel }) {
  const { t } = useTranslation();
  const label = accessibilityLabel ?? t('misc.verificationCode');
  const inputs = useRef([]);
  const digits = Array.from({ length }, (_, i) => value[i] || '');
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const setDigit = (index, text) => {
    // Handles paste (multiple chars land in one box) as well as single keystrokes.
    const clean = text.replace(/[^0-9]/g, '');
    if (!clean) {
      onChangeText?.(value.slice(0, index) + value.slice(index + 1));
      return;
    }
    const next = (value.slice(0, index) + clean + value.slice(index + 1)).slice(0, length);
    onChangeText?.(next);
    const advanceTo = Math.min(index + clean.length, length - 1);
    inputs.current[advanceTo]?.focus();
  };

  const onKeyPress = (index, e) => {
    if (e.nativeEvent.key === 'Backspace' && !digits[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
  };

  return (
    <View style={styles.row} accessibilityLabel={label}>
      {digits.map((digit, index) => (
        <TextInput
          key={index}
          ref={(el) => { inputs.current[index] = el; }}
          style={[styles.box, digit && styles.boxFilled, focusedIndex === index && styles.boxFocused]}
          value={digit}
          onChangeText={(text) => setDigit(index, text)}
          onKeyPress={(e) => onKeyPress(index, e)}
          onFocus={() => setFocusedIndex(index)}
          onBlur={() => setFocusedIndex((current) => (current === index ? -1 : current))}
          keyboardType="number-pad"
          maxLength={2}
          editable={editable}
          textAlign="center"
          textAlignVertical="center"
          accessibilityLabel={t('misc2.digitN', { label, n: index + 1 })}
        />
      ))}
    </View>
  );
}

const BOX_SIZE = 44;
const BOX_HEIGHT = 54;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginVertical: 16 },
  box: {
    width: BOX_SIZE, height: BOX_HEIGHT,
    borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.ctrl,
    backgroundColor: colors.card,
    paddingVertical: 0, paddingHorizontal: 0,
    textAlign: 'center',
    fontFamily: fonts.headingBold, fontWeight: '700', fontSize: rf(fontSize.title), lineHeight: BOX_HEIGHT,
    color: colors.leaf900 || colors.leaf700,
  },
  boxFilled: { borderColor: colors.leaf700 },
  boxFocused: { borderColor: colors.leaf700, borderWidth: 2 },
});
