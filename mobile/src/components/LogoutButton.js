import { rf } from '../lib/responsive';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../i18n/useTranslation';
import { confirmAction } from '../lib/ui';

// Calling signOut() clears the token and flips the navigator back to Login
// automatically (RootNavigator re-renders off context) — no reload needed.
// Shared by every dashboard, so the confirmation lives here once.
export default function LogoutButton() {
  const { signOut } = useAuth();
  const { t } = useTranslation();

  const confirmLogout = () => {
    confirmAction(t('profile.logoutConfirmTitle'), t('profile.logoutConfirmMessage'), () => signOut());
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
    borderColor: '#1E4E09',
  },
  text: { color: '#1E4E09', fontSize: rf(16), fontWeight: '600' },
});
