import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { apiGet } from '../../lib/api';
import { colors } from '../../lib/theme';
import TopNav from '../../components/TopNav';
import { crew, Chip, PlaceBox, PersonCard, GearCard, WITHIN_CHOICES, DEFAULT_WITHIN } from '../../components/CrewBits';

// Crew Call (pages/crew/index.js on the web): find people by role, gear
// and distance, browse the gear, keep your own card. Fed by
// /api/crew/people; a signed-in viewer with a place on their card starts
// out searching near it, anyone can pick a place or use their location.
const withinLabel = (n) => (n === 0 ? 'Anywhere' : `Within ${n} mi`);

export default function CrewCall() {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const tokenRef = useRef(null);
  const reqId = useRef(0);

  const [options, setOptions] = useState({ roles: [], gearCategories: [] });
  const [hasCard, setHasCard] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [tab, setTab] = useState('people');
  const [q, setQ] = useState('');
  const [roles, setRoles] = useState([]);
  const [gearCat, setGearCat] = useState('');
  const [near, setNear] = useState(null);
  const [within, setWithin] = useState(DEFAULT_WITHIN);
  const [openOnly, setOpenOnly] = useState(false);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [people, setPeople] = useState(null);
  const [gear, setGear] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // On every focus: the vocabularies, and (signed in) the own card so
  // the default "near" is where they're based and the button reads right.
  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      tokenRef.current = isLoaded && isSignedIn
        ? await Promise.race([getToken().catch(() => null), new Promise((r) => setTimeout(() => r(null), 4000))])
        : null;
      try { const o = await apiGet('/api/crew/options'); if (alive) setOptions(o); } catch (err) { /* chips just stay empty */ }
      if (tokenRef.current) {
        try {
          const d = await apiGet('/api/crew/card', tokenRef.current);
          if (alive) {
            setHasCard(Boolean(d.card));
            if (d.card && d.card.place) setNear((n) => n || d.card.place);
          }
        } catch (err) { /* no card yet */ }
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
      if (roles.length) params.push(`roles=${encodeURIComponent(roles.join(','))}`);
      if (gearCat) params.push(`gear=${encodeURIComponent(gearCat)}`);
      if (near) params.push(`lat=${near.lat}`, `lng=${near.lng}`, `within=${within}`);
      if (openOnly) params.push('open=1');
      if (verifiedOnly) params.push('verified=1');
      if (tab === 'gear') params.push('view=gear');
      try {
        const data = await apiGet(`/api/crew/people?${params.join('&')}`, tokenRef.current);
        if (id !== reqId.current) return;
        if (tab === 'gear') setGear(data); else setPeople(data);
        setError(null);
      } catch (err) {
        if (id === reqId.current) setError(err.message);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [refreshKey, tab, q, roles, gearCat, near, within, openOnly, verifiedOnly]);

  const hasFilters = Boolean(q.trim() || roles.length || gearCat || openOnly || verifiedOnly);
  const toggleRole = (r) => setRoles((list) => (list.includes(r) ? list.filter((x) => x !== r) : [...list, r]));
  const sortNote = near ? `nearest to ${near.label}` : 'newest first';
  const list = tab === 'gear' ? gear : people;

  return (
    <SafeAreaView style={crew.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView contentContainerStyle={crew.stage} keyboardShouldPersistTaps="handled">
        <Text style={crew.eyebrow}>Connect</Text>
        <Text style={crew.h1}>Crew Call</Text>
        <Text style={crew.lead}>Find the people and the gear for the next shoot. Everyone with an account gets a working card — what you do, what you have, where you are.</Text>
        <Pressable style={[crew.btn, crew.btnPrimary, styles.cta]} onPress={() => router.push(isSignedIn ? '/crew/card' : '/account')}>
          <Text style={[crew.btnText, crew.btnPrimaryText]}>{!isSignedIn ? 'Sign in to make your card' : hasCard ? 'Your card' : '+ Set up your card'}</Text>
        </Pressable>

        <View style={[crew.chips, { marginBottom: 12 }]}>
          <Chip label={`Find people${people && people.total ? ` · ${people.total}` : ''}`} on={tab === 'people'} onPress={() => setTab('people')} />
          <Chip label={`Gear${gear && gear.total ? ` · ${gear.total}` : ''}`} on={tab === 'gear'} onPress={() => setTab('gear')} />
        </View>

        <TextInput
          style={[crew.input, { marginBottom: 10 }]}
          value={q}
          onChangeText={setQ}
          placeholder={tab === 'gear' ? 'Camera, light, lens, van…' : 'Name, role, gear, city…'}
          placeholderTextColor={colors.inkFaint}
          autoCorrect={false}
          returnKeyType="search"
        />

        <View style={crew.panel}>
          {tab === 'people' ? (
            <View>
              <Text style={crew.label}>Role</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hrow} keyboardShouldPersistTaps="handled">
                {options.roles.map((r) => <Chip key={r} label={r} on={roles.includes(r)} onPress={() => toggleRole(r)} />)}
              </ScrollView>
            </View>
          ) : null}
          <View>
            <Text style={crew.label}>{tab === 'gear' ? 'Category' : 'Has gear'}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hrow} keyboardShouldPersistTaps="handled">
              <Chip label={tab === 'gear' ? 'All gear' : 'Any gear'} on={!gearCat} onPress={() => setGearCat('')} />
              {options.gearCategories.map((c) => <Chip key={c} label={c} on={gearCat === c} onPress={() => setGearCat(c)} />)}
            </ScrollView>
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
          {tab === 'people' ? (
            <View style={crew.chips}>
              <Chip label="● Open to work" on={openOnly} onPress={() => setOpenOnly((v) => !v)} />
              <Chip label="✓ Verified creators" on={verifiedOnly} onPress={() => setVerifiedOnly((v) => !v)} />
            </View>
          ) : null}
          {hasFilters ? (
            <Pressable onPress={() => { setQ(''); setRoles([]); setGearCat(''); setOpenOnly(false); setVerifiedOnly(false); }}>
              <Text style={[crew.mono, { color: colors.inkDim }]}>Clear filters</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.rhead}>
          <Text style={crew.mono}>
            {list ? (tab === 'gear' ? `${list.total} ${list.total === 1 ? 'item' : 'items'}` : `${list.total} ${list.total === 1 ? 'person' : 'people'}`) : 'Loading…'}
            {loading && list ? ' · updating…' : ''}
          </Text>
          <Text style={crew.mono}>{sortNote}</Text>
        </View>

        {error ? <Text style={crew.error}>{error}</Text> : null}
        {!list && !error ? <ActivityIndicator color={colors.brass} style={{ marginTop: 24 }} /> : null}

        {tab === 'people' && people ? (
          people.people.length === 0 && !error ? (
            <Text style={crew.empty}>
              {hasFilters || near ? 'Nobody matches yet. Widen the distance or clear a filter.' : isSignedIn ? 'No cards yet — be the first. Set up your working card and you’ll show up here.' : 'No cards yet. Sign in to set up yours and be the first on the board.'}
            </Text>
          ) : (
            people.people.map((p) => <PersonCard key={p.userId} p={p} onOpen={() => router.push(p.profilePath)} />)
          )
        ) : null}

        {tab === 'gear' && gear ? (
          gear.items.length === 0 && !error ? (
            <Text style={crew.empty}>{hasFilters || near ? 'No gear matches. Try another category or widen the distance.' : 'No gear listed yet. Add yours on your working card.'}</Text>
          ) : (
            gear.items.map((g) => <GearCard key={g.id} g={g} onOpen={() => router.push(g.owner.profilePath)} />)
          )
        ) : null}

        <Text style={[crew.muted, { marginTop: 10 }]}>Gear here is a “just have it” deal — no money moves through the app. The ✓ creator badge comes from an approved creator application.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  cta: { alignSelf: 'flex-start', marginBottom: 16 },
  hrow: { flexDirection: 'row', gap: 6, paddingVertical: 6 },
  rhead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8, marginTop: 4 }
});
