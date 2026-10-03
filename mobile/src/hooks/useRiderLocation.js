import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as Location from 'expo-location';
import { useIsFocused } from '@react-navigation/native';
import api from '../api/client';
import { friendlyError } from '../lib/errorMessages';
import { locationSample, isRecentSample } from '../lib/locationSamples';
import { acquireDevicePosition } from '../lib/deviceLocation';
import { tr } from '../i18n/translate';

// Without a first fix by then, say so and offer Reload GPS instead of spinning.
const FIRST_FIX_TIMEOUT_MS = 20000;
// Fixes are requested on a timer, not on movement: the server treats a rider
// location older than 60 s as not live and then stops returning the route, so a
// rider who has stopped (traffic, at the farm) must keep reporting.
const WATCH_OPTIONS = { timeInterval: 5000, distanceInterval: 0 };
// A position the phone already knows is shown (marked approximate) while the
// first fresh fix is found. It is never uploaded: the server needs a fresh fix.
const LAST_KNOWN_MAX_AGE_MS = 5 * 60000;

// Rider-facing wording for a failed location request.
function locationMessage(err) {
  if (err?.code === 'GPS_INACCURATE') return tr('nav.gpsInaccurate');
  if (['LOCATION_PERMISSION_DENIED', 'LOCATION_SERVICES_DISABLED'].includes(err?.code)) return friendlyError(err, tr('nav.gpsTimeout'));
  return tr('nav.gpsTimeout');
}

/**
 * Live GPS for rider navigation (deliveries and farm pickups). One position
 * watch runs while the screen is focused and the app is in the foreground; it
 * is removed when either stops and replaced (never added to) by reloadGps.
 * onFirstShare runs after the first location is saved on the server, so the
 * screen can fetch the route at once instead of waiting for its next poll.
 */
export default function useRiderLocation(orderId, enabled, { onFirstShare } = {}) {
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState !== 'background');
  const [position, setPosition] = useState(null), [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const lastSent = useRef(0), sending = useRef(null), alive = useRef(true);
  const generation = useRef(0), latestSample = useRef(null), refreshPromise = useRef(null);
  const shared = useRef(false), firstShare = useRef(onFirstShare);
  firstShare.current = onFirstShare;
  // Bumping watchRun replaces the watch (the effect removes the old one first).
  const [watchRun, setWatchRun] = useState(0);
  useEffect(() => {
    alive.current = true;
    const sub = AppState.addEventListener('change', state => setActive(state === 'active'));
    return () => { alive.current = false; sub.remove(); };
  }, []);
  // A different delivery or pickup starts from nothing. Leaving the screen or the
  // app (home button, a Messenger chat head) keeps the last position, so coming
  // back shows the rider at once instead of "Finding your location" again.
  useEffect(() => {
    generation.current++;
    setPosition(null); setError(''); setRefreshing(false); lastSent.current = 0; latestSample.current = null;
    refreshPromise.current = null; shared.current = false;
    return () => { generation.current++; };
  }, [orderId, enabled]);
  // Pausing only cancels an upload in flight; nothing is uploaded while paused.
  useEffect(() => () => { sending.current?.controller.abort(); sending.current = null; }, [orderId, enabled, focused, active]);
  const publish = useCallback(async (next, force = false) => {
    const sample = locationSample(next);
    if (!isRecentSample(sample) || !enabled || !focused || !active || !alive.current) return false;
    if (latestSample.current && sample.timestamp < latestSample.current.timestamp) return false;
    latestSample.current = sample;
    setPosition(sample);
    // A fresh fix clears an earlier "unable to get your location" message.
    setError(current => ([tr('nav.gpsTimeout'), tr('nav.gpsInaccurate')].includes(current) ? '' : current));
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
      if (alive.current) setError(tr('nav.shareProblem'));
      if (force) throw err;
      return false;
    } finally { if (sending.current === request) sending.current = null; }
  }, [orderId, enabled, focused, active]);
  // One fresh, accurate fix (bounded by acquireDevicePosition's own timeout).
  // A second call while one is running returns the same request.
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
      if (alive.current && version === generation.current) setError(locationMessage(err));
      throw err;
    }).finally(() => {
      if (refreshPromise.current === operation) refreshPromise.current = null;
      if (alive.current && version === generation.current) setRefreshing(false);
    });
    refreshPromise.current = operation;
    return operation;
  }, [publish]);
  // Reload GPS: replace the watch (in case it stalled) and ask for one fresh fix.
  const reloadGps = useCallback(() => {
    setWatchRun(run => run + 1);
    return refreshLocation();
  }, [refreshLocation]);
  useEffect(() => {
    if (!enabled || !focused || !active) return undefined;
    let cancelled = false, subscription, browserWatch;
    const receive = location => {
      if (cancelled) return;
      const sample = locationSample(location);
      if (sample) publish(sample);
    };
    const fail = err => { if (!cancelled) setError(locationMessage(err)); };
    (async () => {
      try {
        if (Platform.OS === 'web') {
          if (!globalThis.navigator?.geolocation) throw new Error(tr('nav.gpsTimeout'));
          // Only a permission denial ends a browser watch; timeouts keep it running.
          browserWatch = navigator.geolocation.watchPosition(receive,
            err => fail(err?.code === 1 ? Object.assign(new Error(tr('misc.gpsDenied')), { code: 'LOCATION_PERMISSION_DENIED' }) : err),
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
          return;
        }
        const permission = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (permission.status !== 'granted') throw Object.assign(new Error(tr('nav.locationOff')), { code: 'LOCATION_PERMISSION_DENIED' });
        if (!await Location.hasServicesEnabledAsync()) throw Object.assign(new Error(tr('nav.gpsOff')), { code: 'LOCATION_SERVICES_DISABLED' });
        if (cancelled) return;
        if (!latestSample.current) {
          Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS }).then(last => {
            const sample = locationSample(last);
            if (!cancelled && sample && !latestSample.current) setPosition({ ...sample, approximate: true });
          }).catch(() => {});
        }
        const watch = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, ...WATCH_OPTIONS }, receive, () => fail(null));
        if (cancelled) watch.remove(); else subscription = watch;
      } catch (err) { fail(err); }
    })();
    // The watch keeps running; this only replaces "Finding your location" with Reload GPS.
    const firstFix = setTimeout(() => {
      if (!cancelled && !latestSample.current) setError(current => current || tr('nav.gpsTimeout'));
    }, FIRST_FIX_TIMEOUT_MS);
    return () => {
      cancelled = true; clearTimeout(firstFix);
      subscription?.remove(); if (browserWatch != null) navigator.geolocation.clearWatch(browserWatch);
    };
  }, [enabled, focused, active, publish, watchRun]);
  return { position, error, publish, refreshLocation, reloadGps, refreshing };
}
