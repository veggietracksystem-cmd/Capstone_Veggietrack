import { forwardRef } from 'react';
import { TextInput as RNTextInput } from 'react-native';
import { colors, fonts } from '../theme/appTheme';

// The app's one text input. React Native draws a placeholder at the input's own
// font size, so to keep every placeholder the same small, subtle style (one
// size, family and color everywhere) the field switches to the placeholder style
// while it is empty and back to its normal size as soon as the user types.
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
