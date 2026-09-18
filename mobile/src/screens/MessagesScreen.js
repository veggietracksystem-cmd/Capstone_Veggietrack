import useRequestLock from '../hooks/useRequestLock';
import UserAvatar from '../components/UserAvatar';
import { rf } from '../lib/responsive';
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
import { colors, fonts, fontSize, radius, shadowCard } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';
import ScreenHeader from '../components/ScreenHeader';

const roleLabel = (r) => (r ? r.replace('_', ' ') : '');

// Use the device's local calendar for both separators and message times.
const messageDate = (timestamp) => {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
};

const sameDay = (a, b) => Boolean(a && b
  && a.getFullYear() === b.getFullYear()
  && a.getMonth() === b.getMonth()
  && a.getDate() === b.getDate());

const messageDateLabel = (date, now) => {
  if (sameDay(date, now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
};

// `embedded`: rendered as the "Messages" bottom tab (no back arrow, no own
// SafeAreaView top inset - the tab bar/topbar chrome is provided by the parent).
export default function MessagesScreen({ navigation, embedded }) {
  const requestLock = useRequestLock();
  const { user } = useAuth();
  const { t } = useTranslation();
  const [view, setView] = useState('contacts'); // 'contacts' | 'thread'
  const [contacts, setContacts] = useState([]);
  const [contactSearch, setContactSearch] = useState('');
  const [active, setActive] = useState(null); // contact being chatted with
  const [thread, setThread] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const mounted = useRef(true);
  const activeId = useRef(null);
  const threadVersion = useRef(0);

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
      const version = ++threadVersion.current;
      try {
        const data = await api.get(`/api/messages/${active.id}`);
        if (threadMounted && version === threadVersion.current && activeId.current === active.id) setThread(Array.isArray(data) ? data : []);
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
    activeId.current = contact.id;
    const version = ++threadVersion.current;
    setThread([]);
    setActive(contact);
    setView('thread');
    setLoading(true);
    try {
      const data = await api.get(`/api/messages/${contact.id}`);
      if (mounted.current && version === threadVersion.current && activeId.current === contact.id) setThread(Array.isArray(data) ? data : []);
      await loadContacts(); // opening marks incoming as read; refresh badges
    } catch (err) {
      showAlert(t('common.error'), err.message);
    } finally {
      if (mounted.current && activeId.current === contact.id) setLoading(false);
    }
  };

  // Messaging is intentionally online-only — unlike harvests (fire-and-forget
  // records with no real-time expectation), a chat message implies the
  // recipient sees it promptly; silently queuing it for delivery minutes or
  // hours later when connectivity returns would be surprising, not helpful,
  // and would need thread-merge/ordering logic this feature doesn't warrant.
  // What IS preserved on failure: the typed draft is never cleared unless
  // the send actually succeeds (see the try/catch below), so a failed send
  // never loses the user's text — they see the error and can retry.
  const send = async () => {
    const body = input.trim();
    if (!body || !active) return;
    if (!requestLock.acquire('Sending')) return;
    setSending(true);
    try {
      const { data } = await api.post('/api/messages', { recipient_id: active.id, body });
      // Invalidate a poll started before the send was committed.
      threadVersion.current++;
      if (mounted.current && activeId.current === active.id) {
        setThread(prev => prev.some(m => m.id === data.id) ? prev : [...prev, data]);
        setInput(current => current.trim() === body ? '' : current);
      }
    } catch (err) {
      showAlert(t('common.error'), err.message);
    } finally {
      requestLock.release('Sending');
      setSending(false);
    }
  };

  const handleBack = () => {
    if (view === 'thread') {
      activeId.current = null;
      threadVersion.current++;
      setLoading(false);
      setInput('');
      setView('contacts');
      setActive(null);
    } else if (!embedded) {
      navigation.goBack();
    }
  };

  const Wrapper = embedded ? View : SafeAreaView;
  const displayNow = new Date();
  const contactQuery = contactSearch.trim().toLocaleLowerCase();
  const filteredContacts = contacts.filter((contact) => !contactQuery
    || `${contact.full_name || ''} ${roleLabel(contact.role)}`.toLocaleLowerCase().includes(contactQuery));

  return (
    <Wrapper style={styles.container}>
      <ScreenHeader
        title={view === 'thread' ? (active?.full_name || t('messages.chat')) : t('messages.title')}
        onBack={(view === 'thread' || !embedded) ? handleBack : undefined}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
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
            <View style={styles.searchRow}>
              <Ionicons name="search-outline" size={rf(18)} color={colors.inkFaint} />
              <TextInput style={styles.searchInput} value={contactSearch} onChangeText={setContactSearch}
                placeholder="Search conversations" placeholderTextColor={colors.inkFaint} autoCapitalize="none"
                returnKeyType="search" accessibilityLabel="Search conversations" />
              {!!contactSearch && <TouchableOpacity onPress={() => setContactSearch('')} hitSlop={8}><Ionicons name="close-circle" size={rf(18)} color={colors.inkFaint} /></TouchableOpacity>}
            </View>
            {contacts.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Ionicons name="mail-outline" size={rf(40)} color={colors.inkFaint} style={styles.emptyIcon} />
                <Text style={styles.emptyTitle}>{t('messages.noContactsTitle')}</Text>
                <Text style={styles.emptySubtitle}>{t('messages.noContactsSubtitle')}</Text>
              </View>
            ) : filteredContacts.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Ionicons name="search-outline" size={rf(40)} color={colors.inkFaint} style={styles.emptyIcon} />
                <Text style={styles.emptyTitle}>No conversations found</Text>
              </View>
            ) : (
              filteredContacts.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={styles.contactRow}
                  onPress={() => openThread(c)}
                  activeOpacity={0.7}
                >
                  <UserAvatar user={c} size={42} style={styles.avatar} textStyle={styles.avatarText} />
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
                  <Ionicons name="chatbubble-ellipses-outline" size={rf(40)} color={colors.inkFaint} style={styles.emptyIcon} />
                  <Text style={styles.emptyTitle}>{t('messages.noMessagesTitle')}</Text>
                  <Text style={styles.emptySubtitle}>{t('messages.noMessagesSubtitle')}</Text>
                </View>
              ) : (
                thread.map((m, index) => {
                  const mine = m.sender_id === user?.id;
                  const date = messageDate(m.created_at);
                  const previousDate = messageDate(thread[index - 1]?.created_at);
                  const showDate = date && !sameDay(date, previousDate);
                  return (
                    <View key={m.id}>
                      {showDate && (
                        <View style={styles.dateSeparator}>
                          <Text style={styles.dateLabel}>{messageDateLabel(date, displayNow)}</Text>
                        </View>
                      )}
                      <View style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs]}>
                        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                          <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{m.body}</Text>
                          {date && (
                            <Text style={[styles.messageTime, mine && styles.messageTimeMine]}>
                              {date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                              {mine && (m.is_read === true ? ' · Seen' : m.is_read === false ? ' · Sent' : '')}
                            </Text>
                          )}
                        </View>
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
                  : <Ionicons name="send" size={rf(17)} color="#fff" />}
              </TouchableOpacity>
            </View>
          </>
        )}
      </KeyboardAvoidingView>
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF', minHeight: 0 },
  bodyFlex: { flex: 1, minHeight: 0 },

  scrollArea: { flex: 1, minHeight: 0 },
  content: { paddingHorizontal: 2, paddingBottom: 16 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.ctrl, paddingHorizontal: 12, marginBottom: 12 },
  searchInput: { flex: 1, minWidth: 0, paddingVertical: 10, fontFamily: fonts.body, color: colors.ink, fontSize: rf(fontSize.md) },

  emptyContainer: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 24 },
  emptyIcon: { marginBottom: 12 },
  emptyTitle: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.md), color: colors.inkSoft, marginBottom: 4 },
  emptySubtitle: { fontFamily: fonts.body, fontSize: rf(fontSize.sm), color: colors.inkFaint, textAlign: 'center' },

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
  avatarText: { fontFamily: fonts.headingBold, color: colors.gold700, fontSize: rf(fontSize.lg) },
  contactInfo: { flex: 1, minWidth: 0 },
  contactName: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.md), color: colors.ink },
  contactRole: { fontFamily: fonts.body, fontSize: rf(fontSize.sm), color: colors.inkSoft, marginTop: 2, textTransform: 'capitalize' },
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
  contactBadgeText: { fontFamily: fonts.bodyBold, color: colors.soil800, fontSize: rf(fontSize.xs) },

  threadContent: { paddingHorizontal: 2, paddingBottom: 8, flexGrow: 1 },
  dateSeparator: { alignItems: 'center', marginTop: 12, marginBottom: 8 },
  dateLabel: { fontFamily: fonts.bodyMedium, fontSize: rf(fontSize.sm), color: colors.inkSoft, backgroundColor: colors.leaf50, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4, textAlign: 'center' },
  bubbleRow: { flexDirection: 'row', marginVertical: 3 },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '78%', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 16, ...shadowCard },
  bubbleMine: { backgroundColor: colors.leaf700, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: colors.card, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: colors.border },
  bubbleText: { fontFamily: fonts.body, fontSize: rf(fontSize.md), color: colors.ink },
  bubbleTextMine: { color: '#ffffff' },
  messageTime: { fontFamily: fonts.body, fontSize: rf(fontSize.xs), color: colors.inkSoft, marginTop: 4, alignSelf: 'flex-end' },
  messageTimeMine: { color: colors.leaf100 },

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
    fontSize: rf(fontSize.md),
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
