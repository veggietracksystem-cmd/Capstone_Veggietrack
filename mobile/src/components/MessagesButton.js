import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Text, View, TextInput, TouchableOpacity, Modal, ScrollView,
  ActivityIndicator, StyleSheet, Platform, Alert, KeyboardAvoidingView,
} from 'react-native';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

const PRIMARY = '#2e7d32';
const POLL_MS = 30000;

function showAlert(title, message) {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
}

const roleLabel = (r) => (r ? r.replace('_', ' ') : '');

export default function MessagesButton() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('contacts'); // 'contacts' | 'thread'
  const [contacts, setContacts] = useState([]);
  const [unread, setUnread] = useState(0);
  const [active, setActive] = useState(null); // contact being chatted with
  const [thread, setThread] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const mounted = useRef(true);

  const loadUnread = useCallback(async () => {
    try {
      const { count } = await api.get('/api/messages/unread-count');
      if (mounted.current) setUnread(count || 0);
    } catch {
      /* silent on background poll */
    }
  }, []);

  // Poll the unread badge.
  useEffect(() => {
    mounted.current = true;
    loadUnread();
    const id = setInterval(loadUnread, POLL_MS);
    return () => { mounted.current = false; clearInterval(id); };
  }, [loadUnread]);

  // Poll the active thread when open (real-time FIFO sync).
  useEffect(() => {
    if (!open || view !== 'thread' || !active) return undefined;
    let activeMounted = true;
    const fetchThread = async () => {
      try {
        const data = await api.get(`/api/messages/${active.id}`);
        if (activeMounted) {
          setThread(Array.isArray(data) ? data : []);
          loadUnread();
        }
      } catch (err) {
        // silent
      }
    };
    const intervalId = setInterval(fetchThread, 3000);
    return () => {
      activeMounted = false;
      clearInterval(intervalId);
    };
  }, [open, view, active, loadUnread]);

  // Poll contacts list when open (unread count highlights).
  useEffect(() => {
    if (!open || view !== 'contacts') return undefined;
    let contactsMounted = true;
    const fetchContacts = async () => {
      try {
        const data = await api.get('/api/messages/contacts');
        if (contactsMounted) {
          setContacts(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        // silent
      }
    };
    const intervalId = setInterval(fetchContacts, 5000);
    return () => {
      contactsMounted = false;
      clearInterval(intervalId);
    };
  }, [open, view]);

  const openModal = async () => {
    setOpen(true);
    setView('contacts');
    setLoading(true);
    try {
      const data = await api.get('/api/messages/contacts');
      setContacts(Array.isArray(data) ? data : []);
    } catch (err) {
      showAlert('Error', err.message);
    } finally {
      setLoading(false);
    }
  };

  const openThread = async (contact) => {
    setActive(contact);
    setView('thread');
    setLoading(true);
    try {
      const data = await api.get(`/api/messages/${contact.id}`);
      setThread(Array.isArray(data) ? data : []);
      await loadUnread(); // opening marks incoming as read
    } catch (err) {
      showAlert('Error', err.message);
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
      showAlert('Error', err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <TouchableOpacity style={styles.iconBtn} onPress={openModal} activeOpacity={0.7}>
        <Text style={styles.icon}>✉️</Text>
        {unread > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
          </View>
        )}
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.sheet}
          >
            {/* Header */}
            <View style={styles.sheetHeader}>
              {view === 'thread' ? (
                <TouchableOpacity onPress={() => setView('contacts')}>
                  <Text style={styles.back}>‹ Back</Text>
                </TouchableOpacity>
              ) : <View style={{ width: 50 }} />}
              <Text style={styles.sheetTitle} numberOfLines={1}>
                {view === 'thread' ? (active?.full_name || 'Chat') : 'Messages'}
              </Text>
              <TouchableOpacity onPress={() => setOpen(false)}>
                <Text style={styles.close}>✕</Text>
              </TouchableOpacity>
            </View>

            {loading ? (
              <ActivityIndicator size="large" color={PRIMARY} style={{ marginVertical: 40 }} />
            ) : view === 'contacts' ? (
              contacts.length === 0 ? (
                <Text style={styles.empty}>No contacts available.</Text>
              ) : (
                <ScrollView style={styles.list}>
                  {contacts.map((c) => (
                    <TouchableOpacity key={c.id} style={styles.contactRow} onPress={() => openThread(c)}>
                      <View style={styles.avatar}>
                        <Text style={styles.avatarText}>
                          {(c.full_name || '?').charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.contactName}>{c.full_name || 'Unknown'}</Text>
                        <Text style={styles.contactRole}>{roleLabel(c.role)}</Text>
                      </View>
                      {c.unread_count > 0 && (
                        <View style={styles.contactBadge}>
                          <Text style={styles.contactBadgeText}>{c.unread_count}</Text>
                        </View>
                      )}
                      <Text style={styles.chevron}>›</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )
            ) : (
              <>
                <ScrollView style={styles.thread} contentContainerStyle={{ paddingVertical: 8 }}>
                  {thread.length === 0 ? (
                    <Text style={styles.empty}>No messages yet. Say hello 👋</Text>
                  ) : (
                    thread.map((m) => {
                      const mine = m.sender_id === user?.id;
                      return (
                        <View key={m.id} style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs]}>
                          <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                            <Text style={[styles.bubbleText, mine && { color: '#fff' }]}>{m.body}</Text>
                          </View>
                        </View>
                      );
                    })
                  )}
                </ScrollView>
                <View style={styles.inputRow}>
                  <TextInput
                    style={styles.input}
                    placeholder="Type a message…"
                    value={input}
                    onChangeText={setInput}
                    editable={!sending}
                    onSubmitEditing={send}
                  />
                  <TouchableOpacity
                    style={[styles.sendBtn, sending && { opacity: 0.6 }]}
                    onPress={send}
                    disabled={sending}
                  >
                    {sending
                      ? <ActivityIndicator color="#fff" />
                      : <Text style={styles.sendText}>Send</Text>}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  iconBtn: { padding: 6, marginRight: 2 },
  icon: { fontSize: 20 },
  badge: { position: 'absolute', top: 0, right: 0, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: '#d32f2f', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 20, height: '75%' },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: '#222', flex: 1, textAlign: 'center' },
  back: { color: PRIMARY, fontSize: 16, fontWeight: '600', width: 50 },
  close: { fontSize: 18, color: '#666', fontWeight: '700' },

  empty: { color: '#888', fontStyle: 'italic', textAlign: 'center', marginVertical: 30 },
  list: { flex: 1 },

  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#e8f5e9', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: PRIMARY, fontWeight: '700', fontSize: 16 },
  contactName: { fontSize: 16, fontWeight: '600', color: '#222' },
  contactRole: { fontSize: 13, color: '#888', textTransform: 'capitalize' },
  chevron: { fontSize: 22, color: '#ccc' },

  thread: { flex: 1 },
  bubbleRow: { flexDirection: 'row', marginVertical: 3, paddingHorizontal: 4 },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '78%', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 14 },
  bubbleMine: { backgroundColor: PRIMARY, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: '#eceff1', borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, color: '#222' },

  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#eee' },
  input: { flex: 1, backgroundColor: '#fafafa', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, borderWidth: 1, borderColor: '#ddd' },
  sendBtn: { backgroundColor: PRIMARY, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20 },
  sendText: { color: '#fff', fontWeight: '700' },
  contactBadge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: PRIMARY, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, marginRight: 4 },
  contactBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
