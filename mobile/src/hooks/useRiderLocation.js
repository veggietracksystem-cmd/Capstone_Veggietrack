import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as Location from 'expo-location';
import { useIsFocused } from '@react-navigation/native';
import api from '../api/client';
import { locationSample, isRecentSample } from '../lib/locationSamples';
import { acquireDevicePosition } from '../lib/deviceLocation';

export default function useRiderLocation(orderId, enabled) {
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState !== 'background');
  const [position, setPosition] = useState(null), [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const lastSent = useRef(0), sending = useRef(null), alive = useRef(true);
  const generation = useRef(0), latestSample = useRef(null), refreshPromise = useRef(null);
  useEffect(() => {
    alive.current = true;
    const sub = AppState.addEventListener('change', state => setActive(state === 'active'));
    return () => { alive.current = false; sub.remove(); };
  }, []);
  useEffect(() => {
    generation.current++;
    setPosition(null); setError(''); setRefreshing(false); lastSent.current = 0; latestSample.current = null;
    refreshPromise.current = null;
    return () => { generation.current++; sending.current?.controller.abort(); sending.current = null; };
  }, [orderId, enabled, focused, active]);
  const publish = useCallback(async (next, force = false) => {
    const sample = locationSample(next);
    if (!isRecentSample(sample) || !enabled || !focused || !active || !alive.current) return false;
    if (latestSample.current && sample.timestamp < latestSample.current.timestamp) return false;
    latestSample.current = sample;
    setPosition(sample);
    const version = generation.current;
    if (sending.current) return false;
    if (!force && Date.now() - lastSent.current < 5000) return false;
    const controller = new AbortController();
    const request = { controller, promise: null };
    sending.current = request;
    lastSent.current = Date.now();
    try {
      request.promise = api.post('/api/delivery/update-location', { latitude: sample.latitude, longitude: sample.longitude,
        accuracy: sample.accuracy, captured_at: new Date(sample.timestamp).toISOString(), delivery_id: orderId }, { signal: controller.signal });
      await request.promise;
      if (alive.current && version === generation.current) setError('');
      return true;
    } catch (err) {
      if (controller.signal.aborted || version !== generation.current) return false;
      if (alive.current) setError(`GPS not shared: ${err.message}`);
      if (force) throw err;
      return false;
    } finally { if (sending.current === request) sending.current = null; }
  }, [orderId, enabled, focused, active]);
  const refreshLocation = useCallback(({ publish: shouldPublish = true } = {}) => {
    if (refreshPromise.current) return refreshPromise.current;
    const version = generation.current;
    setRefreshing(true);
    const operation = acquireDevicePosition().then(async next => {
      if (!alive.current || version !== generation.current) return next;
      if (!latestSample.current || next.timestamp >= latestSample.current.timestamp) {
        latestSample.current = next; setPosition(next);
      }
      setError('');
      if (shouldPublish) await publish(next, true);
      return next;
    }).catch(err => {
      if (alive.current && version === generation.current) setError(err.message);
      throw err;
    }).finally(() => {
      if (refreshPromise.current === operation) refreshPromise.current = null;
      if (alive.current && version === generation.current) setRefreshing(false);
    });
    refreshPromise.current = operation;
    return operation;
  }, [publish]);
  useEffect(() => {
    if (!enabled || !focused || !active) return undefined;
    let cancelled = false, subscription, browserWatch;
    const receive = location => {
      if (cancelled) return;
      const sample = locationSample(location);
      if (sample) publish(sample);
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
  return { position, error, publish, refreshLocation, refreshing };
}
