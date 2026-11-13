import { useCallback, useRef } from 'react';
import { useFocusEffect } from 'expo-router';

// Runs `refresh` each time the screen comes back into focus — never on the
// first focus, when the screen's own first read is already on its way.
// The browse screens use it so Back from a title shows the Continue
// Watching row and "Continue S1 E3" the viewer just made.
export function useRefreshOnReturn(refresh) {
  const ref = useRef(refresh);
  ref.current = refresh;
  const seen = useRef(false);
  useFocusEffect(useCallback(() => {
    if (!seen.current) { seen.current = true; return; }
    if (ref.current) ref.current();
  }, []));
}
