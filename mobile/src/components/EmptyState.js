import { rf } from '../lib/responsive';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, fonts, radius, typography } from '../theme/appTheme';

const PRIMARY = colors.leaf700;

export default function EmptyState({ iconElement, title, message, actionLabel, onAction }) {
  return (
    <View style={styles.wrap}>
      {iconElement || <MaterialCommunityIcons name="sprout" size={rf(44)} color={colors.inkFaint} style={styles.icon} />}
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {actionLabel && onAction ? (
        <TouchableOpacity style={styles.button} onPress={onAction} activeOpacity={0.85}>
          <Text style={styles.buttonText}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40, paddingHorizontal: 24 },
  icon: { marginBottom: 12 },
  title: { ...typography.emptyTitle, color: colors.inkSoft, textAlign: 'center' },
  message: { ...typography.emptyMessage, color: colors.inkFaint, textAlign: 'center', marginTop: 6, lineHeight: 19 },
  button: { marginTop: 16, backgroundColor: PRIMARY, paddingVertical: 12, paddingHorizontal: 22, borderRadius: radius.ctrl },
  buttonText: { ...typography.buttonBlock, color: '#fff' },
});
