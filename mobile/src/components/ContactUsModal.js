import { rf } from '../lib/responsive';
import { useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform,
  Animated,
} from 'react-native';
import { showAlert } from '../lib/ui';
import { colors, control, fonts, radius } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';
import { Ionicons } from '@expo/vector-icons';
import { useBottomSheetMotion } from '../lib/motion';

const PRIMARY = colors.leaf700;

export default function ContactUsModal({ visible, onClose }) {
  const { t } = useTranslation();
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const { backdropStyle, sheetStyle } = useBottomSheetMotion(visible);

  const handleSend = () => {
    const s = subject.trim();
    const m = message.trim();

    if (!s) {
      showAlert(t('common.error'), t('contactUs.subjectRequired'));
      return;
    }
    if (!m) {
      showAlert(t('common.error'), t('contactUs.messageRequired'));
      return;
    }

    setSending(true);
    setTimeout(() => {
      setSending(false);
      setSubject('');
      setMessage('');
      showAlert(t('contactUs.sentTitle'), t('contactUs.sentMessage'), () => {
        onClose();
      });
    }, 800);
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.kav} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
          <Animated.View style={[styles.sheet, sheetStyle]}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>{t('contactUs.title')}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={rf(22)} color={colors.ink} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {/* Hub Info Card */}
            <View style={styles.infoCard}>
              <Text style={styles.cardTitle}>{t('contactUs.hubName')}</Text>

              <View style={styles.infoRow}>
                <Ionicons name="location-outline" size={rf(20)} color={PRIMARY} style={styles.icon} />
                <Text style={styles.infoText}>San Pablo City Central Warehouse, Laguna, Philippines</Text>
              </View>

              <View style={styles.infoRow}>
                <Ionicons name="call-outline" size={rf(20)} color={PRIMARY} style={styles.icon} />
                <Text style={styles.infoText}>+63 917 123 4567 / (049) 501-2345</Text>
              </View>

              <View style={styles.infoRow}>
                <Ionicons name="mail-outline" size={rf(20)} color={PRIMARY} style={styles.icon} />
                <Text style={styles.infoText}>support@veggietrack.ph</Text>
              </View>

              <View style={styles.infoRow}>
                <Ionicons name="time-outline" size={rf(20)} color={PRIMARY} style={styles.icon} />
                <Text style={styles.infoText}>{t('contactUs.hours')}</Text>
              </View>
            </View>

            {/* Support Form */}
            <Text style={styles.formTitle}>{t('contactUs.sendInquiry')}</Text>

            <Text style={styles.label}>{t('contactUs.subjectLabel')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('contactUs.subjectPlaceholder')} placeholderTextColor={colors.placeholder}
              value={subject}
              onChangeText={setSubject}
              editable={!sending}
            />

            <Text style={styles.label}>{t('contactUs.messageLabel')}</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder={t('contactUs.messagePlaceholder')} placeholderTextColor={colors.placeholder}
              value={message}
              onChangeText={setMessage}
              multiline
              numberOfLines={4}
              editable={!sending}
            />

            <TouchableOpacity
              style={[styles.button, sending && styles.buttonDisabled]}
              onPress={handleSend}
              disabled={sending}
              activeOpacity={0.7}
            >
              {sending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>{t('contactUs.sendMessage')}</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
          </Animated.View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  kav: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(20,17,16,0.42)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bgScreen, borderTopLeftRadius: 26, borderTopRightRadius: 26, maxHeight: '85%', paddingBottom: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { fontFamily: fonts.heading, fontSize: rf(18), color: colors.ink },
  closeBtn: { padding: 6, minWidth: control.minTouch, minHeight: control.minTouch, alignItems: 'center', justifyContent: 'center'  },
  closeText: { fontSize: rf(18), color: colors.inkSoft, fontWeight: 'bold' },
  content: { padding: 20 },
  infoCard: { backgroundColor: colors.leaf50, borderRadius: radius.card, padding: 16, borderWidth: 1, borderColor: colors.leaf100, marginBottom: 20 },
  cardTitle: { fontFamily: fonts.heading, fontSize: rf(16), color: colors.ink, marginBottom: 12 },
  infoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  icon: { fontSize: rf(16), marginRight: 10, width: 24, textAlign: 'center' },
  infoText: { fontFamily: fonts.body, fontSize: rf(13), color: colors.inkSoft, flex: 1 },
  formTitle: { fontFamily: fonts.heading, fontSize: rf(16), color: colors.ink, marginBottom: 12 },
  label: { fontFamily: fonts.bodySemiBold, fontSize: rf(12.5), color: colors.inkSoft, marginBottom: 6, marginTop: 4 },
  input: { backgroundColor: colors.card, borderRadius: radius.ctrl, minHeight: 48, paddingHorizontal: 12, paddingVertical: 12, fontFamily: fonts.body, fontSize: rf(14), marginBottom: 14, borderWidth: 1.4, borderColor: colors.border, color: colors.ink, textAlignVertical: 'center' },
  textArea: { height: 100, textAlignVertical: 'top' },
  button: { backgroundColor: PRIMARY, minHeight: 48, paddingHorizontal: 14, paddingVertical: 14, borderRadius: radius.ctrl, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(15.5) },
});
