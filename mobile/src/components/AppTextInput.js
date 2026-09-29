import { forwardRef } from 'react';
import { TextInput as RNTextInput } from 'react-native';
import { colors, fonts } from '../theme/appTheme';

// Shared text input. While empty it uses the placeholder style, because React
// Native renders the placeholder at the input's own font size.
export const PLACEHOLDER_FONT_SIZE = 10;

const AppTextInput = forwardRef(function AppTextInput({ style, value, placeholder, ...rest }, ref) {
  const empty = value === undefined || value === null || String(value).length === 0;
  return (
    <RNTextInput
      ref={ref}
      style={[style, !!placeholder && empty && { fontSize: PLACEHOLDER_FONT_SIZE, fontFamily: fonts.body, fontWeight: '400' }]}
      value={value}
      placeholder={placeholder}
      {...rest}
      placeholderTextColor={colors.placeholder}
    />
  );
});

export default AppTextInput;
