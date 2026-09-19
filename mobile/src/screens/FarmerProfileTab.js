import UserAvatar from '../components/UserAvatar';
import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { confirmAction, showAlert } from '../lib/ui';
import { colors, fonts, fontSize, radius, shadowCard } from '../theme/appTheme';
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

  // Same informational message already shown on Edit Profile's "Disable
  // account" action — self-service deactivation isn't available, so this is
  // a notice, not a confirm/cancel decision.
  const deactivate = () => showAlert(t('profile.deactivateAccountTitle'), t('profile.deactivateAccountMessage'));

  return (
    <ScrollView style={styles.scrollArea} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {/* Profile header: avatar + name + role + Edit Profile shortcut
          (prototype's profile-header block, matches farmer-profile). */}
      <View style={styles.profileCard}>
        <UserAvatar user={user} style={styles.avatarCircle} textStyle={styles.avatarText} />
        <Text style={styles.userName}>{fullName || user?.email || 'Farmer'}</Text>
        <View style={styles.roleBadge}>
          <Text style={styles.roleBadgeText}>{(user?.role || 'farmer').replace(/_/g, ' ').toUpperCase()}</Text>
        </View>
        <TouchableOpacity style={styles.editProfileBtn} onPress={() => navigation.navigate('EditProfile')} activeOpacity={0.8}>
          <Text style={styles.editProfileBtnText}>{t('profile.editProfile')}</Text>
        </TouchableOpacity>
      </View>

      {/* Account: read-only info list (icon + label + value rows), matching
          the prototype's separate "Account" list under the profile header. */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>{t('profile.account')}</Text>

        <View style={[styles.infoRow, !user?.farm_location && styles.menuItemLast]}>
          <View style={styles.infoIconBox}><Ionicons name="mail-outline" size={rf(16)} color={colors.leaf700} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.infoLabel}>Email</Text>
            <Text style={styles.infoValue}>{user?.email || '—'}</Text>
          </View>
        </View>
        {!!user?.farm_location && (
          <View style={[styles.infoRow, styles.menuItemLast]}>
            <View style={styles.infoIconBox}><Ionicons name="location-outline" size={rf(16)} color={colors.leaf700} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.infoLabel}>{t('auth.register.farmLocation')}</Text>
              <Text style={styles.infoValue}>{user.farm_location}</Text>
            </View>
          </View>
        )}
      </View>

      {/* Preferences: Language + Help & Support links, matching the
          prototype's single combined "Preferences" list section. */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>{t('profile.preferences')}</Text>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => setLangOpen(true)}
        >
          <Text style={styles.menuItemText}>{t('language.menuLabel')}</Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

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

      {/* Log Out / Deactivate: final list section (prototype renders these as
          rows, not a standalone button). Deactivate reuses the same
          distributor-managed-account message already shown on Edit Profile. */}
      <View style={styles.sectionCard}>
        <TouchableOpacity style={styles.menuItem} onPress={logout}>
          <View style={styles.menuItemContent}>
            <Ionicons name="log-out-outline" size={rf(18)} color={colors.leaf700} />
            <Text style={[styles.menuItemText, { color: colors.leaf700 }]}>{t('profile.logout')}</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.menuItem, styles.menuItemLast]} onPress={deactivate}>
          <View style={styles.menuItemContent}>
            <Ionicons name="alert-circle-outline" size={rf(18)} color={colors.danger} />
            <Text style={[styles.menuItemText, { color: colors.danger }]}>{t('profile.deactivateAccount')}</Text>
          </View>
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
            {language === opt.code ? <Ionicons name="checkmark" size={rf(18)} color={colors.leaf700} /> : null}
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
  editProfileBtn: {
    marginTop: 6, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20,
    borderWidth: 1.4, borderColor: colors.leaf700,
  },
  editProfileBtnText: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), color: colors.leaf700 },
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
  avatarText: { fontFamily: fonts.heading, fontSize: rf(fontSize.h1), color: colors.leaf700 },
  userName: { fontFamily: fonts.heading, fontSize: rf(fontSize.xl), color: colors.ink, marginBottom: 4 },
  roleBadge: {
    backgroundColor: colors.leaf100,
    borderRadius: 12,
    paddingVertical: 3,
    paddingHorizontal: 10,
    marginBottom: 6,
  },
  roleBadgeText: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.xs), color: colors.leaf700, letterSpacing: 0.5 },

  // Account list rows (icon + label + value) — the prototype's read-only
  // Account section, separate from the profile header card above.
  infoRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  infoIconBox: {
    width: 34, height: 34, borderRadius: 10, backgroundColor: colors.leaf50,
    alignItems: 'center', justifyContent: 'center',
  },
  infoLabel: { fontFamily: fonts.body, fontSize: rf(fontSize.xs), color: colors.inkFaint },
  infoValue: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), color: colors.ink, marginTop: 1 },

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

  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  menuItemContent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  menuItemLast: { borderBottomWidth: 0 },
  menuItemText: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.md), color: colors.ink },
  chevron: { fontSize: rf(fontSize.xl), color: colors.inkFaint, fontWeight: '600' },

  // Language modal rows
  langRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  langRowText: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.lg), color: colors.ink },
  langCheck: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.lg), color: colors.leaf700 },
});
