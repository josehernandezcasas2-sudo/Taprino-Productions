import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { apiGet } from '../../../lib/api';
import { colors } from '../../../lib/theme';
import TopNav from '../../../components/TopNav';
import { crew, Chip, PlaceBox, CallCard, WITHIN_CHOICES, DEFAULT_WITHIN } from '../../../components/CrewBits';

// The Crew Call board (pages/crew/calls on the web): who's needed, when,
// where, how it pays. Fed by /api/crew/calls; a signed-in viewer with a
// place on their card starts out near it.
const PAY = { paid: 'Paid', union: 'Union', deferred: 'Deferred', unpaid: 'Unpaid', other: 'Other' };
const withinLabel = (n) => (n === 0 ? 'Anywhere' : `Within ${n} mi`);

export default function CallsBoard() {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const tokenRef = useRef(null);
  const reqId = useRef(0);
  const [options, setOptions] = useState({ roles: [] });
  const [refreshKey, setRefreshKey] = useState(0);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [pay, setPay] = useState([]);
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [matches, setMatches] = useState(false);
  const [near, setNear] = useState(null);
  const [within, setWithin] = useState(DEFAULT_WITHIN);
  const [hasCard, setHasCard] = useState(false);
  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      tokenRef.current = isLoaded && isSignedIn
        ? await Promise.race([getToken().catch(() => null), new Promise((r) => setTimeout(() => r(null), 4000))])
        : null;
      try { const o = await apiGet('/api/crew/options'); if (alive) setOptions(o); } catch (err) { /* chips stay empty */ }
      if (tokenRef.current) {
        try {
          const d = await apiGet('/api/crew/card', tokenRef.current);
          if (alive) { setHasCard(Boolean(d.card)); if (d.card && d.card.place) setNear((n) => n || d.card.place); }
        } catch (err) { /* no card */ }
      }
      if (alive) setRefreshKey((k) => k + 1);
    })();
    return () => { alive = false; };
  }, [isLoaded, isSignedIn]));

  useEffect(() => {
    if (refreshKey === 0) return undefined;
    const id = ++reqId.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      const params = [];
      if (q.trim()) params.push(`q=${encodeURIComponent(q.trim())}`);
      if (role) params.push(`role=${encodeURIComponent(role)}`);
      if (pay.length) params.push(`pay=${pay.join(',')}`);
      if (remoteOnly) params.push('remote=1');
      if (matches) params.push('matches=1');
      if (near) params.push(`lat=${near.lat}`, `lng=${near.lng}`, `within=${within}`);
      try {
        const data = await apiGet(`/api/crew/calls?${params.join('&')}`, tokenRef.current);
        if (id !== reqId.current) return;
        setBoard(data);
        setError(null);
      } catch (err) {
        if (id === reqId.current) setError(err.message);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [refreshKey, q, role, pay, remoteOnly, matches, near, within]);

  const togglePay = (k) => setPay((list) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k]));
  const hasFilters = Boolean(q.trim() || role || pay.length || remoteOnly || matches);

  return (
    <SafeAreaView style={crew.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView contentContainerStyle={crew.stage} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.push('/crew')} hitSlop={8}><Text style={crew.mono}>‹ Crew Call</Text></Pressable>
        <Text style={[crew.eyebrow, { marginTop: 10 }]}>Connect · Crew Call</Text>
        <Text style={crew.h1}>Calls</Text>
        <Text style={crew.lead}>Who's needed, when, where, how it pays. Anyone with an account can post a call or respond to one.</Text>
        <Pressable style={[crew.btn, crew.btnPrimary, styles.cta]} onPress={() => router.push(isSignedIn ? '/crew/calls/new' : '/account')}>
          <Text style={[crew.btnText, crew.btnPrimaryText]}>{isSignedIn ? '+ Post a call' : 'Sign in to post a call'}</Text>
        </Pressable>

        <TextInput style={[crew.input, { marginBottom: 10 }]} value={q} onChangeText={setQ} placeholder="Role, title, place, project…" placeholderTextColor={colors.inkFaint} autoCorrect={false} returnKeyType="search" />

        <View style={crew.panel}>
          <View>
            <Text style={crew.label}>Role</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hrow} keyboardShouldPersistTaps="handled">
              <Chip label="Any role" on={!role} onPress={() => setRole('')} />
              {options.roles.map((r) => <Chip key={r} label={r} on={role === r} onPress={() => setRole(role === r ? '' : r)} />)}
            </ScrollView>
          </View>
          <View>
            <Text style={crew.label}>Pay</Text>
            <View style={[crew.chips, { marginTop: 6 }]}>
              {Object.entries(PAY).map(([k, v]) => <Chip key={k} label={v} on={pay.includes(k)} onPress={() => togglePay(k)} />)}
            </View>
          </View>
          <View>
            <Text style={[crew.label, { marginBottom: 6 }]}>Near</Text>
            <PlaceBox value={near} onChange={(p) => { setNear(p); if (p && within === 0) setWithin(DEFAULT_WITHIN); }} placeholder="City, or use your location" />
            {near ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.hrow, { marginTop: 8 }]}>
                {WITHIN_CHOICES.map((n) => <Chip key={n} label={withinLabel(n)} on={within === n} onPress={() => setWithin(n)} />)}
              </ScrollView>
            ) : null}
          </View>
          <View style={crew.chips}>
            {hasCard ? <Chip label="● Matches my card" on={matches} onPress={() => setMatches((v) => !v)} /> : null}
            <Chip label="Remote" on={remoteOnly} onPress={() => setRemoteOnly((v) => !v)} />
          </View>
          {hasFilters ? (
            <Pressable onPress={() => { setQ(''); setRole(''); setPay([]); setRemoteOnly(false); setMatches(false); }}>
              <Text style={[crew.mono, { color: colors.inkDim }]}>Clear filters</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.rhead}>
          <Text style={crew.mono}>{board ? `${board.total} open ${board.total === 1 ? 'call' : 'calls'}` : 'Loading…'}{loading && board ? ' · updating…' : ''}</Text>
          <Text style={crew.mono}>{near ? `nearest to ${near.label} + remote` : 'newest first'}</Text>
        </View>
        {error ? <Text style={crew.error}>{error}</Text> : null}
        {!board && !error ? <ActivityIndicator color={colors.brass} style={{ marginTop: 24 }} /> : null}
        {board && board.calls.length === 0 && !error ? (
          <Text style={crew.empty}>{hasFilters ? 'No calls match. Clear a filter or widen the distance.' : 'No open calls yet. Post the first one.'}</Text>
        ) : null}
        {board ? board.calls.map((c) => <CallCard key={c.id} c={c} onOpen={() => router.push(`/crew/calls/${c.id}`)} />) : null}

        <Text style={[crew.muted, { marginTop: 10 }]}>Calls close themselves a week after the last day. Pay is always labelled — paid, union, deferred, unpaid, other — and no money moves through the app.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  cta: { alignSelf: 'flex-start', marginBottom: 16 },
  hrow: { flexDirection: 'row', gap: 6, paddingVertical: 6 },
  rhead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8, marginTop: 4 }
});
