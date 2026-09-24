import useLatestRequest from '../hooks/useLatestRequest';
import useRequestLock from '../hooks/useRequestLock';
import { rf } from '../lib/responsive';
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Text, View, TouchableOpacity, ScrollView,
  ActivityIndicator, StyleSheet, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import api from '../api/client';
import CustomModal from './CustomModal';
import EmptyState from './EmptyState';
import { colors, control, fonts, radius, actionBtn, actionBtnOutline, actionBtnText } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';
import { showAlert } from '../lib/ui';
import { friendlyError } from '../lib/errorMessages';

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
  const navigation = useNavigation();
  const beginRead = useLatestRequest();
  const requestLock = useRequestLock();
  const [marking, setMarking] = useState(false);
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
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
      // Silent on background polls; only surface on the Notifications screen.
      if (fullScreen) showAlert(t('common.error'), friendlyError(err));
    }
  }, [fullScreen, t]);

  // Re-sync the badge when coming back from the Notifications screen.
  useEffect(() => navigation.addListener('focus', load), [navigation, load]);

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

  // Notifications is its own stack screen (like Messages), not a modal.
  const openScreen = () => navigation.navigate('Notifications');

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
      showAlert(t('common.error'), friendlyError(err));
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
      showAlert(t('common.error'), friendlyError(err));
    } finally {
      requestLock.release('mark');
      if (mounted.current) setMarking(false);
    }
  };

  if (fullScreen) {
    return (
      <SafeAreaView style={styles.screenContainer} edges={['left', 'right', 'bottom']}>
        {/* The screen's standard header (title + back arrow) comes from
            NotificationsScreen, so only the "Mark all read" action lives here. */}
        {unread > 0 && (
          <View style={styles.screenActions}>
            <TouchableOpacity style={styles.markAllBtn} disabled={marking} onPress={markAllRead} activeOpacity={0.8} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <Text style={styles.markAllText}>{marking ? t('common.loading') : t('notifications.markAllRead')}</Text>
            </TouchableOpacity>
          </View>
        )}

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
                <View style={styles.unreadSlot}>{!n.is_read && <View style={styles.unreadDot} />}</View>
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

  return asTabItem ? (
    <TouchableOpacity style={styles.tabItemBtn} onPress={onPress || openScreen} activeOpacity={0.7}>
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
    <TouchableOpacity
      style={styles.bellBtn}
      onPress={openScreen}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={t('notifications.screenTitle')}
    >
      <Ionicons name="notifications-outline" size={rf(27)} color={colors.soil800} />
      {unread > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  // Shares its size with MessagesIcon's button so the pair sits evenly.
  // Last icon in the header: a small right margin keeps it off the edge.
  bellBtn: { width: 40, height: control.minTouch, alignItems: 'center', justifyContent: 'center', marginRight: 4 },

  // Full-screen variant (the dedicated Notifications screen)
  screenContainer: { flex: 1, minHeight: 0, backgroundColor: '#FFFFFF', width: '100%', maxWidth: 640, alignSelf: 'center' },
  // Centered under the header, low-key: small text, no fill, with room above the first card.
  screenActions: { alignItems: 'center', paddingTop: 12, paddingBottom: 6 },
  // Compact outlined action button (shared action-button style), centered by screenActions.
  markAllBtn: { ...actionBtn, ...actionBtnOutline },
  markAllText: { ...actionBtnText, color: PRIMARY },
  screenList: { flex: 1, minHeight: 0 },
  screenListContent: { padding: 16, paddingBottom: 24 },

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
    position: 'absolute', top: 3, right: -1, minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  badgeText: { fontFamily: fonts.bodyBold, color: '#fff', fontSize: rf(11) },

  // Each notification is its own card (same look and 10px gap as the Messages list).
  item: { flexDirection: 'row', alignItems: 'flex-start', padding: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, marginBottom: 10 },
  itemUnread: { backgroundColor: colors.leaf50, borderColor: colors.leaf100 },
  itemTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  itemTitle: { fontFamily: fonts.bodySemiBold, fontSize: rf(14.5), color: colors.ink, flex: 1, marginRight: 8 },
  itemTitleUnread: { fontFamily: fonts.bodyBold, color: colors.ink },
  itemTime: { fontFamily: fonts.body, fontSize: rf(12), color: colors.inkFaint },
  itemMessage: { fontFamily: fonts.body, fontSize: rf(13.5), color: colors.inkSoft, marginTop: 2 },
  // Fixed-width slot: reserved on every card so the time never shifts, dot or not.
  unreadSlot: { width: 8, marginLeft: 8, marginTop: 6, alignItems: 'center' },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: PRIMARY },

  detailMessage: { fontFamily: fonts.body, fontSize: rf(14.5), color: colors.ink, lineHeight: 21 },
  detailTime: { fontFamily: fonts.body, fontSize: rf(12.5), color: colors.inkFaint, marginTop: 10 },
});
