import { useCallback, useEffect, useRef, useState } from 'react';

const MIN_LENGTH = 3;
const DEBOUNCE_MS = 400;

export default function usePlaceAutocomplete(visible) {
  const apiKey = process.env.EXPO_PUBLIC_GEOAPIFY_API_KEY?.trim();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [error, setError] = useState('');
  const version = useRef(0);
  const timer = useRef(null);
  const controller = useRef(null);
  const active = useRef(visible);
  const queryRef = useRef('');

  const cancel = useCallback(() => {
    version.current += 1;
    clearTimeout(timer.current);
    controller.current?.abort();
    controller.current = null;
  }, []);

  useEffect(() => {
    active.current = visible;
    cancel();
    queryRef.current = '';
    setQuery('');
    setResults([]);
    setSearching(false);
    setShowResults(false);
    setError('');
    return () => { active.current = false; cancel(); };
  }, [visible, cancel]);

  const search = useCallback(async (text, requestVersion) => {
    if (!active.current || requestVersion !== version.current) return;
    const abortController = new AbortController();
    controller.current = abortController;
    const isCurrent = () => active.current && requestVersion === version.current;
    // Bound a stalled provider request without changing any map/pin state.
    const timeout = setTimeout(() => abortController.abort(), 10000);
    try {
      const response = await fetch(
        `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(text)}&filter=countrycode:ph&limit=5&format=json&apiKey=${encodeURIComponent(apiKey)}`,
        { signal: abortController.signal }
      );
      if (!isCurrent()) return;
      if (!response.ok) {
        setError(response.status === 429
          ? 'Location search limit reached. Try again later or pin on the map.'
          : 'Location search is unavailable. Please try again or pin on the map.');
        return;
      }
      const data = await response.json();
      if (!isCurrent()) return;
      if (!Array.isArray(data.results)) throw new Error('Invalid search response');
      // Adapt only search results to the existing picker selection contract.
      setResults(data.results.filter(item => (
        Number.isFinite(item.lat) && Number.isFinite(item.lon)
        && Math.abs(item.lat) <= 90 && Math.abs(item.lon) <= 180
        && item.country_code?.toLowerCase() === 'ph'
        && (item.formatted || item.name)
      )).slice(0, 5).map(item => ({
        place_id: item.place_id,
        lat: item.lat,
        lon: item.lon,
        display_name: item.formatted || item.name,
      })));
    } catch {
      if (isCurrent()) setError('Location search is unavailable. Please try again or pin on the map.');
    } finally {
      clearTimeout(timeout);
      if (isCurrent()) {
        controller.current = null;
        setSearching(false);
      }
    }
  }, [apiKey]);

  const changeQuery = useCallback((text) => {
    // Invalidate immediately, before the next debounce or React render.
    cancel();
    queryRef.current = text;
    setQuery(text);
    setResults([]);
    setError('');
    setSearching(false);
    const eligible = active.current && text.trim().length >= MIN_LENGTH && Boolean(apiKey);
    setShowResults(eligible);
    if (!eligible) return;
    setSearching(true);
    const requestVersion = version.current;
    timer.current = setTimeout(() => search(text.trim(), requestVersion), DEBOUNCE_MS);
  }, [apiKey, cancel, search]);

  const selectResult = useCallback((item) => {
    cancel();
    queryRef.current = item.display_name;
    setQuery(item.display_name);
    setResults([]);
    setSearching(false);
    setShowResults(false);
    setError('');
  }, [cancel]);

  return {
    query, results, searching, showResults, error, configured: Boolean(apiKey),
    changeQuery, selectResult,
    retry: () => changeQuery(queryRef.current),
  };
}
