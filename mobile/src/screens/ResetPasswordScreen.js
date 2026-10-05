import { useRef, useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { AuthPage, AuthButton, authStyles as s } from '../components/AuthForm';
import PasswordInput from '../components/PasswordInput';
import { supabase, authConfigured } from '../lib/supabase';
import { recoveryError } from '../lib/authErrors';
import { useAuth } from '../context/AuthContext';
import { showAlert } from '../lib/ui';
import { useTranslation } from '../i18n/useTranslation';

// Reached in recovery mode: after the Forgot Password code is verified, or after
// a Supabase recovery link exchanged its one-time PKCE code. The recovery
// session may only set a new password; leaving signs it out.
export default function ResetPasswordScreen({ navigation }) {
  const { t } = useTranslation();
  const { signOut, recoveryMode } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  const updatePassword = async () => {
    if (lock.current) return;
    if (password.length < 8) { setError(t('authx.pwShort')); return; }
    if (password !== confirmPassword) { setError(t('authx.pwMismatch')); return; }
    lock.current = true; setBusy(true); setError('');
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) { setError(t('authx.codeInvalid')); return; }
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      // Signing out ends the recovery session; the user logs in with the new password.
      await signOut({ redirectToLogin: true });
      showAlert(t('authx.passwordUpdated'), t('authx.passwordUpdatedMsg'));
    } catch (err) { setError(recoveryError(err)); }
    finally { lock.current = false; setBusy(false); }
  };

  const leave = () => {
    if (busy) return;
    if (recoveryMode) void signOut({ redirectToLogin: true });
    // Opened from a link there may be no earlier screen to return to.
    else if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Login');
  };

  return <AuthPage title={t('authx.resetTitle')} onBack={leave}>
    {!authConfigured && <Text style={s.error}>{t('authx.unavailable')}</Text>}
    {!recoveryMode ? <Text style={[s.note, styles.note]}>{t('authx.openLink')}</Text> : <>
      <Text style={[s.note, styles.note]}>{t('authx.chooseNew')}</Text>
      <PasswordInput style={s.input} placeholder={t('authx.newPassword')} accessibilityLabel={t('authx.newPassword')} value={password} onChangeText={setPassword} editable={!busy} />
      <PasswordInput style={s.input} placeholder={t('authx.confirmNewPassword')} accessibilityLabel={t('authx.confirmNewPassword')} value={confirmPassword} onChangeText={setConfirmPassword} editable={!busy} />
      <AuthButton title={t('authx.saveNewPassword')} disabled={busy || !authConfigured} onPress={updatePassword} />
    </>}
    {!!error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
    <AuthButton variant="ghost" title={t('common.back')} disabled={busy} onPress={leave} />
  </AuthPage>;
}

// Centered under the title, as on Verify Email.
const styles = StyleSheet.create({
  note: { textAlign: 'center', alignSelf: 'center', maxWidth: 320, lineHeight: 21 },
});
