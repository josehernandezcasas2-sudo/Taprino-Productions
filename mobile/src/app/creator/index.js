import { useCallback } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { DASHBOARD_PATH } from '../../lib/creatorDashboardRules';
import { colors } from '../../lib/theme';

// /creator was Creator Studio's hub (Submit a title and its types, Your
// shows, the drafts, the In review / Needs you / Live piles, Get paid,
// Paid to you). On 2026-11-14 the Dashboard took its place (Jose: "yes
// lets add the sections to the dashobard, lets flesh it out too"): every
// piece that lived only here is on creator/dashboard now, and nothing in
// the app opens this address any more (hrefToRoute in
// components/PushListener.js sends /creator to the Dashboard too).
//
// What is left is a forward, so an old link, an old build's push or a
// typed studiotapatv://creator still lands: on to the Dashboard, keeping
// what the three steps used to hand the hub (?submitted=, ?id=, ?show=).
// It goes with router.dismissTo where expo-router's <Redirect> would
// replace: back down to the Dashboard when it is already open underneath,
// in this screen's place when it isn't — a replace would have put a second
// Dashboard on top of the first.
const KEPT = ['submitted', 'id', 'show'];
const first = (v) => (Array.isArray(v) ? v[0] : v);

export default function CreatorHubForward() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const query = KEPT
    .map((key) => [key, first(params[key])])
    .filter(([, value]) => typeof value === 'string' && value)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  const to = `${DASHBOARD_PATH}${query ? `?${query}` : ''}`;

  useFocusEffect(useCallback(() => {
    try {
      router.dismissTo(to);
    } catch {
      // Nothing to go to yet (the navigator isn't up): the next focus asks again.
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to]));

  // One frame of the app's own background while it forwards.
  return <View style={{ flex: 1, backgroundColor: colors.surface0 }} />;
}
