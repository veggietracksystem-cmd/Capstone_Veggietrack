import { useEffect, useRef } from 'react';
import { useNavigation } from '@react-navigation/native';

// Keep mounted lists and their filters/scroll positions when returning to them.
// Initial loading remains owned by the screen.
export default function useRefreshOnFocus(refresh) {
  const navigation = useNavigation();
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => navigation.addListener('focus', () => {
    void latest.current();
  }), [navigation]);
}
