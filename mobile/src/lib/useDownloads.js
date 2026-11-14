import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { canPlay, downloadLogic, getDownloadsState, subscribe } from './downloads';

// The screens' view of the downloads manager (mobile/src/lib/downloads.js).
// Nothing here asks the network or Clerk: it is the index and the files,
// which is what lets the Downloads page and the offline player work with
// no connection.

// Everything: { supported, hidden, items, byId, count, notices, missing,
// index, net, offline, session, activeId }.
export function useDownloads() {
  return useSyncExternalStore(subscribe, getDownloadsState, getDownloadsState);
}

// One title's copy on this phone, or null.
export function useDownload(episodeId) {
  const state = useDownloads();
  return episodeId ? state.byId[episodeId] || null : null;
}

// How many titles this phone holds (the Watch menu's count).
export function useDownloadCount() {
  return useDownloads().count;
}

// Each row with its standing — `now` moves once a minute, so a copy whose
// date passes while the page is open locks without a tap.
export function useDownloadRows() {
  const state = useDownloads();
  const [minute, setMinute] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setMinute((m) => m + 1), 60000);
    return () => clearInterval(t);
  }, []);
  // The clock is looked at again each minute and whenever the store changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => Date.now(), [minute, state.version]);
  const rows = useMemo(() => {
    const offline = state.offline;
    const wifiBlocked = !offline && state.index.wifiOnly !== false && state.net.known && !state.net.wifi;
    return state.items.map((item) => ({ item, status: downloadLogic.rowStatus(state.index, item, { now, missing: state.missing.get(item.episodeId) === true, offline, wifiBlocked }) }));
  }, [state, now]);
  return { state, rows, now };
}

// "May this copy play": asked when the screen opens, once a minute while it
// is open, and whenever the store changes (a check-in, a removal).
export function usePlayCheck(episodeId) {
  const state = useDownloads();
  const [verdict, setVerdict] = useState(() => (episodeId ? canPlay(episodeId) : { ok: false, reason: 'nothere' }));
  useEffect(() => {
    if (!episodeId) return undefined;
    const ask = () => setVerdict((prev) => {
      const next = canPlay(episodeId);
      return prev.ok === next.ok && prev.reason === next.reason ? prev : next;
    });
    ask();
    const t = setInterval(ask, 60000);
    return () => clearInterval(t);
  }, [episodeId, state.version]);
  return verdict;
}
