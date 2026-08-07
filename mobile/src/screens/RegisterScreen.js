import { rf } from '../lib/responsive';
import { useState } from 'react';
import {
  Text, TextInput, TouchableOpacity, ActivityIndicator, View, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../i18n/useTranslation';
import { showAlert } from '../lib/ui';
import { normalizePhone, isValidPhone } from '../lib/phone';
import PasswordInput from '../components/PasswordInput';
import MapPinningModal from '../components/MapPinningModal';

const PRIMARY = '#1E4E09';
const PH_PREFIX = '+63';

export default function RegisterScreen({ navigation }) {
  const { signIn } = useAuth();
  const { t } = useTranslation();

  // Role -> location field key + i18n keys. The backend reads the matching key.
  const ROLES = [
    { value: 'farmer', label: t('auth.register.roleFarmer'), locationKey: 'farm_location', locationLabel: t('auth.register.farmLocation') },
    { value: 'distributor', label: t('auth.register.roleDistributor'), locationKey: 'warehouse_location', locationLabel: t('auth.register.warehouseLocation') },
    { value: 'retailer', label: t('auth.register.roleRetailer'), locationKey: 'store_location', locationLabel: t('auth.register.storeLocation') },
    { value: 'delivery_personnel', label: t('auth.register.roleDelivery'), locationKey: 'service_area', locationLabel: t('auth.register.serviceArea') },
  ];

  const [localNumber, setLocalNumber] = useState('');
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

  // Only digits reach the field; a leading 0 (common when copying a local
  // number like 0917...) is dropped since the +63 prefix already covers it.
  const handlePhoneChange = (text) => {
    let digits = text.replace(/\D/g, '');
    if (digits.startsWith('0')) digits = digits.slice(1);
    setLocalNumber(digits.slice(0, 10));
  };

  const register = async () => {
    const trimmedPhone = normalizePhone(`${PH_PREFIX}${localNumber}`);
    const trimmedName = fullName.trim();

    if (!isValidPhone(trimmedPhone)) {
      showAlert(t('common.error'), t('common.phoneHint'));
      return;
    }
    if (!trimmedName) {
      showAlert(t('common.error'), t('auth.register.enterFullName'));
      return;
    }
    if (!password || password.length < 6) {
      showAlert(t('common.error'), t('auth.register.passwordTooShort'));
      return;
    }
    if (password !== confirmPassword) {
      showAlert(t('common.error'), t('auth.register.passwordsDontMatch'));
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
      showAlert(t('auth.register.successTitle'), t('auth.register.successMessage'), () => {
        navigation.navigate('Login');
      });
    } catch (err) {
      showAlert(t('common.error'), err.message);
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
          <Text style={styles.title}>{t('auth.register.title')}</Text>
          <Text style={styles.subtitle}>{t('auth.register.subtitle')}</Text>

          <Text style={styles.fieldLabel}>{t('auth.register.phoneLabel')}</Text>
          <View style={styles.phoneRow}>
            <View style={styles.phonePrefix}>
              <Text style={styles.phonePrefixText}>{PH_PREFIX}</Text>
            </View>
            <TextInput
              style={styles.phoneInput}
              placeholder="9171234567"
              value={localNumber}
              onChangeText={handlePhoneChange}
              keyboardType="phone-pad"
              autoCapitalize="none"
              editable={!loading}
              maxLength={10}
            />
          </View>

          <Text style={styles.fieldLabel}>{t('auth.register.fullNameLabel')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('auth.register.fullNamePlaceholder')}
            value={fullName}
            onChangeText={setFullName}
            editable={!loading}
          />

          <Text style={styles.fieldLabel}>{t('auth.register.usernameLabel')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('auth.register.usernamePlaceholder')}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            editable={!loading}
          />

          <Text style={styles.fieldLabel}>{t('auth.register.roleLabel')}</Text>
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
                <Text style={styles.pinBtnText}>{t('auth.register.pinMap')}</Text>
              </TouchableOpacity>
            )}
          </View>
          {latitude && longitude ? (
            <Text style={styles.coordsLabel}>
              {t('auth.register.coordsPinned', { lat: Number(latitude).toFixed(4), lng: Number(longitude).toFixed(4) })}
            </Text>
          ) : null}

          <Text style={styles.fieldLabel}>{t('auth.register.passwordLabel')}</Text>
          <PasswordInput
            style={styles.input}
            placeholder={t('auth.register.passwordPlaceholder')}
            value={password}
            onChangeText={setPassword}
            editable={!loading}
          />

          <Text style={styles.fieldLabel}>{t('auth.register.confirmPasswordLabel')}</Text>
          <PasswordInput
            style={styles.input}
            placeholder={t('auth.register.confirmPasswordPlaceholder')}
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
              : <Text style={styles.buttonText}>{t('auth.register.registerButton')}</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigation.navigate('Login')} disabled={loading}>
            <Text style={styles.link}>{t('auth.register.haveAccount')}</Text>
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
  title: { fontSize: rf(32), fontWeight: 'bold', color: PRIMARY, textAlign: 'center', marginBottom: 6 },
  subtitle: { fontSize: rf(16), color: '#555', textAlign: 'center', marginBottom: 24 },
  fieldLabel: { fontSize: rf(13), color: '#555', marginBottom: 6, marginTop: 4 },
  input: { backgroundColor: '#fff', borderRadius: 8, padding: 12, fontSize: rf(16), marginBottom: 16, borderWidth: 1, borderColor: '#ddd' },
  phoneRow: { flexDirection: 'row', alignItems: 'stretch', marginBottom: 16, borderRadius: 8, borderWidth: 1, borderColor: '#ddd', backgroundColor: '#fff', overflow: 'hidden' },
  phonePrefix: { justifyContent: 'center', paddingHorizontal: 12, backgroundColor: '#f0f0f0', borderRightWidth: 1, borderRightColor: '#ddd' },
  phonePrefixText: { fontSize: rf(16), color: '#333', fontWeight: '600' },
  phoneInput: { flex: 1, padding: 12, fontSize: rf(16) },
  roleWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  roleChip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: '#ccc', backgroundColor: '#fff' },
  roleChipActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  roleChipText: { color: '#555', fontSize: rf(14) },
  roleChipTextActive: { color: '#fff', fontWeight: '600' },
  button: { backgroundColor: PRIMARY, padding: 14, borderRadius: 8, alignItems: 'center', marginTop: 8 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: rf(18), fontWeight: '600' },
  link: { textAlign: 'center', marginTop: 16, color: PRIMARY, fontSize: rf(14) },
  locationInputRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 16 },
  pinBtn: { paddingVertical: 12, paddingHorizontal: 16, backgroundColor: PRIMARY, borderRadius: 8 },
  pinBtnText: { color: '#fff', fontWeight: '700', fontSize: rf(14) },
  coordsLabel: { color: PRIMARY, fontSize: rf(13), fontWeight: '600', marginTop: -12, marginBottom: 16 },
});
