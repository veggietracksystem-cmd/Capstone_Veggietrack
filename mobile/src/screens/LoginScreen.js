import { useState, useEffect } from 'react';
import {
  Text, View, TextInput, TouchableOpacity, ActivityIndicator,
  StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../i18n/useTranslation';
import { showAlert } from '../lib/ui';
import { normalizePhone, isValidPhone } from '../lib/phone';
import PasswordInput from '../components/PasswordInput';
import UserGuideModal from '../components/UserGuideModal';
import ContactUsModal from '../components/ContactUsModal';

const REMEMBER_KEY = 'rememberedPhone'; // AsyncStorage key for the saved phone number

export default function LoginScreen({ navigation }) {
  const { signIn } = useAuth();
  const { t } = useTranslation();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);

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

  // Self-service password reset (ForgotPasswordScreen).
  const forgotPassword = () => {
    navigation.navigate('ForgotPassword');
  };

  // Direct login with phone + password
  const handleLogin = async () => {
    const trimmedPhone = normalizePhone(phone);
    if (!isValidPhone(trimmedPhone)) {
      showAlert(t('common.error'), t('common.phoneHint'));
      return;
    }
    if (!password) {
      showAlert(t('common.error'), t('auth.login.enterPassword'));
      return;
    }

    setLoading(true);
    try {
      const data = await api.post('/api/auth/login', { phone: trimmedPhone, password });
      
      try {
        if (rememberMe) await AsyncStorage.setItem(REMEMBER_KEY, trimmedPhone);
        else await AsyncStorage.removeItem(REMEMBER_KEY);
      } catch { /* ignore storage errors */ }

      await signIn(data.token, { ...data.user, name: data.user.full_name });
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
        <Text style={styles.title}>{t('auth.login.title')}</Text>
        <Text style={styles.subtitle}>{t('auth.login.subtitle')}</Text>

        <TextInput
          style={styles.input}
          placeholder={t('auth.login.phonePlaceholder')}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          autoCapitalize="none"
          editable={!loading}
        />

        <PasswordInput
          style={styles.input}
          placeholder={t('auth.login.passwordPlaceholder')}
          value={password}
          onChangeText={setPassword}
          editable={!loading}
        />

        {/* Remember Me + Forgot Password row */}
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
            <Text style={styles.rememberText}>{t('auth.login.rememberMe')}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={forgotPassword} disabled={loading}>
            <Text style={styles.forgotText}>{t('auth.login.forgotPassword')}</Text>
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
            : <Text style={styles.buttonText}>{t('auth.login.loginButton')}</Text>}
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.navigate('Register')} disabled={loading}>
          <Text style={styles.link}>{t('auth.login.noAccount')}</Text>
        </TouchableOpacity>

        {/* User Guide & Contact Us footer links */}
        <View style={styles.footerHelpRow}>
          <TouchableOpacity onPress={() => setGuideOpen(true)} disabled={loading}>
            <Text style={styles.footerHelpLink}>{t('auth.login.howItWorks')}</Text>
          </TouchableOpacity>
          <Text style={styles.footerHelpDot}>•</Text>
          <TouchableOpacity onPress={() => setContactOpen(true)} disabled={loading}>
            <Text style={styles.footerHelpLink}>{t('auth.login.contactUs')}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <UserGuideModal visible={guideOpen} onClose={() => setGuideOpen(false)} />
      <ContactUsModal visible={contactOpen} onClose={() => setContactOpen(false)} />
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

  // Remember Me + Forgot Password row
  optionsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: -8, marginBottom: 20 },
  rememberWrap: { flexDirection: 'row', alignItems: 'center' },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: '#2e7d32', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  checkboxChecked: { backgroundColor: '#2e7d32' },
  checkboxTick: { color: '#fff', fontSize: 13, fontWeight: '700', lineHeight: 16 },
  rememberText: { color: '#555', fontSize: 14 },
  forgotText: { color: '#2e7d32', fontSize: 14, fontWeight: '600' },

  footerHelpRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 28 },
  footerHelpLink: { color: '#555', fontSize: 13, fontWeight: '600' },
  footerHelpDot: { color: '#aaa', marginHorizontal: 12 },
});
