import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Text, View, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, StyleSheet, Platform, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { showAlert } from '../lib/ui';
import { colors, fonts, radius, shadowCard } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';

const roleLabel = (r) => (r ? r.replace('_', ' ') : '');

// `embedded`: rendered as the "Messages" bottom tab (no back arrow, no own
// SafeAreaView top inset - the tab bar/topbar chrome is provided by the parent).
export default function MessagesScreen({ navigation, embedded }) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [view, setView] = useState('contacts'); // 'contacts' | 'thread'
  const [contacts, setContacts] = useState([]);
  const [active, setActive] = useState(null); // contact being chatted with
  const [thread, setThread] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const mounted = useRef(true);

  const loadContacts = useCallback(async () => {
    try {
      const data = await api.get('/api/messages/contacts');
      if (mounted.current) setContacts(Array.isArray(data) ? data : []);
    } catch (err) {
      showAlert(t('common.error'), err.message);
    }
  }, []);

  // Initial load.
  useEffect(() => {
    mounted.current = true;
    setLoading(true);
    loadContacts().finally(() => { if (mounted.current) setLoading(false); });
    return () => { mounted.current = false; };
  }, [loadContacts]);

  // Poll the contacts list (unread badges) while browsing contacts.
  useEffect(() => {
    if (view !== 'contacts') return undefined;
    const intervalId = setInterval(loadContacts, 5000);
    return () => clearInterval(intervalId);
  }, [view, loadContacts]);

  // Poll the active thread for new messages.
  useEffect(() => {
    if (view !== 'thread' || !active) return undefined;
    let threadMounted = true;
    const fetchThread = async () => {
      try {
        const data = await api.get(`/api/messages/${active.id}`);
        if (threadMounted) setThread(Array.isArray(data) ? data : []);
      } catch (err) {
        // silent on background poll
      }
    };
    const intervalId = setInterval(fetchThread, 3000);
    return () => {
      threadMounted = false;
      clearInterval(intervalId);
    };
  }, [view, active]);

  const openThread = async (contact) => {
    setActive(contact);
    setView('thread');
    setLoading(true);
    try {
      const data = await api.get(`/api/messages/${contact.id}`);
      setThread(Array.isArray(data) ? data : []);
      await loadContacts(); // opening marks incoming as read; refresh badges
    } catch (err) {
      showAlert(t('common.error'), err.message);
    } finally {
      setLoading(false);
    }
  };

  const send = async () => {
    const body = input.trim();
    if (!body || !active) return;
    setSending(true);
    try {
      const { data } = await api.post('/api/messages', { recipient_id: active.id, body });
      setThread((prev) => [...prev, data]);
      setInput('');
    } catch (err) {
      showAlert(t('common.error'), err.message);
    } finally {
      setSending(false);
    }
  };

  const handleBack = () => {
    if (view === 'thread') {
      setView('contacts');
      setActive(null);
    } else if (!embedded) {
      navigation.goBack();
    }
  };

  const Wrapper = embedded ? View : SafeAreaView;

  return (
    <Wrapper style={styles.container}>
      <View style={styles.header}>
        {(view === 'thread' || !embedded) ? (
          <TouchableOpacity onPress={handleBack} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="arrow-back" size={20} color={colors.ink} />
          </TouchableOpacity>
        ) : <View style={{ width: 20 }} />}
        <Text style={styles.headerTitle} numberOfLines={1}>
          {view === 'thread' ? (active?.full_name || t('messages.chat')) : t('messages.title')}
        </Text>
        <View style={{ width: 20 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.bodyFlex}
      >
        {loading ? (
          <ActivityIndicator size="large" color={colors.leaf700} style={{ marginTop: 60 }} />
        ) : view === 'contacts' ? (
          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            {contacts.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Ionicons name="mail-outline" size={40} color={colors.inkFaint} style={styles.emptyIcon} />
                <Text style={styles.emptyTitle}>{t('messages.noContactsTitle')}</Text>
                <Text style={styles.emptySubtitle}>{t('messages.noContactsSubtitle')}</Text>
              </View>
            ) : (
              contacts.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={styles.contactRow}
                  onPress={() => openThread(c)}
                  activeOpacity={0.7}
                >
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {(c.full_name || '?').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.contactInfo}>
                    <Text style={styles.contactName} numberOfLines={1}>{c.full_name || t('messages.unknownContact')}</Text>
                    <Text style={styles.contactRole} numberOfLines={1}>{roleLabel(c.role)}</Text>
                  </View>
                  <View style={styles.contactRight}>
                    {c.unread_count > 0 && (
                      <View style={styles.contactBadge}>
                        <Text style={styles.contactBadgeText}>{c.unread_count > 9 ? '9+' : c.unread_count}</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        ) : (
          <>
            <ScrollView style={styles.scrollArea} contentContainerStyle={styles.threadContent} showsVerticalScrollIndicator={false}>
              {thread.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Ionicons name="chatbubble-ellipses-outline" size={40} color={colors.inkFaint} style={styles.emptyIcon} />
                  <Text style={styles.emptyTitle}>{t('messages.noMessagesTitle')}</Text>
                  <Text style={styles.emptySubtitle}>{t('messages.noMessagesSubtitle')}</Text>
                </View>
              ) : (
                thread.map((m) => {
                  const mine = m.sender_id === user?.id;
                  return (
                    <View key={m.id} style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs]}>
                      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                        <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{m.body}</Text>
                      </View>
                    </View>
                  );
                })
              )}
            </ScrollView>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                placeholder={t('messages.typePlaceholder')}
                placeholderTextColor={colors.inkFaint}
                value={input}
                onChangeText={setInput}
                editable={!sending}
                onSubmitEditing={send}
              />
              <TouchableOpacity
                style={[styles.sendBtn, (sending || !input.trim()) && styles.sendBtnDisabled]}
                onPress={send}
                disabled={sending || !input.trim()}
                activeOpacity={0.85}
              >
                {sending
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Ionicons name="send" size={17} color="#fff" />}
              </TouchableOpacity>
            </View>
          </>
        )}
      </KeyboardAvoidingView>
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgScreen },
  bodyFlex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingTop: 6,
    paddingBottom: 14,
  },
  headerTitle: { fontFamily: fonts.heading, fontSize: 20, color: colors.ink, flex: 1, textAlign: 'center' },

  scrollArea: { flex: 1 },
  content: { paddingHorizontal: 2, paddingBottom: 16 },

  emptyContainer: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 24 },
  emptyIcon: { marginBottom: 12 },
  emptyTitle: { fontFamily: fonts.bodyBold, fontSize: 14.5, color: colors.inkSoft, marginBottom: 4 },
  emptySubtitle: { fontFamily: fonts.body, fontSize: 13, color: colors.inkFaint, textAlign: 'center' },

  contactRow: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 12,
    marginBottom: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 11,
    backgroundColor: colors.gold100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: fonts.headingBold, color: colors.gold700, fontSize: 17 },
  contactInfo: { flex: 1, minWidth: 0 },
  contactName: { fontFamily: fonts.bodySemiBold, fontSize: 14.5, color: colors.ink },
  contactRole: { fontFamily: fonts.body, fontSize: 12, color: colors.inkSoft, marginTop: 2, textTransform: 'capitalize' },
  contactRight: { alignItems: 'flex-end' },
  contactBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.gold500,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  contactBadgeText: { fontFamily: fonts.bodyBold, color: colors.soil800, fontSize: 11 },

  threadContent: { paddingHorizontal: 2, paddingBottom: 8, flexGrow: 1 },
  bubbleRow: { flexDirection: 'row', marginVertical: 3 },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '78%', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 16, ...shadowCard },
  bubbleMine: { backgroundColor: colors.leaf700, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: colors.card, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: colors.border },
  bubbleText: { fontFamily: fonts.body, fontSize: 14.5, color: colors.ink },
  bubbleTextMine: { color: '#ffffff' },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.ctrl,
    borderWidth: 1.4,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontFamily: fonts.body,
    fontSize: 14.5,
    color: colors.ink,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.leaf700,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.5 },
});
