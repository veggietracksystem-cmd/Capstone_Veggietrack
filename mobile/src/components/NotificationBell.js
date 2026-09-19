import useLatestRequest from '../hooks/useLatestRequest';
import useRequestLock from '../hooks/useRequestLock';
import { rf } from '../lib/responsive';
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Text, View, TouchableOpacity, Modal, ScrollView,
  ActivityIndicator, StyleSheet, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api from '../api/client';
import CustomModal from './CustomModal';
import EmptyState from './EmptyState';
import { colors, fonts, radius, shadowCard } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';
import { showAlert } from '../lib/ui';

const PRIMARY = colors.leaf700;
const INACTIVE = colors.inkFaint;
const POLL_MS = 30000; // refresh unread count every 30s

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

export default function NotificationBell({ asTabItem = false, active = false, onPress, fullScreen = false }) {
  const beginRead = useLatestRequest();
  const requestLock = useRequestLock();
  const [marking, setMarking] = useState(false);
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detailNotification, setDetailNotification] = useState(null); // shown before navigating anywhere
  const mounted = useRef(true);

  const unread = items.filter((n) => !n.is_read).length;

  const load = useCallback(async () => {
    const isCurrent = beginRead('notifications');
    try {
      const data = await api.get('/api/notifications');
      if (isCurrent()) setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      // Silent on background polls; only surface if the modal/screen is open.
      if (open || fullScreen) showAlert(t('common.error'), err.message);
    }
  }, [open, fullScreen, t]);

  // Initial fetch + polling for the unread badge.
  useEffect(() => {
    mounted.current = true;
    (async () => {
      await load();
      if (mounted.current) setInitialLoading(false);
    })();
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
    if (n.is_read || !requestLock.acquire('mark')) return;
    setMarking(true);
    try {
      await api.put(`/api/notifications/${n.id}/read`);
      beginRead('notifications');
      if (mounted.current) setItems(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x));
    } catch (err) {
      showAlert(t('common.error'), err.message);
    } finally {
      requestLock.release('mark');
      if (mounted.current) setMarking(false);
    }
  };

  // Tapping a notification opens a detail modal first — it no longer
  // navigates straight away (requirement: show full details before jumping).
  const handlePress = async (n) => {
    await markRead(n);
    setDetailNotification(n);
  };

  const markAllRead = async () => {
    if (unread === 0 || !requestLock.acquire('mark')) return;
    const ids = new Set(items.map(n => n.id));
    setMarking(true);
    try {
      await api.put('/api/notifications/read-all');
      beginRead('notifications');
      if (mounted.current) setItems(prev => prev.map(n => ids.has(n.id) ? { ...n, is_read: true } : n));
    } catch (err) {
      showAlert(t('common.error'), err.message);
    } finally {
      requestLock.release('mark');
      if (mounted.current) setMarking(false);
    }
  };

  if (fullScreen) {
    return (
      <SafeAreaView style={styles.screenContainer} edges={['left', 'right', 'bottom']}>
        <View style={styles.screenHeader}>
          <View style={styles.sheetTitleRow}>
            <Ionicons name="notifications-outline" size={rf(20)} color={PRIMARY} />
            <Text style={styles.screenTitle}>{t('notifications.screenTitle')}</Text>
          </View>
          {unread > 0 && (
            <TouchableOpacity disabled={marking} onPress={markAllRead} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.markAllText}>{marking ? t('common.loading') : t('notifications.markAllRead')}</Text>
            </TouchableOpacity>
          )}
        </View>

        <ScrollView
          style={styles.screenList}
          contentContainerStyle={styles.screenListContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          showsVerticalScrollIndicator={false}
        >
          {initialLoading ? (
            <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />
          ) : items.length === 0 ? (
            <EmptyState
              iconElement={<Ionicons name="notifications-outline" size={rf(40)} color={colors.inkFaint} />}
              title={t('notifications.emptyTitle')}
              message={t('notifications.empty')}
            />
          ) : (
            items.map((n) => (
              <TouchableOpacity
                key={n.id}
                style={[styles.item, !n.is_read && styles.itemUnread]}
                onPress={() => handlePress(n)}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1 }}>
                  <View style={styles.itemTop}>
                    <Text style={[styles.itemTitle, !n.is_read && styles.itemTitleUnread]} numberOfLines={1}>
                      {n.title}
                    </Text>
                    <Text style={styles.itemTime}>{timeAgo(n.created_at, t)}</Text>
                  </View>
                  <Text style={styles.itemMessage} numberOfLines={2}>{n.message}</Text>
                </View>
                {!n.is_read && <View style={styles.unreadDot} />}
              </TouchableOpacity>
            ))
          )}
        </ScrollView>

        <CustomModal
          visible={!!detailNotification}
          title={detailNotification?.title}
          cancelLabel={t('notifications.close')}
          onCancel={() => setDetailNotification(null)}
        >
          <Text style={styles.detailMessage}>{detailNotification?.message}</Text>
          <Text style={styles.detailTime}>
            {detailNotification?.created_at ? new Date(detailNotification.created_at).toLocaleString() : ''}
          </Text>
        </CustomModal>
      </SafeAreaView>
    );
  }

  return (
    <>
      {asTabItem ? (
        <TouchableOpacity style={styles.tabItemBtn} onPress={onPress || openModal} activeOpacity={0.7}>
          <View style={[styles.tabIconBadge, active && styles.tabIconBadgeActive]}>
            <Ionicons name="notifications-outline" size={rf(20)} color={active ? PRIMARY : INACTIVE} />
            {unread > 0 && (
              <View style={styles.tabBadge}>
                <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
              </View>
            )}
          </View>
          <Text style={[styles.tabLabel, active && styles.tabLabelActive]} numberOfLines={1}>
            {t('notifications.screenTitle')}
          </Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={styles.bellBtn} onPress={openModal} activeOpacity={0.7}>
          <Ionicons name="notifications-outline" size={rf(20)} color={colors.soil800} />
          {unread > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
            </View>
          )}
        </TouchableOpacity>
      )}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          {/* Tap outside the card to dismiss. */}
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setOpen(false)} />

          <View style={styles.card}>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetTitleRow}>
                <Ionicons name="notifications-outline" size={rf(18)} color={PRIMARY} />
                <Text style={styles.sheetTitle}>{t('notifications.screenTitle')}</Text>
              </View>
              {unread > 0 && (
                <View style={styles.headerBadge}>
                  <Text style={styles.headerBadgeText}>{t('notifications.newBadge', { count: unread })}</Text>
                </View>
              )}
            </View>

            {loading ? (
              <ActivityIndicator size="large" color={PRIMARY} style={{ marginVertical: 40 }} />
            ) : items.length === 0 ? (
              <EmptyState
                iconElement={<Ionicons name="notifications-outline" size={rf(36)} color={colors.inkFaint} />}
                title={t('notifications.emptyTitle')}
                message={t('notifications.empty')}
              />
            ) : (
              <ScrollView
                style={styles.list}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
                showsVerticalScrollIndicator={false}
              >
                {items.map((n) => (
                  <TouchableOpacity
                    key={n.id}
                    style={[styles.item, !n.is_read && styles.itemUnread]}
                    onPress={() => handlePress(n)}
                    activeOpacity={0.7}
                  >
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
                disabled={marking || unread === 0}
              >
                <Text style={[styles.footerOutlineText, unread === 0 && styles.linkDisabled]}>{marking ? t('common.loading') : t('notifications.markAllRead')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.footerBtn, styles.footerBtnPrimary]} onPress={() => setOpen(false)}>
                <Text style={styles.footerPrimaryText}>{t('notifications.close')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <CustomModal
        visible={!!detailNotification}
        title={detailNotification?.title}
        cancelLabel={t('notifications.close')}
        onCancel={() => setDetailNotification(null)}
      >
        <Text style={styles.detailMessage}>{detailNotification?.message}</Text>
        <Text style={styles.detailTime}>
          {detailNotification?.created_at ? new Date(detailNotification.created_at).toLocaleString() : ''}
        </Text>
      </CustomModal>
    </>
  );
}

const styles = StyleSheet.create({
  bellBtn: { padding: 6, marginRight: 4 },

  // Full-screen variant (farmer bottom-nav "Notifications" tab)
  screenContainer: { flex: 1, minHeight: 0, backgroundColor: colors.bgScreen },
  screenHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: colors.bgScreen, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  screenTitle: { fontFamily: fonts.heading, fontSize: rf(18), color: colors.ink },
  markAllText: { fontFamily: fonts.bodySemiBold, color: PRIMARY, fontSize: rf(13) },
  screenList: { flex: 1, minHeight: 0 },
  screenListContent: { padding: 12, paddingBottom: 100 },

  // Bottom-nav tab-item variant (matches BottomNavBar's own tab styling)
  tabItemBtn: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabIconBadge: {
    width: 40, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', marginBottom: 2,
  },
  tabIconBadgeActive: { backgroundColor: colors.leaf100 },
  tabBadge: {
    position: 'absolute', top: -2, right: 2, minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  tabLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(11), color: colors.inkFaint },
  tabLabelActive: { color: PRIMARY },

  badge: {
    position: 'absolute', top: 0, right: 0, minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  badgeText: { fontFamily: fonts.bodyBold, color: '#fff', fontSize: rf(11) },

  backdrop: { flex: 1, backgroundColor: 'rgba(20,17,16,0.42)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 420, backgroundColor: colors.bgScreen, borderRadius: radius.card, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 16, maxHeight: '80%', ...shadowCard },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sheetTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sheetTitle: { fontFamily: fonts.heading, fontSize: rf(18), color: colors.ink },
  headerBadge: { backgroundColor: colors.leaf100, borderRadius: 12, paddingVertical: 3, paddingHorizontal: 10, borderWidth: 1, borderColor: PRIMARY },
  headerBadgeText: { fontFamily: fonts.bodyBold, color: PRIMARY, fontSize: rf(12) },
  linkDisabled: { color: colors.inkFaint },

  footer: { flexDirection: 'row', gap: 12, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  footerBtn: { flex: 1, paddingVertical: 12, borderRadius: radius.ctrl, alignItems: 'center' },
  footerBtnOutline: { borderWidth: 1.5, borderColor: PRIMARY },
  footerBtnPrimary: { backgroundColor: PRIMARY },
  footerOutlineText: { fontFamily: fonts.bodySemiBold, color: PRIMARY, fontSize: rf(14.5) },
  footerPrimaryText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(14.5) },
  btnDisabled: { opacity: 0.5, borderColor: colors.border },

  emptyText: { fontFamily: fonts.body, color: colors.inkFaint, fontStyle: 'italic', textAlign: 'center', marginVertical: 30 },
  list: { },

  item: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 12, paddingHorizontal: 8, borderRadius: radius.ctrl, marginBottom: 4 },
  itemUnread: { backgroundColor: colors.leaf50 },
  itemTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  itemTitle: { fontFamily: fonts.bodySemiBold, fontSize: rf(14.5), color: colors.ink, flex: 1, marginRight: 8 },
  itemTitleUnread: { fontFamily: fonts.bodyBold, color: colors.ink },
  itemTime: { fontFamily: fonts.body, fontSize: rf(12), color: colors.inkFaint },
  itemMessage: { fontFamily: fonts.body, fontSize: rf(13.5), color: colors.inkSoft, marginTop: 2 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: PRIMARY, marginLeft: 8, marginTop: 6 },

  detailMessage: { fontFamily: fonts.body, fontSize: rf(14.5), color: colors.ink, lineHeight: 21 },
  detailTime: { fontFamily: fonts.body, fontSize: rf(12.5), color: colors.inkFaint, marginTop: 10 },
});
