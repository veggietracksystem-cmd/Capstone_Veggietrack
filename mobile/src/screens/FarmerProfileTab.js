import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { confirmAction } from '../lib/ui';
import { colors, fonts, radius, shadowCard } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';
import CustomModal from '../components/CustomModal';
import UserGuideModal from '../components/UserGuideModal';
import ContactUsModal from '../components/ContactUsModal';
import { rf } from '../lib/responsive';

// Farmer-only Profile tab, restyled to match the shared ProfileScreen design
// (used by Retailer/Distributor/Delivery Personnel) so all four roles look
// and feel consistent — same profile card, section cards, and outlined
// logout button. Still embedded inline inside FarmerDashboard's "profile"
// tab (not a pushed screen), and still shows farm-specific info (location).
export default function FarmerProfileTab({ navigation }) {
  const { user, signOut } = useAuth();
  const { t, language, setLanguage } = useTranslation();
  const fullName = user?.full_name || user?.name || t('dashboards.farmer.defaultFarmerName');

  const [guideOpen, setGuideOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);

  const logout = () => {
    confirmAction(t('profile.logoutConfirmTitle'), t('profile.logoutConfirmMessage'), () => signOut());
  };

  return (
    <ScrollView style={styles.scrollArea} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {/* User Card */}
      <View style={styles.profileCard}>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarText}>
            {(fullName || user?.phone || 'F').charAt(0).toUpperCase()}
          </Text>
        </View>
        <Text style={styles.userName}>{fullName || user?.phone || 'Farmer'}</Text>
        <View style={styles.roleBadge}>
          <Text style={styles.roleBadgeText}>{(user?.role || 'farmer').replace(/_/g, ' ').toUpperCase()}</Text>
        </View>
        <Text style={styles.phoneText}>📞 {user?.phone || '—'}</Text>
        {user?.farm_location ? (
          <Text style={styles.locationText}>📍 {user.farm_location}</Text>
        ) : null}
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollArea: { flex: 1 },
  content: { paddingBottom: 90 },

  // User Profile Card
  profileCard: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: 20,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadowCard,
  },
  avatarCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.leaf100,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    borderWidth: 2,
    borderColor: colors.leaf700,
  },
  avatarText: { fontFamily: fonts.heading, fontSize: rf(28), color: colors.leaf700 },
  userName: { fontFamily: fonts.heading, fontSize: rf(18), color: colors.ink, marginBottom: 4 },
  roleBadge: {
    backgroundColor: colors.leaf100,
    borderRadius: 12,
    paddingVertical: 3,
    paddingHorizontal: 10,
    marginBottom: 6,
  },
  roleBadgeText: { fontFamily: fonts.bodyBold, fontSize: rf(11), color: colors.leaf700, letterSpacing: 0.5 },
  phoneText: { fontFamily: fonts.body, fontSize: rf(13), color: colors.inkSoft },
  locationText: { fontFamily: fonts.body, fontSize: rf(13), color: colors.inkSoft, marginTop: 2 },

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
  button: { paddingVertical: 14, borderRadius: radius.ctrl, alignItems: 'center', justifyContent: 'center' },
  buttonOutline: { borderWidth: 1.4, borderColor: colors.leaf700, backgroundColor: colors.card },
  buttonOutlineText: { fontFamily: fonts.bodySemiBold, color: colors.leaf700, fontSize: rf(15) },

  // Language modal rows
  langRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  langRowText: { fontFamily: fonts.bodySemiBold, fontSize: rf(15), color: colors.ink },
  langCheck: { fontFamily: fonts.bodyBold, fontSize: rf(16), color: colors.leaf700 },
});
