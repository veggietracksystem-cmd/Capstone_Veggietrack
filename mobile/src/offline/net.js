import NetInfo from '@react-native-community/netinfo';

// Shared connectivity helpers used by the offline stores.
export async function isOnline() {
  try {
    const state = await NetInfo.fetch();
    return state.isConnected !== false && state.isInternetReachable !== false;
  } catch {
    return true; // assume online if we can't tell
  }
}

// Calls cb() whenever the device transitions to online.
export function onReconnect(cb) {
  return NetInfo.addEventListener((state) => {
    if (state.isConnected && state.isInternetReachable !== false) cb();
  });
}
