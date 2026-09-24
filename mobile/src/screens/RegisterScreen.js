import { rf } from '../lib/responsive';
import { useState, useRef } from 'react';
import { supabase, authConfigured } from '../lib/supabase';
import { authError } from '../lib/authErrors';
import {
  Text, TouchableOpacity, ActivityIndicator, View, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform, useWindowDimensions,
} from 'react-native';
import TextInput from '../components/AppTextInput';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from '../i18n/useTranslation';
import { showAlert } from '../lib/ui';
import MapPinningModal from '../components/MapPinningModal';
import ScreenHeader from '../components/ScreenHeader';
import { colors, control, fontSize, radius, spacing, actionBtn, actionBtnPrimary, actionBtnText, actionBtnOutline } from '../theme/appTheme';
import PasswordInput from '../components/PasswordInput';
import { SegmentedTabs } from '../components/ui/SegmentedTabs';
import { Ionicons } from '@expo/vector-icons';
import { titleCaseWords } from '../lib/textFormat';
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
    if(!authConfigured){showAlert(t('authx.notAvailableTitle'),t('authx.cantCreate'));return;}
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())){showAlert(t('authx.checkEmailTitle'),t('authx.invalidEmail'));return;}
    if(password.length<8 || password!==confirmPassword){showAlert(t('authx.checkPasswordTitle'),t('authx.checkPasswordMsg'));return;}
    if(!fullName.trim() || (roleConfig.locationKey && !location.trim())){showAlert(t('authx.fillRequiredTitle'), roleConfig.locationKey ? t('authx.enterNameLocation') : t('authy.enterName'));return;}
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
    } catch(error){showAlert(t('authx.cantCreateTitle'),authError(error));}
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
              <Text style={styles.fieldLabel}>{t('authx.fullName')}</Text>
              <TextInput
                style={styles.input}
                placeholder={t('authx.enterFullName')}
                placeholderTextColor={colors.placeholder}
                accessibilityLabel={t('authx.fullName')}
                autoCapitalize="words"
                value={fullName}
                onChangeText={(v) => setFullName(titleCaseWords(v))}
                editable={!loading}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>{t('authx.email')}</Text>
              <TextInput
                style={styles.input}
                placeholder={t('authx.enterEmail')}
                placeholderTextColor={colors.placeholder}
                accessibilityLabel={t('authx.email')}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                value={email}
                onChangeText={setEmail}
                editable={!loading}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>{t('authx.password')}</Text>
              <PasswordInput
                style={[styles.input, styles.passwordInput]}
                placeholder={t('authx.enterPasswordHint')}
                placeholderTextColor={colors.placeholder}
                accessibilityLabel={t('authx.password')}
                value={password}
                onChangeText={setPassword}
                editable={!loading}
                visibilityLabel="password"
              />

              <PasswordInput
                style={[styles.input, styles.passwordInput]}
                placeholder={t('authx.confirmPasswordPh')}
                placeholderTextColor={colors.placeholder}
                accessibilityLabel={t('authx.confirmPassword')}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                editable={!loading}
                visibilityLabel="confirm password"
              />
              {!!confirmPassword && (
                <Text style={password === confirmPassword ? styles.matchText : styles.passwordError} accessibilityRole="alert">
                  {password === confirmPassword ? t('authx.pwMatch') : t('authx.pwMismatch')}
                </Text>
              )}
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>{t('auth.register.roleLabel')}</Text>
              {/* Same filter-tab component the rest of the app uses (equal widths, wraps long labels). */}
              <SegmentedTabs
                options={ROLES.map((r) => ({ value: r.value, label: r.label }))}
                value={role}
                onChange={handleRoleChange}
                disabled={loading}
                style={{ marginBottom: 0 }}
              />
            </View>

            {locationRequired && (
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>{roleConfig.locationLabel}</Text>
                <View style={styles.locationInputRow}>
                  <TextInput
                    style={[styles.input, styles.locationInput]}
                    placeholder={roleConfig.locationLabel}
                    placeholderTextColor={colors.placeholder}
                    value={location}
                                        autoCapitalize="words"
                    onChangeText={(v) => setLocation(titleCaseWords(v))}
                    editable={!loading}
                  />
                  <TouchableOpacity
                    style={styles.pinBtn}
                    onPress={() => setMapModalVisible(true)}
                    disabled={loading}
                  >
                    <Ionicons name="location-outline" size={rf(16)} color={colors.leaf700} />
                    <Text style={styles.pinBtnText}>{t('auth.register.pinMap')}</Text>
                  </TouchableOpacity>
                </View>
                {latitude && longitude ? (
                  <View style={styles.locationFeedback}>
                    <View style={styles.coordsRow}>
                      <Ionicons name="checkmark-circle-outline" size={rf(17)} color={PRIMARY} />
                      <Text style={styles.coordsLabel}>{t('authx.locationPinned')}</Text>
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
                  : <Text style={styles.buttonText}>{t('authx.createAccountBtn')}</Text>}
              </TouchableOpacity>

              <Text style={styles.nextStep}>{t('auth.register.verificationNext')}</Text>
            </View>

            <View style={[styles.footerSpacer, tallScreen && styles.footerSpacerTall]} />

            <TouchableOpacity onPress={() => navigation.navigate('Login')} disabled={loading}>
              <Text style={styles.link}>
                {t('regx.haveAccountText')} <Text style={styles.linkAction}>{t('regx.signIn')}</Text>
              </Text>
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
  fieldLabel: { fontFamily: 'Poppins_600SemiBold', fontSize: rf(fontSize.sm), color: colors.labelInk, marginBottom: 6, marginTop: 0 },
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
  ctaBlock: { marginTop: 20 },
  button: { backgroundColor: PRIMARY, minHeight: 48, paddingHorizontal: control.paddingH, paddingVertical: 14, borderRadius: radius.ctrl, alignItems: 'center', justifyContent: 'center' },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontFamily: 'Poppins_600SemiBold', fontSize: rf(fontSize.lg), textAlign: 'center' },
  nextStep: { fontFamily: 'Poppins_400Regular', textAlign: 'center', color: '#687065', fontSize: rf(11), lineHeight: rf(16), marginTop: 14 },
  footerSpacer: { flexGrow: 1, minHeight: 10, marginTop: 22, marginBottom: 10 },
  footerSpacerTall: { minHeight: 28, maxHeight: 96 },
  link: { fontFamily: 'Poppins_400Regular', textAlign: 'center', color: colors.inkSoft, fontSize: rf(15), marginBottom: 4 },
  // Only the tappable part is green and underlined.
  linkAction: { fontFamily: 'Poppins_500Medium', color: PRIMARY, textDecorationLine: 'underline' },
  // Wide field with the compact Pin Map button to its right, vertically centered together.
  locationInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  locationInput: { flex: 1, minWidth: 0, marginBottom: 0 },
  pinBtn: { ...actionBtn, ...actionBtnOutline, flexDirection: 'row', gap: 6, flexShrink: 0 },
  pinBtnText: { ...actionBtnText, color: colors.leaf700 },
  locationFeedback: { backgroundColor: '#edf5e9', borderRadius: 8, padding: 10, marginTop: 10 },
  coordsRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  coordsLabel: { color: PRIMARY, fontFamily: 'Poppins_600SemiBold', fontSize: rf(13) },
  addressLabel: { color: '#4f594d', fontFamily: 'Poppins_400Regular', fontSize: rf(13), marginTop: 2 },
});
