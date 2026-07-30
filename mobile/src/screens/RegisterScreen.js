import { useState } from 'react';
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
import MapPinningModal from '../components/MapPinningModal';

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

  const [phone, setPhone] = useState('+63');
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('farmer');
  const [location, setLocation] = useState('');
  const [mapModalVisible, setMapModalVisible] = useState(false);
  const [latitude, setLatitude] = useState(null);
  const [longitude, setLongitude] = useState(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const roleConfig = ROLES.find((r) => r.value === role) || ROLES[0];

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
    if (!password || password.length < 6) {
      showAlert('Error', 'Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      showAlert('Error', 'Passwords do not match.');
      return;
    }

    const payload = {
      phone: trimmedPhone,
      full_name: trimmedName,
      role,
      password,
      [roleConfig.locationKey]: location.trim() || undefined,
      latitude: latitude || undefined,
      longitude: longitude || undefined,
    };

    setLoading(true);
    try {
      const data = await api.post('/api/auth/register', payload);
      showAlert('Registration Successful', 'Your account has been created. Please log in to proceed.', () => {
        navigation.navigate('Login');
      });
    } catch (err) {
      showAlert('Error', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleMapConfirm = ({ latitude, longitude, address }) => {
    setLatitude(latitude);
    setLongitude(longitude);
    setLocation(address);
    setMapModalVisible(false);
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

          <Text style={styles.fieldLabel}>{roleConfig.locationLabel}</Text>
          <View style={styles.locationInputRow}>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0 }]}
              placeholder={roleConfig.locationLabel}
              value={location}
              onChangeText={setLocation}
              editable={!loading}
            />
            {role !== 'delivery_personnel' && (
              <TouchableOpacity
                style={styles.pinBtn}
                onPress={() => setMapModalVisible(true)}
                disabled={loading}
              >
                <Text style={styles.pinBtnText}>📍 Pin Map</Text>
              </TouchableOpacity>
            )}
          </View>
          {latitude && longitude ? (
            <Text style={styles.coordsLabel}>
              ✓ Coordinates pinned: {Number(latitude).toFixed(4)}, {Number(longitude).toFixed(4)}
            </Text>
          ) : null}

          <Text style={styles.fieldLabel}>Password</Text>
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
        </ScrollView>
      </KeyboardAvoidingView>
      <MapPinningModal
        visible={mapModalVisible}
        onConfirm={handleMapConfirm}
        onClose={() => setMapModalVisible(false)}
      />
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
  link: { textAlign: 'center', marginTop: 16, color: PRIMARY, fontSize: 14 },
  locationInputRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 16 },
  pinBtn: { paddingVertical: 12, paddingHorizontal: 16, backgroundColor: PRIMARY, borderRadius: 8 },
  pinBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  coordsLabel: { color: PRIMARY, fontSize: 13, fontWeight: '600', marginTop: -12, marginBottom: 16 },
});
