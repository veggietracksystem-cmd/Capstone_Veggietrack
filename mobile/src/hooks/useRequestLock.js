import { useRef } from 'react';
import { createRequestLock } from '../lib/requestLock';

export default function useRequestLock() {
  const lock = useRef(null);
  if (!lock.current) lock.current = createRequestLock();
  return lock.current;
}
