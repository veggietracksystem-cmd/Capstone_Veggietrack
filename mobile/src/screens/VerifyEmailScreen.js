import { useState, useEffect, useRef } from 'react';
import { Text } from 'react-native';
import { AuthPage, AuthButton, authStyles as s } from '../components/AuthForm';
import OtpInput from '../components/OtpInput';
import { supabase } from '../lib/supabase';
import { authError } from '../lib/authErrors';
import { useAuth } from '../context/AuthContext';
import { showAlert } from '../lib/ui';

export default function VerifyEmailScreen({ navigation, route }) {
  const email = route.params?.email || '';
  const purpose = route.params?.purpose || 'signup';
  const { refreshProfile } = useAuth();
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const lock = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => setCooldown((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(timer);
  }, []);

  const verify = async () => {
    if (lock.current) return;
    if (!otp.trim()) { setError('Enter the code sent to your email.'); return; }
    lock.current = true; setBusy(true); setError('');
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({ email, token: otp.trim(), type: purpose === 'login' ? 'email' : 'signup' });
      if (verifyError) throw verifyError;
      setOtp('');
      if (purpose === 'login') await refreshProfile();
      else {
        await supabase.auth.signOut({ scope: 'local' });
        navigation.navigate('Login');
      }
    } catch (verifyError) { setError(authError(verifyError)); }
    finally { lock.current = false; setBusy(false); }
  };

  const resend = async () => {
    if (lock.current || cooldown > 0) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const { error: resendError } = purpose === 'login'
        ? await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })
        : await supabase.auth.resend({ type: 'signup', email });
      if (resendError) throw resendError;
      setCooldown(60);
      showAlert('Verification code', 'A new code has been sent to your email.');
    } catch (resendError) { setError(authError(resendError)); }
    finally { lock.current = false; setBusy(false); }
  };

  return (
    <AuthPage title="Verify your email">
      <Text style={s.note}>{purpose === 'login' ? `We sent a sign-in verification code to ${email}.` : `We sent a verification code to ${email}. Enter it below to confirm your account. Once verified, your registration will be sent to the distributor for approval.`}</Text>
      <OtpInput value={otp} onChangeText={setOtp} length={6} editable={!busy} accessibilityLabel="Verification code" />
      <AuthButton title="Verify" disabled={busy || !otp} onPress={verify} />
      <AuthButton title={cooldown ? `Resend in ${cooldown}s` : 'Resend Code'} variant="ghost" disabled={busy || cooldown > 0} onPress={resend} />
      {!!error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
      <AuthButton variant="ghost" title="Back" onPress={() => navigation.goBack()} />
    </AuthPage>
  );
}
