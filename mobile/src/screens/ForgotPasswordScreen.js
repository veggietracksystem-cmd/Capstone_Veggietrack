import { useEffect, useRef, useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { AuthPage, AuthInput, AuthButton, authStyles as s } from '../components/AuthForm';
import OtpInput from '../components/OtpInput';
import { supabase, authConfigured } from '../lib/supabase';
import { recoveryError } from '../lib/authErrors';
import { useAuth } from '../context/AuthContext';
import { showAlert } from '../lib/ui';
import { useTranslation } from '../i18n/useTranslation';

const OTP_LENGTH = 6;

// Reached both from Login (email typed by hand) and from Edit Profile, which
// already knows the signed-in address and passes it through as a param.
// Step 1 emails a verification code to a registered account; step 2 checks the
// code, which opens Reset Password (AuthContext recovery mode). Codes are used
// instead of a reset link so recovery works in every build without deep links.
export default function ForgotPasswordScreen({ navigation, route }) {
  const { t } = useTranslation();
  const { verifyRecoveryCode } = useAuth();
  const [email, setEmail] = useState(route?.params?.email || '');
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const lock = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => setCooldown((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(timer);
  }, []);

  const run = async (action) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await action(); }
    catch (err) { setError(recoveryError(err)); }
    finally { lock.current = false; setBusy(false); }
  };

  // shouldCreateUser: false makes Supabase refuse an email with no account, which
  // is how "Account not found." is detected.
  const sendCode = (address) => supabase.auth.signInWithOtp({ email: address, options: { shouldCreateUser: false } })
    .then(({ error: sendError }) => { if (sendError) throw sendError; });

  const submitEmail = () => {
    const address = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) { setError(t('authx.invalidEmail')); return; }
    return run(async () => {
      await sendCode(address);
      setSentTo(address); setCode(''); setCooldown(60);
    });
  };

  const resend = () => {
    if (cooldown > 0) return;
    return run(async () => {
      await sendCode(sentTo);
      setCode(''); setCooldown(60);
      showAlert(t('authx.codeSentTitle'), t('authx.codeSentMsg'));
    });
  };

  const verify = () => {
    if (code.trim().length < OTP_LENGTH) { setError(t('authx.enterCode')); return; }
    return run(() => verifyRecoveryCode(sentTo, code.trim()));
  };

  const backToEmail = () => { if (!busy) { setSentTo(''); setCode(''); setError(''); } };

  if (sentTo) {
    return (
      <AuthPage title={t('authx.resetTitle')} onBack={backToEmail}>
        <Text style={[s.note, styles.note]}>{t('authx.resetCodeSent', { email: sentTo })}</Text>
        <View style={styles.otpWrap}>
          <OtpInput value={code} onChangeText={setCode} length={OTP_LENGTH} editable={!busy} accessibilityLabel={t('authx.codeLabel')} />
        </View>
        <AuthButton title={t('authx.verify')} disabled={busy || code.length < OTP_LENGTH} onPress={verify} />
        <View style={styles.resendWrap}>
          <AuthButton title={cooldown ? t('authx.resendIn', { n: cooldown }) : t('authx.resend')} variant="ghost" disabled={busy || cooldown > 0} onPress={resend} />
        </View>
        {!!error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
        <AuthButton variant="ghost" title={t('authx.useDifferentEmail')} disabled={busy} onPress={backToEmail} />
      </AuthPage>
    );
  }

  return <AuthPage title={t('authx.resetTitle')}>
    {!authConfigured && <Text style={s.error}>{t('authx.unavailable')}</Text>}
    <Text style={[s.note, styles.note]}>{t('authx.resetIntro')}</Text>
    <AuthInput placeholder={t('authx.email')} accessibilityLabel={t('authx.email')} keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} editable={!busy} />
    <AuthButton title={t('authx.sendCode')} disabled={busy || !authConfigured} onPress={submitEmail} />
    {!!error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
    <AuthButton variant="ghost" title={t('common.back')} onPress={() => navigation.goBack()} />
  </AuthPage>;
}

const styles = StyleSheet.create({
  note: { textAlign: 'center', alignSelf: 'center', maxWidth: 320, lineHeight: 21, marginBottom: 20 },
  otpWrap: { marginBottom: 20 },
  resendWrap: { marginTop: 12 },
});
