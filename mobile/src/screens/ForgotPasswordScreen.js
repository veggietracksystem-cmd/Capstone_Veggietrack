import { useState } from 'react';
import {
  Text, View, TextInput, TouchableOpacity, ActivityIndicator,
  StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { useTranslation } from '../i18n/useTranslation';
import { showAlert } from '../lib/ui';
import { normalizePhone, isValidPhone } from '../lib/phone';
import PasswordInput from '../components/PasswordInput';

export default function ForgotPasswordScreen({ navigation }) {
  const { t } = useTranslation();
  const [phone, setPhone] = useState('+63');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1); // 1: verify phone, 2: set new password

  const verifyPhone = async () => {
    const trimmedPhone = normalizePhone(phone);
    if (!isValidPhone(trimmedPhone)) {
      showAlert(t('common.error'), t('common.phoneHint'));
      return;
    }

    setLoading(true);
    try {
      await api.post('/api/auth/forgot-password', { phone: trimmedPhone });
      setStep(2);
    } catch (err) {
      showAlert(t('common.error'), err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!password || password.length < 6) {
      showAlert(t('common.error'), t('auth.forgotPassword.passwordTooShort'));
      return;
    }
    if (password !== confirmPassword) {
      showAlert(t('common.error'), t('auth.forgotPassword.passwordsDontMatch'));
      return;
    }

    setLoading(true);
    try {
      await api.post('/api/auth/reset-password', {
        phone: normalizePhone(phone),
        new_password: password,
      });
      showAlert(t('auth.forgotPassword.successTitle'), t('auth.forgotPassword.successMessage'), () => {
        navigation.navigate('Login');
      });
    } catch (err) {
      showAlert(t('common.error'), err.message);
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
        <Text style={styles.title}>{t('auth.forgotPassword.title')}</Text>

        {step === 1 ? (
          <>
            <Text style={styles.subtitle}>
              {t('auth.forgotPassword.step1Subtitle')}
            </Text>
            <TextInput
              style={styles.input}
              placeholder={t('auth.forgotPassword.phonePlaceholder')}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              autoCapitalize="none"
              editable={!loading}
            />
            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={verifyPhone}
              disabled={loading}
              activeOpacity={0.7}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.buttonText}>{t('auth.forgotPassword.continueButton')}</Text>}
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.subtitle}>
              {t('auth.forgotPassword.step2Subtitle', { phone: normalizePhone(phone) })}
            </Text>
            <PasswordInput
              style={styles.input}
              placeholder={t('auth.forgotPassword.newPasswordPlaceholder')}
              value={password}
              onChangeText={setPassword}
              editable={!loading}
            />
            <PasswordInput
              style={styles.input}
              placeholder={t('auth.forgotPassword.confirmPasswordPlaceholder')}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              editable={!loading}
            />
            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleResetPassword}
              disabled={loading}
              activeOpacity={0.7}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.buttonText}>{t('auth.forgotPassword.resetButton')}</Text>}
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity onPress={() => navigation.navigate('Login')} disabled={loading}>
          <Text style={styles.link}>{t('auth.forgotPassword.backToLogin')}</Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 30 },
  title: { fontSize: 32, fontWeight: 'bold', color: '#2e7d32', textAlign: 'center', marginBottom: 10 },
  subtitle: { fontSize: 16, color: '#555', textAlign: 'center', marginBottom: 30, lineHeight: 22 },
  input: { backgroundColor: '#fff', borderRadius: 8, padding: 12, fontSize: 16, marginBottom: 20, borderWidth: 1, borderColor: '#ddd' },
  button: { backgroundColor: '#2e7d32', padding: 14, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  link: { textAlign: 'center', marginTop: 20, color: '#2e7d32', fontSize: 14, fontWeight: '600' },
});
