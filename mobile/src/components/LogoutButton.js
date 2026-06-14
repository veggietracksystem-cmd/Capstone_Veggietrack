import { TouchableOpacity, Text, StyleSheet, Platform, Alert } from 'react-native';
import { useAuth } from '../context/AuthContext';

// Calling signOut() clears the token and flips the navigator back to Login
// automatically (RootNavigator re-renders off context) — no reload needed.
// Shared by every dashboard, so the confirmation lives here once.
export default function LogoutButton() {
  const { signOut } = useAuth();

  const confirmLogout = () => {
    if (Platform.OS === 'web') {
      // Alert.alert buttons are a no-op on web; use window.confirm instead.
      // eslint-disable-next-line no-alert
      if (window.confirm('Are you sure you want to log out?')) signOut();
      return;
    }
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => signOut() },
    ]);
  };

  return (
    <TouchableOpacity style={styles.button} onPress={confirmLogout} activeOpacity={0.7}>
      <Text style={styles.text}>Log out</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    marginTop: 24,
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2e7d32',
  },
  text: { color: '#2e7d32', fontSize: 16, fontWeight: '600' },
});
