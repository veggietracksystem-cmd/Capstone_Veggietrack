import { View, Text, StyleSheet } from 'react-native';
import { colors, fonts, radius } from '../theme/appTheme';

// Shows an offline / pending-sync banner. Renders nothing when fully synced & online.
export default function OfflineBanner({ offline, pendingCount = 0 }) {
  if (!offline && pendingCount === 0) return null;

  return (
    <View style={[styles.banner, offline ? styles.offline : styles.pending]}>
      <Text style={styles.text}>
        {offline ? '⚠ Offline — showing saved data. ' : '🔄 '}
        {pendingCount > 0
          ? `${pendingCount} change${pendingCount > 1 ? 's' : ''} waiting to sync.`
          : 'Will sync automatically when online.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { borderRadius: radius.ctrl, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 12 },
  offline: { backgroundColor: colors.gold100, borderWidth: 1, borderColor: colors.gold500 },
  pending: { backgroundColor: colors.leaf100, borderWidth: 1, borderColor: colors.leaf500 },
  text: { fontFamily: fonts.body, fontSize: 13, color: colors.ink },
});
