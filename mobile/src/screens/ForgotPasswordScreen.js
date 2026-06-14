import { useState } from 'react';
import {
  Text, View, TextInput, TouchableOpacity, ActivityIndicator,
  StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { showAlert } from '../lib/ui';
import { normalizePhone, isValidPhone, PHONE_HINT } from '../lib/phone';
import PasswordInput from '../components/PasswordInput';

export default function ForgotPasswordScreen({ navigation }) {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otpSent, setOtpSent] = useState(false); // false: request OTP, true: enter OTP + new password
  const [loading, setLoading] = useState(false);

  // Step 1: validate the phone and request a reset OTP.
  const sendOtp = async () => {
    const trimmedPhone = normalizePhone(phone);
    if (!isValidPhone(trimmedPhone)) {
      showAlert('Error', PHONE_HINT);
      return;
    }
    setLoading(true);
    try {
      await api.post('/api/auth/forgot-password', { phone: trimmedPhone });
      showAlert('OTP sent', 'A reset code was sent to your phone.');
      setOtpSent(true);
    } catch (err) {
      showAlert('Error', err.message);
    } finally {
      setLoading(false);
    }
  };

  // Step 2: verify the OTP and set the new password.
  const resetPassword = async () => {
    const trimmedOtp = otp.trim();
    if (trimmedOtp.length !== 6) {
      showAlert('Error', 'Enter the 6-digit OTP.');
      return;
    }
    if (newPassword.length < 6) {
      showAlert('Error', 'New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      showAlert('Error', 'Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await api.post('/api/auth/reset-password', {
        phone: normalizePhone(phone),
        otp: trimmedOtp,
        new_password: newPassword,
      });
      showAlert('Success', 'Password reset successful. You can now log in.');
      navigation.navigate('Login');
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
        <Text style={styles.title}>Reset Password</Text>
        <Text style={styles.subtitle}>
          {otpSent
            ? 'Enter the code we sent and choose a new password.'
            : 'Enter your phone number to receive a reset code.'}
        </Text>

        {!otpSent ? (
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
            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={sendOtp}
              disabled={loading}
              activeOpacity={0.7}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.buttonText}>Send OTP</Text>}
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
            <PasswordInput
              style={styles.input}
              placeholder="New password"
              value={newPassword}
              onChangeText={setNewPassword}
              editable={!loading}
            />
            <PasswordInput
              style={styles.input}
              placeholder="Confirm new password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              editable={!loading}
            />
            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={resetPassword}
              disabled={loading}
              activeOpacity={0.7}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.buttonText}>Reset Password</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setOtpSent(false)} disabled={loading}>
              <Text style={styles.link}>Change phone number</Text>
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity onPress={() => navigation.navigate('Login')} disabled={loading}>
          <Text style={styles.link}>Back to Login</Text>
        </TouchableOpacity>
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
});
