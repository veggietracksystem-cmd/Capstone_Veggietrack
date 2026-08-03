import { useState } from 'react';
import {
  Text, TextInput, TouchableOpacity, ActivityIndicator, View, ScrollView,
  StyleSheet, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../i18n/useTranslation';
import { showAlert, confirmAction } from '../lib/ui';
import PasswordInput from '../components/PasswordInput';

const PRIMARY = '#2e7d32';

export default function EditProfileScreen({ navigation }) {
  const { user, signOut, updateUser } = useAuth();
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
  const [location, setLocation] = useState(loc ? (user?.[loc.key] || '') : '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

  const save = async () => {
    const name = fullName.trim();
    if (!name) {
      showAlert(t('common.error'), t('editProfile.nameRequired'));
      return;
    }

    const updates = { full_name: name, email: email.trim() };
    if (loc) updates[loc.key] = location.trim();

    setSaving(true);
    try {
      const data = await api.put(`/api/users/${user.id}`, updates);
      await updateUser({ ...data.user, name: data.user.full_name });
      showAlert(t('common.saved'), t('editProfile.saved'));
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
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.back}>‹ {t('common.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('editProfile.title')}</Text>
        <View style={{ width: 50 }} />
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

          {loc && (
            <>
              <Text style={styles.fieldLabel}>{loc.label}</Text>
              <TextInput
                style={styles.input}
                value={location}
                onChangeText={setLocation}
                editable={!saving && !deleting}
              />
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
      <Modal visible={pwOpen} transparent animationType="slide" onRequestClose={() => setPwOpen(false)}>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8faf8' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  back: { color: PRIMARY, fontSize: 16, fontWeight: '600', width: 50 },
  title: { fontSize: 18, fontWeight: '700', color: PRIMARY },
  content: { padding: 16, paddingBottom: 40 },

  // Section Card
  sectionCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#edf2ed',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#1a1a1a', marginBottom: 12 },
  fieldLabel: { fontSize: 13, color: '#555', fontWeight: '600', marginBottom: 6, marginTop: 8 },
  input: {
    backgroundColor: '#f8faf8',
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#ddd',
  },

  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  menuItemLast: { borderBottomWidth: 0 },
  menuItemText: { fontSize: 14, fontWeight: '600', color: '#333' },
  chevron: { fontSize: 18, color: '#aaa', fontWeight: '600' },

  dangerSection: { gap: 10 },
  button: { paddingVertical: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  buttonPrimary: { backgroundColor: PRIMARY, marginTop: 8 },
  buttonPrimaryText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  buttonOutline: { borderWidth: 1, borderColor: PRIMARY, backgroundColor: '#ffffff' },
  buttonOutlineText: { color: PRIMARY, fontSize: 15, fontWeight: '700' },
  buttonDanger: { backgroundColor: '#fff5f5', borderWidth: 1, borderColor: '#ffcdd2' },
  buttonDangerText: { color: '#c62828', fontSize: 15, fontWeight: '700' },
  buttonDisabled: { opacity: 0.6 },

  // Change-password modal
  pwBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  pwSheet: { backgroundColor: '#ffffff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 28 },
  pwTitle: { fontSize: 18, fontWeight: '800', color: '#1a1a1a', marginBottom: 6 },
  pwHint: { fontSize: 13, color: '#666', marginBottom: 12 },
  pwActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
});
