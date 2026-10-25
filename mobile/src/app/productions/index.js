import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { apiGet, freshToken } from '../../lib/api';
import { colors } from '../../lib/theme';
import TopNav from '../../components/TopNav';
import { crew, Chip } from '../../components/CrewBits';
import { ProductionCard, KINDS, STATUS } from '../../components/ProductionBits';

// Productions (pages/productions on the web, migration 104): who's making
// what. Fed by /api/productions; a signed-in person's own productions
// and the ones they're crew on sit at the top (/api/productions/mine).
const PUBLIC_STATUSES = ['prep', 'shooting', 'post', 'released'];

export default function ProductionsScreen() {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const signedIn = Boolean(isLoaded && isSignedIn);
  const reqId = useRef(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [board, setBoard] = useState(null);
  const [mine, setMine] = useState({ owned: [], crewOn: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      if (signedIn) {
        try {
          const m = await apiGet('/api/productions/mine', await freshToken(getToken));
          if (alive) setMine({ owned: m.owned || [], crewOn: m.crewOn || [] });
        } catch (err) { /* optional */ }
      } else setMine({ owned: [], crewOn: [] });
      if (alive) setRefreshKey((k) => k + 1);
    })();
    return () => { alive = false; };
  }, [signedIn])); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (refreshKey === 0) return undefined;
    const id = ++reqId.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      const p = [];
      if (q.trim()) p.push(`q=${encodeURIComponent(q.trim())}`);
      if (kind) p.push(`kind=${kind}`);
      if (status) p.push(`status=${status}`);
      try {
        const d = await apiGet(`/api/productions?${p.join('&')}`, signedIn ? await freshToken(getToken) : null);
        if (id !== reqId.current) return;
        setBoard(d);
        setError(null);
      } catch (err) {
        if (id === reqId.current) setError(err.message);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [refreshKey, q, kind, status]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasFilters = Boolean(q.trim() || kind || status);
  const open = (p) => router.push(`/productions/${p.id}`);

  return (
    <SafeAreaView style={crew.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView contentContainerStyle={crew.stage} keyboardShouldPersistTaps="handled">
        <Text style={crew.eyebrow}>Connect · Productions</Text>
        <Text style={crew.h1}>Productions</Text>
        <Text style={crew.lead}>The shoots happening on Studio Tapa. Crew calls, location bookings and the call sheet live here — and when it’s released, everyone who worked it gets the credit.</Text>
        <View style={[crew.row, { marginBottom: 14, flexWrap: 'wrap' }]}>
          <Pressable style={[crew.btn, crew.btnPrimary]} onPress={() => router.push(signedIn ? '/productions/new' : '/account')}><Text style={[crew.btnText, crew.btnPrimaryText]}>{signedIn ? '+ Start a production' : 'Sign in to start one'}</Text></Pressable>
          <Pressable style={crew.btn} onPress={() => router.push('/crew/calls')}><Text style={crew.btnText}>Calls</Text></Pressable>
          <Pressable style={crew.btn} onPress={() => router.push('/locations')}><Text style={crew.btnText}>Locations</Text></Pressable>
        </View>

        {mine.owned.length > 0 ? (
          <>
            <Text style={crew.h3}>Yours · {mine.owned.length}</Text>
            {mine.owned.map((p) => <ProductionCard key={p.id} p={p} onOpen={() => open(p)} />)}
          </>
        ) : null}
        {mine.crewOn.length > 0 ? (
          <>
            <Text style={[crew.h3, { marginTop: 8 }]}>You’re on the crew · {mine.crewOn.length}</Text>
            {mine.crewOn.map((p) => <ProductionCard key={p.id} p={p} roles={p.myRoles} onOpen={() => open(p)} />)}
          </>
        ) : null}

        <View style={[crew.panel, { marginTop: 8 }]}>
          <TextInput style={crew.input} value={q} onChangeText={setQ} placeholder="Title, place, who…" placeholderTextColor={colors.inkFaint} returnKeyType="search" />
          <Text style={[crew.label, { marginTop: 4 }]}>Kind</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hrow}>
            <Chip label="Any" on={!kind} onPress={() => setKind('')} />
            {Object.entries(KINDS).map(([k, v]) => <Chip key={k} label={v} on={kind === k} onPress={() => setKind(kind === k ? '' : k)} />)}
          </ScrollView>
          <Text style={[crew.label, { marginTop: 4 }]}>Where it’s at</Text>
          <View style={crew.chips}>{PUBLIC_STATUSES.map((k) => <Chip key={k} label={STATUS[k]} on={status === k} onPress={() => setStatus(status === k ? '' : k)} />)}</View>
          {hasFilters ? <Pressable onPress={() => { setQ(''); setKind(''); setStatus(''); }}><Text style={[crew.mono, { color: colors.olive }]}>Clear filters</Text></Pressable> : null}
        </View>

        <View style={[crew.row, { justifyContent: 'space-between', marginBottom: 6 }]}>
          <Text style={crew.mono}>{board ? `${board.total} ${board.total === 1 ? 'production' : 'productions'}` : ''}{loading ? ' · updating…' : ''}</Text>
          <Text style={crew.mono}>shooting now first</Text>
        </View>
        {error ? <Text style={crew.error}>{error}</Text> : null}
        {loading && !board ? <ActivityIndicator color={colors.brass} style={{ marginTop: 24 }} /> : null}
        {board && board.productions.length === 0 ? <Text style={crew.empty}>{hasFilters ? 'Nothing matches. Clear a filter.' : 'No productions yet. Start the first one.'}</Text> : null}
        {board ? board.productions.map((p) => <ProductionCard key={p.id} p={p} onOpen={() => open(p)} />) : null}
        <Text style={[crew.mono, { marginTop: 10 }]}>Public productions only. The call sheet — addresses, access notes, house rules — is for the crew on each one.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ hrow: { gap: 6, paddingVertical: 2 } });
