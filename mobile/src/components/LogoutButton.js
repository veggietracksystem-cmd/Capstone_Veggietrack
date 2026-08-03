import { TouchableOpacity, Text, StyleSheet, Platform, Alert } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../i18n/useTranslation';

// Calling signOut() clears the token and flips the navigator back to Login
// automatically (RootNavigator re-renders off context) — no reload needed.
// Shared by every dashboard, so the confirmation lives here once.
export default function LogoutButton() {
  const { signOut } = useAuth();
  const { t } = useTranslation();

  const confirmLogout = () => {
    if (Platform.OS === 'web') {
      // Alert.alert buttons are a no-op on web; use window.confirm instead.
      // eslint-disable-next-line no-alert
      if (window.confirm(t('profile.logoutConfirmMessage'))) signOut();
      return;
    }
    Alert.alert(t('profile.logoutConfirmTitle'), t('profile.logoutConfirmMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.logout'), style: 'destructive', onPress: () => signOut() },
    ]);
  };

  return (
    <TouchableOpacity style={styles.button} onPress={confirmLogout} activeOpacity={0.7}>
      <Text style={styles.text}>{t('common.logout')}</Text>
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
