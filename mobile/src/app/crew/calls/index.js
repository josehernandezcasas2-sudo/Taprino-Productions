import { Redirect, useLocalSearchParams } from 'expo-router';

// The calls board is the first tab of Crew Call since 2026-11-18 (Crew
// Call, simpler: mobile/src/app/crew/index.js). /crew/calls with no id
// goes there, keeping what the older links asked for: ?urgent=1,
// ?production=<id>, ?kind=crew|cast. A call's own screen is
// crew/calls/[id].js, posting one crew/calls/new.js.
const KEEP = ['urgent', 'production', 'kind'];

export default function CallsBoard() {
  const params = useLocalSearchParams();
  const kept = {};
  for (const k of KEEP) {
    const v = Array.isArray(params[k]) ? params[k][0] : params[k];
    if (typeof v === 'string' && v) kept[k] = v;
  }
  return <Redirect href={{ pathname: '/crew', params: kept }} />;
}
