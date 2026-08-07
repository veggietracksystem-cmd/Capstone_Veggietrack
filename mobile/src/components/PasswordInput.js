import { rf } from '../lib/responsive';
import { useState } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
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
  editable = true,
  autoCapitalize = 'none',
  ...rest
}) {
  const [show, setShow] = useState(false);

  return (
    <View style={styles.wrap}>
      <TextInput
        style={[style, styles.input]}
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
  // Reserve room on the right for the eye button.
  input: { paddingRight: 46 },
  // Pinned near the top so it lines up with the input's first text line
  // regardless of the marginBottom baked into each screen's `styles.input`.
  eyeBtn: { position: 'absolute', right: 12, top: 12, padding: 2 },
});
