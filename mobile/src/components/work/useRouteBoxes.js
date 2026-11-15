import { useCallback, useEffect, useRef, useState } from 'react';
import { showCall } from '../../lib/showApi';

// The reads of a title's dashboard and a show's Overview (2026-11-15; the
// Dashboard's useDashboardData pattern): each route's answer kept on its
// own so a part draws the moment its route answers, and one that refuses
// or fails never holds the others back.
//
// `paths` is { key: path }. A box is { state, data }: 'loading' | 'ok' |
// 'refused' (401 / 403: this account has no such thing) | 'failed'
// (anything else; what was on screen stays). Nothing refused is ever handed
// on as zeros: its data is null. `enabled` false asks nothing.
const LOADING = { state: 'loading', data: null };

export function useRouteBoxes(paths, { getToken, enabled = true }) {
  const keys = Object.keys(paths);
  const [boxes, setBoxes] = useState(() => Object.fromEntries(keys.map((k) => [k, LOADING])));
  // key → the number of its newest read: only the newest answer counts.
  const turn = useRef({});
  const pathsRef = useRef(paths);
  pathsRef.current = paths;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const read = useCallback(async (key) => {
    const path = pathsRef.current[key];
    if (!path || !enabledRef.current) return undefined;
    const mine = (turn.current[key] || 0) + 1;
    turn.current[key] = mine;
    const r = await showCall('GET', path, undefined, getToken);
    if (!alive.current || turn.current[key] !== mine) return undefined;
    setBoxes((b) => {
      if (r.ok) return { ...b, [key]: { state: 'ok', data: r.data } };
      if (r.status === 401 || r.status === 403) return { ...b, [key]: { state: 'refused', data: null } };
      return { ...b, [key]: { state: 'failed', data: b[key] ? b[key].data : null } };
    });
    return r.ok ? r.data : undefined;
  }, [getToken]);

  const readAll = useCallback(() => Promise.all(Object.keys(pathsRef.current).map((k) => read(k))), [read]);

  return { boxes, read, readAll };
}

// A box's answer when it has one (a failed read keeps what it had).
export const dataOf = (box) => (box && box.data ? box.data : null);
