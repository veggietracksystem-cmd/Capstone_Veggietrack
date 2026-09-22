import { rf } from '../../lib/responsive';
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '../../api/client';
import { friendlyError } from '../../lib/errorMessages';
import { useAuth } from '../../context/AuthContext';
import { isDeliveryPersonnel } from '../../lib/roles';
import { useTranslation } from '../../i18n/useTranslation';
import DeliveryTrackingMap from '../../components/DeliveryTrackingMap';
import ScreenHeader from '../../components/ScreenHeader';
import useDeliveryTracking from '../../hooks/useDeliveryTracking';
import useRiderLocation from '../../hooks/useRiderLocation';
import { coordinate, routePoints, routeProgress } from '../../lib/trackingGeometry';
import { colors, fonts, fontSize, radius } from '../../theme/appTheme';

export default function RiderNavigationScreen({ route, navigation }) {
  // Screen skips the bottom safe-area edge, so pad the scroll content instead.
  const insets = useSafeAreaInsets();
  const { orderId } = route.params || {};
  const { user } = useAuth(), { t } = useTranslation();
  const { data, loading, error, refresh } = useDeliveryTracking(orderId);
  const isAssigned = isDeliveryPersonnel(user) && data?.delivery_personnel_id === user?.id && !['delivered', 'cancelled'].includes(data?.status);
  const { position, error: gpsError, publish } = useRiderLocation(orderId, isAssigned);
  const [metrics, setMetrics] = useState(null), [actionError, setActionError] = useState(''), [opening, setOpening] = useState(false);
  const nav = data?.rider_view || {}, steps = nav.route_steps || [];
  const toHub = nav.navigation_phase === 'pickup' || (!nav.navigation_phase && !['picked_up', 'in_transit', 'delivered'].includes(data?.status));
  const target = nav.navigation_target || (toHub ? nav.pickup_location : nav.delivery_location);
  const points = useMemo(() => routePoints(nav.full_route), [nav.full_route]);
  const current = coordinate(position) || coordinate(nav.current_location);
  const progress = useMemo(() => routeProgress(points, current), [points, current?.latitude, current?.longitude]);
  // Advance by GPS progress along the current road route, not by elapsed time.
  const travelled = progress.total > 0 ? progress.travelled / progress.total * (Number(nav.distance_km) * 1000 || progress.total) : 0;
  let stepIndex = 0, passed = 0;
  while (stepIndex < steps.length - 1 && passed + (steps[stepIndex].distance || 0) <= travelled) passed += steps[stepIndex++].distance || 0;
  const currentStep = steps[stepIndex], nextStep = steps[stepIndex + 1], guidance = nextStep || currentStep;
  const turnDistance = currentStep ? Math.max(0, passed + (currentStep.distance || 0) - travelled) : null;
  const offRoute = progress.offRoute != null && progress.offRoute > 150;
  const openDetails = async () => {
    setOpening(true); setActionError('');
    try {
      const orders = await api.get('/api/delivery/orders');
      const order = orders.find(item => item.id === orderId);
      if (!order) throw new Error('Delivery could not be loaded. Return to your dashboard and refresh.');
      navigation.navigate('DeliveryDetails', { order });
    } catch (err) { setActionError(friendlyError(err)); } finally { setOpening(false); }
  };
  return <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
    <ScreenHeader title="Rider navigation" onBack={() => navigation.goBack()} />
    {loading && !data ? <ActivityIndicator style={{ padding: 30 }} color={colors.leaf700} /> : <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 24 + insets.bottom }]}>
      <View style={styles.instruction}>
        <Text style={styles.turn}>{metrics?.demo ? 'Demo playback • return to live for navigation' : !metrics?.live ? 'Waiting for fresh rider GPS' : offRoute ? 'Off route • waiting for updated road guidance' : guidance?.instruction || nav.navigation_error || 'Waiting for a road route'}</Text>
        {metrics?.live && !metrics?.demo && !offRoute && turnDistance != null && <Text style={styles.turnDistance}>In {turnDistance < 1000 ? `${Math.round(turnDistance)} m` : `${(turnDistance / 1000).toFixed(1)} km`}</Text>}
        <Text style={styles.destination}>To {toHub ? 'dispatch hub' : 'retailer'}: {target?.address || 'Address unavailable'}</Text>
      </View>
      <DeliveryTrackingMap mode="navigation" trackingData={data} riderPosition={position} onAcquirePosition={isAssigned ? next => publish(next, true) : undefined} onMetrics={setMetrics} style={styles.map} />
      {(error || gpsError) && <TouchableOpacity accessibilityRole="button" onPress={refresh}><Text style={styles.error}>{error || gpsError} Tap to refresh.</Text></TouchableOpacity>}
      <TouchableOpacity accessibilityRole="button" disabled={opening} style={styles.action} onPress={openDetails}><Text style={styles.actionText}>{opening ? 'Opening…' : 'Delivery details / mark delivered'}</Text></TouchableOpacity>
      {!!actionError && <Text style={styles.error}>{actionError}</Text>}
      <Text style={styles.note}>GPS sharing runs while this screen is active. Keep the app open for live tracking. Directions follow mapped roads and do not include live traffic.</Text>
    </ScrollView>}
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgScreen },
  content: { padding: 16, gap: 12, paddingBottom: 30 },
  instruction: { borderRadius: radius.card, padding: 16, backgroundColor: colors.leaf700 },
  turn: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.xl), color: '#fff' },
  turnDistance: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.h1), color: '#fff', marginTop: 6 },
  destination: { fontFamily: fonts.body, color: colors.leaf100, fontSize: rf(fontSize.sm), marginTop: 8 },
  map: { height: 510, flex: 0 },
  action: { padding: 16, backgroundColor: colors.leaf700, borderRadius: radius.ctrl, alignItems: 'center' },
  actionText: { fontFamily: fonts.bodyBold, color: '#fff', fontSize: rf(fontSize.md) },
  note: { fontFamily: fonts.body, fontSize: rf(fontSize.xs), color: colors.inkSoft },
  error: { fontFamily: fonts.bodyMedium, fontSize: rf(fontSize.sm), color: colors.gold700, padding: 10, backgroundColor: colors.gold100, borderRadius: radius.ctrl },
});
