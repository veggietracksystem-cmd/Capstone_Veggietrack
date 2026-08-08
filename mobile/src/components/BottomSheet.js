import { rf } from '../lib/responsive';
import {
  Text, View, TouchableOpacity, ScrollView, Modal, Platform, StyleSheet,
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, radius } from '../theme/appTheme';

// Matches the mockup's .overlay/.sheet: dimmed backdrop, rounded-top sheet
// sliding up from the bottom, drag handle, title + close (X) button.
export default function BottomSheet({ visible, onClose, title, children, scroll = true }) {
  const Body = scroll ? ScrollView : View;
  return (
    <Modal
      visible={visible}
      transparent
      animationType={Platform.OS === 'web' ? 'none' : 'slide'}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.backdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.head}>
              <Text style={styles.title} numberOfLines={1}>{title}</Text>
              <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.7}>
                <Ionicons name="close" size={rf(16)} color={colors.soil800} />
              </TouchableOpacity>
            </View>
            <Body
              style={scroll ? styles.scrollBody : undefined}
              contentContainerStyle={scroll ? styles.scrollContent : undefined}
              keyboardShouldPersistTaps={scroll ? 'handled' : undefined}
            >
              {children}
            </Body>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  kav: { flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(20,17,16,0.42)',
    justifyContent: 'flex-end',
    zIndex: 9999,
    elevation: 9999,
  },
  sheet: {
    backgroundColor: colors.bgScreen,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    padding: 18,
    paddingBottom: 26,
    maxHeight: '88%',
  },
  handle: {
    width: 38,
    height: 4,
    backgroundColor: colors.soil300,
    borderRadius: 3,
    alignSelf: 'center',
    marginBottom: 14,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  title: { fontFamily: fonts.heading, fontSize: rf(18), color: colors.ink, flex: 1 },
  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: radius.ctrl,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollBody: { flexGrow: 0 },
  scrollContent: { paddingBottom: 4 },
});
