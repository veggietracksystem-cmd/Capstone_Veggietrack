import { rf } from '../lib/responsive';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView, Linking, Animated, Platform,
} from 'react-native';
import { showAlert } from '../lib/ui';
import { colors, radius, shadowCard, typography } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';
import { Ionicons } from '@expo/vector-icons';
import ModalCloseButton from './ui/ModalCloseButton';
import { useSharedModalMotion } from '../lib/motion';

const PRIMARY = colors.leaf700;

// VeggieTrack's support contacts. Inquiries go through the user's own email app.
export const SUPPORT_PHONE = '09452340031 / 09465606365';
export const SUPPORT_EMAIL = 'veggietrack.system@gmail.com';

// A new email to support. On a phone, mailto: opens the email app (Gmail when it
// is the default). A computer browser often has no mail app registered and only
// shows a blank mailto: tab, so on the web Gmail's compose page opens instead.
export const supportEmailUrl = (os = Platform.OS) => (os === 'web'
  ? `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(SUPPORT_EMAIL)}`
  : `mailto:${SUPPORT_EMAIL}`);

// Resolves false when nothing could open the email.
export async function openSupportEmail(linking = Linking, os = Platform.OS) {
  try {
    await linking.openURL(supportEmailUrl(os));
    return true;
  } catch {
    return false;
  }
}

export default function ContactUsModal({ visible, onClose }) {
  const { t } = useTranslation();
  const { backdropStyle, cardStyle } = useSharedModalMotion(visible);

  const emailUs = async () => {
    if (!(await openSupportEmail())) showAlert(t('common.error'), t('contactUs.emailFailed', { email: SUPPORT_EMAIL }));
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <Animated.View style={[styles.card, cardStyle]}>
          <View style={styles.header}>
            <Text style={styles.title}>{t('contactUs.title')}</Text>
            <ModalCloseButton onPress={onClose} />
          </View>

          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.intro}>{t('contactUs.intro')}</Text>
            <View style={styles.infoCard}>
              {/* Icon beside the label, value on the full width below, so the
                  email address fits on one line. */}
              <View style={styles.infoRow}>
                <View style={styles.labelRow}>
                  <Ionicons name="call-outline" size={rf(18)} color={PRIMARY} />
                  <Text style={styles.label}>{t('contactUs.phoneLabel')}</Text>
                </View>
                <Text style={styles.value} selectable>{SUPPORT_PHONE}</Text>
              </View>

              <TouchableOpacity
                style={[styles.infoRow, styles.infoRowLast]}
                onPress={emailUs}
                activeOpacity={0.7}
                accessibilityRole="link"
                accessibilityLabel={t('contactUs.emailA11y', { email: SUPPORT_EMAIL })}
              >
                <View style={styles.labelRow}>
                  <Ionicons name="mail-outline" size={rf(18)} color={PRIMARY} />
                  <Text style={styles.label}>{t('contactUs.emailLabel')}</Text>
                </View>
                {/* On a narrow phone the address wraps after "@", never mid-word. */}
                <Text style={styles.link}>{SUPPORT_EMAIL.replace('@', '@\u200B')}</Text>
                <Text style={styles.hint}>{t('contactUs.emailHint')}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(20,17,16,0.42)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 380, maxHeight: '90%', backgroundColor: colors.bgScreen, borderRadius: radius.card, overflow: 'hidden', paddingBottom: 20, ...shadowCard },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { ...typography.modalTitle, color: colors.ink, flex: 1 },
  content: { padding: 20 },
  intro: { ...typography.body, color: colors.inkSoft, marginBottom: 16 },
  infoCard: { backgroundColor: colors.leaf50, borderRadius: radius.card, padding: 16, borderWidth: 1, borderColor: colors.leaf100 },
  infoRow: { marginBottom: 16 },
  infoRowLast: { marginBottom: 0 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { ...typography.label, color: colors.labelInk },
  value: { ...typography.body, color: colors.ink, marginTop: 4 },
  link: { ...typography.listTitle, color: PRIMARY, textDecorationLine: 'underline', marginTop: 4 },
  hint: { ...typography.helper, color: colors.inkSoft, marginTop: 2 },
});
