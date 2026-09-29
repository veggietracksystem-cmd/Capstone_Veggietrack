import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { syncPending } from '../offline/harvestStore';
import { useAuth } from '../context/AuthContext';

// Central coordinator for app-wide data refresh. Screens register readers instead
// of creating their own listeners or polling timers.
const SyncContext = createContext({ register: () => () => {}, refresh: async () => {} });
const REVALIDATE_MS = 30_000;

function online(state) {
  return state.isConnected !== false && state.isInternetReachable !== false;
}

export function SyncProvider({ children }) {
  const { session } = useAuth();
  const signedIn = Boolean(session);
  const readers = useRef(new Map());
  const running = useRef(null);
  const wasOnline = useRef(null);
  const appState = useRef(AppState.currentState);
  const [syncState, setSyncState] = useState('synced');

  const refresh = useCallback(async ({ replayPending = false } = {}) => {
    if (!signedIn) return;
    // Coalesce reconnect, foreground, timer and focus races into one pass.
    if (running.current) return running.current;
    running.current = (async () => {
      try {
        setSyncState(replayPending ? 'syncing' : 'refreshing');
        if (replayPending) await syncPending();
        await Promise.allSettled([...readers.current.values()].map((read) => read()));
        setSyncState('synced');
      } catch {
        // Readers fall back to their caches; only the sync state is marked offline.
        setSyncState('offline');
      } finally {
        running.current = null;
      }
    })();
    return running.current;
  }, [signedIn]);

  const register = useCallback((key, reader) => {
    readers.current.set(key, reader);
    return () => readers.current.delete(key);
  }, []);

  useEffect(() => {
    if (!signedIn) return undefined;
    const applyNetwork = (state) => {
      const nowOnline = online(state);
      const restored = wasOnline.current === false && nowOnline;
      wasOnline.current = nowOnline;
      setSyncState(nowOnline ? 'synced' : 'offline');
      if (restored) void refresh({ replayPending: true });
    };
    NetInfo.fetch().then(applyNetwork).catch(() => {});
    const unsubscribe = NetInfo.addEventListener(applyNetwork);
    const appSubscription = AppState.addEventListener('change', (next) => {
      const resumed = appState.current !== 'active' && next === 'active';
      appState.current = next;
      if (resumed) {
        NetInfo.fetch().then((state) => {
          applyNetwork(state);
          if (online(state)) void refresh({ replayPending: true });
        }).catch(() => void refresh());
      }
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active' && wasOnline.current !== false) void refresh();
    }, REVALIDATE_MS);
    return () => { unsubscribe(); appSubscription.remove(); clearInterval(timer); };
  }, [signedIn, refresh]);

  return <SyncContext.Provider value={{ register, refresh, syncState }}>{children}</SyncContext.Provider>;
}

// `reader` is kept in a ref so a re-created callback does not re-register.
export function useAutoSync(key, reader) {
  const { register, refresh, syncState } = useContext(SyncContext);
  const latest = useRef(reader);
  latest.current = reader;
  useEffect(() => register(key, () => latest.current()), [key, register]);
  return { refresh, syncState };
}
