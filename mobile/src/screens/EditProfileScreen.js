import useRequestLock from '../hooks/useRequestLock';
import { rf } from '../lib/responsive';
import ProfilePhotoField from '../components/ProfilePhotoField';
import { useState } from 'react';
import {
  Text, TouchableOpacity, ActivityIndicator, View, ScrollView,
  StyleSheet,
} from 'react-native';
import TextInput from '../components/AppTextInput';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { isDeliveryPersonnel } from '../lib/roles';
import { useTranslation } from '../i18n/useTranslation';
import { showAlert } from '../lib/ui';
import { friendlyError } from '../lib/errorMessages';
import MapPinningModal from '../components/MapPinningModal';
import ScreenHeader from '../components/ScreenHeader';
import { colors, control, fonts, fontSize, radius, shadowCard, spacing, actionBtn, actionBtnPrimary, actionBtnText, actionBtnOutline } from '../theme/appTheme';
import { titleCaseWords } from '../lib/textFormat';

export default function EditProfileScreen({ navigation }) {
  const requestLock = useRequestLock();
  const { user, updateUser } = useAuth();
  const { t } = useTranslation();

  const ROLE_LOCATION = {
    farmer: { key: 'farm_location', label: t('auth.register.farmLocation') },
    distributor: { key: 'warehouse_location', label: t('auth.register.warehouseLocation') },
    retailer: { key: 'store_location', label: t('auth.register.storeLocation') },
  };

  const loc = ROLE_LOCATION[user?.role] || null;

  const [fullName, setFullName] = useState(user?.full_name || user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [location, setLocation] = useState(loc ? (user?.[loc.key] || '') : '');
  const [latitude, setLatitude] = useState(user?.latitude ?? null);
  const [longitude, setLongitude] = useState(user?.longitude ?? null);
  const [mapModalVisible, setMapModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url || null);
  const [avatarChanged, setAvatarChanged] = useState(false);
  const [photoState, setPhotoState] = useState('ready');

  const handleMapConfirm = ({ latitude: lat, longitude: lng, address }) => {
    setLatitude(lat);
    setLongitude(lng);
    setLocation(address);
    setMapModalVisible(false);
  };

  const save = async () => {
    if (saving || photoState !== 'ready') return;
    const name = fullName.trim();
    if (!name) {
      showAlert(t('common.error'), t('editProfile.nameRequired'));
      return;
    }


    const updates = { full_name: name };
    // Keep the contact profile update separate from Supabase Auth credentials.
    // Avoid sending an empty email that could overwrite an existing value.
    if (!isDeliveryPersonnel(user)) updates.email = email.trim();
    if (avatarChanged) updates.avatar_url = avatarUrl;
    if (loc) updates[loc.key] = location.trim();
    if (latitude != null && longitude != null) {
      updates.latitude = latitude;
      updates.longitude = longitude;
    }

    if (!requestLock.acquire('Saving')) return;

    setSaving(true);
    try {
      const data = await api.put(`/api/users/${user.id}`, updates);
      await updateUser({ ...data.user, name: data.user.full_name });
      setAvatarChanged(false);
      showAlert(t('common.saved'), t('editProfile.saved'));
      // Every role uses this shared editor. Return only after both the API
      // update and the shared profile refresh have succeeded.
      navigation.goBack();
    } catch (err) {
      showAlert(t('common.error'), friendlyError(err, 'We couldn’t save your changes. Please try again.'));
    } finally {
      requestLock.release('Saving');
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader title={t('editProfile.title')} onBack={() => navigation.goBack()} />

      <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Profile Details Card */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{t('editProfile.profileDetails')}</Text>
          <ProfilePhotoField user={user} value={avatarUrl} disabled={saving}
            onChange={(url) => { setAvatarUrl(url); setAvatarChanged(true); }}
            onStateChange={setPhotoState} />

          <Text style={styles.fieldLabel}>{t('editProfile.fullNameLabel')}</Text>
          <TextInput
            style={styles.input}
            value={fullName}
                        autoCapitalize="words"
            onChangeText={(v) => setFullName(titleCaseWords(v))}
            editable={!saving}
          />

          {!isDeliveryPersonnel(user) && (
            <>
              <Text style={styles.fieldLabel}>{t('editProfile.emailLabel')}</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                editable={!saving}
              />
            </>
          )}

          {loc && (
            <>
              <Text style={styles.fieldLabel}>{loc.label}</Text>
              <View style={styles.locationInputRow}>
                <TextInput
                  style={[styles.input, styles.locationInput]}
                  value={location}
                                    autoCapitalize="words"
                  onChangeText={(v) => setLocation(titleCaseWords(v))}
                  editable={!saving}
                />
                <TouchableOpacity
                  style={styles.pinBtn}
                  onPress={() => setMapModalVisible(true)}
                  disabled={saving}
                >
                  <Ionicons name="location-outline" size={rf(16)} color={colors.leaf700} />
                  <Text style={styles.pinBtnText}>{t('auth.register.pinMap')}</Text>
                </TouchableOpacity>
              </View>
              {latitude != null && longitude != null ? (
                <View style={styles.coordsRow}>
                  <Ionicons name="checkmark-circle-outline" size={rf(17)} color={colors.leaf700} />
                  <Text style={styles.coordsLabel}>
                    {t('auth.register.coordsPinned', { lat: Number(latitude).toFixed(4), lng: Number(longitude).toFixed(4) })}
                  </Text>
                </View>
              ) : null}
            </>
          )}

          <TouchableOpacity
            style={[styles.button, styles.buttonPrimary, (saving || photoState !== 'ready') && styles.buttonDisabled]}
            onPress={save}
            disabled={saving || photoState !== 'ready'}
          >
            {saving
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.buttonPrimaryText}>{t('common.saveChanges')}</Text>}
          </TouchableOpacity>
        </View>

        {/* Change password: same emailed reset flow as "Forgot password", just
            reachable from inside the profile editor instead of Login.
            ResetPassword itself only renders a form once the emailed recovery
            link has opened the app, so it must not be the entry point here. */}
        <View style={styles.sectionCard}>
          <TouchableOpacity
            style={[styles.menuItem, styles.menuItemLast]}
            onPress={() => navigation.navigate('ForgotPassword', { email: user?.email })}
          >
            <Text style={styles.menuItemText}>{t('profile.changePassword')}</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        </View>

        {/* No "Disable account" action here. This editor is shared by every
            role, so the button it used to show told a signed-in distributor to
            "contact the distributor" about their own account. Disabling an
            account is a distributor decision made from User Management, not
            something a user does to themselves from their own profile. */}
      </ScrollView>

      <MapPinningModal
        visible={mapModalVisible}
        onConfirm={handleMapConfirm}
        onClose={() => setMapModalVisible(false)}
        initialCoords={latitude != null && longitude != null ? { latitude: Number(latitude), longitude: Number(longitude) } : null}
        initialAddress={location || null}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgScreen },
  content: { padding: spacing.lg, paddingBottom: 40 },

  // Section Card
  sectionCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadowCard,
  },
  sectionTitle: { fontFamily: fonts.heading, fontSize: rf(fontSize.lg), color: colors.ink, marginBottom: spacing.md },
  fieldLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), color: colors.labelInk, marginBottom: 6, marginTop: spacing.md },
  input: {
    backgroundColor: '#fff',
    borderRadius: radius.ctrl,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    minHeight: control.height,
    fontFamily: fonts.body,
    fontSize: rf(fontSize.md),
    color: colors.ink,
    marginBottom: 4,
    borderWidth: 1.4,
    borderColor: colors.border,
  },
  // alignItems: 'stretch' (not 'center') so the pin button is forced to the
  // exact same height as the TextInput next to it, rather than eyeballing a
  // matching paddingVertical that drifts once fonts/line-heights change.
  // Wide field, compact Pin Map button on the right (same layout as Create Account).
  locationInputRow: { flexDirection: 'row', gap: 10, alignItems: 'center', minWidth: 0 },
  locationInput: { flex: 1, minWidth: 0, marginBottom: 0 },
  pinBtn: { ...actionBtn, ...actionBtnOutline, flexDirection: 'row', gap: 6, alignSelf: 'center', flexShrink: 0 },
  pinBtnText: { ...actionBtnText, color: colors.leaf700 },
  coordsRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  coordsLabel: { fontFamily: fonts.body, color: colors.leaf700, fontSize: rf(fontSize.sm), fontWeight: '600', marginTop: 4, marginBottom: 4 },

  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: control.minTouch,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  menuItemLast: { borderBottomWidth: 0 },
  menuItemText: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.md), color: colors.ink },
  chevron: { fontSize: rf(fontSize.xl), color: colors.inkFaint, fontWeight: '600' },

  button: { minHeight: control.height, paddingVertical: 12, paddingHorizontal: control.paddingH, borderRadius: radius.ctrl, alignItems: 'center', justifyContent: 'center' },
  buttonPrimary: { backgroundColor: colors.leaf700, marginTop: spacing.md },
  buttonPrimaryText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(fontSize.md), textAlign: 'center' },
  buttonDisabled: { opacity: 0.6 },
});
