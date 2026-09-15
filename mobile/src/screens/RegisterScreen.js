import { rf } from '../lib/responsive';
import { useState, useRef } from 'react';
import { supabase, authConfigured } from '../lib/supabase';
import { normalizePhone, isValidPhone, PHONE_HINT } from '../lib/phone';
import { authError } from '../lib/authErrors';
import {
  Text, TextInput, TouchableOpacity, ActivityIndicator, View, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from '../i18n/useTranslation';
import { showAlert } from '../lib/ui';
import MapPinningModal from '../components/MapPinningModal';

const PRIMARY = '#1E4E09';

export default function RegisterScreen({ navigation, route }) {
  const { t } = useTranslation();

  // Role -> location field key + i18n keys. The backend reads the matching key.
  const ROLES = [
    { value: 'farmer', label: t('auth.register.roleFarmer'), locationKey: 'farm_location', locationLabel: t('auth.register.farmLocation') },
    { value: 'retailer', label: t('auth.register.roleRetailer'), locationKey: 'store_location', locationLabel: t('auth.register.storeLocation') },
    { value: 'delivery_personnel', label: t('auth.register.roleDelivery'), locationKey: 'service_area', locationLabel: t('auth.register.serviceArea') },
  ];

  const [phone,setPhone]=useState('');
  const [password,setPassword]=useState('');
  const lock=useRef(false);
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('farmer');
  const [location, setLocation] = useState('');
  const [mapModalVisible, setMapModalVisible] = useState(false);
  const [latitude, setLatitude] = useState(null);
  const [longitude, setLongitude] = useState(null);
  const [loading, setLoading] = useState(false);

  const roleConfig = ROLES.find((r) => r.value === role) || ROLES[0];

  const register = async () => {
    if(lock.current)return;
    if(!authConfigured){showAlert('Configuration required','Configure Supabase before registering.');return;}
    if(!isValidPhone(phone)){showAlert('Mobile number',PHONE_HINT);return;}
    if(!fullName.trim() || !location.trim() || password.length<8){showAlert('Check your details','Enter your name, location and a password of at least 8 characters.');return;}
    lock.current=true;setLoading(true);
    try {
      const {error}=await supabase.auth.signUp({phone:normalizePhone(phone),password,options:{data:{full_name:fullName.trim(),role,[roleConfig.locationKey]:location.trim(),latitude,longitude}}});
      if(error)throw error;
      setPassword('');navigation.navigate('PhoneOtp',{phone:normalizePhone(phone)});
    } catch(error){showAlert('Registration',authError(error));}
    finally{lock.current=false;setLoading(false);}
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
          <Text style={styles.subtitle}>Verify your mobile number, then wait for distributor approval.</Text>

          <TextInput style={styles.input} placeholder="Mobile number" accessibilityLabel="Mobile number" keyboardType="phone-pad" value={phone} onChangeText={setPhone} editable={!loading}/>
          <TextInput style={styles.input} placeholder="Password (at least 8 characters)" accessibilityLabel="Password" secureTextEntry value={password} onChangeText={setPassword} editable={!loading}/>
          <Text style={styles.fieldLabel}>{t('auth.register.fullNameLabel')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('auth.register.fullNamePlaceholder')}
            value={fullName}
            onChangeText={setFullName}
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

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={register}
            accessibilityState={{ disabled: loading }}
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
