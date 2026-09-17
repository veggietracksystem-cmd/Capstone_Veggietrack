import { useCallback, useEffect, useRef } from 'react';

// A late refresh must not replace the result of a newer refresh.
export default function useLatestRequest() {
  const versions = useRef({});
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; versions.current = {}; };
  }, []);
  return useCallback((key) => {
    const ticket = Symbol(key);
    versions.current[key] = ticket;
    return () => mounted.current && versions.current[key] === ticket;
  }, []);
}
