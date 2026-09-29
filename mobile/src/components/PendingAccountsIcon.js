import { useState, useEffect, useCallback, useRef } from 'react';
import { Text, View, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import api from '../api/client';
import useRefreshOnFocus from '../hooks/useRefreshOnFocus';
import { colors, control, fonts } from '../theme/appTheme';
import { rf } from '../lib/responsive';
import { useTranslation } from '../i18n/useTranslation';

const POLL_MS = 30000; // matches NotificationBell/MessagesIcon

// Distributor header icon for User Management, with a badge counting accounts
// awaiting a decision.
export default function PendingAccountsIcon() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const [pending, setPending] = useState(0);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const rows = await api.get('/api/accounts?status=pending_approval');
      if (mounted.current) setPending(Array.isArray(rows) ? rows.length : 0);
    } catch {
      // Background poll failures are ignored.
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

  // Refresh on focus so an approval clears the badge immediately.
  useRefreshOnFocus(load);

  return (
    <TouchableOpacity
      style={styles.iconBtn}
      onPress={() => navigation.navigate('AccountManagement')}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={pending > 0 ? t('misc.userMgmtPending', { n: pending }) : t('misc.userMgmt')}
    >
      <Ionicons name="people-outline" size={rf(24)} color={colors.soil800} />
      {pending > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{pending > 9 ? '9+' : pending}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  iconBtn: { width: control.minTouch, height: control.minTouch, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute', top: 3, right: 2, minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  badgeText: { fontFamily: fonts.bodyBold, color: '#fff', fontSize: rf(11) },
});
