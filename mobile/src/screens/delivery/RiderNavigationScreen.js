import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useTranslation } from '../../i18n/useTranslation';
import DeliveryTrackingMap from '../../components/DeliveryTrackingMap';
import useDeliveryTracking from '../../hooks/useDeliveryTracking';
import useRiderLocation from '../../hooks/useRiderLocation';
import { coordinate, routePoints, routeProgress } from '../../lib/trackingGeometry';

export default function RiderNavigationScreen({ route, navigation }) {
  const { orderId } = route.params || {};
  const { user } = useAuth(), { t } = useTranslation();
  const { data, loading, error, refresh } = useDeliveryTracking(orderId);
  const isAssigned = user?.role === 'delivery_personnel' && data?.delivery_personnel_id === user?.id && !['delivered', 'cancelled'].includes(data?.status);
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
    } catch (err) { setActionError(err.message); } finally { setOpening(false); }
  };
  return <SafeAreaView style={styles.container}>
    <View style={styles.header}><TouchableOpacity accessibilityRole="button" onPress={() => navigation.goBack()}><Text style={styles.back}>‹ {t('common.back')}</Text></TouchableOpacity><Text style={styles.title}>Rider navigation</Text></View>
    {loading && !data ? <ActivityIndicator style={{ padding: 30 }} color="#218258" /> : <ScrollView contentContainerStyle={styles.content}>
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
  container: { flex: 1, backgroundColor: '#f2f6f0' }, header: { padding: 16, flexDirection: 'row', gap: 16, alignItems: 'center', backgroundColor: '#fff' },
  back: { color: '#245636', fontSize: 16 }, title: { color: '#245636', fontWeight: '700', fontSize: 18 }, content: { padding: 12, gap: 10, paddingBottom: 30 },
  instruction: { borderRadius: 12, padding: 16, backgroundColor: '#245636' }, turn: { fontSize: 19, fontWeight: '700', color: '#fff' },
  turnDistance: { fontSize: 22, color: '#fff', marginTop: 6 }, destination: { color: '#d6e7d8', fontSize: 12, marginTop: 8 }, map: { height: 510, flex: 0 },
  action: { padding: 16, backgroundColor: '#245636', borderRadius: 10, alignItems: 'center' }, actionText: { color: '#fff', fontWeight: '700' },
  note: { fontSize: 11, color: '#66746b' }, error: { color: '#85530b', padding: 10, backgroundColor: '#fff3da' },
});
