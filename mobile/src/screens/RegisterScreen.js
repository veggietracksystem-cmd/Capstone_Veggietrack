import { useState, useEffect } from 'react';
import {
  Text, TextInput, TouchableOpacity, ActivityIndicator, View, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { showAlert } from '../lib/ui';
import { normalizePhone, isValidPhone, PHONE_HINT } from '../lib/phone';
import PasswordInput from '../components/PasswordInput';

const PRIMARY = '#2e7d32';

// Role -> location field key + label. The backend reads the matching key.
const ROLES = [
  { value: 'farmer', label: 'Farmer', locationKey: 'farm_location', locationLabel: 'Farm Location' },
  { value: 'distributor', label: 'Distributor', locationKey: 'warehouse_location', locationLabel: 'Warehouse Location' },
  { value: 'retailer', label: 'Retailer', locationKey: 'store_location', locationLabel: 'Store Location' },
  { value: 'delivery_personnel', label: 'Delivery', locationKey: 'service_area', locationLabel: 'Service Area' },
];

export default function RegisterScreen({ navigation }) {
  const { signIn } = useAuth();

  // Step 1 form fields.
  const [phone, setPhone] = useState('+63');
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState(''); // optional, UI-only for now
  const [role, setRole] = useState('farmer');
  const [email, setEmail] = useState('');
  const [location, setLocation] = useState('');
  // Password is optional. If set, it's validated locally (match + min length)
  // and sent to the backend, which stores a bcrypt hash for password+OTP login.
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Step 2 (OTP) — reuses the same otpMode pattern as LoginScreen.
  const [otp, setOtp] = useState('');
  const [otpMode, setOtpMode] = useState(false);
  const [loading, setLoading] = useState(false);

  // Resend cooldown (seconds remaining; 0 = enabled).
  const [cooldown, setCooldown] = useState(0);

  const roleConfig = ROLES.find((r) => r.value === role) || ROLES[0];

  // Tick the resend cooldown down to 0.
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const id = setInterval(() => setCooldown((c) => (c <= 1 ? 0 : c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const register = async () => {
    const trimmedPhone = normalizePhone(phone);
    const trimmedName = fullName.trim();

    if (!isValidPhone(trimmedPhone)) {
      showAlert('Error', PHONE_HINT);
      return;
    }
    if (!trimmedName) {
      showAlert('Error', 'Enter your full name.');
      return;
    }
    // Password is optional. If the user fills it in, validate match + length
    // before sending it to the backend (which stores a bcrypt hash).
    if (password || confirmPassword) {
      if (password.length < 6) {
        showAlert('Error', 'Password must be at least 6 characters.');
        return;
      }
      if (password !== confirmPassword) {
        showAlert('Error', 'Passwords do not match.');
        return;
      }
    }

    // Issue 14: build the payload once and log exactly what's sent, including
    // the role-specific location key (farm_location/warehouse_location/etc.).
    const payload = {
      phone: trimmedPhone,
      full_name: trimmedName,
      role,
      email: email.trim() || undefined,
      // Sent so the backend can store a bcrypt hash for password+OTP login.
      // Optional: if left blank the account works via OTP only.
      password: password || undefined,
      [roleConfig.locationKey]: location.trim() || undefined,
    };
    console.log('[register] locationKey:', roleConfig.locationKey);
    console.log('[register] payload:', JSON.stringify({ ...payload, password: password ? '***' : undefined }));

    setLoading(true);
    try {
      await api.post('/api/auth/register', payload);
      showAlert('Success', 'OTP sent to your phone.');
      setOtpMode(true);
      setCooldown(60); // start the resend cooldown right after the first send
    } catch (err) {
      showAlert('Error', err.message);
    } finally {
      setLoading(false);
    }
  };

  const verifyRegistration = async () => {
    const trimmedOtp = otp.trim();
    if (trimmedOtp.length !== 6) {
      showAlert('Error', 'Enter the 6-digit OTP');
      return;
    }

    setLoading(true);
    try {
      const data = await api.post('/api/auth/verify-registration', {
        phone: normalizePhone(phone),
        otp: trimmedOtp,
      });
      // Issue 14: confirm the saved user (incl. location field) came back.
      console.log('[verify-registration] saved user:', JSON.stringify(data.user));
      // signIn saves token+user and flips the navigator to the right dashboard.
      // Map full_name -> name so dashboard headers (which read user.name) work.
      await signIn(data.token, { ...data.user, name: data.user.full_name });
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
      await api.post('/api/auth/resend-otp', { phone: normalizePhone(phone), purpose: 'registration' });
      showAlert('Success', 'OTP resent to your phone.');
      setCooldown(60);
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
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>Register with your phone number</Text>

          {!otpMode ? (
            <>
              <Text style={styles.fieldLabel}>Phone number</Text>
              <TextInput
                style={styles.input}
                placeholder="+639171234567"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                autoCapitalize="none"
                editable={!loading}
              />

              <Text style={styles.fieldLabel}>Full name</Text>
              <TextInput
                style={styles.input}
                placeholder="Juan dela Cruz"
                value={fullName}
                onChangeText={setFullName}
                editable={!loading}
              />

              <Text style={styles.fieldLabel}>Username (optional)</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g., juandc"
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                editable={!loading}
              />

              <Text style={styles.fieldLabel}>Role</Text>
              <View style={styles.roleWrap}>
                {ROLES.map((r) => {
                  const selected = role === r.value;
                  return (
                    <TouchableOpacity
                      key={r.value}
                      style={[styles.roleChip, selected && styles.roleChipActive]}
                      onPress={() => setRole(r.value)}
                      disabled={loading}
                    >
                      <Text style={[styles.roleChipText, selected && styles.roleChipTextActive]}>
                        {r.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.fieldLabel}>Email (optional)</Text>
              <TextInput
                style={styles.input}
                placeholder="you@example.com"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                editable={!loading}
              />

              <Text style={styles.fieldLabel}>{roleConfig.locationLabel}</Text>
              <TextInput
                style={styles.input}
                placeholder={roleConfig.locationLabel}
                value={location}
                onChangeText={setLocation}
                editable={!loading}
              />

              {/* Password (optional) — stored as a bcrypt hash for password+OTP
                  login. Leave blank to use OTP-only login. */}
              <Text style={styles.fieldLabel}>Password (optional)</Text>
              <PasswordInput
                style={styles.input}
                placeholder="At least 6 characters"
                value={password}
                onChangeText={setPassword}
                editable={!loading}
              />

              <Text style={styles.fieldLabel}>Confirm Password</Text>
              <PasswordInput
                style={styles.input}
                placeholder="Re-enter password"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                editable={!loading}
              />

              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={register}
                disabled={loading}
                activeOpacity={0.7}
              >
                {loading
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.buttonText}>Register</Text>}
              </TouchableOpacity>

              <TouchableOpacity onPress={() => navigation.navigate('Login')} disabled={loading}>
                <Text style={styles.link}>Already have an account? Sign in</Text>
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
                onPress={verifyRegistration}
                disabled={loading}
                activeOpacity={0.7}
              >
                {loading
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.buttonText}>Verify</Text>}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.resendBtn}
                onPress={resendOTP}
                disabled={loading || cooldown > 0}
              >
                <Text style={[styles.link, cooldown > 0 && styles.linkDisabled]}>
                  {cooldown > 0 ? `Resend OTP in ${cooldown}s` : 'Resend OTP'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={() => setOtpMode(false)} disabled={loading}>
                <Text style={styles.link}>Change phone number</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  inner: { padding: 30, paddingTop: 20 },
  title: { fontSize: 32, fontWeight: 'bold', color: PRIMARY, textAlign: 'center', marginBottom: 6 },
  subtitle: { fontSize: 16, color: '#555', textAlign: 'center', marginBottom: 24 },
  fieldLabel: { fontSize: 13, color: '#555', marginBottom: 6, marginTop: 4 },
  input: { backgroundColor: '#fff', borderRadius: 8, padding: 12, fontSize: 16, marginBottom: 16, borderWidth: 1, borderColor: '#ddd' },
  roleWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  roleChip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: '#ccc', backgroundColor: '#fff' },
  roleChipActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  roleChipText: { color: '#555', fontSize: 14 },
  roleChipTextActive: { color: '#fff', fontWeight: '600' },
  button: { backgroundColor: PRIMARY, padding: 14, borderRadius: 8, alignItems: 'center', marginTop: 8 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  resendBtn: { marginTop: 16 },
  link: { textAlign: 'center', marginTop: 16, color: PRIMARY, fontSize: 14 },
  linkDisabled: { color: '#999' },
});
