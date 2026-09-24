import { rf } from '../lib/responsive';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Animated,
} from 'react-native';
import { colors, control, fonts, radius, shadowCard } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';
import { useAuth } from '../context/AuthContext';
import ModalCloseButton from './ui/ModalCloseButton';
import { useSharedModalMotion } from '../lib/motion';

const PRIMARY = colors.leaf700;

// Backend role -> userGuide.<key>.sections translation key.
const ROLE_GUIDE_KEY = {
  farmer: 'farmer',
  distributor: 'distributor',
  retailer: 'retailer',
  delivery_personnel: 'rider',
};

export default function UserGuideModal({ visible, onClose }) {
  const { t, tRaw } = useTranslation();
  const { user } = useAuth();
  // Only the logged-in user's own role guide is shown - no tabs to switch
  // between, since there's nothing else to show.
  const roleKey = ROLE_GUIDE_KEY[user?.role] || 'farmer';
  const { backdropStyle, cardStyle } = useSharedModalMotion(visible);

  const roleSections = tRaw(`userGuide.${roleKey}.sections`) || [];

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <Animated.View style={[styles.card, cardStyle]}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>{t(`userGuide.${roleKey}.title`)}</Text>
            <ModalCloseButton onPress={onClose} />
          </View>

          {/* Content Body */}
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.sectionList}>
              {roleSections.map((section, s) => (
                <View key={s} style={styles.section}>
                  <Text style={styles.sectionHeading}>{section.heading}</Text>
                  <View style={styles.stepContainer}>
                    {(section.items || []).map((item, i) => (
                      <View style={styles.stepCard} key={i}>
                        {section.numbered ? (
                          <Text style={styles.stepNum}>{i + 1}</Text>
                        ) : (
                          <View style={styles.stepDot} />
                        )}
                        <View style={styles.stepInfo}>
                          {item.title ? <Text style={styles.stepTitle}>{item.title}</Text> : null}
                          <Text style={styles.stepDesc}>{item.desc}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
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
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: 20, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { flex: 1, fontFamily: fonts.heading, fontSize: rf(17), color: colors.ink },
  closeBtn: { padding: 6, minWidth: control.minTouch, minHeight: control.minTouch, alignItems: 'center', justifyContent: 'center'  },
  content: { padding: 16 },
  sectionList: { gap: 20 },
  section: { gap: 10 },
  sectionHeading: {
    fontFamily: fonts.bodyBold, fontSize: rf(12.5), color: PRIMARY,
    textTransform: 'uppercase', letterSpacing: 0.4,
  },
  stepContainer: { gap: 10 },
  stepCard: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.card, padding: 14, borderWidth: 1, borderColor: colors.border, alignItems: 'flex-start' },
  stepNum: { width: 26, height: 26, borderRadius: 13, backgroundColor: PRIMARY, color: '#fff', textAlign: 'center', lineHeight: 26, fontWeight: 'bold', fontSize: rf(13), marginRight: 12 },
  // Plain reference items (screens, statuses, reminders) get a small dot
  // instead of a number, so only real how-to steps read as "step 1, 2, 3…".
  stepDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: PRIMARY, marginRight: 12, marginTop: 8 },
  stepInfo: { flex: 1 },
  stepTitle: { fontFamily: fonts.bodyBold, fontSize: rf(14.5), color: colors.ink, marginBottom: 2 },
  stepDesc: { fontFamily: fonts.body, fontSize: rf(13), color: colors.inkSoft, lineHeight: 18 },
});
