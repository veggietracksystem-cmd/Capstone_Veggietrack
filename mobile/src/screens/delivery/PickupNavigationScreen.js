import { rf } from '../../lib/responsive';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../context/AuthContext';
import { isDeliveryPersonnel } from '../../lib/roles';
import { useTranslation } from '../../i18n/useTranslation';
import { localizeVegetableName } from '../../lib/vegetableNames';
import ScreenHeader from '../../components/ScreenHeader';
import RiderNavigationView, { navActionStyles } from '../../components/RiderNavigationView';
import usePickupTracking from '../../hooks/usePickupTracking';
import useRiderLocation from '../../hooks/useRiderLocation';
import { colors, fonts, fontSize } from '../../theme/appTheme';

// Farm pickup navigation: same map, GPS and turn-by-turn guidance as delivery
// navigation, heading to the farmer's pinned farm location. Pickup confirmation
// (photo and GPS proof) stays on the rider dashboard.
export default function PickupNavigationScreen({ route, navigation }) {
  const { pickupId, pickup } = route.params || {};
  const { user } = useAuth(), { t, language } = useTranslation();
  const { data, loading, error, refresh } = usePickupTracking(pickupId);
  const isAssigned = isDeliveryPersonnel(user) && data?.delivery_personnel_id === user?.id && ['assigned', 'otw'].includes(data?.status);
  // Pickups are not orders, so the position is shared without a delivery_id.
  const { position, error: gpsError, reloadGps, refreshing: reloadingGps } = useRiderLocation(null, isAssigned, { onFirstShare: refresh });
  const target = data?.rider_view?.navigation_target;
  const harvest = pickup?.harvests;
  const summary = [pickup?.farmer_name, harvest && `${localizeVegetableName(harvest.vegetable_name, language)} · ${harvest.quantity_kg} kg`].filter(Boolean).join(' · ');

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScreenHeader title={t('nav.pickupTitle')} onBack={() => navigation.goBack()} />
      <RiderNavigationView tracking={data} loading={loading} trackingError={error} onRetryRoute={refresh}
        position={position} gpsError={gpsError} onReloadGps={reloadGps} reloadingGps={reloadingGps}
        target={target} targetKind="farm" destinationLabel={t('nav.toFarm')} arrivedHint={t('nav.arrivedPickupHint')}
        onBack={() => navigation.goBack()}>
        {({ arrived }) => (
          <>
            {!!summary && <Text style={styles.summary} numberOfLines={2}>{summary}</Text>}
            <TouchableOpacity accessibilityRole="button" activeOpacity={0.85}
              style={[navActionStyles.action, arrived && navActionStyles.actionPrimary]} onPress={() => navigation.goBack()}>
              <Text style={[navActionStyles.actionText, arrived && navActionStyles.actionTextPrimary]}>{t('nav.backToPickup')}</Text>
            </TouchableOpacity>
          </>
        )}
      </RiderNavigationView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgScreen },
  summary: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), color: colors.ink, textAlign: 'center' },
});
