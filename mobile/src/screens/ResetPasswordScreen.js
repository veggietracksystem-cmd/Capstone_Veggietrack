import { useRef, useState } from 'react';
import { Text } from 'react-native';
import { AuthPage, AuthButton, authStyles as s } from '../components/AuthForm';
import PasswordInput from '../components/PasswordInput';
import { supabase, authConfigured } from '../lib/supabase';
import { authError } from '../lib/authErrors';
import { useAuth } from '../context/AuthContext';

// This screen is reached after the Supabase recovery link has exchanged its
// one-time PKCE code for a short-lived recovery session.
export default function ResetPasswordScreen({ navigation }) {
  const { signOut, recoveryMode } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  const updatePassword = async () => {
    if (lock.current) return;
    if (password.length < 8) { setError('Please use a password with at least 8 characters.'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }
    lock.current = true; setBusy(true); setError('');
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) { setError('Your reset link has expired. Please ask for a new one.'); return; }
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      await signOut({ redirectToLogin: true });
    } catch (err) { setError(authError(err)); }
    finally { lock.current = false; setBusy(false); }
  };

  return <AuthPage title="Reset password">
    {!authConfigured && <Text style={s.error}>This isn’t available right now. Please try again later.</Text>}
    {!recoveryMode ? <Text style={s.note}>Open the link we emailed you on this phone to continue.</Text> : <>
      <Text style={s.note}>Choose a new password, then sign in again.</Text>
      <PasswordInput style={s.input} placeholder="New password" accessibilityLabel="New password" value={password} onChangeText={setPassword} editable={!busy} />
      <PasswordInput style={s.input} placeholder="Confirm new password" accessibilityLabel="Confirm new password" value={confirmPassword} onChangeText={setConfirmPassword} editable={!busy} />
      <AuthButton title="Save new password" disabled={busy || !authConfigured} onPress={updatePassword} />
    </>}
    {!!error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
    <AuthButton variant="ghost" title="Back" onPress={() => navigation.goBack()} />
  </AuthPage>;
}
