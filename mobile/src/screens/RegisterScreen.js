import { rf } from '../lib/responsive';
import { useState, useRef } from 'react';
import { supabase, authConfigured } from '../lib/supabase';
import { normalizePhone, isValidPhone, PHONE_HINT } from '../lib/phone';
import { authError } from '../lib/authErrors';
import {
  Text, TextInput, TouchableOpacity, ActivityIndicator, View, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from '../i18n/useTranslation';
import { showAlert } from '../lib/ui';
import MapPinningModal from '../components/MapPinningModal';
import ScreenHeader from '../components/ScreenHeader';
import { colors, fonts, fontSize, radius } from '../theme/appTheme';
import PasswordInput from '../components/PasswordInput';
import { Ionicons } from '@expo/vector-icons';
const PRIMARY = colors.leaf700;

export default function RegisterScreen({ navigation, route }) {
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const compactLayout = width < 380;
  const tallScreen = height >= 760;

  // Role -> location field key + i18n keys. The backend reads the matching key.
  const ROLES = [
    { value: 'farmer', label: t('auth.register.roleFarmer'), locationKey: 'farm_location', locationLabel: t('auth.register.farmLocation') },
    { value: 'retailer', label: t('auth.register.roleRetailer'), locationKey: 'store_location', locationLabel: t('auth.register.storeLocation') },
    // Riders authenticate with their mobile number and do not need a profile
    // address/service area. Operational pickup and delivery locations are
    // collected from their respective workflows.
    { value: 'delivery_personnel', label: t('auth.register.roleDelivery') },
  ];

  const [phone,setPhone]=useState('');
  const [password,setPassword]=useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const lock=useRef(false);
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('farmer');
  const [location, setLocation] = useState('');
  const [mapModalVisible, setMapModalVisible] = useState(false);
  const [latitude, setLatitude] = useState(null);
  const [longitude, setLongitude] = useState(null);
  const [loading, setLoading] = useState(false);

  const roleConfig = ROLES.find((r) => r.value === role) || ROLES[0];
  const locationRequired = role !== 'delivery_personnel';

  const handleRoleChange = (nextRole) => {
    setRole(nextRole);
    if (nextRole === 'delivery_personnel') {
      setLocation('');
      setLatitude(null);
      setLongitude(null);
      setMapModalVisible(false);
    }
  };

  const register = async () => {
    if(lock.current)return;
    if(!authConfigured){showAlert('Configuration required','Configure Supabase before registering.');return;}
    if(!isValidPhone(phone)){showAlert('Mobile number',PHONE_HINT);return;}
  if(!fullName.trim() || (locationRequired && !location.trim()) || password.length<8){showAlert('Check your details', locationRequired ? 'Enter your name, location and a password of at least 8 characters.' : 'Enter your name and a password of at least 8 characters.');return;}
  if(!confirmPassword){showAlert('Check your details','Please confirm your password.');return;}
  if(password!==confirmPassword){showAlert('Check your details','Passwords do not match.');return;}
    lock.current=true;setLoading(true);
    try {
      const metadata = { full_name: fullName.trim(), role };
      if (locationRequired) {
        metadata[roleConfig.locationKey] = location.trim();
        metadata.latitude = latitude;
        metadata.longitude = longitude;
      }
      const {error}=await supabase.auth.signUp({phone:normalizePhone(phone),password,options:{data:metadata}});
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
    <SafeAreaView style={styles.container} edges={['top','left','right']}>
      <ScreenHeader title={t('auth.register.title')} onBack={() => navigation.goBack()} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
  {false && (
        <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
          <Text style={styles.subtitle}>Verify your mobile number, then wait for distributor approval.</Text>

          <Text style={styles.sectionLabel}>Account Details</Text>
          <TextInput style={styles.input} placeholderTextColor={colors.inkFaint} placeholder="Mobile number" accessibilityLabel="Mobile number" keyboardType="phone-pad" value={phone} onChangeText={setPhone} editable={!loading}/>
          <TextInput style={styles.input} placeholderTextColor={colors.inkFaint} placeholder="Password (at least 8 characters)" accessibilityLabel="Password" secureTextEntry value={password} onChangeText={setPassword} editable={!loading}/>

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
  )}
        <ScrollView
          contentContainerStyle={[styles.inner, tallScreen && styles.innerTall]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        >
          <View style={styles.contentWrap}>
            <View style={styles.headerBlock}>
              <Text style={styles.title}>{t('auth.register.title')}</Text>
              <Text style={styles.subtitle}>Create your VeggieTrack account to get started.</Text>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Full Name</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter your full name"
                placeholderTextColor={styles.placeholder.color}
                accessibilityLabel="Full Name"
                autoCapitalize="words"
                value={fullName}
                onChangeText={setFullName}
                editable={!loading}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Mobile Number</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter mobile number (+63 or 09)"
                placeholderTextColor={styles.placeholder.color}
                accessibilityLabel="Mobile Number"
                keyboardType="phone-pad"
                value={phone}
                onChangeText={setPhone}
                editable={!loading}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Password</Text>
              <PasswordInput
                style={[styles.input, styles.passwordInput]}
                placeholder="Enter your password (at least 8 characters)"
                placeholderTextColor={styles.placeholder.color}
                accessibilityLabel="Password"
                value={password}
                onChangeText={setPassword}
                editable={!loading}
                visibilityLabel="password"
              />

              <PasswordInput
                style={[styles.input, styles.passwordInput]}
                placeholder="Confirm password"
                placeholderTextColor={styles.placeholder.color}
                accessibilityLabel="Confirm Password"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                editable={!loading}
                visibilityLabel="confirm password"
              />
              {!!confirmPassword && (
                <Text style={password === confirmPassword ? styles.matchText : styles.passwordError} accessibilityRole="alert">
                  {password === confirmPassword ? 'Passwords match.' : 'Passwords do not match.'}
                </Text>
              )}
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Role</Text>
              <View style={styles.roleWrap}>
                {ROLES.map((r) => {
                  const selected = role === r.value;
                  return (
                    <TouchableOpacity
                      key={r.value}
                      style={[styles.roleChip, selected && styles.roleChipActive]}
                      onPress={() => handleRoleChange(r.value)}
                      disabled={loading}
                    >
                      <Text style={[styles.roleChipText, selected && styles.roleChipTextActive]}>
                        {r.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {locationRequired && (
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>{roleConfig.locationLabel}</Text>
                <View style={[styles.locationInputRow, compactLayout && styles.locationInputColumn]}>
                  <TextInput
                    style={[styles.input, styles.locationInput, compactLayout && styles.locationInputFull]}
                    placeholder={roleConfig.locationLabel}
                    placeholderTextColor={styles.placeholder.color}
                    value={location}
                    onChangeText={setLocation}
                    editable={!loading}
                  />
                  <TouchableOpacity
                    style={[styles.pinBtn, compactLayout && styles.pinBtnFull]}
                    onPress={() => setMapModalVisible(true)}
                    disabled={loading}
                  >
                    <Ionicons name="location-outline" size={rf(17)} color="#fff" />
                    <Text style={styles.pinBtnText}>{t('auth.register.pinMap')}</Text>
                  </TouchableOpacity>
                </View>
                {latitude && longitude ? (
                  <View style={styles.locationFeedback}>
                    <View style={styles.coordsRow}>
                      <Ionicons name="checkmark-circle-outline" size={rf(17)} color={PRIMARY} />
                      <Text style={styles.coordsLabel}>Location pinned</Text>
                    </View>
                    <Text style={styles.addressLabel}>{location}</Text>
                  </View>
                ) : null}
              </View>
            )}

            <View style={styles.ctaBlock}>
              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={register}
                accessibilityState={{ disabled: loading }}
                disabled={loading}
                activeOpacity={0.7}
              >
                {loading
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.buttonText}>Create Account</Text>}
              </TouchableOpacity>

              <Text style={styles.nextStep}>Next: You'll verify your mobile number and wait for distributor approval.</Text>
            </View>

            <View style={[styles.footerSpacer, tallScreen && styles.footerSpacerTall]} />

            <TouchableOpacity onPress={() => navigation.navigate('Login')} disabled={loading}>
              <Text style={styles.link}>{t('auth.register.haveAccount')}</Text>
            </TouchableOpacity>
          </View>
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
  inner: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 24,
    flexGrow: 1,
  },
  innerTall: { minHeight: 760 },
  contentWrap: { flexGrow: 1, justifyContent: 'flex-start' },
  headerBlock: { marginBottom: 56 },
  title: { fontFamily: 'Poppins_700Bold', fontSize: rf(36), color: PRIMARY, textAlign: 'center', marginBottom: 8 },
  subtitle: { fontFamily: 'Poppins_400Regular', fontSize: rf(11), color: '#555', textAlign: 'center', lineHeight: rf(16) },
  fieldGroup: { marginBottom: 18 },
  fieldLabel: { fontFamily: 'Poppins_600SemiBold', fontSize: rf(13), color: '#555', marginBottom: 8, marginTop: 0 },
  placeholder: { color: '#9aa39a' },
  matchText: { fontFamily: 'Poppins_400Regular', fontSize: rf(13), color: PRIMARY, marginTop: 4, marginBottom: 0 },
  passwordError: { fontFamily: 'Poppins_400Regular', fontSize: rf(13), color: '#A32621', marginTop: 4, marginBottom: 0 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    fontFamily: 'Poppins_400Regular',
    fontSize: rf(14),
    borderWidth: 1,
    borderColor: '#ddd',
    minWidth: 0,
  },
  passwordInput: { marginBottom: 8 },
  phoneRow: { flexDirection: 'row', alignItems: 'stretch', marginBottom: 16, borderRadius: 8, borderWidth: 1, borderColor: '#ddd', backgroundColor: '#fff', overflow: 'hidden' },
  phonePrefix: { justifyContent: 'center', paddingHorizontal: 12, backgroundColor: '#f0f0f0', borderRightWidth: 1, borderRightColor: '#ddd' },
  phonePrefixText: { fontSize: rf(16), color: '#333', fontWeight: '600' },
  phoneInput: { flex: 1, padding: 12, fontSize: rf(16) },
  roleWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  roleChip: { minHeight: 44, justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: '#ccc', backgroundColor: '#fff' },
  roleChipActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  roleChipText: { color: '#555', fontFamily: 'Poppins_500Medium', fontSize: rf(14) },
  roleChipTextActive: { color: '#fff', fontFamily: 'Poppins_600SemiBold' },
  ctaBlock: { marginTop: 8 },
  button: { backgroundColor: PRIMARY, minHeight: 50, paddingHorizontal: 14, paddingVertical: 14, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontFamily: 'Poppins_600SemiBold', fontSize: rf(18) },
  nextStep: { fontFamily: 'Poppins_400Regular', textAlign: 'center', color: '#687065', fontSize: rf(11), lineHeight: rf(16), marginTop: 14 },
  footerSpacer: { flexGrow: 1, minHeight: 10, marginTop: 22, marginBottom: 10 },
  footerSpacerTall: { minHeight: 28, maxHeight: 96 },
  link: { fontFamily: 'Poppins_500Medium', textAlign: 'center', color: PRIMARY, fontSize: rf(15), marginBottom: 4 },
  locationInputRow: { flexDirection: 'row', gap: 8, alignItems: 'center', minWidth: 0 },
  locationInputColumn: { flexDirection: 'column', alignItems: 'stretch' },
  locationInput: { flex: 1, marginBottom: 0 },
  locationInputFull: { width: '100%', flex: 0 },
  pinBtn: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 16, backgroundColor: PRIMARY, borderRadius: 8 },
  pinBtnFull: { width: '100%' },
  pinBtnText: { color: '#fff', fontFamily: 'Poppins_700Bold', fontSize: rf(14) },
  locationFeedback: { backgroundColor: '#edf5e9', borderRadius: 8, padding: 10, marginTop: 10 },
  coordsRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  coordsLabel: { color: PRIMARY, fontFamily: 'Poppins_600SemiBold', fontSize: rf(13) },
  addressLabel: { color: '#4f594d', fontFamily: 'Poppins_400Regular', fontSize: rf(13), marginTop: 2 },
});
