import { useState, useEffect, useCallback, useRef } from 'react';
import { Image, Text, View, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import api from '../api/client';
import { colors, control, fonts } from '../theme/appTheme';
import { rf } from '../lib/responsive';
import { useTranslation } from '../i18n/useTranslation';

// Custom chat icon (two speech bubbles); a transparent PNG tinted to the
// header icon colour so it matches NotificationBell.
const CHAT_ICON = require('../../assets/chat-icon.png');

const POLL_MS = 30000; // matches NotificationBell's unread-count poll interval

// Header icon placed beside NotificationBell (Distributor/Retailer/Delivery).
// Farmer instead has an embedded "Messages" bottom tab, so it doesn't use this.
export default function MessagesIcon() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const [unread, setUnread] = useState(0);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const data = await api.get('/api/messages/unread-count');
      if (mounted.current) setUnread(data?.count || 0);
    } catch {
      // silent on background poll
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, [load]);

  return (
    <TouchableOpacity
      style={styles.iconBtn}
      onPress={() => navigation.navigate('Messages')}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={t('messages.title')}
    >
      <Image source={CHAT_ICON} style={styles.icon} resizeMode="contain" accessibilityIgnoresInvertColors />
      {unread > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  // Shares its size with NotificationBell's button so the pair sits evenly.
  iconBtn: { width: 40, height: control.minTouch, alignItems: 'center', justifyContent: 'center' },
  icon: { width: rf(26), height: rf(26), tintColor: colors.soil800 },
  badge: {
    position: 'absolute', top: 3, right: -1, minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  badgeText: { fontFamily: fonts.bodyBold, color: '#fff', fontSize: rf(11) },
});
