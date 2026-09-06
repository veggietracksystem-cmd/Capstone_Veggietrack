import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function useDeliveryTracking(orderId) {
  const focused = useIsFocused();
  const { user } = useAuth();
  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState(null);
  const generation = useRef(0), busy = useRef(false);
  const refresh = useCallback(async () => {
    if (!orderId || busy.current || !focused || AppState.currentState === 'background') return;
    const version = generation.current;
    busy.current = true;
    try { const next = await api.get(`/api/delivery/tracking/${encodeURIComponent(orderId)}`);
      if (version === generation.current) { setData(next); setError(null); }
    } catch (err) { if (version === generation.current) setError(err.message || 'Tracking unavailable'); }
    finally { if (version === generation.current) { busy.current = false; setLoading(false); } }
  }, [orderId, focused, user?.id, user?.role]);
  useEffect(() => {
    generation.current++; busy.current = false; setData(null); setLoading(!!orderId);
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => { generation.current++; busy.current = false; clearInterval(timer); };
  }, [refresh, orderId]);
  return { data, loading, error, refresh };
}
