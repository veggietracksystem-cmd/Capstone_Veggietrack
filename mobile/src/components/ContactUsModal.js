import { useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, ActivityIndicator,
} from 'react-native';
import { showAlert } from '../lib/ui';
import { useTranslation } from '../i18n/useTranslation';

const PRIMARY = '#2e7d32';

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
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '85%', paddingBottom: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#eee' },
  title: { fontSize: 18, fontWeight: '700', color: PRIMARY },
  closeBtn: { padding: 6 },
  closeText: { fontSize: 18, color: '#777', fontWeight: 'bold' },
  content: { padding: 20 },
  infoCard: { backgroundColor: '#f8fdf8', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#c8e6c9', marginBottom: 20 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: PRIMARY, marginBottom: 12 },
  infoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  icon: { fontSize: 16, marginRight: 10, width: 24, textAlign: 'center' },
  infoText: { fontSize: 13, color: '#444', flex: 1 },
  formTitle: { fontSize: 16, fontWeight: '700', color: '#222', marginBottom: 12 },
  label: { fontSize: 13, color: '#555', marginBottom: 6, marginTop: 4 },
  input: { backgroundColor: '#fff', borderRadius: 8, padding: 12, fontSize: 14, marginBottom: 14, borderWidth: 1, borderColor: '#ddd' },
  textArea: { height: 100, textAlignVertical: 'top' },
  button: { backgroundColor: PRIMARY, paddingVertical: 14, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
