import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenHeader from '../components/ScreenHeader';
import NotificationBell from '../components/NotificationBell';
import { useTranslation } from '../i18n/useTranslation';

// Dedicated Notifications screen (pushed from the header bell, like Messages).
// It is a stack screen, so the dashboards' bottom nav is not rendered here.
export default function NotificationsScreen({ navigation }) {
  const { t } = useTranslation();

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScreenHeader title={t('notifications.screenTitle')} onBack={() => navigation.goBack()} />
      <View style={styles.body}>
        <NotificationBell fullScreen />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF', minHeight: 0 },
  body: { flex: 1, minHeight: 0 },
});
