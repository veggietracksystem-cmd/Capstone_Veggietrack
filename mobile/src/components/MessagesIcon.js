import { useState, useEffect, useCallback, useRef } from 'react';
import { Text, View, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import api from '../api/client';
import { colors, fonts } from '../theme/appTheme';
import { rf } from '../lib/responsive';

const POLL_MS = 30000; // matches NotificationBell's unread-count poll interval

// Header icon placed beside NotificationBell (Distributor/Retailer/Delivery).
// Farmer instead has an embedded "Messages" bottom tab, so it doesn't use this.
export default function MessagesIcon() {
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
    >
      <Ionicons name="mail-outline" size={rf(20)} color={colors.soil800} />
      {unread > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  iconBtn: { padding: 6, marginRight: 4 },
  badge: {
    position: 'absolute', top: 0, right: 0, minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  badgeText: { fontFamily: fonts.bodyBold, color: '#fff', fontSize: rf(11) },
});
