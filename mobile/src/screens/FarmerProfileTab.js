import UserAvatar from '../components/UserAvatar';
import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { roleLabel } from '../lib/roles';
import { confirmAction } from '../lib/ui';
import { colors } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';
import CustomModal from '../components/CustomModal';
import UserGuideModal from '../components/UserGuideModal';
import ContactUsModal from '../components/ContactUsModal';
import { rf } from '../lib/responsive';
import { useBottomNavSpace } from '../components/BottomNavBar';
import { styles as profileStyles } from './ProfileScreen';

// Farmer-only Profile tab, restyled to match the shared ProfileScreen design
// (used by Retailer/Distributor/Delivery Personnel) so all four roles look
// and feel consistent — same profile card, section cards, and outlined
// logout button. Still embedded inline inside FarmerDashboard's "profile"
// tab (not a pushed screen), and still shows farm-specific info (location).
export default function FarmerProfileTab({ navigation }) {
  const navSpace = useBottomNavSpace();
  const { user, signOut } = useAuth();
  const { t, language, setLanguage } = useTranslation();
  const fullName = user?.full_name || user?.name || t('dashboards.farmer.defaultFarmerName');

  const [guideOpen, setGuideOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);

  const logout = () => {
    confirmAction(t('profile.logoutConfirmTitle'), t('profile.logoutConfirmMessage'), () => signOut(), { danger: true, hideCloseIcon: true });
  };

  return (
    <ScrollView style={styles.scrollArea} contentContainerStyle={[styles.content, { paddingBottom: navSpace }]} showsVerticalScrollIndicator={false}>
      {/* Profile header: avatar + name + role + Edit Profile shortcut
          (prototype's profile-header block, matches farmer-profile). */}
      <View style={styles.profileCard}>
        <UserAvatar user={user} style={styles.avatarCircle} textStyle={styles.avatarText} />
        <Text style={styles.userName}>{fullName || user?.email || 'Farmer'}</Text>
        <View style={styles.roleBadge}>
          <Text style={styles.roleBadgeText}>{roleLabel(user?.role || 'farmer').toUpperCase()}</Text>
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
            <Text style={styles.infoLabel}>{t('profile.emailLabel')}</Text>
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
          <Text style={styles.menuItemText}>{t('profile.userGuideByRole.farmer')}</Text>
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

      {/* Log Out: final list section (prototype renders this as a row, not a
          standalone button). No "Deactivate account" row — a user never
          disables their own account; the distributor does that from User
          Management. Matches the shared ProfileScreen used by every other
          role. */}
      <View style={styles.sectionCard}>
        <TouchableOpacity style={[styles.menuItem, styles.menuItemLast]} onPress={logout}>
          <View style={styles.menuItemContent}>
            <Ionicons name="log-out-outline" size={rf(18)} color={colors.danger} />
            <Text style={[styles.menuItemText, styles.logoutText]}>{t('profile.logout')}</Text>
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

const styles = {
  ...profileStyles,
  scrollArea: { flex: 1 },
  // Side/top padding comes from the Farmer dashboard's content wrapper.
  content: { paddingBottom: 90 },
};
