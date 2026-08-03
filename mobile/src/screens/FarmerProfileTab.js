import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { confirmAction } from '../lib/ui';
import { colors, fonts, radius, shadowCard } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';
import CustomModal from '../components/CustomModal';
import UserGuideModal from '../components/UserGuideModal';
import ContactUsModal from '../components/ContactUsModal';

// Farmer-only Profile tab matching the mockup's avatar/info-list/action-list
// layout. "Edit profile" deep-links to the dedicated EditProfileScreen; the
// Language/User Guide/Contact Us actions are handled inline so farmers never
// have to leave this tab.
export default function FarmerProfileTab({ navigation }) {
  const { user, signOut } = useAuth();
  const { t, language, setLanguage } = useTranslation();
  const name = user?.full_name || user?.name || t('dashboards.farmer.defaultFarmerName');
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'F';

  const [langOpen, setLangOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);

  const logout = () => {
    confirmAction(t('profile.logoutConfirmTitle'), t('profile.logoutConfirmMessage'), () => signOut());
  };

  return (
    <ScrollView style={styles.scrollArea} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.head}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.pname} numberOfLines={1}>{name}</Text>
          <Text style={styles.ploc} numberOfLines={1}>{user?.farm_location || t('dashboards.farmer.profileLocationFallback')}</Text>
        </View>
      </View>

      <View style={styles.infoList}>
        <View style={styles.infoRow}>
          <Text style={styles.k}>{t('dashboards.farmer.profileContactLabel')}</Text>
          <Text style={styles.v}>{user?.phone || '—'}</Text>
        </View>
        <View style={[styles.infoRow, styles.infoRowLast]}>
          <Text style={styles.k}>{t('dashboards.farmer.profileEmailLabel')}</Text>
          <Text style={styles.v} numberOfLines={1}>{user?.email || '—'}</Text>
        </View>
      </View>

      <View style={styles.actionList}>
        <TouchableOpacity style={styles.actionRow} onPress={() => navigation.navigate('EditProfile')} activeOpacity={0.7}>
          <View style={styles.actionLeft}>
            <Ionicons name="create-outline" size={18} color={colors.inkSoft} />
            <Text style={styles.actionText}>{t('dashboards.farmer.profileEditAction')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.inkFaint} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionRow} onPress={() => setLangOpen(true)} activeOpacity={0.7}>
          <View style={styles.actionLeft}>
            <Ionicons name="globe-outline" size={18} color={colors.inkSoft} />
            <Text style={styles.actionText}>{t('dashboards.farmer.profileLanguageAction')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.inkFaint} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionRow} onPress={() => setGuideOpen(true)} activeOpacity={0.7}>
          <View style={styles.actionLeft}>
            <Ionicons name="book-outline" size={18} color={colors.inkSoft} />
            <Text style={styles.actionText}>{t('dashboards.farmer.profileUserGuideAction')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.inkFaint} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionRow, styles.actionRowLast]} onPress={() => setContactOpen(true)} activeOpacity={0.7}>
          <View style={styles.actionLeft}>
            <Ionicons name="call-outline" size={18} color={colors.inkSoft} />
            <Text style={styles.actionText}>{t('dashboards.farmer.profileContactUsAction')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.inkFaint} />
        </TouchableOpacity>
      </View>

      <View style={[styles.actionList, { marginTop: 14 }]}>
        <TouchableOpacity style={[styles.actionRow, styles.actionRowLast]} onPress={logout} activeOpacity={0.7}>
          <View style={styles.actionLeft}>
            <Ionicons name="log-out-outline" size={18} color={colors.danger} />
            <Text style={[styles.actionText, { color: colors.danger }]}>{t('dashboards.farmer.profileLogoutAction')}</Text>
          </View>
        </TouchableOpacity>
      </View>

      <CustomModal
        visible={langOpen}
        title={t('language.modalTitle')}
        onCancel={() => setLangOpen(false)}
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
            {language === opt.code ? <Ionicons name="checkmark" size={18} color={colors.leaf700} /> : null}
          </TouchableOpacity>
        ))}
      </CustomModal>

      <UserGuideModal visible={guideOpen} onClose={() => setGuideOpen(false)} />
      <ContactUsModal visible={contactOpen} onClose={() => setContactOpen(false)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollArea: { flex: 1 },
  content: { paddingBottom: 90 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8, marginBottom: 18 },
  avatar: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: colors.gold500,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontFamily: fonts.heading, fontSize: 22, color: '#fff' },
  pname: { fontFamily: fonts.heading, fontSize: 18, color: colors.ink },
  ploc: { fontFamily: fonts.body, fontSize: 12.5, color: colors.inkSoft, marginTop: 2 },

  infoList: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: 14, overflow: 'hidden', marginBottom: 16, ...shadowCard,
  },
  infoRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  infoRowLast: { borderBottomWidth: 0 },
  k: { fontFamily: fonts.body, fontSize: 13.5, color: colors.inkSoft, width: 88 },
  v: { fontFamily: fonts.bodySemiBold, fontSize: 13.5, color: colors.ink, flex: 1 },

  actionList: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: 14, overflow: 'hidden', ...shadowCard,
  },
  actionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 14, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  actionRowLast: { borderBottomWidth: 0 },
  actionLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actionText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.ink },

  langRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  langRowText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
});
