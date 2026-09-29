import { createClient, processLock } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
// Supabase alone creates/refreshes sessions. Native credentials use secure storage.
const rawStorage = {
  getItem: key => Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.getItem(key) || null) : SecureStore.getItemAsync(key),
  setItem: (key,value) => Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.setItem(key,value)) : SecureStore.setItemAsync(key,value),
  removeItem: key => Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.removeItem(key)) : SecureStore.deleteItemAsync(key),
};

// "Keep me signed in": when on, the session persists across restarts until logout;
// when off, it is kept only in memory (sessionStorage on web). Only the session
// token is stored, never the password.
const KEEP_KEY = 'veggietrack.keepSignedIn';
let keepSignedIn = true;
const keepReady = rawStorage.getItem(KEEP_KEY).then(v => { keepSignedIn = v !== '0'; }).catch(() => {});
const memory = new Map();
const tempGet = key => Platform.OS === 'web' ? (globalThis.sessionStorage?.getItem(key) ?? null) : (memory.get(key) ?? null);
const tempSet = (key,value) => { if (Platform.OS === 'web') globalThis.sessionStorage?.setItem(key,value); else memory.set(key,value); };
const tempRemove = key => { if (Platform.OS === 'web') globalThis.sessionStorage?.removeItem(key); else memory.delete(key); };

const storage = {
  getItem: async key => { await keepReady; return tempGet(key) ?? rawStorage.getItem(key); },
  setItem: async (key,value) => {
    await keepReady;
    if (keepSignedIn) { tempRemove(key); return rawStorage.setItem(key,value); }
    tempSet(key,value);
    return rawStorage.removeItem(key);
  },
  removeItem: async key => { tempRemove(key); return rawStorage.removeItem(key); },
};

// Called by the Log in screen before signing in. Turning it off also drops any
// stored session so the next app start requires a fresh login.
export async function setKeepSignedIn(keep) {
  await keepReady;
  keepSignedIn = !!keep;
  await rawStorage.setItem(KEEP_KEY, keep ? '1' : '0');
  if (!keep) await rawStorage.removeItem(storageKey);
}
export const authConfigured = !!(process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
const storageKey = 'veggietrack.supabase.auth';
export const clearStoredSession = () => storage.removeItem(storageKey);
export const supabase = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://unconfigured.supabase.co', process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'unconfigured', {
  auth: { storage, storageKey, persistSession:true, autoRefreshToken:true, detectSessionInUrl:Platform.OS==='web', flowType:'pkce', lock:processLock },
});
