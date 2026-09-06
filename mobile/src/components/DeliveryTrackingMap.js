import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, ActivityIndicator } from 'react-native';
import * as Location from 'expo-location';
import DeliveryMapFrame from './DeliveryMapFrame';
import { formatEta } from '../lib/formatEta';
import { coordinate, routePoints, routeLength, routeProgress, positionAlong } from '../lib/trackingGeometry';

export async function acquireDevicePosition() {
  if (Platform.OS === 'web') {
    if (!globalThis.navigator?.geolocation) throw new Error('This browser does not support GPS.');
    return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
      position => resolve({ ...coordinate(position.coords), accuracy: position.coords.accuracy, timestamp: position.timestamp }),
      error => reject(new Error(error.code === 1 ? 'Location permission denied. Enable it in your browser settings.' : 'GPS unavailable. Try again outdoors.')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    ));
  }
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== 'granted') throw new Error('Location permission denied. Enable it in your device settings.');
  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return { ...coordinate(position.coords), accuracy: position.coords.accuracy, timestamp: position.timestamp };
}

const numberOrNull = value => value != null && Number.isFinite(Number(value)) ? Number(value) : null;

// A display component: only an explicit onAcquirePosition callback can publish real GPS.
// Simulation never calls that callback and never makes an API mutation.
export default function DeliveryTrackingMap({ trackingData, riderPosition, onAcquirePosition, onMetrics, mode = 'tracking', style }) {
  const view = trackingData?.retailer_view || {};
  const nav = trackingData?.rider_view || {};
  const pickup = view.pickup || nav.pickup_location || {};
  const delivery = view.delivery || nav.delivery_location || {};
  const rider = view.rider || {};
  const origin = { ...pickup, ...coordinate(pickup), name: pickup.name || 'Central Laguna Vegetable Hub' };
  const destination = { ...delivery, ...coordinate(delivery), name: delivery.name || 'Retailer destination' };
  const phase = nav.navigation_phase || (['picked_up', 'in_transit', 'delivered'].includes(trackingData?.status) ? 'delivery' : 'pickup');
  const navigationTarget = nav.navigation_target || (phase === 'pickup' ? origin : destination);
  const actualRider = coordinate(riderPosition) || coordinate(rider) || coordinate(nav.current_location);
  const geometry = mode === 'navigation' ? nav.full_route : view.tracking?.route;
  const points = useMemo(() => routePoints(geometry), [geometry]);
  const length = useMemo(() => routeLength(points), [points]);
  const [demo, setDemo] = useState(false), [demoMetres, setDemoMetres] = useState(0);
  const [autoRecenter, setAutoRecenter] = useState(true), [fitToken, setFitToken] = useState(0);
  const [viewer, setViewer] = useState(null), [viewerToken, setViewerToken] = useState(0);
  const [gpsBusy, setGpsBusy] = useState(false), [gpsFeedback, setGpsFeedback] = useState('');
  const [mapError, setMapError] = useState(''), [mapReady, setMapReady] = useState(false), [retry, setRetry] = useState(0);
  const [now, setNow] = useState(Date.now());
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(id); }, []);
  useEffect(() => { setDemo(false); setDemoMetres(0); setViewer(null); setGpsFeedback(''); }, [trackingData?.order_id]);
  useEffect(() => {
    if (mode === 'navigation') { setDemo(false); setDemoMetres(0); setAutoRecenter(true); setFitToken(value => value + 1); }
  }, [mode, phase]);
  useEffect(() => {
    if (!demo || length <= 0) return undefined;
    // Accelerated demonstration: roughly two minutes for a full corridor.
    const id = setInterval(() => setDemoMetres(value => Math.min(length, value + Math.max(4, length / 240))), 500);
    return () => clearInterval(id);
  }, [demo, length]);
  const shownRider = demo ? positionAlong(points, demoMetres) : actualRider;
  const progress = useMemo(() => routeProgress(points, shownRider), [points, shownRider?.latitude, shownRider?.longitude]);
  const updated = riderPosition?.timestamp || rider.last_updated;
  const age = updated ? Math.max(0, (now - new Date(updated).getTime()) / 1000) : Infinity;
  const ended = ['delivered', 'cancelled'].includes(trackingData?.status);
  const live = !ended && !!actualRider && Number.isFinite(age) && age <= 60;
  const offRoute = !demo && progress.offRoute != null && progress.offRoute > 150;
  const duration = numberOrNull(mode === 'navigation' ? nav.eta_seconds : view.tracking?.eta_seconds);
  const ratio = progress.total > 0 ? progress.remaining / progress.total : 1;
  const remainingKm = points.length > 1 && shownRider && !offRoute ? progress.remaining / 1000 : null;
  const etaSeconds = remainingKm != null && duration != null ? duration * ratio : null;
  const label = demo ? 'DEMO • not live GPS' : ended ? String(trackingData.status).replace(/_/g, ' ') :
    live ? 'LIVE GPS' : actualRider ? 'Last known location' : 'Waiting for rider GPS';
  const accuracy = demo ? null : numberOrNull(riderPosition?.accuracy ?? rider.accuracy);
  useEffect(() => { onMetrics?.({ distanceKm: remainingKm, etaSeconds, demo, offRoute, live }); }, [remainingKm, etaSeconds, demo, offRoute, live, onMetrics]);
  const data = {
    origin, destination, rider: { ...shownRider, name: rider.name || 'Delivery rider', live: live || demo, label, accuracy },
    viewer, viewerToken, route: points, completed: offRoute ? [] : progress.completed,
    focusPoints: mode === 'navigation' ? [shownRider, navigationTarget] : undefined,
    autoRecenter, fitToken, tileConfig: trackingData?.map_config, riderEmoji: mode === 'tracking' ? '🚛' : '🛵',
  };
  const acquire = async () => {
    setGpsBusy(true); setGpsFeedback('Acquiring GPS…');
    try {
      const position = await acquireDevicePosition();
      if (!mounted.current) return;
      setViewer(position); setViewerToken(v => v + 1);
      setGpsFeedback(`Your GPS: ${position.latitude.toFixed(5)}, ${position.longitude.toFixed(5)}${position.accuracy != null ? ` • ±${Math.round(position.accuracy)} m` : ''}`);
      if (onAcquirePosition) {
        const sent = await onAcquirePosition(position);
        if (mounted.current && sent) setGpsFeedback(value => `${value} • sent to delivery tracking`);
      }
    } catch (error) { if (mounted.current) setGpsFeedback(error.message || 'Could not acquire location.'); }
    finally { if (mounted.current) setGpsBusy(false); }
  };
  return <View style={[styles.container, style]}>
    <View style={styles.status}>
      <View style={[styles.dot, { backgroundColor: demo ? '#a7660b' : live ? '#218258' : '#808b84' }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.riderName} numberOfLines={1}>🛵 {rider.name || 'Delivery rider'} · {label}</Text>
        <Text style={styles.detail}>{shownRider ? `${shownRider.latitude.toFixed(5)}, ${shownRider.longitude.toFixed(5)}` : 'Location not yet available'}
          {accuracy != null && accuracy >= 0 ? `  ±${Math.round(accuracy)} m` : ''}</Text>
      </View>
    </View>
    <View style={styles.map}>
      <DeliveryMapFrame key={retry} data={data} onEvent={event => {
        if (event.type === 'ready') { setMapReady(true); setMapError(''); }
        if (event.type === 'error') { setMapReady(true); setMapError(event.message); }
        if (event.type === 'manual-pan') setAutoRecenter(false);
      }} />
      {!mapReady && <View pointerEvents="none" style={styles.loading}><ActivityIndicator color="#218258" /><Text>Loading map…</Text></View>}
    </View>
    <View style={styles.metrics}>
      <Text style={styles.metric}>{remainingKm != null ? `${remainingKm.toFixed(2)} km remaining` : points.length > 1 ? `${(length / 1000).toFixed(2)} km route` : 'Road route unavailable'}</Text>
      <Text style={styles.metric}>{etaSeconds != null ? `ETA ≈ ${formatEta(etaSeconds)}` : 'ETA unavailable'}</Text>
    </View>
    <Text style={styles.hint}>{demo ? 'Demo playback only • return to live to see actual GPS.' : offRoute ? 'Rider is outside the route corridor. ETA is unavailable.' : 'Road estimate • no live traffic. GPS updates while the rider screen is open.'}</Text>
    {mode === 'navigation' ? (!!nav.navigation_error && <Text style={styles.warning}>{nav.navigation_error}</Text>) : <>
      {!coordinate(origin) && <Text style={styles.warning}>Dispatch hub has no saved map pin. Update the distributor warehouse location.</Text>}
      {!coordinate(destination) && <Text style={styles.warning}>Destination has no saved map pin. Pin the delivery address to calculate a road route.</Text>}
      {!!view.tracking?.route_error && <Text style={styles.warning}>{view.tracking.route_error}</Text>}
    </>}
    <View style={styles.controls}>
      <TouchableOpacity accessibilityRole="button" disabled={gpsBusy} style={styles.button} onPress={acquire}>
        <Text style={styles.buttonText}>{gpsBusy ? 'Acquiring…' : Platform.OS === 'web' ? 'Acquire Browser GPS' : 'Acquire Device GPS'}</Text>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" disabled={points.length < 2} style={[styles.button, points.length < 2 && styles.disabled]} onPress={() => { setDemo(v => !v); setDemoMetres(0); setAutoRecenter(true); }}>
        <Text style={styles.buttonText}>{demo ? 'Return to live' : 'Simulate Road Movement'}</Text>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" accessibilityState={{ selected: autoRecenter }} style={styles.button}
        onPress={() => { setAutoRecenter(v => !v); setFitToken(v => v + 1); }}>
        <Text style={styles.buttonText}>Auto-recenter: {autoRecenter ? 'on' : 'off'}</Text>
      </TouchableOpacity>
    </View>
    {!!gpsFeedback && <Text accessibilityLiveRegion="polite" style={styles.feedback}>{gpsFeedback}</Text>}
    {!!mapError && <TouchableOpacity accessibilityRole="button" onPress={() => { setRetry(v => v + 1); setMapError(''); setMapReady(false); }}><Text style={styles.warning}>{mapError} Tap to retry.</Text></TouchableOpacity>}
  </View>;
}
const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 390, backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 10, backgroundColor: '#eff6ef' },
  dot: { width: 8, height: 8, borderRadius: 4 }, riderName: { fontSize: 12, fontWeight: '700', color: '#234d35' },
  detail: { fontSize: 11, color: '#4a6050', marginTop: 3 }, map: { flex: 1, minHeight: 220 },
  loading: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: '#eff5ef' },
  metrics: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', paddingHorizontal: 10, paddingTop: 8, gap: 4 },
  metric: { fontSize: 12, fontWeight: '700', color: '#234d35' }, hint: { fontSize: 10, color: '#627368', paddingHorizontal: 10, paddingVertical: 4 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 8 },
  button: { paddingHorizontal: 9, paddingVertical: 10, borderRadius: 7, backgroundColor: '#e8f2e8' },
  buttonText: { fontSize: 11, fontWeight: '600', color: '#245636' }, disabled: { opacity: .4 },
  feedback: { padding: 8, fontSize: 11, color: '#245636' }, warning: { padding: 8, fontSize: 11, color: '#85530b', backgroundColor: '#fff5e5' },
});
