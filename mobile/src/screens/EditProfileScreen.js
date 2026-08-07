import { rf } from '../lib/responsive';
import { useState } from 'react';
import {
  Text, TextInput, TouchableOpacity, ActivityIndicator, View, ScrollView,
  StyleSheet, Modal, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../i18n/useTranslation';
import { showAlert, confirmAction } from '../lib/ui';
import { normalizePhone, isValidPhone } from '../lib/phone';
import PasswordInput from '../components/PasswordInput';
import MapPinningModal from '../components/MapPinningModal';
import { colors, fonts, radius, shadowCard } from '../theme/appTheme';

export default function EditProfileScreen({ navigation }) {
  const { user, signIn, signOut, updateUser } = useAuth();
  const { t } = useTranslation();

  const ROLE_LOCATION = {
    farmer: { key: 'farm_location', label: t('auth.register.farmLocation') },
    distributor: { key: 'warehouse_location', label: t('auth.register.warehouseLocation') },
    retailer: { key: 'store_location', label: t('auth.register.storeLocation') },
    delivery_personnel: { key: 'service_area', label: t('auth.register.serviceArea') },
  };

  const loc = ROLE_LOCATION[user?.role] || null;

  const [fullName, setFullName] = useState(user?.full_name || user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [location, setLocation] = useState(loc ? (user?.[loc.key] || '') : '');
  const [latitude, setLatitude] = useState(user?.latitude ?? null);
  const [longitude, setLongitude] = useState(user?.longitude ?? null);
  const [mapModalVisible, setMapModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleMapConfirm = ({ latitude: lat, longitude: lng, address }) => {
    setLatitude(lat);
    setLongitude(lng);
    setLocation(address);
    setMapModalVisible(false);
  };

  // Change-password modal state
  const [pwOpen, setPwOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [changingPw, setChangingPw] = useState(false);

  const changePassword = async () => {
    if (newPw.length < 6) {
      showAlert(t('common.error'), t('editProfile.passwordTooShort'));
      return;
    }
    if (newPw !== confirmPw) {
      showAlert(t('common.error'), t('editProfile.passwordsDontMatch'));
      return;
    }
    setChangingPw(true);
    try {
      await api.put(`/api/users/${user.id}/password`, {
        current_password: currentPw || undefined,
        new_password: newPw,
      });
      setPwOpen(false);
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
      showAlert(t('common.saved'), t('editProfile.passwordUpdated'));
    } catch (err) {
      showAlert(t('common.error'), err.message);
    } finally {
      setChangingPw(false);
    }
  };

  // Change-phone modal state. Phone is the login credential, so unlike
  // Name/Email it requires a current-password confirmation (Issue: security)
  // before the change is applied, via a dedicated endpoint.
  const [phonePwOpen, setPhonePwOpen] = useState(false);
  const [phonePw, setPhonePw] = useState('');
  const [pendingPhone, setPendingPhone] = useState(null);
  const [changingPhone, setChangingPhone] = useState(false);

  const applyPhoneChange = async () => {
    setChangingPhone(true);
    try {
      const data = await api.put(`/api/users/${user.id}/phone`, {
        current_password: phonePw || undefined,
        new_phone: pendingPhone,
      });
      await signIn(data.token, { ...user, phone: data.phone });
      setPhonePwOpen(false);
      setPhonePw('');
      setPendingPhone(null);
      showAlert(t('common.saved'), t('editProfile.phoneUpdated'));
    } catch (err) {
      showAlert(t('common.error'), err.message);
    } finally {
      setChangingPhone(false);
    }
  };

  const save = async () => {
    const name = fullName.trim();
    if (!name) {
      showAlert(t('common.error'), t('editProfile.nameRequired'));
      return;
    }

    const normalizedPhone = normalizePhone(phone);
    const phoneChanged = normalizedPhone !== (user?.phone || '');
    if (phoneChanged && !isValidPhone(normalizedPhone)) {
      showAlert(t('common.error'), t('common.phoneHint'));
      return;
    }

    const updates = { full_name: name, email: email.trim() };
    if (loc) updates[loc.key] = location.trim();
    if (latitude != null && longitude != null) {
      updates.latitude = latitude;
      updates.longitude = longitude;
    }

    setSaving(true);
    try {
      const data = await api.put(`/api/users/${user.id}`, updates);
      await updateUser({ ...data.user, name: data.user.full_name });
      if (phoneChanged) {
        setPendingPhone(normalizedPhone);
        setPhonePwOpen(true);
      } else {
        showAlert(t('common.saved'), t('editProfile.saved'));
      }
    } catch (err) {
      showAlert(t('common.error'), err.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteAccount = () => {
    confirmAction(
      t('editProfile.deleteConfirmTitle'),
      t('editProfile.deleteConfirmMessage'),
      async () => {
        setDeleting(true);
        try {
          await api.delete(`/api/users/${user.id}`);
          showAlert(t('editProfile.deletedTitle'), t('editProfile.deletedMessage'));
          await signOut({ redirectToLogin: true });
        } catch (err) {
          showAlert(t('common.error'), err.message);
          setDeleting(false);
        }
      }
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={rf(20)} color={colors.ink} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('editProfile.title')}</Text>
        <View style={{ width: 20 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Profile Details Card */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{t('editProfile.profileDetails')}</Text>

          <Text style={styles.fieldLabel}>{t('editProfile.fullNameLabel')}</Text>
          <TextInput
            style={styles.input}
            value={fullName}
            onChangeText={setFullName}
            editable={!saving && !deleting}
          />

          <Text style={styles.fieldLabel}>{t('editProfile.emailLabel')}</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            editable={!saving && !deleting}
          />

          <Text style={styles.fieldLabel}>{t('auth.register.phoneLabel')}</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoCapitalize="none"
            editable={!saving && !deleting}
          />
          <Text style={styles.phoneHint}>{t('common.phoneHint')}</Text>

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
                  <Text style={styles.pinBtnText}>{t('auth.register.pinMap').replace(/^📍\s*/, '')}</Text>
                </TouchableOpacity>
              </View>
              {latitude != null && longitude != null ? (
                <Text style={styles.coordsLabel}>
                  {t('auth.register.coordsPinned', { lat: Number(latitude).toFixed(4), lng: Number(longitude).toFixed(4) })}
                </Text>
              ) : null}
            </>
          )}

          <TouchableOpacity
            style={[styles.button, styles.buttonPrimary, saving && styles.buttonDisabled]}
            onPress={save}
            disabled={saving || deleting}
          >
            {saving
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.buttonPrimaryText}>{t('common.saveChanges')}</Text>}
          </TouchableOpacity>
        </View>

        {/* Security Card */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{t('editProfile.security')}</Text>

          <TouchableOpacity
            style={[styles.menuItem, styles.menuItemLast]}
            onPress={() => setPwOpen(true)}
            disabled={saving || deleting}
          >
            <Text style={styles.menuItemText}>{t('editProfile.changePassword')}</Text>
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
              : <Text style={styles.buttonDangerText}>{t('editProfile.deleteAccount')}</Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Change Password modal */}
      <Modal visible={pwOpen} transparent animationType={Platform.OS === 'web' ? 'none' : 'slide'} onRequestClose={() => setPwOpen(false)}>
        <View style={styles.pwBackdrop}>
          <View style={styles.pwSheet}>
            <Text style={styles.pwTitle}>{t('editProfile.changePasswordTitle')}</Text>
            <Text style={styles.pwHint}>
              {t('editProfile.changePasswordHint')}
            </Text>

            <Text style={styles.fieldLabel}>{t('editProfile.currentPasswordLabel')}</Text>
            <PasswordInput
              style={styles.input}
              value={currentPw}
              onChangeText={setCurrentPw}
              editable={!changingPw}
            />

            <Text style={styles.fieldLabel}>{t('editProfile.newPasswordLabel')}</Text>
            <PasswordInput
              style={styles.input}
              value={newPw}
              onChangeText={setNewPw}
              placeholder={t('editProfile.newPasswordPlaceholder')}
              editable={!changingPw}
            />

            <Text style={styles.fieldLabel}>{t('editProfile.confirmNewPasswordLabel')}</Text>
            <PasswordInput
              style={styles.input}
              value={confirmPw}
              onChangeText={setConfirmPw}
              editable={!changingPw}
            />

            <View style={styles.pwActions}>
              <TouchableOpacity
                style={[styles.button, styles.buttonOutline, { flex: 1, marginTop: 0 }]}
                onPress={() => setPwOpen(false)}
                disabled={changingPw}
              >
                <Text style={styles.buttonOutlineText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.buttonPrimary, { flex: 1, marginTop: 0 }, changingPw && styles.buttonDisabled]}
                onPress={changePassword}
                disabled={changingPw}
              >
                {changingPw
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.buttonPrimaryText}>{t('common.update')}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Confirm-password modal, shown after Save when the phone number changed */}
      <Modal visible={phonePwOpen} transparent animationType={Platform.OS === 'web' ? 'none' : 'slide'} onRequestClose={() => setPhonePwOpen(false)}>
        <View style={styles.pwBackdrop}>
          <View style={styles.pwSheet}>
            <Text style={styles.pwTitle}>{t('editProfile.changePhoneTitle')}</Text>
            <Text style={styles.pwHint}>{t('editProfile.changePhoneHint')}</Text>

            <Text style={styles.fieldLabel}>{t('editProfile.currentPasswordLabel')}</Text>
            <PasswordInput
              style={styles.input}
              value={phonePw}
              onChangeText={setPhonePw}
              editable={!changingPhone}
            />

            <View style={styles.pwActions}>
              <TouchableOpacity
                style={[styles.button, styles.buttonOutline, { flex: 1, marginTop: 0 }]}
                onPress={() => { setPhonePwOpen(false); setPhonePw(''); setPendingPhone(null); }}
                disabled={changingPhone}
              >
                <Text style={styles.buttonOutlineText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.buttonPrimary, { flex: 1, marginTop: 0 }, changingPhone && styles.buttonDisabled]}
                onPress={applyPhoneChange}
                disabled={changingPhone}
              >
                {changingPhone
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.buttonPrimaryText}>{t('common.update')}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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
  sectionTitle: { fontFamily: fonts.heading, fontSize: rf(16), color: colors.ink, marginBottom: 12 },
  fieldLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(12.5), color: colors.inkSoft, marginBottom: 6, marginTop: 8 },
  input: {
    backgroundColor: '#fff',
    borderRadius: radius.ctrl,
    padding: 12,
    fontFamily: fonts.body,
    fontSize: rf(14.5),
    color: colors.ink,
    marginBottom: 4,
    borderWidth: 1.4,
    borderColor: colors.border,
  },
  phoneHint: { fontFamily: fonts.body, fontSize: rf(11.5), color: colors.inkFaint, marginBottom: 4 },
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
  pinBtnText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(13) },
  coordsLabel: { fontFamily: fonts.body, color: colors.leaf700, fontSize: rf(12.5), fontWeight: '600', marginTop: 4, marginBottom: 4 },

  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  menuItemLast: { borderBottomWidth: 0 },
  menuItemText: { fontFamily: fonts.bodySemiBold, fontSize: rf(14), color: colors.ink },
  chevron: { fontSize: rf(18), color: colors.inkFaint, fontWeight: '600' },

  dangerSection: { gap: 10 },
  button: { paddingVertical: 13, borderRadius: radius.ctrl, alignItems: 'center', justifyContent: 'center' },
  buttonPrimary: { backgroundColor: colors.leaf700, marginTop: 8 },
  buttonPrimaryText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(14.5) },
  buttonOutline: { borderWidth: 1.4, borderColor: colors.leaf700, backgroundColor: colors.card },
  buttonOutlineText: { fontFamily: fonts.bodySemiBold, color: colors.leaf700, fontSize: rf(14.5) },
  buttonDanger: { backgroundColor: '#fff5f5', borderWidth: 1, borderColor: '#ffcdd2' },
  buttonDangerText: { fontFamily: fonts.bodySemiBold, color: colors.danger, fontSize: rf(14.5) },
  buttonDisabled: { opacity: 0.6 },

  // Change-password modal
  pwBackdrop: { flex: 1, backgroundColor: 'rgba(20,17,16,0.42)', justifyContent: 'flex-end' },
  pwSheet: { backgroundColor: colors.bgScreen, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 20, paddingBottom: 30 },
  pwTitle: { fontFamily: fonts.heading, fontSize: rf(18), color: colors.ink, marginBottom: 6 },
  pwHint: { fontFamily: fonts.body, fontSize: rf(13), color: colors.inkSoft, marginBottom: 12 },
  pwActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
});
