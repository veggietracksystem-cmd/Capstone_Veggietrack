import { rf } from '../lib/responsive';
import {
  Text, View, TouchableOpacity, ScrollView, Modal, Platform, StyleSheet,
  KeyboardAvoidingView, Animated,
} from 'react-native';
import ModalCloseButton from './ui/ModalCloseButton';
import { colors, fonts, radius, shadowCard } from '../theme/appTheme';
import { useSharedModalMotion } from '../lib/motion';

// Centered white card, dim backdrop, title + close (X) button - same shape
// as CustomModal, so this and every other in-app dialog read as one system.
export default function BottomSheet({ visible, onClose, title, children, scroll = true }) {
  const Body = scroll ? ScrollView : View;
  const { backdropStyle, cardStyle } = useSharedModalMotion(visible);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
          <Animated.View style={[styles.card, cardStyle]}>
            <View style={styles.head}>
              <Text style={styles.title} numberOfLines={1}>{title}</Text>
              <ModalCloseButton onPress={onClose} />
            </View>
            <Body
              style={scroll ? styles.scrollBody : undefined}
              contentContainerStyle={scroll ? styles.scrollContent : undefined}
              keyboardShouldPersistTaps={scroll ? 'handled' : undefined}
            >
              {children}
            </Body>
          </Animated.View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  kav: { flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(20,17,16,0.42)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    zIndex: 9999,
    elevation: 9999,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    maxHeight: '90%',
    backgroundColor: colors.bgScreen,
    borderRadius: radius.card,
    padding: 22,
    ...shadowCard,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  title: { fontFamily: fonts.heading, fontSize: rf(18), color: colors.ink, flex: 1 },
  scrollBody: { flexGrow: 0 },
  scrollContent: { paddingBottom: 4 },
});
