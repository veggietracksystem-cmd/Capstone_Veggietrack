import { rf } from '../lib/responsive';
import { useState } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/appTheme';

const PRIMARY = colors.leaf700;

/**
 * Password field with a show/hide eye toggle (Issue 4).
 *
 * Drop-in replacement for a `<TextInput secureTextEntry />`. Pass the same
 * `style` you used on the original input — extra right padding is added so the
 * eye button never overlaps the text. Any other TextInput props pass through.
 */
export default function PasswordInput({
  style,
  value,
  onChangeText,
  placeholder,
  visibilityLabel = 'password',
  editable = true,
  autoCapitalize = 'none',
  ...rest
}) {
  const [show, setShow] = useState(false);
  const inputStyle = StyleSheet.flatten(style) || {};

  return (
    <View style={[styles.wrap, { marginBottom: inputStyle.marginBottom || 0 }]}>
      <TextInput
        style={[style, styles.input, styles.inputSpacing, Platform.OS === 'web' && styles.webInput]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        secureTextEntry={!show}
        autoCapitalize={autoCapitalize}
        editable={editable}
        {...rest}
      />
      <TouchableOpacity
        style={styles.eyeBtn}
        onPress={() => setShow((s) => !s)}
        accessibilityRole="button"
        accessibilityLabel={`${show ? 'Hide' : 'Show'} ${visibilityLabel}`}
        disabled={!editable}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        activeOpacity={0.6}
      >
        <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={rf(20)} color={PRIMARY} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative', justifyContent: 'center' },
  input: { paddingRight: 46 },
  inputSpacing: { marginBottom: 0 },
  webInput: { appearance: 'none', WebkitAppearance: 'none' },
  eyeBtn: { position: 'absolute', right: 10, top: '50%', minHeight: 28, padding: 2, justifyContent: 'center', transform: [{ translateY: -14 }] },
});
