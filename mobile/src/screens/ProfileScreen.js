import { useState } from 'react';
import {
  Text, TextInput, TouchableOpacity, ActivityIndicator, View, ScrollView,
  StyleSheet, Modal, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { showAlert, confirmAction } from '../lib/ui';
import PasswordInput from '../components/PasswordInput';
import UserGuideModal from '../components/UserGuideModal';
import ContactUsModal from '../components/ContactUsModal';

const PRIMARY = '#2e7d32';

const ROLE_LOCATION = {
  farmer: { key: 'farm_location', label: 'Farm Location' },
  distributor: { key: 'warehouse_location', label: 'Warehouse Location' },
  retailer: { key: 'store_location', label: 'Store Location' },
  delivery_personnel: { key: 'service_area', label: 'Service Area' },
};

export default function ProfileScreen({ navigation }) {
  const { user, signOut, updateUser } = useAuth();

  const loc = ROLE_LOCATION[user?.role] || null;

  const [fullName, setFullName] = useState(user?.full_name || user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [location, setLocation] = useState(loc ? (user?.[loc.key] || '') : '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Modals state
  const [guideOpen, setGuideOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);

  // Change-password modal state
  const [pwOpen, setPwOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [changingPw, setChangingPw] = useState(false);

  const changePassword = async () => {
    if (newPw.length < 6) {
      showAlert('Error', 'New password must be at least 6 characters.');
      return;
    }
    if (newPw !== confirmPw) {
      showAlert('Error', 'New passwords do not match.');
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
      showAlert('Saved', 'Your password has been updated.');
    } catch (err) {
      showAlert('Error', err.message);
    } finally {
      setChangingPw(false);
    }
  };

  const save = async () => {
    const name = fullName.trim();
    if (!name) {
      showAlert('Error', 'Full name cannot be empty.');
      return;
    }

    const updates = { full_name: name, email: email.trim() };
    if (loc) updates[loc.key] = location.trim();

    setSaving(true);
    try {
      const data = await api.put(`/api/users/${user.id}`, updates);
      await updateUser({ ...data.user, name: data.user.full_name });
      showAlert('Saved', 'Profile updated.');
    } catch (err) {
      showAlert('Error', err.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteAccount = () => {
    confirmAction(
      'Delete Account',
      'This permanently deletes your account. This cannot be undone.',
      async () => {
        setDeleting(true);
        try {
          await api.delete(`/api/users/${user.id}`);
          await signOut();
        } catch (err) {
          showAlert('Error', err.message);
          setDeleting(false);
        }
      }
    );
  };

  const logout = () => {
    confirmAction('Log out', 'Are you sure you want to log out?', () => signOut());
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.back}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Account Profile</Text>
        <View style={{ width: 50 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* User Card */}
        <View style={styles.profileCard}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>
              {(fullName || user?.phone || 'U').charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.userName}>{fullName || user?.phone || 'User'}</Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleBadgeText}>{(user?.role || 'user').toUpperCase()}</Text>
          </View>
          <Text style={styles.phoneText}>📞 {user?.phone || '—'}</Text>
        </View>

        {/* Account Settings Card */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Profile Details</Text>

          <Text style={styles.fieldLabel}>Full Name</Text>
          <TextInput
            style={styles.input}
            value={fullName}
            onChangeText={setFullName}
            editable={!saving && !deleting}
          />

          <Text style={styles.fieldLabel}>Email Address</Text>
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
              : <Text style={styles.buttonPrimaryText}>Save Changes</Text>}
          </TouchableOpacity>
        </View>

        {/* Support & Actions Card */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Help & Support</Text>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => setGuideOpen(true)}
            disabled={saving || deleting}
          >
            <Text style={styles.menuItemText}>📖 How VeggieTrack Works (User Guide)</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => setContactOpen(true)}
            disabled={saving || deleting}
          >
            <Text style={styles.menuItemText}>📞 Contact Us & Support</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => navigation.navigate('SUS')}
            disabled={saving || deleting}
          >
            <Text style={styles.menuItemText}>📋 Usability Survey (SUS)</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => setPwOpen(true)}
            disabled={saving || deleting}
          >
            <Text style={styles.menuItemText}>🔒 Change Password</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Logout & Delete Account Actions */}
        <View style={styles.dangerSection}>
          <TouchableOpacity
            style={[styles.button, styles.buttonOutline]}
            onPress={logout}
            disabled={saving || deleting}
          >
            <Text style={styles.buttonOutlineText}>Log Out</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.buttonDanger, deleting && styles.buttonDisabled]}
            onPress={deleteAccount}
            disabled={saving || deleting}
          >
            {deleting
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.buttonDangerText}>Delete Account</Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>

      <UserGuideModal visible={guideOpen} onClose={() => setGuideOpen(false)} />
      <ContactUsModal visible={contactOpen} onClose={() => setContactOpen(false)} />

      {/* Change Password modal */}
      <Modal visible={pwOpen} transparent animationType="slide" onRequestClose={() => setPwOpen(false)}>
        <View style={styles.pwBackdrop}>
          <View style={styles.pwSheet}>
            <Text style={styles.pwTitle}>Change Password</Text>
            <Text style={styles.pwHint}>
              Enter your current password and your new password below.
            </Text>

            <Text style={styles.fieldLabel}>Current Password</Text>
            <PasswordInput
              style={styles.input}
              value={currentPw}
              onChangeText={setCurrentPw}
              editable={!changingPw}
            />

            <Text style={styles.fieldLabel}>New Password</Text>
            <PasswordInput
              style={styles.input}
              value={newPw}
              onChangeText={setNewPw}
              placeholder="At least 6 characters"
              editable={!changingPw}
            />

            <Text style={styles.fieldLabel}>Confirm New Password</Text>
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
                <Text style={styles.buttonOutlineText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.buttonPrimary, { flex: 1, marginTop: 0 }, changingPw && styles.buttonDisabled]}
                onPress={changePassword}
                disabled={changingPw}
              >
                {changingPw
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.buttonPrimaryText}>Update</Text>}
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

  // User Profile Card
  profileCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 20,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#edf2ed',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 5,
    elevation: 2,
  },
  avatarCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#e8f5e9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    borderWidth: 2,
    borderColor: PRIMARY,
  },
  avatarText: { fontSize: 28, fontWeight: '800', color: PRIMARY },
  userName: { fontSize: 18, fontWeight: '800', color: '#1a1a1a', marginBottom: 4 },
  roleBadge: {
    backgroundColor: '#e8f5e9',
    borderRadius: 12,
    paddingVertical: 3,
    paddingHorizontal: 10,
    marginBottom: 6,
  },
  roleBadgeText: { fontSize: 11, fontWeight: '700', color: PRIMARY, letterSpacing: 0.5 },
  phoneText: { fontSize: 13, color: '#666' },

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
