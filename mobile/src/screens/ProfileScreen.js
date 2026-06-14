import { useState } from 'react';
import {
  Text, TextInput, TouchableOpacity, ActivityIndicator, View, ScrollView,
  StyleSheet, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { showAlert, confirmAction } from '../lib/ui';
import PasswordInput from '../components/PasswordInput';

const PRIMARY = '#2e7d32';

// Role -> location field key + label (kept in sync with RegisterScreen / backend).
const ROLE_LOCATION = {
  farmer: { key: 'farm_location', label: 'Farm Location' },
  distributor: { key: 'warehouse_location', label: 'Warehouse Location' },
  retailer: { key: 'store_location', label: 'Store Location' },
  delivery_personnel: { key: 'service_area', label: 'Service Area' },
};

export default function ProfileScreen({ navigation }) {
  const { user, signOut, updateUser } = useAuth();

  const loc = ROLE_LOCATION[user?.role] || null;

  // Seed from context. Login returns user.name; registration/profile returns
  // user.full_name — accept either. Location fields are only present after a
  // profile save (login/registration responses don't include them).
  const [fullName, setFullName] = useState(user?.full_name || user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [location, setLocation] = useState(loc ? (user?.[loc.key] || '') : '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Change-password modal state (Issue 9).
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
      // Backend returns the full user (with full_name + location fields).
      // Keep `name` in sync so dashboard headers still render correctly.
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
          // signOut flips the navigator back to Login automatically.
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
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Profile</Text>
        <View style={{ width: 50 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Read-only identity */}
        <View style={styles.infoCard}>
          <Text style={styles.infoLine}>Phone: {user?.phone || '—'}</Text>
          <Text style={styles.infoLine}>Role: {user?.role || '—'}</Text>
        </View>

        <Text style={styles.fieldLabel}>Full name</Text>
        <TextInput
          style={styles.input}
          value={fullName}
          onChangeText={setFullName}
          editable={!saving && !deleting}
        />

        <Text style={styles.fieldLabel}>Email</Text>
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

        <TouchableOpacity
          style={[styles.button, styles.buttonOutline]}
          onPress={() => navigation.navigate('SUS')}
          disabled={saving || deleting}
        >
          <Text style={styles.buttonOutlineText}>Usability Survey (SUS)</Text>
        </TouchableOpacity>

        {/* Change phone number — out of scope for now (would need a new
            OTP verify flow against a future backend endpoint). */}
        <TouchableOpacity
          style={[styles.button, styles.buttonOutline]}
          onPress={() => showAlert('Coming soon', 'Changing your phone number will be available in a future update.')}
          disabled={saving || deleting}
        >
          <Text style={styles.buttonOutlineText}>Change Phone Number</Text>
        </TouchableOpacity>

        {/* Change Password — opens the modal below (Issue 9). */}
        <TouchableOpacity
          style={[styles.button, styles.buttonOutline]}
          onPress={() => setPwOpen(true)}
          disabled={saving || deleting}
        >
          <Text style={styles.buttonOutlineText}>Change Password</Text>
        </TouchableOpacity>

        {/* Account Settings — placeholder for a future settings screen. */}
        <TouchableOpacity
          style={[styles.button, styles.buttonOutline]}
          onPress={() => showAlert('Account Settings', 'Notification and privacy settings are coming soon.')}
          disabled={saving || deleting}
        >
          <Text style={styles.buttonOutlineText}>Account Settings</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.buttonOutline]}
          onPress={logout}
          disabled={saving || deleting}
        >
          <Text style={styles.buttonOutlineText}>Log out</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.buttonDanger, deleting && styles.buttonDisabled]}
          onPress={deleteAccount}
          disabled={saving || deleting}
        >
          {deleting
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.buttonPrimaryText}>Delete Account</Text>}
        </TouchableOpacity>
      </ScrollView>

      {/* Change Password modal (Issue 9) */}
      <Modal visible={pwOpen} transparent animationType="slide" onRequestClose={() => setPwOpen(false)}>
        <View style={styles.pwBackdrop}>
          <View style={styles.pwSheet}>
            <Text style={styles.pwTitle}>Change Password</Text>
            <Text style={styles.pwHint}>
              Leave “current password” blank if your account doesn’t have one set yet.
            </Text>

            <Text style={styles.fieldLabel}>Current password</Text>
            <PasswordInput
              style={styles.input}
              value={currentPw}
              onChangeText={setCurrentPw}
              editable={!changingPw}
            />

            <Text style={styles.fieldLabel}>New password</Text>
            <PasswordInput
              style={styles.input}
              value={newPw}
              onChangeText={setNewPw}
              placeholder="At least 6 characters"
              editable={!changingPw}
            />

            <Text style={styles.fieldLabel}>Confirm new password</Text>
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
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  back: { color: PRIMARY, fontSize: 16, fontWeight: '600', width: 50 },
  title: { fontSize: 20, fontWeight: 'bold', color: PRIMARY },
  content: { padding: 16, paddingBottom: 40 },
  infoCard: { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: '#eee' },
  infoLine: { fontSize: 15, color: '#333', marginBottom: 4 },
  fieldLabel: { fontSize: 13, color: '#555', marginBottom: 6, marginTop: 4 },
  input: { backgroundColor: '#fff', borderRadius: 8, padding: 12, fontSize: 16, marginBottom: 16, borderWidth: 1, borderColor: '#ddd' },
  button: { paddingVertical: 14, borderRadius: 8, alignItems: 'center', marginTop: 8 },
  buttonPrimary: { backgroundColor: PRIMARY },
  buttonPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  buttonOutline: { borderWidth: 1, borderColor: PRIMARY },
  buttonOutlineText: { color: PRIMARY, fontSize: 16, fontWeight: '600' },
  buttonDanger: { backgroundColor: '#c62828' },
  buttonDisabled: { opacity: 0.6 },

  // Change-password modal
  pwBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  pwSheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, paddingBottom: 28 },
  pwTitle: { fontSize: 18, fontWeight: '700', color: '#222', marginBottom: 6 },
  pwHint: { fontSize: 13, color: '#777', marginBottom: 12 },
  pwActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
});
