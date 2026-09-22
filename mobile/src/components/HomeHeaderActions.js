import { StyleSheet, View } from 'react-native';
import MessagesIcon from './MessagesIcon';
import NotificationBell from './NotificationBell';
import { colors } from '../theme/appTheme';

// Right-hand actions for each module's Home header: Messages and
// Notifications, separated by a thin, low-opacity divider.
export default function HomeHeaderActions() {
  return (
    <View style={styles.row}>
      <MessagesIcon />
      <View style={styles.divider} />
      <NotificationBell />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  divider: {
    width: 1,
    height: 26,
    marginHorizontal: 4,
    backgroundColor: colors.ink,
    opacity: 0.12,
  },
});
