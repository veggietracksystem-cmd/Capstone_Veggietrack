import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as Location from 'expo-location';
import { useIsFocused } from '@react-navigation/native';
import api from '../api/client';
import { friendlyError } from '../lib/errorMessages';
import { locationSample, isRecentSample } from '../lib/locationSamples';
import { acquireDevicePosition } from '../lib/deviceLocation';
import { tr } from '../i18n/translate';

const LOCATION_FALLBACK = 'We can’t find your location. Please check that location access is turned on.';
// Without a first fix by then, say so and offer Try again instead of spinning.
const FIRST_FIX_TIMEOUT_MS = 20000;
// Fixes are requested on a timer, not on movement: the server treats a rider
// location older than 60 s as not live and then stops returning the route, so a
// rider who has stopped (traffic, at the farm) must keep reporting.
const WATCH_OPTIONS = { timeInterval: 5000, distanceInterval: 0 };

// onFirstShare runs after the first location is saved on the server, so the
// screen can fetch the route at once instead of waiting for its next poll.
export default function useRiderLocation(orderId, enabled, { onFirstShare } = {}) {
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState !== 'background');
  const [position, setPosition] = useState(null), [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const lastSent = useRef(0), sending = useRef(null), alive = useRef(true);
  const generation = useRef(0), latestSample = useRef(null), refreshPromise = useRef(null);
  const shared = useRef(false), firstShare = useRef(onFirstShare);
  firstShare.current = onFirstShare;
  // A watch that stopped (permission denied, unsupported) is restarted by the next
  // successful manual refresh, so live updates resume once location is allowed.
  const watchStopped = useRef(false), [watchRun, setWatchRun] = useState(0);
  useEffect(() => {
    alive.current = true;
    const sub = AppState.addEventListener('change', state => setActive(state === 'active'));
    return () => { alive.current = false; sub.remove(); };
  }, []);
  useEffect(() => {
    generation.current++;
    setPosition(null); setError(''); setRefreshing(false); lastSent.current = 0; latestSample.current = null;
    refreshPromise.current = null; shared.current = false;
    return () => { generation.current++; sending.current?.controller.abort(); sending.current = null; };
  }, [orderId, enabled, focused, active]);
  const publish = useCallback(async (next, force = false) => {
    const sample = locationSample(next);
    if (!isRecentSample(sample) || !enabled || !focused || !active || !alive.current) return false;
    if (latestSample.current && sample.timestamp < latestSample.current.timestamp) return false;
    latestSample.current = sample;
    setPosition(sample);
    // A late first fix clears the "unable to get your location" message.
    setError(current => (current === tr('nav.gpsTimeout') ? '' : current));
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
      if (alive.current && version === generation.current) {
        setError('');
        if (!shared.current) { shared.current = true; firstShare.current?.(); }
      }
      return true;
    } catch (err) {
      if (controller.signal.aborted || version !== generation.current) return false;
      if (alive.current) setError(`Your location couldn’t be shared. ${friendlyError(err)}`);
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
      if (watchStopped.current) { watchStopped.current = false; setWatchRun(run => run + 1); }
      if (shouldPublish) await publish(next, true);
      return next;
    }).catch(err => {
      if (alive.current && version === generation.current) setError(friendlyError(err));
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
    watchStopped.current = false;
    const receive = location => {
      if (cancelled) return;
      const sample = locationSample(location);
      if (sample) publish(sample);
    };
    // Browser GeolocationPositionError carries a numeric code and raw English
    // text; show the same translated wording the rest of the app uses.
    const fail = (err, stopped = true) => {
      if (cancelled) return;
      if (stopped) watchStopped.current = true;
      if (Platform.OS === 'web' && typeof err?.code === 'number') setError(err.code === 1 ? tr('misc.gpsDenied') : LOCATION_FALLBACK);
      else setError(friendlyError(err, LOCATION_FALLBACK));
    };
    (async () => {
      try {
        if (Platform.OS === 'web') {
          if (!globalThis.navigator?.geolocation) throw new Error('Sharing your location isn’t supported in this browser.');
          // Only a permission denial ends a browser watch; timeouts keep it running.
          browserWatch = navigator.geolocation.watchPosition(receive, err => fail(err, err?.code === 1), { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
        } else {
          const permission = await Location.requestForegroundPermissionsAsync();
          if (cancelled) return;
          if (permission.status !== 'granted') throw new Error(tr('nav.locationOff'));
          subscription = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, ...WATCH_OPTIONS }, receive);
          if (cancelled) subscription.remove();
        }
      } catch (err) { fail(err); }
    })();
    // The watch keeps running; this only replaces "Finding your location" with a retry.
    const firstFix = setTimeout(() => {
      if (!cancelled && !latestSample.current) setError(tr('nav.gpsTimeout'));
    }, FIRST_FIX_TIMEOUT_MS);
    return () => {
      cancelled = true; clearTimeout(firstFix);
      subscription?.remove(); if (browserWatch != null) navigator.geolocation.clearWatch(browserWatch);
    };
  }, [enabled, focused, active, publish, watchRun]);
  return { position, error, publish, refreshLocation, refreshing };
}
