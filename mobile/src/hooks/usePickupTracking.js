import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import api from '../api/client';
import { friendlyError } from '../lib/errorMessages';
import { useAuth } from '../context/AuthContext';

// Mirrors useDeliveryTracking.js exactly (focus/AppState-aware polling, one
// timer, request de-duplication/abort) against the pickup-request tracking
// endpoint instead of the order one — kept as a separate small hook rather
// than parameterizing the delivery hook so the live retailer tracking screen
// is never at risk from a pickup-specific change.
export default function usePickupTracking(pickupId) {
  const focused = useIsFocused();
  const { user } = useAuth();
  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState(null);
  const [active, setActive] = useState(AppState.currentState !== 'background');
  const generation = useRef(0), pending = useRef(null);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setActive(state === 'active'));
    return () => subscription.remove();
  }, []);
  const refresh = useCallback(async () => {
    if (!pickupId || !focused || !active) return;
    if (pending.current) return pending.current.promise;
    const version = generation.current;
    const request = { controller: new AbortController(), promise: null };
    pending.current = request;
    request.promise = (async () => {
    try { const next = await api.get(`/api/pickup-requests/${encodeURIComponent(pickupId)}/tracking`, { signal: request.controller.signal });
      if (version === generation.current) { setData(next); setError(null); }
    } catch (err) { if (version === generation.current && !request.controller.signal.aborted) setError(friendlyError(err, 'We can’t load the tracking right now.')); }
    finally {
      if (pending.current === request) pending.current = null;
      if (version === generation.current) setLoading(false);
    }
    })();
    return request.promise;
  }, [pickupId, focused, active, user?.id, user?.role]);
  useEffect(() => {
    setData(null); setLoading(!!pickupId); setError(null);
  }, [pickupId, user?.id, user?.role]);
  useEffect(() => {
    generation.current++;
    if (!focused || !active || !pickupId) return undefined;
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      generation.current++;
      pending.current?.controller.abort(); pending.current = null;
      clearInterval(timer);
    };
  }, [refresh, pickupId, focused, active]);
  return { data, loading, error, refresh };
}
