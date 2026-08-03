import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Text, View, TouchableOpacity, Modal, ScrollView,
  ActivityIndicator, StyleSheet, Platform, Alert, RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../i18n/useTranslation';
import api from '../api/client';

const PRIMARY = '#2e7d32';
const POLL_MS = 30000; // refresh unread count every 30s

function showAlert(title, message) {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
}

// Lightweight relative-time formatter (no date lib needed).
function timeAgo(iso, t) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (isNaN(then)) return '';
  const secs = Math.floor((Date.now() - then) / 1000);
  if (secs < 60) return t('notifications.justNow');
  const mins = Math.floor(secs / 60);
  if (mins < 60) return t('notifications.minAgo', { n: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t('notifications.hourAgo', { n: hrs });
  const days = Math.floor(hrs / 24);
  if (days < 7) return t('notifications.dayAgo', { n: days });
  return new Date(iso).toLocaleDateString();
}

function typeColor(type) {
  switch (type) {
    case 'order': return '#1976d2';
    case 'delivery': return '#7b1fa2';
    case 'payment': return PRIMARY;
    default: return '#607d8b';
  }
}

export default function NotificationBell() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);

  const unread = items.filter((n) => !n.is_read).length;

  const load = useCallback(async () => {
    try {
      const data = await api.get('/api/notifications');
      if (mounted.current) setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      // Silent on background polls; only surface if the modal is open.
      if (open) showAlert(t('common.error'), err.message);
    }
  }, [open]);

  // Initial fetch + polling for the unread badge.
  useEffect(() => {
    mounted.current = true;
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, [load]);

  const openModal = async () => {
    setOpen(true);
    setLoading(true);
    await load();
    setLoading(false);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const markRead = async (n) => {
    if (n.is_read) return;
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
    try {
      await api.put(`/api/notifications/${n.id}/read`);
    } catch (err) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: false } : x)));
      showAlert(t('common.error'), err.message);
    }
  };

  const handlePress = async (n) => {
    await markRead(n);
    setOpen(false);

    if (n.item_id) {
      if (n.type === 'pickup') {
        navigation.navigate('DistributorDashboard', { tab: 'pickups' });
      } else if (['order', 'delivery', 'payment'].includes(n.type)) {
        if (user?.role === 'retailer') {
          navigation.navigate('OrderTracking', { orderId: n.item_id });
        } else if (user?.role === 'distributor') {
          navigation.navigate('DistributorDashboard', { tab: 'orders' });
        } else if (user?.role === 'delivery_personnel') {
          navigation.navigate('DeliveryDashboard', { filter: 'active' });
        }
      }
    }
  };

  const markAllRead = async () => {
    if (unread === 0) return;
    const snapshot = items;
    setItems((prev) => prev.map((x) => ({ ...x, is_read: true })));
    try {
      await api.put('/api/notifications/read-all');
    } catch (err) {
      setItems(snapshot); // revert
      showAlert(t('common.error'), err.message);
    }
  };

  return (
    <>
      <TouchableOpacity style={styles.bellBtn} onPress={openModal} activeOpacity={0.7}>
        <Text style={styles.bellIcon}>🔔</Text>
        {unread > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
          </View>
        )}
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          {/* Tap outside the card to dismiss. */}
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setOpen(false)} />

          <View style={styles.card}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{t('notifications.title')}</Text>
              {unread > 0 && (
                <View style={styles.headerBadge}>
                  <Text style={styles.headerBadgeText}>{t('notifications.newBadge', { count: unread })}</Text>
                </View>
              )}
            </View>

            {loading ? (
              <ActivityIndicator size="large" color={PRIMARY} style={{ marginVertical: 40 }} />
            ) : items.length === 0 ? (
              <Text style={styles.emptyText}>{t('notifications.empty')}</Text>
            ) : (
              <ScrollView
                style={styles.list}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
              >
                {items.map((n) => (
                  <TouchableOpacity
                    key={n.id}
                    style={[styles.item, !n.is_read && styles.itemUnread]}
                    onPress={() => handlePress(n)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.typeDot, { backgroundColor: typeColor(n.type) }]} />
                    <View style={{ flex: 1 }}>
                      <View style={styles.itemTop}>
                        <Text style={[styles.itemTitle, !n.is_read && styles.itemTitleUnread]} numberOfLines={1}>
                          {n.title}
                        </Text>
                        <Text style={styles.itemTime}>{timeAgo(n.created_at, t)}</Text>
                      </View>
                      <Text style={styles.itemMessage}>{n.message}</Text>
                    </View>
                    {!n.is_read && <View style={styles.unreadDot} />}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            {/* Footer actions */}
            <View style={styles.footer}>
              <TouchableOpacity
                style={[styles.footerBtn, styles.footerBtnOutline, unread === 0 && styles.btnDisabled]}
                onPress={markAllRead}
                disabled={unread === 0}
              >
                <Text style={[styles.footerOutlineText, unread === 0 && styles.linkDisabled]}>{t('notifications.markAllRead')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.footerBtn, styles.footerBtnPrimary]} onPress={() => setOpen(false)}>
                <Text style={styles.footerPrimaryText}>{t('notifications.close')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bellBtn: { padding: 6, marginRight: 4 },
  bellIcon: { fontSize: 22 },
  badge: {
    position: 'absolute', top: 0, right: 0, minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: '#d32f2f', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 420, backgroundColor: '#fff', borderRadius: 16, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 16, maxHeight: '80%', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: PRIMARY },
  headerBadge: { backgroundColor: '#e8f5e9', borderRadius: 12, paddingVertical: 3, paddingHorizontal: 10, borderWidth: 1, borderColor: PRIMARY },
  headerBadgeText: { color: PRIMARY, fontSize: 12, fontWeight: '700' },
  linkDisabled: { color: '#aaa' },

  footer: { flexDirection: 'row', gap: 12, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#eee' },
  footerBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  footerBtnOutline: { borderWidth: 1.5, borderColor: PRIMARY },
  footerBtnPrimary: { backgroundColor: PRIMARY },
  footerOutlineText: { color: PRIMARY, fontWeight: '600', fontSize: 15 },
  footerPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnDisabled: { opacity: 0.5, borderColor: '#ccc' },

  emptyText: { color: '#888', fontStyle: 'italic', textAlign: 'center', marginVertical: 30 },
  list: { },

  item: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 12, paddingHorizontal: 8, borderRadius: 10, marginBottom: 4 },
  itemUnread: { backgroundColor: '#f1f8e9' },
  typeDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6, marginRight: 10 },
  itemTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  itemTitle: { fontSize: 15, fontWeight: '600', color: '#333', flex: 1, marginRight: 8 },
  itemTitleUnread: { color: '#111', fontWeight: '700' },
  itemTime: { fontSize: 12, color: '#999' },
  itemMessage: { fontSize: 14, color: '#555', marginTop: 2 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: PRIMARY, marginLeft: 8, marginTop: 6 },
});
