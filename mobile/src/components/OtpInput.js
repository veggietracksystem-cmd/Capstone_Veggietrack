import { useRef } from 'react';
import { View, TextInput, StyleSheet } from 'react-native';
import { rf } from '../lib/responsive';
import { colors, fonts, fontSize, radius } from '../theme/appTheme';

// Visual-only boxed code entry (matches the redesign prototype's OTP boxes).
// Still just a single string value under the hood — `value`/`onChangeText`
// behave exactly like a plain TextInput for the email verification screens.
export default function OtpInput({ value = '', onChangeText, length = 6, editable = true, accessibilityLabel = 'Verification code' }) {
  const inputs = useRef([]);
  const digits = Array.from({ length }, (_, i) => value[i] || '');

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
    <View style={styles.row} accessibilityLabel={accessibilityLabel}>
      {digits.map((digit, index) => (
        <TextInput
          key={index}
          ref={(el) => { inputs.current[index] = el; }}
          style={[styles.box, digit && styles.boxFilled]}
          value={digit}
          onChangeText={(text) => setDigit(index, text)}
          onKeyPress={(e) => onKeyPress(index, e)}
          keyboardType="number-pad"
          maxLength={2}
          editable={editable}
          textAlign="center"
          accessibilityLabel={`${accessibilityLabel} digit ${index + 1}`}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginVertical: 16 },
  box: {
    width: 44, height: 54,
    borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.ctrl,
    backgroundColor: colors.card,
    fontFamily: fonts.headingBold, fontSize: rf(fontSize.title), color: colors.leaf900 || colors.leaf700,
  },
  boxFilled: { borderColor: colors.leaf700 },
});
