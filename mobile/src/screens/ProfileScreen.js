import { useState } from 'react';
import {
  Text, TouchableOpacity, View, ScrollView, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../i18n/useTranslation';
import { confirmAction } from '../lib/ui';
import UserGuideModal from '../components/UserGuideModal';
import ContactUsModal from '../components/ContactUsModal';
import CustomModal from '../components/CustomModal';

const PRIMARY = '#2e7d32';

export default function ProfileScreen({ navigation }) {
  const { user, signOut } = useAuth();
  const { t, language, setLanguage } = useTranslation();

  const fullName = user?.full_name || user?.name || '';

  // Modals state
  const [guideOpen, setGuideOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);

  const logout = () => {
    confirmAction(t('profile.logoutConfirmTitle'), t('profile.logoutConfirmMessage'), () => signOut());
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.back}>‹ {t('common.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('profile.title')}</Text>
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

        {/* Account Actions Card */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{t('profile.account')}</Text>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => navigation.navigate('EditProfile')}
          >
            <Text style={styles.menuItemText}>{t('profile.editProfile')}</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.menuItem, styles.menuItemLast]}
            onPress={() => setLangOpen(true)}
          >
            <Text style={styles.menuItemText}>{t('language.menuLabel')}</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Support & Actions Card */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{t('profile.helpSupport')}</Text>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => setGuideOpen(true)}
          >
            <Text style={styles.menuItemText}>{t('profile.userGuide')}</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.menuItem, styles.menuItemLast]}
            onPress={() => setContactOpen(true)}
          >
            <Text style={styles.menuItemText}>{t('profile.contactUs')}</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Logout */}
        <View style={styles.dangerSection}>
          <TouchableOpacity
            style={[styles.button, styles.buttonOutline]}
            onPress={logout}
          >
            <Text style={styles.buttonOutlineText}>{t('profile.logout')}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <UserGuideModal visible={guideOpen} onClose={() => setGuideOpen(false)} />
      <ContactUsModal visible={contactOpen} onClose={() => setContactOpen(false)} />

      <CustomModal
        visible={langOpen}
        title={t('language.modalTitle')}
        onCancel={() => setLangOpen(false)}
        cancelLabel={t('common.close')}
      >
        {[
          { code: 'en', label: t('language.english') },
          { code: 'tl', label: t('language.tagalog') },
        ].map((opt) => (
          <TouchableOpacity
            key={opt.code}
            style={styles.langRow}
            onPress={() => { setLanguage(opt.code); setLangOpen(false); }}
          >
            <Text style={styles.langRowText}>{opt.label}</Text>
            {language === opt.code ? <Text style={styles.langCheck}>✓</Text> : null}
          </TouchableOpacity>
        ))}
      </CustomModal>
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
  buttonOutline: { borderWidth: 1, borderColor: PRIMARY, backgroundColor: '#ffffff' },
  buttonOutlineText: { color: PRIMARY, fontSize: 15, fontWeight: '700' },

  // Language modal rows
  langRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  langRowText: { fontSize: 15, fontWeight: '600', color: '#333' },
  langCheck: { fontSize: 16, color: PRIMARY, fontWeight: '800' },
});
