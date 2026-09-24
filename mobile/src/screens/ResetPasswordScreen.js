import { useRef, useState } from 'react';
import { Text } from 'react-native';
import { AuthPage, AuthButton, authStyles as s } from '../components/AuthForm';
import PasswordInput from '../components/PasswordInput';
import { supabase, authConfigured } from '../lib/supabase';
import { authError } from '../lib/authErrors';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../i18n/useTranslation';

// This screen is reached after the Supabase recovery link has exchanged its
// one-time PKCE code for a short-lived recovery session.
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
      if (!sessionData.session) { setError(t('authx.linkExpired')); return; }
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      await signOut({ redirectToLogin: true });
    } catch (err) { setError(authError(err)); }
    finally { lock.current = false; setBusy(false); }
  };

  return <AuthPage title={t('authx.resetTitle')}>
    {!authConfigured && <Text style={s.error}>{t('authx.unavailable')}</Text>}
    {!recoveryMode ? <Text style={s.note}>{t('authx.openLink')}</Text> : <>
      <Text style={s.note}>{t('authx.chooseNew')}</Text>
      <PasswordInput style={s.input} placeholder={t('authx.newPassword')} accessibilityLabel={t('authx.newPassword')} value={password} onChangeText={setPassword} editable={!busy} />
      <PasswordInput style={s.input} placeholder={t('authx.confirmNewPassword')} accessibilityLabel={t('authx.confirmNewPassword')} value={confirmPassword} onChangeText={setConfirmPassword} editable={!busy} />
      <AuthButton title={t('authx.saveNewPassword')} disabled={busy || !authConfigured} onPress={updatePassword} />
    </>}
    {!!error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
    <AuthButton variant="ghost" title={t('common.back')} onPress={() => navigation.goBack()} />
  </AuthPage>;
}
