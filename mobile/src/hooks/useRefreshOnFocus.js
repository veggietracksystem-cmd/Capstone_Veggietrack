import { useEffect, useRef } from 'react';
import { useNavigation } from '@react-navigation/native';

// Refreshes a mounted list when its screen regains focus, keeping filters and
// scroll position. Initial loading stays with the screen.
export default function useRefreshOnFocus(refresh) {
  const navigation = useNavigation();
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => navigation.addListener('focus', () => {
    void latest.current();
  }), [navigation]);
}
