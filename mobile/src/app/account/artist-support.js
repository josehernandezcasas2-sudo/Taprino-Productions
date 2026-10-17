import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useHostedAuth } from '@clerk/expo/hosted-auth';
import { apiGet, apiPost } from '../../lib/api';
import { colors, fonts } from '../../lib/theme';
import TopNav from '../../components/TopNav';
import { Avatar } from '../../components/CrewBits';
import { MAX_PICKS, MAX_WEIGHT, MIN_WEIGHT, dollars, splitLineup } from '../../lib/artistSupportRules';

// Mirrors pages/artist-support.js + components/ArtistSupportCard.js:
// Membership Artist Support, where a member chooses the creators their
// membership supports (up to 10, equal or set shares, name visibility),
// via GET/POST /api/artist-support and GET /api/artist-support/search.
// Reached from the Account tab's drop-up and the Membership card.
const COLORS = [colors.brass, colors.olive, colors.mint, colors.sky, '#b48ad6', colors.danger, colors.oliveBright, colors.ok, '#f2bf88', '#8499dc'];
const TIER_LABELS = { basic: 'Basic', standard: 'Standard', premium: 'Premium', sponsor: 'Sponsor' };

const signature = (picks, mode, shareVisible) => JSON.stringify({ picks: picks.map((p) => `${p.creatorId}:${p.weight}`), mode, shareVisible });

function Toggle({ on, onPress, label }) {
  return (
    <Pressable style={styles.togRow} onPress={onPress} accessibilityRole="switch" accessibilityState={{ checked: on }}>
      <View style={[styles.tog, on && styles.togOn]}><View style={[styles.togKnob, on && styles.togKnobOn]} /></View>
      <Text style={styles.togLabel}>{label}</Text>
    </Pressable>
  );
}

export default function ArtistSupport() {
  const { getToken } = useAuth();
  const { startHostedAuth } = useHostedAuth();
  const router = useRouter();
  const [state, setState] = useState({ loading: true, error: null, signedOut: false, data: null });
  const [picks, setPicks] = useState([]);
  const [mode, setMode] = useState('equal');
  const [shareVisible, setShareVisible] = useState(false);
  const [savedSig, setSavedSig] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ creators: [], total: 0 });
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState(null);
  const [busyAuth, setBusyAuth] = useState(false);
  const timer = useRef(null);

  async function withToken() {
    return Promise.race([getToken().catch(() => null), new Promise((r) => setTimeout(() => r(null), 4000))]);
  }

  function adopt(data) {
    const m = data.mode === 'custom' ? 'custom' : 'equal';
    setPicks(data.picks || []);
    setMode(m);
    setShareVisible(Boolean(data.shareVisible));
    setSavedSig(signature(data.picks || [], m, Boolean(data.shareVisible)));
  }

  async function load() {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const token = await withToken();
      if (!token) { setState({ loading: false, error: null, signedOut: true, data: null }); return; }
      const data = await apiGet('/api/artist-support', token);
      adopt(data);
      setState({ loading: false, error: null, signedOut: false, data });
    } catch (err) {
      if (/401|sign in/i.test(err.message)) setState({ loading: false, error: null, signedOut: true, data: null });
      else setState({ loading: false, error: err.message, signedOut: false, data: null });
    }
  }

  useEffect(() => { load(); }, []);

  // Search as you type; the first page of everyone once signed in.
  useEffect(() => {
    if (state.signedOut || state.loading) return undefined;
    let cancelled = false;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const token = await withToken();
        const data = await apiGet(`/api/artist-support/search?q=${encodeURIComponent(query)}`, token);
        if (!cancelled) setResults({ creators: data.creators || [], total: data.total || 0 });
      } catch {
        // Non-fatal: the list just stays as it was.
      }
    }, query ? 250 : 0);
    return () => { cancelled = true; clearTimeout(timer.current); };
  }, [query, state.loading, state.signedOut]);

  async function handleStartAuth(mode) {
    setBusyAuth(true);
    try {
      await startHostedAuth({ mode });
      load();
    } catch {
      // Stay on the sign-in prompt.
    } finally {
      setBusyAuth(false);
    }
  }

  const data = state.data || {};
  const shareCents = Number(data.shareCents) || 0;
  const isPaid = shareCents > 0;
  const available = data.available !== false;
  const split = splitLineup(shareCents, picks, mode);
  const full = picks.length >= MAX_PICKS;
  const dirty = signature(picks, mode, shareVisible) !== savedSig;
  const inLineup = new Set(picks.map((p) => p.creatorId));

  function add(c) {
    if (full || inLineup.has(c.userId)) return;
    setNote(null);
    setPicks((prev) => [...prev, { ...c, creatorId: c.userId, weight: 1 }]);
  }
  function remove(id) { setNote(null); setPicks((prev) => prev.filter((p) => p.creatorId !== id)); }
  function step(id, d) { setPicks((prev) => prev.map((p) => (p.creatorId === id ? { ...p, weight: Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, (p.weight || 1) + d)) } : p))); }

  async function save() {
    setSaving(true);
    setNote(null);
    try {
      const token = await withToken();
      const fresh = await apiPost('/api/artist-support', { picks: picks.map((p) => ({ creatorId: p.creatorId, weight: p.weight })), mode, shareVisible }, token);
      adopt(fresh);
      setState((s) => ({ ...s, data: fresh }));
      setNote({ ok: true, text: fresh.picks && fresh.picks.length ? 'Saved. This applies from your next renewal.' : 'Saved. Your share follows what you watch until you pick someone.' });
    } catch (err) {
      setNote({ ok: false, text: err.message });
    } finally {
      setSaving(false);
    }
  }

  if (state.loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <TopNav />
        <View style={styles.center}><ActivityIndicator color={colors.brass} /></View>
      </SafeAreaView>
    );
  }
  if (state.error) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <TopNav />
        <View style={styles.center}><Text style={styles.errorText}>Couldn't load your creators: {state.error}</Text></View>
      </SafeAreaView>
    );
  }
  if (state.signedOut) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <TopNav />
        <View style={styles.center}>
          <Text style={styles.kicker}>Membership</Text>
          <Text style={styles.h1}>Membership Artist Support</Text>
          <Text style={styles.lede}>Part of every paid membership goes to the people who make what's on Studio Tapa TV. Sign in to choose up to {MAX_PICKS} creators your share goes to.</Text>
          <View style={styles.authRow}>
            <Pressable style={[styles.btnPrimary, busyAuth && { opacity: 0.6 }]} onPress={() => handleStartAuth('signIn')} disabled={busyAuth}><Text style={styles.btnPrimaryText}>Sign in</Text></Pressable>
            <Pressable style={[styles.btnSmall, busyAuth && { opacity: 0.6 }]} onPress={() => handleStartAuth('signUp')} disabled={busyAuth}><Text style={styles.btnSmallText}>Create account</Text></Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} hitSlop={8}><Text style={styles.back}>← Account</Text></Pressable>
        <Text style={styles.kicker}>Membership</Text>
        <Text style={styles.h1}>Membership Artist Support</Text>
        <Text style={styles.lede}>Part of every paid membership goes to the people who make what's on Studio Tapa TV. Pick up to {MAX_PICKS} creators and your share goes to them. Pick nobody and it follows what you watch.</Text>

        <View style={styles.card}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={styles.subheading}>Your creators</Text>
              <Text style={styles.title}>{picks.length} of {MAX_PICKS} picked</Text>
            </View>
            <View style={[styles.tierChip, isPaid && styles.tierChipPaid]}><Text style={[styles.tierChipText, isPaid && { color: colors.ok }]}>{TIER_LABELS[data.tier] || 'Basic'}</Text></View>
          </View>

          <View style={styles.shareRow}>
            <Text style={styles.shareAmount}>{dollars(shareCents)}</Text>
            <Text style={styles.shareCopy}>{isPaid ? 'of your membership goes to your creators every month.' : 'on Basic. Your picks are saved and start getting paid the day you join Tapa +.'}</Text>
          </View>
          <View style={styles.bar}>
            {isPaid && split.filter((s) => s.cents > 0).map((s, i) => (
              <View key={s.id} style={{ flex: s.cents, backgroundColor: COLORS[i % COLORS.length] }} />
            ))}
          </View>
          <Text style={styles.meta}>{picks.length ? `${mode === 'custom' ? 'Your own shares' : 'Equal shares'} · changes apply from your next renewal` : 'Nothing picked · your share follows what you watch'}</Text>

          {!available ? (
            <View style={styles.empty}><Text style={styles.emptyText}><Text style={styles.emptyStrong}>Artist Support isn't switched on yet. </Text>The database part (migration 088) hasn't been run, so picks can't be saved yet.</Text></View>
          ) : null}

          {picks.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}><Text style={styles.emptyStrong}>Nobody picked yet. </Text>Until you pick someone, your share follows what you watch: on each renewal it's split between the creators of the titles you watched in the last 30 days. Watched nothing? It joins the site-wide pool. Pick up to {MAX_PICKS} creators below and it goes to them instead.</Text>
            </View>
          ) : (
            <View style={{ marginTop: 6 }}>
              {picks.map((p, idx) => {
                const s = split.find((x) => x.id === p.creatorId) || { cents: 0, percent: 0 };
                return (
                  <View key={p.creatorId} style={[styles.row, idx > 0 && styles.rowBorder]}>
                    <Avatar userId={p.creatorId} name={p.displayName} src={p.avatarUrl} position={p.avatarPosition} zoom={p.avatarZoom} size={42} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.name} numberOfLines={1}>{p.displayName}</Text>
                      <Text style={styles.sub} numberOfLines={1}>{(p.credits || []).slice(0, 2).join(' · ') || (p.handle ? `@${p.handle}` : 'Creator')}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.amt}>{dollars(s.cents)}</Text>
                      <Text style={styles.amtSub}>{s.percent}%{idx === 0 && picks.length > 1 && mode !== 'custom' ? ' · first pick' : ''}</Text>
                    </View>
                    <View style={styles.rowActions}>
                      {mode === 'custom' ? (
                        <View style={styles.step}>
                          <Pressable style={[styles.round, p.weight <= MIN_WEIGHT && { opacity: 0.35 }]} onPress={() => step(p.creatorId, -1)} disabled={p.weight <= MIN_WEIGHT}><Text style={styles.roundText}>−</Text></Pressable>
                          <Text style={styles.stepText}>×{p.weight}</Text>
                          <Pressable style={[styles.round, p.weight >= MAX_WEIGHT && { opacity: 0.35 }]} onPress={() => step(p.creatorId, 1)} disabled={p.weight >= MAX_WEIGHT}><Text style={styles.roundText}>+</Text></Pressable>
                        </View>
                      ) : null}
                      <Pressable style={styles.round} onPress={() => remove(p.creatorId)} accessibilityLabel={`Remove ${p.displayName}`}><Text style={styles.roundText}>✕</Text></Pressable>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          <View style={styles.togs}>
            <Toggle on={mode === 'custom'} onPress={() => setMode((m) => (m === 'custom' ? 'equal' : 'custom'))} label="Set my own shares" />
            <Toggle on={shareVisible} onPress={() => setShareVisible((v) => !v)} label="Let my creators see my name" />
          </View>

          <View style={styles.searchRow}>
            <TextInput
              style={styles.input}
              value={query}
              onChangeText={setQuery}
              placeholder="Add a creator — name or title"
              placeholderTextColor={colors.inkFaint}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.count}>{full ? 'Your 10 are full' : `${results.total} creator${results.total === 1 ? '' : 's'}`}</Text>
          </View>
          <View style={styles.results}>
            {results.creators.length === 0 ? <Text style={[styles.meta, { paddingVertical: 10 }]}>{query ? 'No creator matches that.' : 'No creators with released titles yet.'}</Text> : null}
            {results.creators.map((c, idx) => (
              <View key={c.userId} style={[styles.row, idx > 0 && styles.rowBorder]}>
                <Avatar userId={c.userId} name={c.displayName} src={c.avatarUrl} position={c.avatarPosition} zoom={c.avatarZoom} size={34} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.name} numberOfLines={1}>{c.displayName}</Text>
                  <Text style={styles.sub} numberOfLines={1}>{(c.credits || []).slice(0, 2).join(' · ') || (c.handle ? `@${c.handle}` : 'Creator')}</Text>
                </View>
                {inLineup.has(c.userId)
                  ? <View style={styles.inChip}><Text style={styles.inChipText}>✓ in your lineup</Text></View>
                  : <Pressable style={[styles.btnSmall, full && { opacity: 0.45 }]} onPress={() => add(c)} disabled={full}><Text style={styles.btnSmallText}>Support</Text></Pressable>}
              </View>
            ))}
          </View>

          <View style={styles.actions}>
            <Pressable style={[styles.btnPrimary, (!dirty || saving || !available) && { opacity: 0.5 }]} onPress={save} disabled={!dirty || saving || !available}>
              <Text style={styles.btnPrimaryText}>{saving ? 'Saving…' : 'Save my creators'}</Text>
            </Pressable>
            {dirty && !saving ? <Text style={styles.noteText}>Unsaved changes</Text> : null}
            {note ? <Text style={[styles.noteText, { color: note.ok ? colors.ok : colors.danger }]}>{note.text}</Text> : null}
          </View>
          <Text style={styles.fineprint}>The split happens on each renewal, the way your list looks at that moment. Your history will show here once Artist Support payments start.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  content: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 120 },
  center: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
  back: { fontFamily: fonts.mono, fontSize: 11.5, color: colors.olive, marginBottom: 10 },
  kicker: { fontFamily: fonts.mono, fontSize: 10.9, letterSpacing: 1.1, textTransform: 'uppercase', color: colors.inkFaint, marginBottom: 4 },
  h1: { fontFamily: fonts.displayBold, fontSize: 26, lineHeight: 30, color: colors.ink, marginBottom: 8 },
  lede: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.inkDim, marginBottom: 16 },
  authRow: { flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 6 },
  errorText: { fontFamily: fonts.body, fontSize: 14, color: colors.danger },
  card: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: 'rgba(251,232,211,0.1)', borderRadius: 4, paddingVertical: 22, paddingHorizontal: 18 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  subheading: { fontFamily: fonts.mono, fontSize: 10.9, letterSpacing: 1.1, textTransform: 'uppercase', color: colors.brass, marginBottom: 4 },
  title: { fontFamily: fonts.displayBold, fontSize: 21, color: colors.ink },
  tierChip: { backgroundColor: colors.surface2, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10 },
  tierChipPaid: { backgroundColor: 'rgba(132,205,152,0.14)' },
  tierChipText: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.inkDim },
  shareRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginTop: 4 },
  shareAmount: { fontFamily: fonts.displayBold, fontSize: 28, color: colors.ink },
  shareCopy: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.inkDim, flex: 1, minWidth: 180 },
  bar: { height: 8, borderRadius: 999, backgroundColor: colors.surface3, overflow: 'hidden', flexDirection: 'row', marginTop: 10, marginBottom: 4 },
  meta: { fontFamily: fonts.mono, fontSize: 10.5, lineHeight: 16, color: colors.inkFaint },
  empty: { borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(251,232,211,0.25)', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, marginTop: 12 },
  emptyText: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.inkDim },
  emptyStrong: { fontFamily: fonts.bodyBold, color: colors.ink },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, flexWrap: 'wrap' },
  rowBorder: { borderTopWidth: 1, borderTopColor: 'rgba(251,232,211,0.1)' },
  name: { fontFamily: fonts.displayBold, fontSize: 14.5, color: colors.ink },
  sub: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.inkFaint, marginTop: 2 },
  amt: { fontFamily: fonts.mono, fontSize: 12.5, color: colors.ink },
  amtSub: { fontFamily: fonts.mono, fontSize: 9.5, color: colors.inkFaint, marginTop: 2 },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stepText: { fontFamily: fonts.mono, fontSize: 10, color: colors.inkFaint, minWidth: 22, textAlign: 'center' },
  round: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(251,232,211,0.2)', alignItems: 'center', justifyContent: 'center' },
  roundText: { fontFamily: fonts.mono, fontSize: 12, color: colors.inkDim },
  togs: { gap: 10, marginTop: 14 },
  togRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tog: { width: 32, height: 18, borderRadius: 999, backgroundColor: colors.surface3, padding: 2 },
  togOn: { backgroundColor: colors.ok },
  togKnob: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.inkFaint },
  togKnobOn: { alignSelf: 'flex-end', backgroundColor: '#0f1f12' },
  togLabel: { fontFamily: fonts.mono, fontSize: 11, color: colors.inkDim },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, marginBottom: 8 },
  input: { flex: 1, backgroundColor: colors.surface2, borderWidth: 1, borderColor: 'rgba(251,232,211,0.12)', borderRadius: 10, paddingVertical: 9, paddingHorizontal: 12, fontFamily: fonts.mono, fontSize: 12, color: colors.ink },
  count: { fontFamily: fonts.mono, fontSize: 10, color: colors.inkFaint },
  results: { borderWidth: 1, borderColor: 'rgba(251,232,211,0.12)', borderRadius: 10, paddingHorizontal: 10, maxHeight: 320 },
  inChip: { backgroundColor: 'rgba(248,95,115,0.14)', borderRadius: 999, paddingVertical: 4, paddingHorizontal: 9 },
  inChipText: { fontFamily: fonts.mono, fontSize: 10, color: colors.brass },
  btnSmall: { borderWidth: 1, borderColor: 'rgba(251,232,211,0.2)', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 },
  btnSmallText: { fontFamily: fonts.display, fontSize: 12.5, color: colors.ink },
  btnPrimary: { backgroundColor: colors.brass, borderRadius: 999, paddingVertical: 11, paddingHorizontal: 18 },
  btnPrimaryText: { fontFamily: fonts.displayBold, fontSize: 13, color: colors.onBrass },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 14 },
  noteText: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.inkFaint },
  fineprint: { fontFamily: fonts.mono, fontSize: 10.6, lineHeight: 17, color: colors.inkFaint, marginTop: 12 }
});
