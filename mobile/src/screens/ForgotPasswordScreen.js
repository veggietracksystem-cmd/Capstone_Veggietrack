import { useState } from 'react';
import {
  Text, View, TextInput, TouchableOpacity, ActivityIndicator,
  StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { showAlert } from '../lib/ui';

export default function ForgotPasswordScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const sendResetLink = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      showAlert('Error', 'Please enter your email address.');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      showAlert('Error', 'Please enter a valid email address.');
      return;
    }

    setLoading(true);
    try {
      await api.post('/api/auth/forgot-password-email', { email: trimmedEmail });
      setSent(true);
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
        
        {!sent ? (
          <>
            <Text style={styles.subtitle}>
              Enter your email address to receive a secure link to reset your password.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Email address (e.g., user@example.com)"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!loading}
            />
            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={sendResetLink}
              disabled={loading}
              activeOpacity={0.7}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.buttonText}>Send Reset Link</Text>}
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={styles.successBox}>
              <Text style={styles.successIcon}>✉️</Text>
              <Text style={styles.successText}>
                We've sent a password reset link to:
              </Text>
              <Text style={styles.successEmail}>{email}</Text>
              <Text style={styles.successInstructions}>
                Please check your inbox (and spam folder) and follow the link to set a new password. Once done, you can return here to log in.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.button}
              onPress={() => {
                setSent(false);
                setEmail('');
                navigation.navigate('Login');
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.buttonText}>Return to Login</Text>
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
  subtitle: { fontSize: 16, color: '#555', textAlign: 'center', marginBottom: 30, lineHeight: 22 },
  input: { backgroundColor: '#fff', borderRadius: 8, padding: 12, fontSize: 16, marginBottom: 20, borderWidth: 1, borderColor: '#ddd' },
  button: { backgroundColor: '#2e7d32', padding: 14, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  link: { textAlign: 'center', marginTop: 20, color: '#2e7d32', fontSize: 14, fontWeight: '600' },

  successBox: { alignItems: 'center', marginBottom: 20, backgroundColor: '#fff', padding: 20, borderRadius: 12, borderWidth: 1, borderColor: '#e8f5e9' },
  successIcon: { fontSize: 48, marginBottom: 10 },
  successText: { fontSize: 16, color: '#555', textAlign: 'center' },
  successEmail: { fontSize: 16, fontWeight: '700', color: '#2e7d32', marginVertical: 6 },
  successInstructions: { fontSize: 14, color: '#666', textAlign: 'center', marginTop: 8, lineHeight: 20 },
});
