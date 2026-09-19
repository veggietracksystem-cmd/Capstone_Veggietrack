import useRequestLock from '../hooks/useRequestLock';
import { rf } from '../lib/responsive';
import ProfilePhotoField from '../components/ProfilePhotoField';
import { useState } from 'react';
import {
  Text, TextInput, TouchableOpacity, ActivityIndicator, View, ScrollView,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../i18n/useTranslation';
import { showAlert, confirmAction } from '../lib/ui';
import MapPinningModal from '../components/MapPinningModal';
import ScreenHeader from '../components/ScreenHeader';
import { colors, fonts, fontSize, radius, shadowCard } from '../theme/appTheme';

export default function EditProfileScreen({ navigation }) {
  const requestLock = useRequestLock();
  const { user, signOut, updateUser } = useAuth();
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
  const [deleting, setDeleting] = useState(false);

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
    if (user?.role !== 'delivery_personnel') updates.email = email.trim();
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
      showAlert(t('common.error'), err.message);
    } finally {
      requestLock.release('Saving');
      setSaving(false);
    }
  };

  const deleteAccount = () => showAlert('Disable account', 'Contact the distributor to disable your account. Your orders and transaction history will be preserved.');

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader title={t('editProfile.title')} onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Profile Details Card */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{t('editProfile.profileDetails')}</Text>
          <ProfilePhotoField user={user} value={avatarUrl} disabled={saving || deleting}
            onChange={(url) => { setAvatarUrl(url); setAvatarChanged(true); }}
            onStateChange={setPhotoState} />

          <Text style={styles.fieldLabel}>{t('editProfile.fullNameLabel')}</Text>
          <TextInput
            style={styles.input}
            value={fullName}
            onChangeText={setFullName}
            editable={!saving && !deleting}
          />

          {user?.role !== 'delivery_personnel' && (
            <>
              <Text style={styles.fieldLabel}>{t('editProfile.emailLabel')}</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                editable={!saving && !deleting}
              />
            </>
          )}

          {loc && (
            <>
              <Text style={styles.fieldLabel}>{loc.label}</Text>
              <View style={styles.locationInputRow}>
                <TextInput
                  style={[styles.input, { flex: 1, marginBottom: 0 }]}
                  value={location}
                  onChangeText={setLocation}
                  editable={!saving && !deleting}
                />
                <TouchableOpacity
                  style={styles.pinBtn}
                  onPress={() => setMapModalVisible(true)}
                  disabled={saving || deleting}
                >
                  <Ionicons name="location" size={rf(16)} color="#fff" />
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
            disabled={saving || deleting || photoState !== 'ready'}
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

        {/* Delete Account */}
        <View style={styles.dangerSection}>
          <TouchableOpacity
            style={[styles.button, styles.buttonDanger, deleting && styles.buttonDisabled]}
            onPress={deleteAccount}
            disabled={saving || deleting}
          >
            {deleting
              ? <ActivityIndicator color="#c62828" />
              : <Text style={styles.buttonDangerText}>Disable account</Text>}
          </TouchableOpacity>
        </View>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  title: { fontFamily: fonts.heading, fontSize: rf(18), color: colors.ink },
  content: { padding: 16, paddingBottom: 40 },

  // Section Card
  sectionCard: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadowCard,
  },
  sectionTitle: { fontFamily: fonts.heading, fontSize: rf(fontSize.lg), color: colors.ink, marginBottom: 12 },
  fieldLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), color: colors.inkSoft, marginBottom: 6, marginTop: 8 },
  input: {
    backgroundColor: '#fff',
    borderRadius: radius.ctrl,
    padding: 12,
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
  locationInputRow: { flexDirection: 'row', gap: 8, alignItems: 'stretch' },
  pinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 14,
    backgroundColor: colors.leaf700,
    borderRadius: radius.ctrl,
  },
  pinBtnText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(fontSize.sm) },
  coordsRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  coordsLabel: { fontFamily: fonts.body, color: colors.leaf700, fontSize: rf(fontSize.sm), fontWeight: '600', marginTop: 4, marginBottom: 4 },

  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  menuItemLast: { borderBottomWidth: 0 },
  menuItemText: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.md), color: colors.ink },
  chevron: { fontSize: rf(fontSize.xl), color: colors.inkFaint, fontWeight: '600' },

  dangerSection: { gap: 10 },
  button: { paddingVertical: 13, borderRadius: radius.ctrl, alignItems: 'center', justifyContent: 'center' },
  buttonPrimary: { backgroundColor: colors.leaf700, marginTop: 8 },
  buttonPrimaryText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(fontSize.md) },
  buttonOutline: { borderWidth: 1.4, borderColor: colors.leaf700, backgroundColor: colors.card },
  buttonOutlineText: { fontFamily: fonts.bodySemiBold, color: colors.leaf700, fontSize: rf(fontSize.md) },
  buttonDanger: { backgroundColor: '#fff5f5', borderWidth: 1, borderColor: '#ffcdd2' },
  buttonDangerText: { fontFamily: fonts.bodySemiBold, color: colors.danger, fontSize: rf(fontSize.md) },
  buttonDisabled: { opacity: 0.6 },

  // Change-password modal
  pwKav: { flex: 1 },
  pwBackdrop: { flex: 1, backgroundColor: 'rgba(20,17,16,0.42)', justifyContent: 'flex-end' },
  pwSheet: { backgroundColor: colors.bgScreen, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 20, paddingBottom: 30, maxHeight: '90%' },
  pwScroll: { flexGrow: 0, flexShrink: 1 },
  pwTitle: { fontFamily: fonts.heading, fontSize: rf(fontSize.xl), color: colors.ink, marginBottom: 6 },
  pwHint: { fontFamily: fonts.body, fontSize: rf(fontSize.sm), color: colors.inkSoft, marginBottom: 12 },
  pwActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
});
