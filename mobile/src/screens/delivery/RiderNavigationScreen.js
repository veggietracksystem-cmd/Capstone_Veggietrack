import { useState } from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../../api/client';
import { friendlyError } from '../../lib/errorMessages';
import { useAuth } from '../../context/AuthContext';
import { isDeliveryPersonnel } from '../../lib/roles';
import { isClosedOrderStatus } from '../../lib/orderStatus';
import { useTranslation } from '../../i18n/useTranslation';
import ScreenHeader from '../../components/ScreenHeader';
import RiderNavigationView, { navActionStyles } from '../../components/RiderNavigationView';
import useDeliveryTracking from '../../hooks/useDeliveryTracking';
import useRiderLocation from '../../hooks/useRiderLocation';
import { colors } from '../../theme/appTheme';

// Active delivery navigation: to the dispatch hub before pickup, then to the retailer.
export default function RiderNavigationScreen({ route, navigation }) {
  const { orderId } = route.params || {};
  const { user } = useAuth(), { t } = useTranslation();
  const { data, loading, error, refresh } = useDeliveryTracking(orderId);
  const isAssigned = isDeliveryPersonnel(user) && data?.delivery_personnel_id === user?.id && !isClosedOrderStatus(data?.status);
  // Live location is watched automatically and sent to the server; the rider never has to refresh it by hand.
  const { position, error: gpsError, refreshLocation } = useRiderLocation(orderId, isAssigned);
  const [actionError, setActionError] = useState(''), [opening, setOpening] = useState(false);

  const nav = data?.rider_view || {};
  const toWarehouse = nav.navigation_phase === 'pickup' || (!nav.navigation_phase && !['picked_up', 'in_transit', 'delivered'].includes(data?.status));
  const target = nav.navigation_target || (toWarehouse ? nav.pickup_location : nav.delivery_location);

  const openDetails = async () => {
    setOpening(true); setActionError('');
    try {
      const orders = await api.get('/api/delivery/orders');
      const order = orders.find(item => item.id === orderId);
      if (!order) throw new Error(t('cmp2.deliveryLoadFail'));
      navigation.navigate('DeliveryDetails', { order });
    } catch (err) { setActionError(friendlyError(err)); } finally { setOpening(false); }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScreenHeader title={t('cmp.riderNav')} onBack={() => navigation.goBack()} />
      <RiderNavigationView tracking={data} loading={loading} trackingError={error} onRetryRoute={refresh}
        position={position} gpsError={gpsError} onRetryGps={() => refreshLocation().catch(() => {})}
        target={target} targetKind={toWarehouse ? 'hub' : 'shop'}
        destinationLabel={t(toWarehouse ? 'nav.toWarehouse' : 'nav.toRetailer')} arrivedHint={t('nav.arrivedHint')}
        onBack={() => navigation.goBack()}>
        {({ arrived }) => (
          <>
            {!!actionError && <Text style={navActionStyles.error}>{actionError}</Text>}
            <TouchableOpacity accessibilityRole="button" disabled={opening} activeOpacity={0.85}
              style={[navActionStyles.action, arrived && navActionStyles.actionPrimary]} onPress={openDetails}>
              <Text style={[navActionStyles.actionText, arrived && navActionStyles.actionTextPrimary]}>{opening ? t('nav.opening') : t('nav.openDetails')}</Text>
            </TouchableOpacity>
          </>
        )}
      </RiderNavigationView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgScreen },
});
