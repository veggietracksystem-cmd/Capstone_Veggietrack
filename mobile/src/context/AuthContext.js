import { createContext, useContext, useState, useEffect } from 'react';
import { Platform } from 'react-native';
import { setAuthToken, setUnauthorizedHandler, setTokenRefreshedHandler } from '../api/client';
import { clearAll } from '../offline/db';

// Cross-platform secure storage: expo-secure-store on native (throws on web),
// localStorage on web. Imported lazily so the web bundle never loads SecureStore.
async function storageGet(key) {
  if (Platform.OS === 'web') return window.localStorage.getItem(key);
  const SecureStore = require('expo-secure-store');
  return SecureStore.getItemAsync(key);
}

async function storageSet(key, value) {
  if (Platform.OS === 'web') {
    window.localStorage.setItem(key, value);
    return;
  }
  const SecureStore = require('expo-secure-store');
  await SecureStore.setItemAsync(key, value);
}

async function storageDelete(key) {
  if (Platform.OS === 'web') {
    window.localStorage.removeItem(key);
    return;
  }
  const SecureStore = require('expo-secure-store');
  await SecureStore.deleteItemAsync(key);
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true); // true until startup restore finishes

  // Keep the API client's token in sync with context state.
  useEffect(() => {
    setAuthToken(token);
  }, [token]);

  // If any request returns 401, the token is dead → sign out.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setAuthToken(null);
      setToken(null);
      setUser(null);
      storageDelete('token');
      storageDelete('user');
      clearAll(); // drop cached offline data for the signed-out user
    });
  }, []);

  // Update context state when a silent token refresh occurs in the API client.
  useEffect(() => {
    setTokenRefreshedHandler((newToken) => {
      setToken(newToken);
    });
  }, []);


  // Restore a saved session on app start.
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const savedToken = await storageGet('token');
        const savedUserJson = await storageGet('user');

        if (savedToken && savedUserJson && mounted) {
          // Set the client token imperatively BEFORE state, so any child
          // screen that mounts on the next render already has a valid token.
          // (React runs child effects before the parent's token-sync effect.)
          setAuthToken(savedToken);
          setToken(savedToken);
          setUser(JSON.parse(savedUserJson));
        }
      } catch (err) {
        console.warn('[Auth] Failed to restore session:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const signIn = async (newToken, newUser) => {
    // Set the client token imperatively first so the dashboard that mounts
    // right after this render can fetch immediately (avoids "No token provided").
    setAuthToken(newToken);
    setToken(newToken);
    setUser(newUser);
    await storageSet('token', newToken);
    await storageSet('user', JSON.stringify(newUser));
  };

  // Merge partial updates into the current user and persist them, so profile
  // edits survive an app restart without forcing a re-login.
  const updateUser = async (updates) => {
    const merged = { ...user, ...updates };
    setUser(merged);
    await storageSet('user', JSON.stringify(merged));
  };

  const signOut = async () => {
    setAuthToken(null);
    setToken(null);
    setUser(null);
    await storageDelete('token');
    await storageDelete('user');
    await clearAll(); // wipe cached harvests/products/orders/queues
  };

  return (
    <AuthContext.Provider value={{ token, user, loading, signIn, signOut, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

// Convenience hook used throughout the app.
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside an <AuthProvider>');
  return ctx;
}
