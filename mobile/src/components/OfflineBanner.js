import { View, Text, StyleSheet } from 'react-native';

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
  banner: { borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 12 },
  offline: { backgroundColor: '#fff8e1', borderWidth: 1, borderColor: '#f9a825' },
  pending: { backgroundColor: '#e3f2fd', borderWidth: 1, borderColor: '#1976d2' },
  text: { fontSize: 13, color: '#444' },
});
