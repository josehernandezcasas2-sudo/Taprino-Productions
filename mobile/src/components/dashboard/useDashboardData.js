import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { showCall } from '../../lib/showApi';

// The Dashboard's six reads (mockups/creator-dashboard-contract.md §2): the
// creator routes that already exist, each with its own gate, each answer
// kept on its own so a section draws the moment its route answers and one
// that refuses or fails never holds the others back.
//
//   subs     GET /api/creator/my-submissions   → { submissions }
//   shows    GET /api/show?mine=1              → { shows }
//   drafts   GET /api/creator/drafts           → { drafts }
//   mine     GET /api/payees/mine              → { invites, paidFor }
//   money    GET /api/creator/money?period=    (with its `dashboard` block)
//   numbers  GET /api/creator/analytics?days=30&compare=1
//
// A box is { state, data }: 'loading' | 'ok' | 'refused' (401 / 403: this
// account has no such thing, e.g. a sub-admin who is not a creator) |
// 'failed' (anything else; what was on screen stays). Nothing refused is
// ever handed on as zeros: its data is null.
//
// Everything is read when the screen comes into focus (the first time and
// each time it is returned to). A new month asks the money route only, and
// starts it empty. `enabled` false (signed out, or not someone who has a
// Dashboard) asks nothing and forgets what the last account showed.
const PATHS = {
  subs: () => '/api/creator/my-submissions',
  shows: () => '/api/show?mine=1',
  drafts: () => '/api/creator/drafts',
  mine: () => '/api/payees/mine',
  money: (period) => `/api/creator/money${period ? `?period=${encodeURIComponent(period)}` : ''}`,
  numbers: () => '/api/creator/analytics?days=30&compare=1'
};
const KEYS = Object.keys(PATHS);
const LOADING = { state: 'loading', data: null };
const fresh = () => Object.fromEntries(KEYS.map((key) => [key, LOADING]));

export function useDashboardData({ enabled, getToken, period = null }) {
  const [boxes, setBoxes] = useState(fresh);
  // key → the number of its newest read: only the newest answer counts.
  const turn = useRef({});
  const periodRef = useRef(period);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  // → the answer when this read was the newest for its route and it
  // worked (a caller that has to know what the list says now: an invite
  // answered or withdrawn meanwhile); undefined otherwise.
  const read = useCallback(async (key) => {
    if (!PATHS[key]) return undefined;
    const mine = (turn.current[key] || 0) + 1;
    turn.current[key] = mine;
    const r = await showCall('GET', PATHS[key](periodRef.current), undefined, getToken);
    if (turn.current[key] !== mine || !enabledRef.current) return undefined;
    setBoxes((b) => {
      if (r.ok) return { ...b, [key]: { state: 'ok', data: r.data } };
      if (r.status === 401 || r.status === 403) return { ...b, [key]: { state: 'refused', data: null } };
      return { ...b, [key]: { state: 'failed', data: b[key] ? b[key].data : null } };
    });
    return r.ok ? r.data : undefined;
  }, [getToken]);

  const readAll = useCallback(() => Promise.all(KEYS.map((key) => read(key))), [read]);

  useFocusEffect(useCallback(() => {
    if (enabled) readAll();
  }, [enabled, readAll]));

  useEffect(() => {
    if (enabled) return;
    // Anything still on its way belongs to the account that left.
    for (const key of KEYS) turn.current[key] = (turn.current[key] || 0) + 1;
    setBoxes(fresh());
  }, [enabled]);

  useEffect(() => {
    if (periodRef.current === period) return;
    periodRef.current = period;
    if (!enabledRef.current) return;
    setBoxes((b) => ({ ...b, money: LOADING }));
    read('money');
  }, [period, read]);

  return { boxes, reload: read, reloadAll: readAll };
}
