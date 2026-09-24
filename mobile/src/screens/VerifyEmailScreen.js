import { useState, useEffect, useRef } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { AuthPage, AuthButton, authStyles as s } from '../components/AuthForm';
import OtpInput from '../components/OtpInput';
import { supabase } from '../lib/supabase';
import { authError } from '../lib/authErrors';
import { useAuth } from '../context/AuthContext';
import { showAlert } from '../lib/ui';
import { useTranslation } from '../i18n/useTranslation';

const OTP_LENGTH = 6;

export default function VerifyEmailScreen({ navigation, route }) {
  const { t } = useTranslation();
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
    if (!otp.trim()) { setError(t('authx.enterCode')); return; }
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
      showAlert(t('authx.codeSentTitle'), t('authx.codeSentMsg'));
    } catch (resendError) { setError(authError(resendError)); }
    finally { lock.current = false; setBusy(false); }
  };

  return (
    <AuthPage title={t('authx.verifyTitle')} onBack={() => navigation.goBack()}>
      <Text style={[s.note, styles.note]}>{purpose === 'login' ? t('authx.codeSentLogin', { email }) : t('authx.codeSentSignup', { email })}</Text>
      <View style={styles.otpWrap}>
        <OtpInput value={otp} onChangeText={setOtp} length={OTP_LENGTH} editable={!busy} accessibilityLabel={t('authx.codeLabel')} />
      </View>
      <AuthButton title={t('authx.verify')} disabled={busy || otp.length < OTP_LENGTH} onPress={verify} />
      <View style={styles.resendWrap}>
        <AuthButton title={cooldown ? t('authx.resendIn', { n: cooldown }) : t('authx.resend')} variant="ghost" disabled={busy || cooldown > 0} onPress={resend} />
      </View>
      {!!error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
    </AuthPage>
  );
}

const styles = StyleSheet.create({
  // Centered, width-capped, and roomier line-height so the multi-sentence
  // instruction reads as one balanced block instead of spanning edge-to-edge.
  note: { textAlign: 'center', alignSelf: 'center', maxWidth: 320, lineHeight: 21, marginBottom: 20 },
  // Even rhythm: instruction 20 -> code boxes 20 -> Verify 12 -> Resend Code.
  otpWrap: { marginBottom: 20 },
  resendWrap: { marginTop: 12 },
});
