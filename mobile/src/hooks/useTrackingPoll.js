import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import api from '../api/client';
import { friendlyError } from '../lib/errorMessages';
import { useAuth } from '../context/AuthContext';

// Polls a tracking endpoint every 5 s while the screen is focused and the app is
// in the foreground, with request de-duplication. Shared by delivery and pickup
// tracking so both refresh the map the same way. A null path disables polling.
export default function useTrackingPoll(path) {
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
    if (!path || !focused || !active) return;
    if (pending.current) return pending.current.promise;
    const version = generation.current;
    const request = { controller: new AbortController(), promise: null };
    pending.current = request;
    request.promise = (async () => {
    try { const next = await api.get(path, { signal: request.controller.signal });
      if (version === generation.current) { setData(next); setError(null); }
    } catch (err) { if (version === generation.current && !request.controller.signal.aborted) setError(friendlyError(err, 'We can’t load the tracking right now.')); }
    finally {
      if (pending.current === request) pending.current = null;
      if (version === generation.current) setLoading(false);
    }
    })();
    return request.promise;
  }, [path, focused, active, user?.id, user?.role]);
  useEffect(() => {
    setData(null); setLoading(!!path); setError(null);
  }, [path, user?.id, user?.role]);
  useEffect(() => {
    generation.current++;
    if (!focused || !active || !path) return undefined;
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      generation.current++;
      pending.current?.controller.abort(); pending.current = null;
      clearInterval(timer);
    };
  }, [refresh, path, focused, active]);
  return { data, loading, error, refresh };
}
