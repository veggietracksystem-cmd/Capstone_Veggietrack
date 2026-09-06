import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as Location from 'expo-location';
import { useIsFocused } from '@react-navigation/native';
import api from '../api/client';
import { coordinate } from '../lib/trackingGeometry';

export default function useRiderLocation(orderId, enabled) {
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState !== 'background');
  const [position, setPosition] = useState(null), [error, setError] = useState('');
  const lastSent = useRef(0), sending = useRef(false), alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const sub = AppState.addEventListener('change', state => setActive(state === 'active'));
    return () => { alive.current = false; sub.remove(); };
  }, []);
  useEffect(() => { setPosition(null); setError(''); lastSent.current = 0; }, [orderId, enabled]);
  const publish = useCallback(async (next, force = false) => {
    if (!coordinate(next) || !enabled || !focused || !active || !alive.current) return false;
    setPosition(next);
    if (sending.current || (!force && Date.now() - lastSent.current < 5000)) return false;
    sending.current = true;
    try {
      await api.post('/api/delivery/update-location', { latitude: next.latitude, longitude: next.longitude,
        accuracy: next.accuracy, delivery_id: orderId });
      lastSent.current = Date.now();
      if (alive.current) setError('');
      return true;
    } catch (err) { if (alive.current) setError(`GPS not shared: ${err.message}`); if (force) throw err; }
    finally { sending.current = false; }
  }, [orderId, enabled, focused, active]);
  useEffect(() => {
    if (!enabled || !focused || !active) return undefined;
    let cancelled = false, subscription, browserWatch;
    const receive = location => {
      if (cancelled) return;
      const coords = coordinate(location.coords);
      if (coords) publish({ ...coords, accuracy: location.coords.accuracy, timestamp: location.timestamp || Date.now() });
    };
    const fail = err => { if (!cancelled) setError(err.message || 'GPS unavailable. Check location permission.'); };
    (async () => {
      try {
        if (Platform.OS === 'web') {
          if (!globalThis.navigator?.geolocation) throw new Error('GPS requires a supported browser on HTTPS.');
          browserWatch = navigator.geolocation.watchPosition(receive, fail, { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
        } else {
          const permission = await Location.requestForegroundPermissionsAsync();
          if (cancelled) return;
          if (permission.status !== 'granted') throw new Error('Enable location permission to share rider GPS.');
          subscription = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 5 }, receive);
          if (cancelled) subscription.remove();
        }
      } catch (err) { fail(err); }
    })();
    return () => { cancelled = true; subscription?.remove(); if (browserWatch != null) navigator.geolocation.clearWatch(browserWatch); };
  }, [enabled, focused, active, publish]);
  return { position, error, publish };
}
