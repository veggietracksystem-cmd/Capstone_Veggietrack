import { rf } from '../lib/responsive';
import { useState, useRef } from 'react';
import { supabase, authConfigured } from '../lib/supabase';
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
import { colors, control, fontSize, radius, spacing } from '../theme/appTheme';
import PasswordInput from '../components/PasswordInput';
import { Ionicons } from '@expo/vector-icons';
const PRIMARY = colors.leaf700;

export default function RegisterScreen({ navigation, route }) {
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const compactLayout = width < 380;
  const tallScreen = height >= 760;
  // The Password placeholder is long, so its font follows the space left
  // beside the eye icon: 16px screen margins, 12px left / 46px right input
  // padding and 2px of border. ~24.5px of text width per font px, clamped to
  // 11–13px so it stays readable on small phones and never oversized.
  const passwordFieldText = Math.min(width, 560) - 32 - 12 - 46 - 2;
  const passwordFontSize = Math.max(11, Math.min(13, Math.floor((passwordFieldText / 24.5) * 2) / 2));

  // Role -> location field key + i18n keys. The backend reads the matching key.
  const ROLES = [
    { value: 'farmer', label: t('auth.register.roleFarmer'), locationKey: 'farm_location', locationLabel: t('auth.register.farmLocation') },
    { value: 'retailer', label: t('auth.register.roleRetailer'), locationKey: 'store_location', locationLabel: t('auth.register.storeLocation') },
    // Operational pickup and delivery locations are collected from rider workflows.
    { value: 'delivery_personnel', label: t('auth.register.roleDelivery') },
  ];

  const [email,setEmail]=useState(''), [password,setPassword]=useState(''), [confirmPassword,setConfirmPassword]=useState('');
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
    if(!authConfigured){showAlert('Not available right now','We can’t create accounts at the moment. Please try again later.');return;}
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())){showAlert('Check your email address','Please enter a valid email address.');return;}
    if(password.length<8 || password!==confirmPassword){showAlert('Check your password','Please use at least 8 characters, and make sure both passwords match.');return;}
    if(!fullName.trim() || (roleConfig.locationKey && !location.trim())){showAlert('Please fill in the required fields', roleConfig.locationKey ? 'Please enter your name and location.' : 'Please enter your name.');return;}
    lock.current=true;setLoading(true);
    try {
      const profileData = { full_name: fullName.trim(), role };
      if (roleConfig.locationKey) {
        profileData[roleConfig.locationKey] = location.trim();
        profileData.latitude = latitude;
        profileData.longitude = longitude;
      }
      const {data,error}=await supabase.auth.signUp({email:email.trim(),password,options:{data:profileData}});
      if(error)throw error;
      const emailTrimmed=email.trim();
      setPassword('');setConfirmPassword('');
      // Registration must always be confirmed with the emailed OTP.  A
      // Supabase project with auto-confirm enabled cannot satisfy this flow.
      if (data.session) await supabase.auth.signOut({ scope: 'local' });
      // signUp has already sent the confirmation email.  Resending it here ran
      // into Supabase's per-address send cooldown on every first registration
      // and surfaced as "Too many attempts", leaving the new account stranded
      // at 'unverified'.  VerifyEmailScreen's own Resend button covers the
      // case where the first email never arrives.
      navigation.navigate('VerifyEmail',{email:emailTrimmed, purpose:'signup'});
    } catch(error){showAlert('We couldn’t create your account',authError(error));}
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
        <ScrollView
          contentContainerStyle={[styles.inner, tallScreen && styles.innerTall]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        >
          <View style={styles.contentWrap}>
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Full Name</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter your full name"
                placeholderTextColor={colors.placeholder}
                accessibilityLabel="Full Name"
                autoCapitalize="words"
                value={fullName}
                onChangeText={setFullName}
                editable={!loading}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Email</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter your email address"
                placeholderTextColor={colors.placeholder}
                accessibilityLabel="Email"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                value={email}
                onChangeText={setEmail}
                editable={!loading}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Password</Text>
              <PasswordInput
                style={[styles.input, styles.passwordInput, { fontSize: passwordFontSize }]}
                placeholder="Enter your password (use at least 8 characters)"
                placeholderTextColor={colors.placeholder}
                accessibilityLabel="Password"
                value={password}
                onChangeText={setPassword}
                editable={!loading}
                visibilityLabel="password"
              />

              <PasswordInput
                style={[styles.input, styles.passwordInput]}
                placeholder="Confirm password"
                placeholderTextColor={colors.placeholder}
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
                    placeholderTextColor={colors.placeholder}
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

              <Text style={styles.nextStep}>{t('auth.register.verificationNext')}</Text>
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
  inner: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: 24,
    flexGrow: 1,
  },
  innerTall: { minHeight: 760 },
  contentWrap: { flexGrow: 1, justifyContent: 'flex-start' },
  fieldGroup: { marginBottom: 14 },
  fieldLabel: { fontFamily: 'Poppins_600SemiBold', fontSize: rf(fontSize.sm), color: colors.inkSoft, marginBottom: 6, marginTop: 0 },
  matchText: { fontFamily: 'Poppins_400Regular', fontSize: rf(13), color: PRIMARY, marginTop: 4, marginBottom: 0 },
  passwordError: { fontFamily: 'Poppins_400Regular', fontSize: rf(13), color: '#A32621', marginTop: 4, marginBottom: 0 },
  input: {
    backgroundColor: colors.card,
    borderRadius: radius.ctrl,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    minHeight: control.height,
    fontFamily: 'Poppins_400Regular',
    fontSize: rf(13),
    color: colors.ink,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 0,
  },
  passwordInput: { marginBottom: 8 },
  roleWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  roleChip: { height: control.height, justifyContent: 'center', alignItems: 'center', paddingHorizontal: control.paddingH, borderRadius: control.height / 2, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  roleChipActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  roleChipText: { color: colors.inkSoft, fontFamily: 'Poppins_500Medium', fontSize: rf(13), textAlign: 'center' },
  roleChipTextActive: { color: '#fff', fontFamily: 'Poppins_600SemiBold' },
  ctaBlock: { marginTop: 8 },
  button: { backgroundColor: PRIMARY, minHeight: 48, paddingHorizontal: control.paddingH, paddingVertical: 14, borderRadius: radius.ctrl, alignItems: 'center', justifyContent: 'center' },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontFamily: 'Poppins_600SemiBold', fontSize: rf(fontSize.lg), textAlign: 'center' },
  nextStep: { fontFamily: 'Poppins_400Regular', textAlign: 'center', color: '#687065', fontSize: rf(11), lineHeight: rf(16), marginTop: 14 },
  footerSpacer: { flexGrow: 1, minHeight: 10, marginTop: 22, marginBottom: 10 },
  footerSpacerTall: { minHeight: 28, maxHeight: 96 },
  link: { fontFamily: 'Poppins_500Medium', textAlign: 'center', color: PRIMARY, fontSize: rf(15), marginBottom: 4 },
  locationInputRow: { flexDirection: 'row', gap: 8, alignItems: 'center', minWidth: 0 },
  locationInputColumn: { flexDirection: 'column', alignItems: 'stretch' },
  locationInput: { flex: 1, marginBottom: 0 },
  locationInputFull: { width: '100%', flex: 0 },
  pinBtn: { minHeight: control.height, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: control.paddingH, backgroundColor: PRIMARY, borderRadius: radius.ctrl },
  pinBtnFull: { width: '100%' },
  pinBtnText: { color: '#fff', fontFamily: 'Poppins_700Bold', fontSize: rf(14), textAlign: 'center' },
  locationFeedback: { backgroundColor: '#edf5e9', borderRadius: 8, padding: 10, marginTop: 10 },
  coordsRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  coordsLabel: { color: PRIMARY, fontFamily: 'Poppins_600SemiBold', fontSize: rf(13) },
  addressLabel: { color: '#4f594d', fontFamily: 'Poppins_400Regular', fontSize: rf(13), marginTop: 2 },
});
