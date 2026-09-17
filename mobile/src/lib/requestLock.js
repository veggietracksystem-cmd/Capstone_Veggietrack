// Acquire synchronously, before React has rendered a disabled button.
export function createRequestLock() {
  const pending = new Set();
  return {
    acquire(key) {
      if (pending.has(key)) return false;
      pending.add(key);
      return true;
    },
    release(key) { pending.delete(key); },
  };
}
