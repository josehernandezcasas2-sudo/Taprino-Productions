import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { apiGet, freshToken } from '../../lib/api';
import { colors } from '../../lib/theme';
import TopNav from '../../components/TopNav';
import { crew, Chip, PlaceBox, WITHIN_CHOICES } from '../../components/CrewBits';
import { ListingCard, loc } from '../../components/LocationBits';
import { fmtRange } from '../../lib/locationRules';

// The Locations directory (pages/locations on the web): place + radius +
// dates, type chips with counts, feature/budget chips, cards nearest
// first. Fed by /api/locations.
const DEFAULT_WITHIN = 25;
const BUDGETS = [['100', 'Under $100/hr'], ['250', 'Under $250/hr']];
const withinLabel = (n) => (n === 0 ? 'Anywhere' : `Within ${n} mi`);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export default function LocationsDirectory() {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const tokenRef = useRef(null);
  const reqId = useRef(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [rules, setRules] = useState(null);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [features, setFeatures] = useState([]);
  const [budget, setBudget] = useState('');
  const [deals, setDeals] = useState(false);
  const [verified, setVerified] = useState(false);
  const [near, setNear] = useState(null);
  const [within, setWithin] = useState(DEFAULT_WITHIN);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState('new');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      tokenRef.current = isLoaded && isSignedIn
        ? await Promise.race([getToken().catch(() => null), new Promise((r) => setTimeout(() => r(null), 4000))])
        : null;
      if (tokenRef.current) {
        try {
          const d = await apiGet('/api/crew/card', tokenRef.current);
          if (alive && d.card && d.card.place) setNear((n) => { if (!n) setSort('near'); return n || d.card.place; });
        } catch (err) { /* no card */ }
      }
      if (alive) setRefreshKey((k) => k + 1);
    })();
    return () => { alive = false; };
  }, [isLoaded, isSignedIn])); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (refreshKey === 0) return undefined;
    const id = ++reqId.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      const p = [];
      if (q.trim()) p.push(`q=${encodeURIComponent(q.trim())}`);
      if (kind) p.push(`kind=${kind}`);
      if (features.length) p.push(`features=${features.join(',')}`);
      if (budget) p.push(`maxHourly=${budget}`);
      if (deals) p.push('deals=1');
      if (verified) p.push('verified=1');
      if (near) p.push(`lat=${near.lat}`, `lng=${near.lng}`, `within=${within}`);
      if (isDate(from)) p.push(`from=${from}`, `to=${isDate(to) && to >= from ? to : from}`);
      p.push(`sort=${sort}`);
      try {
        // Fresh each search: a token from when the screen opened has expired a minute later.
        const d = await apiGet(`/api/locations?${p.join('&')}`, tokenRef.current ? await freshToken(getToken) : null);
        if (id !== reqId.current) return;
        setData(d);
        if (d.rules) setRules(d.rules);
        setError(null);
      } catch (err) {
        if (id === reqId.current) setError(err.message);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [refreshKey, q, kind, features, budget, deals, verified, near, within, from, to, sort]);

  const toggleFeature = (k) => setFeatures((list) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k]));
  const hasFilters = Boolean(q.trim() || kind || features.length || budget || deals || verified || from);
  const counts = (data && data.counts) || {};
  const types = rules ? Object.entries(rules.types) : [];
  const chips = rules ? rules.filterChips : [];
  const fromOk = isDate(from);

  return (
    <SafeAreaView style={crew.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView contentContainerStyle={crew.stage} keyboardShouldPersistTaps="handled">
        <Text style={crew.eyebrow}>Connect · Locations</Text>
        <Text style={crew.h1}>Find a place to shoot</Text>
        <Text style={crew.lead}>Homes, warehouses, cafés, studios and odd corners of the city, listed by the people who hold the keys.</Text>
        <View style={[crew.row, { marginBottom: 14, flexWrap: 'wrap' }]}>
          <Pressable style={[crew.btn, crew.btnPrimary]} onPress={() => router.push(isSignedIn ? '/locations/new' : '/account')}><Text style={[crew.btnText, crew.btnPrimaryText]}>{isSignedIn ? '+ List a place' : 'Sign in to list a place'}</Text></Pressable>
          {isSignedIn ? <Pressable style={crew.btn} onPress={() => router.push('/locations/mine')}><Text style={crew.btnText}>Your places</Text></Pressable> : null}
          {isSignedIn ? <Pressable style={crew.btn} onPress={() => router.push('/locations/requests')}><Text style={crew.btnText}>Your requests</Text></Pressable> : null}
        </View>

        <View style={crew.panel}>
          <Text style={crew.label}>Near</Text>
          <PlaceBox value={near} onChange={(p) => { setNear(p); if (p) { setSort('near'); if (within === 0) setWithin(DEFAULT_WITHIN); } }} placeholder="City or neighbourhood, or use your location" />
          {near ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hrow}>
              {WITHIN_CHOICES.map((n) => <Chip key={n} label={withinLabel(n)} on={within === n} onPress={() => setWithin(n)} />)}
            </ScrollView>
          ) : null}
          <Text style={[crew.label, { marginTop: 4 }]}>Dates (YYYY-MM-DD)</Text>
          <View style={crew.row}>
            <TextInput style={[crew.input, { flex: 1 }]} value={from} onChangeText={setFrom} placeholder="First day" placeholderTextColor={colors.inkFaint} autoCapitalize="none" />
            <TextInput style={[crew.input, { flex: 1 }]} value={to} onChangeText={setTo} placeholder="Last day" placeholderTextColor={colors.inkFaint} autoCapitalize="none" editable={fromOk} />
          </View>
          <TextInput style={crew.input} value={q} onChangeText={setQ} placeholder="Terrazzo, loft, diner, yard…" placeholderTextColor={colors.inkFaint} autoCorrect={false} returnKeyType="search" />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hrow}>
          <Pressable style={[loc.type, kind === '' && loc.typeOn]} onPress={() => setKind('')}><Text style={loc.typeText}>All</Text><Text style={loc.typeN}>{counts.all || 0}</Text></Pressable>
          {types.map(([k, v]) => (
            <Pressable key={k} style={[loc.type, kind === k && loc.typeOn, !counts[k] && kind !== k && { opacity: 0.45 }]} onPress={() => setKind(kind === k ? '' : k)}><Text style={loc.typeText}>{v}</Text><Text style={loc.typeN}>{counts[k] || 0}</Text></Pressable>
          ))}
        </ScrollView>
        <View style={[crew.chips, { marginVertical: 8 }]}>
          {BUDGETS.map(([v, label]) => <Chip key={v} label={label} on={budget === v} onPress={() => setBudget(budget === v ? '' : v)} />)}
          <Chip label="Make a deal" on={deals} onPress={() => setDeals((x) => !x)} />
          {chips.map(([k, label]) => <Chip key={k} label={label} on={features.includes(k)} onPress={() => toggleFeature(k)} />)}
          <Chip label="✓ Verified host" on={verified} onPress={() => setVerified((x) => !x)} />
        </View>
        {hasFilters ? <Pressable onPress={() => { setQ(''); setKind(''); setFeatures([]); setBudget(''); setDeals(false); setVerified(false); setFrom(''); setTo(''); }}><Text style={[crew.mono, { color: colors.brass, marginBottom: 8 }]}>Clear filters</Text></Pressable> : null}

        <View style={styles.rhead}>
          <Text style={crew.mono}>{data ? `${data.total} ${data.total === 1 ? 'place' : 'places'}${fromOk ? ` open ${fmtRange(from, isDate(to) && to >= from ? to : from)}` : ''}` : 'Loading…'}{loading && data ? ' · updating…' : ''}</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.hrow, { marginBottom: 8 }]}>
          {[['near', near ? `closest to ${near.label.split(',')[0]}` : 'closest'], ['booked', 'most booked'], ['cheap', 'cheapest'], ['new', 'newest']].map(([k, label]) => ((k !== 'near' || near) ? <Chip key={k} label={label} on={sort === k} onPress={() => setSort(k)} /> : null))}
        </ScrollView>

        {error ? <Text style={crew.error}>{error}</Text> : null}
        {!data && !error ? <ActivityIndicator color={colors.brass} style={{ marginTop: 24 }} /> : null}
        {data && data.listings.length === 0 && !error ? <Text style={crew.empty}>{hasFilters || near ? 'No places match. Clear a filter, widen the distance, or try other dates.' : 'No places listed yet. List the first one.'}</Text> : null}
        {data ? data.listings.map((l) => <ListingCard key={l.id} l={l} from={fromOk ? from : ''} onOpen={() => router.push(`/locations/${l.id}`)} />) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  hrow: { flexDirection: 'row', gap: 6, paddingVertical: 6 },
  rhead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 4 }
});
