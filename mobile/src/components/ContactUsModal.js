import { useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, ActivityIndicator,
} from 'react-native';
import { showAlert } from '../lib/ui';
import { colors, fonts, radius } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';

const PRIMARY = colors.leaf700;

export default function ContactUsModal({ visible, onClose }) {
  const { t } = useTranslation();
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

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
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>{t('contactUs.title')}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {/* Hub Info Card */}
            <View style={styles.infoCard}>
              <Text style={styles.cardTitle}>{t('contactUs.hubName')}</Text>

              <View style={styles.infoRow}>
                <Text style={styles.icon}>📍</Text>
                <Text style={styles.infoText}>San Pablo City Central Warehouse, Laguna, Philippines</Text>
              </View>

              <View style={styles.infoRow}>
                <Text style={styles.icon}>📞</Text>
                <Text style={styles.infoText}>+63 917 123 4567 / (049) 501-2345</Text>
              </View>

              <View style={styles.infoRow}>
                <Text style={styles.icon}>✉️</Text>
                <Text style={styles.infoText}>support@veggietrack.ph</Text>
              </View>

              <View style={styles.infoRow}>
                <Text style={styles.icon}>⏰</Text>
                <Text style={styles.infoText}>{t('contactUs.hours')}</Text>
              </View>
            </View>

            {/* Support Form */}
            <Text style={styles.formTitle}>{t('contactUs.sendInquiry')}</Text>

            <Text style={styles.label}>{t('contactUs.subjectLabel')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('contactUs.subjectPlaceholder')}
              value={subject}
              onChangeText={setSubject}
              editable={!sending}
            />

            <Text style={styles.label}>{t('contactUs.messageLabel')}</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder={t('contactUs.messagePlaceholder')}
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
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(20,17,16,0.42)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bgScreen, borderTopLeftRadius: 26, borderTopRightRadius: 26, maxHeight: '85%', paddingBottom: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { fontFamily: fonts.heading, fontSize: 18, color: colors.ink },
  closeBtn: { padding: 6 },
  closeText: { fontSize: 18, color: colors.inkSoft, fontWeight: 'bold' },
  content: { padding: 20 },
  infoCard: { backgroundColor: colors.leaf50, borderRadius: radius.card, padding: 16, borderWidth: 1, borderColor: colors.leaf100, marginBottom: 20 },
  cardTitle: { fontFamily: fonts.heading, fontSize: 16, color: colors.ink, marginBottom: 12 },
  infoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  icon: { fontSize: 16, marginRight: 10, width: 24, textAlign: 'center' },
  infoText: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft, flex: 1 },
  formTitle: { fontFamily: fonts.heading, fontSize: 16, color: colors.ink, marginBottom: 12 },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 12.5, color: colors.inkSoft, marginBottom: 6, marginTop: 4 },
  input: { backgroundColor: colors.card, borderRadius: radius.ctrl, padding: 12, fontFamily: fonts.body, fontSize: 14, marginBottom: 14, borderWidth: 1.4, borderColor: colors.border, color: colors.ink },
  textArea: { height: 100, textAlignVertical: 'top' },
  button: { backgroundColor: PRIMARY, paddingVertical: 14, borderRadius: radius.ctrl, alignItems: 'center', marginTop: 10 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: 15.5 },
});
