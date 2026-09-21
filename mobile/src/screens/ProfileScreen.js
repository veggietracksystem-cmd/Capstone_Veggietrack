import UserAvatar from '../components/UserAvatar';
import { rf } from '../lib/responsive';
import { useState } from 'react';
import {
  Text, TouchableOpacity, View, ScrollView, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { isDistributor, isRetailer, isDeliveryPersonnel, roleLabel } from '../lib/roles';
import { useTranslation } from '../i18n/useTranslation';
import { confirmAction } from '../lib/ui';
import UserGuideModal from '../components/UserGuideModal';
import ContactUsModal from '../components/ContactUsModal';
import CustomModal from '../components/CustomModal';
import BottomNavBar from '../components/BottomNavBar';
import ScreenHeader from '../components/ScreenHeader';
import { colors, fonts, fontSize, radius, shadowCard } from '../theme/appTheme';

// Profile is a bottom-tab destination (pushed from the dashboard's "profile"
// tab) for every role except Farmer, whose profile is an embedded dashboard
// tab instead. Each role's tab set/icons mirror its dashboard exactly so the
// bar doesn't visibly change shape when navigating here, matching the same
// pattern StocksScreen/DistributorInventoryReportScreen already use.
const TABS_BY_ROLE = {
  distributor: [
    { id: 'home', iconName: 'home-outline', labelKey: 'dashboards.distributor.tabHome' },
    { id: 'orders', iconName: 'clipboard-outline', labelKey: 'dashboards.distributor.tabOrders' },
    { id: 'stocks', iconName: 'archive-outline', labelKey: 'dashboards.distributor.tabStocks' },
    { id: 'inventory', iconName: 'cube-outline', labelKey: 'dashboards.distributor.tabInventory' },
    { id: 'profile', iconName: 'person-outline', labelKey: 'dashboards.distributor.tabProfile' },
  ],
  retailer: [
    { id: 'home', iconName: 'home-outline', labelKey: 'dashboards.retailer.tabHome' },
    { id: 'cart', iconName: 'cart-outline', labelKey: 'dashboards.retailer.tabCart' },
    { id: 'orders', iconName: 'receipt-outline', labelKey: 'dashboards.retailer.tabOrders' },
    { id: 'profile', iconName: 'person-outline', labelKey: 'dashboards.retailer.tabProfile' },
  ],
  delivery_personnel: [
    { id: 'home', iconName: 'home-outline', labelKey: 'dashboards.delivery.tabHome' },
    { id: 'tasks', iconName: 'clipboard-outline', labelKey: 'dashboards.delivery.tabTasks' },
    { id: 'history', iconName: 'time-outline', labelKey: 'dashboards.delivery.tabHistory' },
    { id: 'profile', iconName: 'person-outline', labelKey: 'dashboards.delivery.tabProfile' },
  ],
};

export default function ProfileScreen({ navigation }) {
  const { user, signOut } = useAuth();
  const { t, language, setLanguage } = useTranslation();

  const fullName = user?.full_name || user?.name || '';

  const roleTabs = TABS_BY_ROLE[user?.role];
  const bottomTabs = roleTabs ? roleTabs.map((tab) => ({ ...tab, label: t(tab.labelKey) })) : null;

  const handleBottomTabPress = (tab) => {
    if (tab.id === 'profile') return;
    if (isDistributor(user)) {
      if (tab.id === 'stocks') navigation.navigate('Stocks');
      else if (tab.id === 'inventory') navigation.navigate('DistributorInventoryReport');
      else navigation.navigate('DistributorDashboard', { tab: tab.id });
    } else if (isRetailer(user)) {
      const RETAILER_TAB_PARAM = { home: 'shop', cart: 'cart', orders: 'orders' };
      navigation.navigate('RetailerDashboard', { tab: RETAILER_TAB_PARAM[tab.id] });
    } else if (isDeliveryPersonnel(user)) {
      const DELIVERY_FILTER_PARAM = { home: 'all', tasks: 'active', history: 'completed' };
      navigation.navigate('DeliveryDashboard', { filter: DELIVERY_FILTER_PARAM[tab.id] });
    }
  };

  // Modals state
  const [guideOpen, setGuideOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);

  const logout = () => {
    confirmAction(t('profile.logoutConfirmTitle'), t('profile.logoutConfirmMessage'), () => signOut());
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader title={t('profile.title')} onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Profile header: avatar + name + role + Edit Profile shortcut
            (prototype's profile-header block). */}
        <View style={styles.profileCard}>
          <UserAvatar user={user} style={styles.avatarCircle} textStyle={styles.avatarText} />
          <Text style={styles.userName}>{fullName || user?.email || 'User'}</Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleBadgeText}>{roleLabel(user?.role).toUpperCase() || 'USER'}</Text>
          </View>
          <TouchableOpacity style={styles.editProfileBtn} onPress={() => navigation.navigate('EditProfile')} activeOpacity={0.8}>
            <Text style={styles.editProfileBtnText}>{t('profile.editProfile')}</Text>
          </TouchableOpacity>
        </View>

        {/* Account: read-only info list, matching the prototype's separate
            Account list under the profile header. */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{t('profile.account')}</Text>
          <View style={[styles.infoRow, styles.menuItemLast]}>
            <View style={styles.infoIconBox}><Ionicons name="mail-outline" size={rf(16)} color={colors.leaf700} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.infoLabel}>{t('profile.emailLabel')}</Text>
              <Text style={styles.infoValue}>{user?.email || '—'}</Text>
            </View>
          </View>
        </View>

        {/* Preferences: Language, Manage Addresses (retailer only), Help &
            Support — matching the prototype's single combined Preferences
            list section. Change password now lives on Edit Profile. */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{t('profile.preferences')}</Text>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => setLangOpen(true)}
          >
            <Text style={styles.menuItemText}>{t('language.menuLabel')}</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          {isRetailer(user) && (
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => navigation.navigate('ManageAddresses')}
            >
              <View style={styles.menuItemContent}>
                <Ionicons name="location-outline" size={rf(18)} color={colors.inkSoft} />
                <Text style={styles.menuItemText}>Manage Addresses</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          )}

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

        {/* Log Out: final list section (prototype renders this as a row, not
            a standalone button). No "Deactivate account" row — a user never
            disables their own account; the distributor does that from User
            Management. */}
        <View style={styles.sectionCard}>
          <TouchableOpacity style={[styles.menuItem, styles.menuItemLast]} onPress={logout}>
            <View style={styles.menuItemContent}>
              <Ionicons name="log-out-outline" size={rf(18)} color={colors.leaf700} />
              <Text style={[styles.menuItemText, { color: colors.leaf700 }]}>{t('profile.logout')}</Text>
            </View>
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
            {language === opt.code ? <Ionicons name="checkmark" size={rf(18)} color={colors.leaf700} /> : null}
          </TouchableOpacity>
        ))}
      </CustomModal>

      {bottomTabs && (
        <BottomNavBar
          tabs={bottomTabs}
          activeTab="profile"
          onTabPress={handleBottomTabPress}
        />
      )}
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
    paddingVertical: 12,
  },
  back: { fontFamily: fonts.bodySemiBold, color: colors.leaf700, fontSize: rf(15), width: 50 },
  title: { fontFamily: fonts.heading, fontSize: rf(18), color: colors.ink },
  content: { padding: 16, paddingBottom: 100 },

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
  editProfileBtnText: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), color: colors.leaf700, textAlign: 'center' },
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

  // Account list rows (icon + label + value) — prototype's read-only Account section.
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
  langRowText: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.md), color: colors.ink },
});
