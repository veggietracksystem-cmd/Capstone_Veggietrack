import { Platform } from 'react-native';

// Persistent key/value store: SQLite (expo-sqlite) on native, AsyncStorage on web.
// Used by the offline layer (offline/harvestStore.js) for caches and queues.

let nativeDbPromise = null;

async function getNativeDb() {
  if (!nativeDbPromise) {
    nativeDbPromise = (async () => {
      const SQLite = require('expo-sqlite');
      const db = await SQLite.openDatabaseAsync('veggietrack.db');
      await db.execAsync(
        'CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT);'
      );
      return db;
    })();
  }
  return nativeDbPromise;
}

function getAsyncStorage() {
  return require('@react-native-async-storage/async-storage').default;
}

export async function kvGet(key) {
  try {
    if (Platform.OS === 'web') {
      const raw = await getAsyncStorage().getItem(`vt:${key}`);
      return raw ? JSON.parse(raw) : null;
    }
    const db = await getNativeDb();
    const row = await db.getFirstAsync('SELECT value FROM kv WHERE key = ?', [key]);
    return row && row.value ? JSON.parse(row.value) : null;
  } catch (err) {
    console.warn('[offline] kvGet failed:', key, err);
    return null;
  }
}

export async function kvSet(key, value) {
  const json = JSON.stringify(value);
  try {
    if (Platform.OS === 'web') {
      await getAsyncStorage().setItem(`vt:${key}`, json);
      return;
    }
    const db = await getNativeDb();
    await db.runAsync(
      'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, json]
    );
  } catch (err) {
    console.warn('[offline] kvSet failed:', key, err);
  }
}

// Clears all offline caches and queues on logout. Auth data is stored separately.
export async function clearAll() {
  try {
    if (Platform.OS === 'web') {
      const AsyncStorage = getAsyncStorage();
      const keys = await AsyncStorage.getAllKeys();
      const vtKeys = keys.filter((k) => k.startsWith('vt:'));
      if (vtKeys.length) await AsyncStorage.multiRemove(vtKeys);
      return;
    }
    const db = await getNativeDb();
    await db.runAsync('DELETE FROM kv');
  } catch (err) {
    console.warn('[offline] clearAll failed:', err);
  }
}
