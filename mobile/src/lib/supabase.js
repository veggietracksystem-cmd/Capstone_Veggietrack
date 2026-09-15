import { createClient, processLock } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
// Supabase alone creates/refreshes sessions. Native credentials use secure storage.
const storage = {
  getItem: key => Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.getItem(key) || null) : SecureStore.getItemAsync(key),
  setItem: (key,value) => Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.setItem(key,value)) : SecureStore.setItemAsync(key,value),
  removeItem: key => Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.removeItem(key)) : SecureStore.deleteItemAsync(key),
};
export const authConfigured = !!(process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
const storageKey = 'veggietrack.supabase.auth';
export const clearStoredSession = () => storage.removeItem(storageKey);
export const supabase = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://unconfigured.supabase.co', process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'unconfigured', {
  auth: { storage, storageKey, persistSession:true, autoRefreshToken:true, detectSessionInUrl:false, lock:processLock },
});
