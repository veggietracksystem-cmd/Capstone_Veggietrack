import { rf } from '../lib/responsive';
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
import BottomNavBar from '../components/BottomNavBar';
import { colors, fonts, radius, shadowCard } from '../theme/appTheme';

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
    if (user?.role === 'distributor') {
      if (tab.id === 'stocks') navigation.navigate('Stocks');
      else if (tab.id === 'inventory') navigation.navigate('DistributorInventoryReport');
      else navigation.navigate('DistributorDashboard', { tab: tab.id });
    } else if (user?.role === 'retailer') {
      const RETAILER_TAB_PARAM = { home: 'shop', cart: 'cart', orders: 'orders' };
      navigation.navigate('RetailerDashboard', { tab: RETAILER_TAB_PARAM[tab.id] });
    } else if (user?.role === 'delivery_personnel') {
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
            <Text style={styles.roleBadgeText}>{(user?.role || 'user').replace(/_/g, ' ').toUpperCase()}</Text>
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
          <TouchableOpacity
    style={styles.menuItem}
    onPress={() => navigation.navigate('ManageAddresses')}
>
    <Text style={styles.menuItemText}>📍 Manage Addresses</Text>
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
