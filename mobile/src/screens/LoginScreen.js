import { useState, useEffect } from 'react';
import {
  Text, View, TextInput, TouchableOpacity, ActivityIndicator,
  StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { showAlert } from '../lib/ui';
import { normalizePhone, isValidPhone, PHONE_HINT } from '../lib/phone';
import PasswordInput from '../components/PasswordInput';

const REMEMBER_KEY = 'rememberedPhone'; // AsyncStorage key for the saved phone number

export default function LoginScreen({ navigation }) {
  const { signIn } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [otpMode, setOtpMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0); // resend cooldown, seconds remaining
  const [rememberMe, setRememberMe] = useState(false); // persist phone for next visit

  // Pre-fill the phone number if it was remembered on a previous login.
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(REMEMBER_KEY);
        if (saved) {
          setPhone(saved);
          setRememberMe(true);
        }
      } catch {
        // Non-fatal: just start with an empty field.
      }
    })();
  }, []);

  // Toggle the checkbox; clearing it immediately forgets the saved number.
  const toggleRememberMe = async () => {
    const next = !rememberMe;
    setRememberMe(next);
    if (!next) {
      try { await AsyncStorage.removeItem(REMEMBER_KEY); } catch { /* ignore */ }
    }
  };

  // Self-service password reset via OTP (ForgotPasswordScreen).
  const forgotPassword = () => {
    navigation.navigate('ForgotPassword');
  };

  // Tick the resend cooldown down to 0.
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const id = setInterval(() => setCooldown((c) => (c <= 1 ? 0 : c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  // Two-step login: validate phone + password first, then send the OTP.
  const handleLogin = async () => {
    const trimmedPhone = normalizePhone(phone);
    if (!isValidPhone(trimmedPhone)) {
      showAlert('Error', PHONE_HINT);
      return;
    }
    if (!password) {
      showAlert('Error', 'Enter your password.');
      return;
    }

    setLoading(true);
    try {
      // Step 1: verify credentials (rejects a wrong password for accounts that
      // have one set; legacy OTP-only accounts pass through).
      await api.post('/api/auth/login', { phone: trimmedPhone, password });
      // Step 2: credentials OK → send the OTP and switch to OTP entry.
      await api.post('/api/auth/send-otp', { phone: trimmedPhone });
      showAlert('Success', 'Password verified. We sent a 6-digit code to your phone.');
      setOtpMode(true);
      setCooldown(60); // start the resend cooldown after the first send
    } catch (err) {
      showAlert('Error', err.message);
    } finally {
      setLoading(false);
    }
  };

  const resendOTP = async () => {
    if (cooldown > 0) return;
    setLoading(true);
    try {
      await api.post('/api/auth/resend-otp', { phone: normalizePhone(phone), purpose: 'login' });
      showAlert('Success', 'OTP resent to your phone.');
      setCooldown(60);
    } catch (err) {
      showAlert('Error', err.message);
    } finally {
      setLoading(false);
    }
  };

  const verifyOTP = async () => {
    const trimmedOtp = otp.trim();
    if (trimmedOtp.length !== 6) {
      showAlert('Error', 'Enter the 6-digit OTP');
      return;
    }

    setLoading(true);
    try {
      const data = await api.post('/api/auth/verify-otp', {
        phone: normalizePhone(phone),
        otp: trimmedOtp,
      });
      // Save (or clear) the phone for next time based on the Remember Me choice.
      try {
        if (rememberMe) await AsyncStorage.setItem(REMEMBER_KEY, normalizePhone(phone));
        else await AsyncStorage.removeItem(REMEMBER_KEY);
      } catch { /* ignore storage errors */ }
      // signIn saves token+user and flips the navigator to the dashboard — no reload.
      await signIn(data.token, data.user);
    } catch (err) {
      showAlert('Error', err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.inner}
      >
        <Text style={styles.title}>VeggieTrack</Text>
        <Text style={styles.subtitle}>Sign in with your phone, password & OTP</Text>

        {!otpMode ? (
          <>
            <TextInput
              style={styles.input}
              placeholder="Phone number (e.g., +639171234567)"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              autoCapitalize="none"
              editable={!loading}
            />

            <PasswordInput
              style={styles.input}
              placeholder="Password"
              value={password}
              onChangeText={setPassword}
              editable={!loading}
            />

            {/* Remember Me + Forgot Password row (between password input and Login) */}
            <View style={styles.optionsRow}>
              <TouchableOpacity
                style={styles.rememberWrap}
                onPress={toggleRememberMe}
                disabled={loading}
                activeOpacity={0.7}
              >
                <View style={[styles.checkbox, rememberMe && styles.checkboxChecked]}>
                  {rememberMe && <Text style={styles.checkboxTick}>✓</Text>}
                </View>
                <Text style={styles.rememberText}>Remember Me</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={forgotPassword} disabled={loading}>
                <Text style={styles.forgotText}>Forgot Password?</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.7}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.buttonText}>Login</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.navigate('Register')} disabled={loading}>
              <Text style={styles.link}>No account yet? Register</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TextInput
              style={styles.input}
              placeholder="Enter 6-digit OTP"
              value={otp}
              onChangeText={setOtp}
              keyboardType="number-pad"
              maxLength={6}
              editable={!loading}
            />
            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={verifyOTP}
              disabled={loading}
              activeOpacity={0.7}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.buttonText}>Verify</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={resendOTP} disabled={loading || cooldown > 0}>
              <Text style={[styles.link, cooldown > 0 && styles.linkDisabled]}>
                {cooldown > 0 ? `Resend OTP in ${cooldown}s` : 'Resend OTP'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setOtpMode(false)} disabled={loading}>
              <Text style={styles.link}>Change phone number</Text>
            </TouchableOpacity>
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 30 },
  title: { fontSize: 32, fontWeight: 'bold', color: '#2e7d32', textAlign: 'center', marginBottom: 10 },
  subtitle: { fontSize: 16, color: '#555', textAlign: 'center', marginBottom: 40 },
  input: { backgroundColor: '#fff', borderRadius: 8, padding: 12, fontSize: 16, marginBottom: 20, borderWidth: 1, borderColor: '#ddd' },
  button: { backgroundColor: '#2e7d32', padding: 14, borderRadius: 8, alignItems: 'center' },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  link: { textAlign: 'center', marginTop: 20, color: '#2e7d32', fontSize: 14 },
  linkDisabled: { color: '#999' },

  // Remember Me + Forgot Password row
  optionsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: -8, marginBottom: 20 },
  rememberWrap: { flexDirection: 'row', alignItems: 'center' },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: '#2e7d32', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  checkboxChecked: { backgroundColor: '#2e7d32' },
  checkboxTick: { color: '#fff', fontSize: 13, fontWeight: '700', lineHeight: 16 },
  rememberText: { color: '#555', fontSize: 14 },
  forgotText: { color: '#2e7d32', fontSize: 14, fontWeight: '600' },
});
