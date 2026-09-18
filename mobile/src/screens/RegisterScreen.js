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
import ScreenHeader from '../components/ScreenHeader';
import { colors, fonts, fontSize, radius } from '../theme/appTheme';

export default function RegisterScreen({ navigation, route }) {
  const { t } = useTranslation();

  // Role -> location field key + i18n keys. The backend reads the matching key.
  const ROLES = [
    { value: 'farmer', label: t('auth.register.roleFarmer'), locationKey: 'farm_location', locationLabel: t('auth.register.farmLocation') },
    { value: 'retailer', label: t('auth.register.roleRetailer'), locationKey: 'store_location', locationLabel: t('auth.register.storeLocation') },
    // Operational pickup and delivery locations are collected from rider workflows.
    { value: 'delivery_personnel', label: t('auth.register.roleDelivery') },
  ];

  const [email,setEmail]=useState(''), [password,setPassword]=useState(''), [confirmPassword,setConfirmPassword]=useState('');
  const [phone,setPhone]=useState('');
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
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())){showAlert('Email','Enter a valid email address.');return;}
    if(!isValidPhone(phone)){showAlert('Mobile number',PHONE_HINT);return;}
    if(password.length<8 || password!==confirmPassword){showAlert('Password','Enter matching passwords of at least 8 characters.');return;}
    if(!fullName.trim() || (roleConfig.locationKey && !location.trim())){showAlert('Check your details', roleConfig.locationKey ? 'Enter your name and location.' : 'Enter your name.');return;}
    lock.current=true;setLoading(true);
    try {
      const profileData = { full_name: fullName.trim(), role, phone: normalizePhone(phone) };
      if (roleConfig.locationKey) {
        profileData[roleConfig.locationKey] = location.trim();
        profileData.latitude = latitude;
        profileData.longitude = longitude;
      }
      const {data,error}=await supabase.auth.signUp({email:email.trim(),password,options:{data:profileData}});
      if(error)throw error;
      setPassword('');setConfirmPassword('');
      showAlert('Registration', data.session ? 'Account created. Please wait for distributor approval.' : 'Account created. Check your email to confirm your account, then sign in.', () => navigation.navigate('Login'));
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
    <SafeAreaView style={styles.container} edges={['top','left','right']}>
      <ScreenHeader title={t('auth.register.title')} onBack={() => navigation.goBack()} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
          <Text style={styles.subtitle}>Create your VeggieTrack account with email and password. Your mobile number is used for contact and delivery coordination.</Text>

          <Text style={styles.sectionLabel}>Account Details</Text>
          <TextInput style={styles.input} placeholderTextColor={colors.inkFaint} placeholder="Email" accessibilityLabel="Email" keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} editable={!loading}/>
          <TextInput style={styles.input} placeholderTextColor={colors.inkFaint} placeholder="Password (at least 8 characters)" accessibilityLabel="Password" secureTextEntry value={password} onChangeText={setPassword} editable={!loading}/>
          <TextInput style={styles.input} placeholderTextColor={colors.inkFaint} placeholder="Confirm password" accessibilityLabel="Confirm password" secureTextEntry value={confirmPassword} onChangeText={setConfirmPassword} editable={!loading}/>
          <TextInput style={styles.input} placeholderTextColor={colors.inkFaint} placeholder="Mobile number" accessibilityLabel="Mobile number" keyboardType="phone-pad" value={phone} onChangeText={setPhone} editable={!loading}/>

          <View style={styles.divider} />

          <Text style={styles.fieldLabel}>{t('auth.register.fullNameLabel')}</Text>
          <TextInput
            style={styles.input}
            placeholderTextColor={colors.inkFaint}
            placeholder={t('auth.register.fullNamePlaceholder')}
            value={fullName}
            onChangeText={setFullName}
            editable={!loading}
          />

          <View style={styles.divider} />

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

          {roleConfig.locationKey && (
            <>
              <View style={styles.divider} />
              <Text style={styles.fieldLabel}>{roleConfig.locationLabel}</Text>
              <View style={styles.locationInputRow}>
                <TextInput
                  style={[styles.input, { flex: 1, marginBottom: 0 }]}
                  placeholderTextColor={colors.inkFaint}
                  placeholder={roleConfig.locationLabel}
                  value={location}
                  onChangeText={setLocation}
                  editable={!loading}
                />
              <TouchableOpacity
                style={styles.pinBtn}
                onPress={() => setMapModalVisible(true)}
                disabled={loading}
              >
                <Text style={styles.pinBtnText}>{t('auth.register.pinMap')}</Text>
              </TouchableOpacity>
              </View>
              {latitude && longitude ? (
                <Text style={styles.coordsLabel}>
                  {t('auth.register.coordsPinned', { lat: Number(latitude).toFixed(4), lng: Number(longitude).toFixed(4) })}
                </Text>
              ) : null}
            </>
          )}

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
  container: { flex: 1, backgroundColor: colors.bgScreen },
  inner: { padding: 24, paddingTop: 16 },
  subtitle: { fontFamily: fonts.body, fontSize: rf(fontSize.md), color: colors.inkSoft, textAlign: 'center', marginBottom: 20 },
  sectionLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.xs), color: colors.inkFaint, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.4 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 16 },
  fieldLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), color: colors.inkSoft, marginBottom: 6, marginTop: 4 },
  input: { backgroundColor: colors.card, borderRadius: radius.ctrl, padding: 12, fontFamily: fonts.body, fontSize: rf(fontSize.lg), color: colors.ink, marginBottom: 16, borderWidth: 1, borderColor: colors.border },
  roleWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  roleChip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  roleChipActive: { backgroundColor: colors.leaf700, borderColor: colors.leaf700 },
  roleChipText: { fontFamily: fonts.bodyMedium, color: colors.inkSoft, fontSize: rf(fontSize.md) },
  roleChipTextActive: { color: '#fff', fontFamily: fonts.bodySemiBold },
  button: { backgroundColor: colors.leaf700, padding: 14, borderRadius: radius.ctrl, alignItems: 'center', marginTop: 8 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.xl) },
  link: { textAlign: 'center', marginTop: 16, color: colors.leaf700, fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.md) },
  locationInputRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 16 },
  pinBtn: { paddingVertical: 12, paddingHorizontal: 16, backgroundColor: colors.leaf700, borderRadius: radius.ctrl },
  pinBtnText: { color: '#fff', fontFamily: fonts.bodyBold, fontSize: rf(fontSize.md) },
  coordsLabel: { color: colors.leaf700, fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), marginTop: -12, marginBottom: 16 },
});
