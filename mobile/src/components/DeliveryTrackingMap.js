import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, ActivityIndicator } from 'react-native';
import DeliveryMapFrame from './DeliveryMapFrame';
import { formatEta } from '../lib/formatEta';
import { coordinate, routePoints, routeLength, routeProgress, positionAlong } from '../lib/trackingGeometry';
import { acquireDevicePosition } from '../lib/deviceLocation';
import { activeJourney, isLivePosition, liveEtaSeconds } from '../lib/trackingJourney';

export { acquireDevicePosition } from '../lib/deviceLocation';

const numberOrNull = value => value != null && Number.isFinite(Number(value)) ? Number(value) : null;

// A display component: only an explicit onAcquirePosition callback can publish real GPS.
// Simulation never calls that callback and never makes an API mutation.
export default function DeliveryTrackingMap({ trackingData, riderPosition, onAcquirePosition, onMetrics, mode = 'tracking', style }) {
  const view = trackingData?.retailer_view || {};
  const nav = trackingData?.rider_view || {};
  const journey = activeJourney(trackingData, mode);
  const pickup = journey.pickup;
  const delivery = journey.delivery;
  const rider = view.rider || {};
  const origin = { ...pickup, ...coordinate(pickup), name: pickup.name || 'Central Laguna Vegetable Hub' };
  const destination = { ...delivery, ...coordinate(delivery), name: delivery.name || 'Retailer destination' };
  const phase = journey.phase;
  const navigationTarget = journey.target;
  const actualPosition = coordinate(riderPosition) ? riderPosition : coordinate(rider) ? rider : nav.current_location;
  const actualRider = coordinate(actualPosition);
  const geometry = journey.route || (mode === 'tracking' ? journey.estimatedRoute : null);
  const points = useMemo(() => routePoints(geometry), [geometry]);
  const length = useMemo(() => routeLength(points), [points]);
  const [demo, setDemo] = useState(false), [demoMetres, setDemoMetres] = useState(0);
  const [autoRecenter, setAutoRecenter] = useState(true), [fitToken, setFitToken] = useState(0);
  const [viewer, setViewer] = useState(null), [viewerToken, setViewerToken] = useState(0);
  const [gpsBusy, setGpsBusy] = useState(false), [gpsFeedback, setGpsFeedback] = useState('');
  const [mapError, setMapError] = useState(''), [mapReady, setMapReady] = useState(false), [retry, setRetry] = useState(0);
  const [now, setNow] = useState(Date.now());
  const mounted = useRef(true), acquiring = useRef(false), acquisitionGeneration = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(id); }, []);
  useEffect(() => {
    acquisitionGeneration.current++;
    setDemo(false); setDemoMetres(0); setViewer(null); setGpsFeedback(''); setGpsBusy(false); acquiring.current = false;
  }, [trackingData?.order_id]);
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
  const ended = ['delivered', 'cancelled'].includes(trackingData?.status);
  const live = !ended && isLivePosition(actualPosition, now);
  const offRoute = !!journey.route && !demo && progress.offRoute != null && progress.offRoute > 150;
  const remainingKm = (journey.route || demo) && points.length > 1 && shownRider && !offRoute ? progress.remaining / 1000 : null;
  const etaSeconds = liveEtaSeconds(journey, { live, ended, offRoute, demo });
  const label = demo ? 'DEMO • not live GPS' : ended ? String(trackingData.status).replace(/_/g, ' ') :
    live ? 'LIVE GPS' : actualRider ? 'Last known location' : 'Waiting for rider GPS';
  const accuracy = demo ? null : numberOrNull(actualPosition?.accuracy);
  useEffect(() => { onMetrics?.({ distanceKm: remainingKm, etaSeconds, demo, offRoute, live }); }, [remainingKm, etaSeconds, demo, offRoute, live, onMetrics]);
  const data = {
    origin, destination, rider: { ...shownRider, name: rider.name || 'Delivery rider', live: live || demo, label, accuracy },
    viewer, viewerToken, route: points, completed: offRoute ? [] : progress.completed,
    // Once the rider has picked up the order, the retailer's map is a
    // destination view: rider -> retailer, never the earlier warehouse leg.
    focusPoints: mode === 'navigation' ? [shownRider, navigationTarget] : phase === 'delivery' ? [shownRider, destination] : undefined,
    autoRecenter, fitToken, tileConfig: trackingData?.map_config,
  };
  const acquire = async () => {
    if (acquiring.current) return;
    acquiring.current = true;
    const version = acquisitionGeneration.current;
    setGpsBusy(true); setGpsFeedback('Acquiring GPS…');
    try {
      const position = await acquireDevicePosition();
      if (!mounted.current || version !== acquisitionGeneration.current) return;
      setViewer(position); setViewerToken(v => v + 1);
      setGpsFeedback(`Your location: ${position.latitude.toFixed(5)}, ${position.longitude.toFixed(5)}${position.accuracy != null ? ` • ±${Math.round(position.accuracy)} m` : ''}`);
      if (onAcquirePosition) {
        const sent = await onAcquirePosition(position);
        if (mounted.current && version === acquisitionGeneration.current && sent) setGpsFeedback(value => `${value} • sent to delivery tracking`);
      }
    } catch (error) { if (mounted.current && version === acquisitionGeneration.current) setGpsFeedback('We couldn’t get your location. Please turn on location and try again.'); }
    finally { if (mounted.current && version === acquisitionGeneration.current) { setGpsBusy(false); acquiring.current = false; } }
  };
  return <View style={[styles.container, style]}>
    <View style={styles.status}>
      <View style={[styles.dot, { backgroundColor: demo ? '#a7660b' : live ? '#218258' : '#808b84' }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.riderName} numberOfLines={1}>{rider.name || 'Delivery rider'} · {label}</Text>
        <Text style={styles.detail}>{shownRider ? `${shownRider.latitude.toFixed(5)}, ${shownRider.longitude.toFixed(5)}` : 'Location not available yet'}
          {accuracy != null && accuracy >= 0 ? `  ±${Math.round(accuracy)} m` : ''}</Text>
      </View>
    </View>
    <View style={styles.map}>
      <DeliveryMapFrame key={retry} data={data} onEvent={event => {
        if (event.type === 'ready') { setMapReady(true); setMapError(''); }
        if (event.type === 'error') { setMapReady(true); setMapError(event.message); }
        if (event.type === 'manual-pan') setAutoRecenter(false);
      }} />
      {!mapReady && <View style={[styles.loading, { pointerEvents: 'none' }]}><ActivityIndicator color="#218258" /><Text>Loading map…</Text></View>}
    </View>
    <View style={styles.metrics}>
      <Text style={styles.metric}>{remainingKm != null ? `${remainingKm.toFixed(2)} km remaining` : points.length > 1 ? `${(length / 1000).toFixed(2)} km route` : 'Road route unavailable'}</Text>
      <Text style={styles.metric}>{etaSeconds != null ? `LIVE ETA: ${formatEta(etaSeconds)}` : 'ETA unavailable'}</Text>
    </View>
    <Text style={styles.hint}>{demo ? 'Practice mode. Switch back to live to see the real location.' : offRoute ? 'The rider is off the planned route, so we can’t estimate the arrival time.' : `On the way to the ${phase === 'pickup' ? 'dispatch hub' : 'shop'}. Arrival time is an estimate.`}</Text>
    {mode === 'navigation' ? (!!nav.navigation_error && <Text style={styles.warning}>{nav.navigation_error}</Text>) : <>
      {!coordinate(origin) && <Text style={styles.warning}>Dispatch hub has no saved map pin. Update the distributor warehouse location.</Text>}
      {!coordinate(destination) && <Text style={styles.warning}>We don’t have a location for this delivery yet. Please contact the distributor.</Text>}
      {!!view.tracking?.route_error && <Text style={styles.warning}>{view.tracking.route_error}</Text>}
    </>}
    <View style={styles.controls}>
      <TouchableOpacity accessibilityRole="button" disabled={gpsBusy} style={styles.button} onPress={acquire}>
        <Text style={styles.buttonText}>{gpsBusy ? 'Acquiring…' : onAcquirePosition ? 'Refresh Location' : Platform.OS === 'web' ? 'Acquire Browser GPS' : 'Acquire Device GPS'}</Text>
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
