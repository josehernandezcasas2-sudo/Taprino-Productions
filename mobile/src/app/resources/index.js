import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { apiGet, apiPost, freshToken } from '../../lib/api';
import { colors, fonts } from '../../lib/theme';
import TopNav from '../../components/TopNav';
import SmartImage from '../../components/SmartImage';
import { crew, Chip, PlaceBox, WITHIN_CHOICES, DEFAULT_WITHIN } from '../../components/CrewBits';

// Resources & partners (pages/resources on the web, migration 108): the
// shops a shoot leans on, with the deal and a gated code. Fed by
// /api/partners; the code opens through /api/partners/<id>/reveal.
const withinLabel = (n) => (n === 0 ? 'Anywhere' : `Within ${n} mi`);

export default function ResourcesScreen() {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const signedIn = Boolean(isLoaded && isSignedIn);
  const reqId = useRef(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [ships, setShips] = useState(false);
  const [near, setNear] = useState(null);
  const [within, setWithin] = useState(DEFAULT_WITHIN);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      if (signedIn) {
        try { const d = await apiGet('/api/crew/card', await freshToken(getToken)); if (alive && d.card && d.card.place) setNear((n) => n || d.card.place); } catch (err) { /* no card */ }
      }
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
      if (ships) p.push('ships=1');
      if (near) p.push(`lat=${near.lat}`, `lng=${near.lng}`, `within=${within}`);
      try {
        const d = await apiGet(`/api/partners?${p.join('&')}`, signedIn ? await freshToken(getToken) : null);
        if (id !== reqId.current) return;
        setData(d);
        setError(null);
      } catch (err) {
        if (id === reqId.current) setError(err.message);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [refreshKey, q, kind, ships, near, within]); // eslint-disable-line react-hooks/exhaustive-deps

  const kinds = data ? Object.entries(data.rules.kinds).filter(([k]) => data.counts[k]) : [];
  const rank = data ? data.rank : 0;

  return (
    <SafeAreaView style={crew.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView contentContainerStyle={crew.stage} keyboardShouldPersistTaps="handled">
        <Text style={crew.eyebrow}>Connect · Resources</Text>
        <Text style={crew.h1}>Resources & partners</Text>
        <Text style={crew.lead}>The shops and people a shoot leans on — near you and far away — and the deal each gives productions on Studio Tapa. Codes open as you build your record here.</Text>

        <View style={crew.panel}>
          <TextInput style={crew.input} value={q} onChangeText={setQ} placeholder="Rental, color, insurance, a name…" placeholderTextColor={colors.inkFaint} returnKeyType="search" />
          <Text style={[crew.label, { marginTop: 4 }]}>Near</Text>
          <PlaceBox value={near} onChange={(p) => { setNear(p); if (p && within === 0) setWithin(DEFAULT_WITHIN); }} placeholder="City, or use your location" />
          {near ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hrow}>
              {WITHIN_CHOICES.map((n) => <Chip key={n} label={withinLabel(n)} on={within === n} onPress={() => setWithin(n)} />)}
            </ScrollView>
          ) : null}
          <View style={crew.chips}>
            <Chip label="📦 Ships / remote" on={ships} onPress={() => setShips((v) => !v)} />
            {kind || q.trim() || ships ? <Chip label="Clear" onPress={() => { setQ(''); setKind(''); setShips(false); }} /> : null}
          </View>
        </View>

        {kinds.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.hrow, { marginBottom: 8 }]}>
            <Chip label="All" on={!kind} onPress={() => setKind('')} />
            {kinds.map(([k, label]) => <Chip key={k} label={`${label} · ${data.counts[k]}`} on={kind === k} onPress={() => setKind(kind === k ? '' : k)} />)}
          </ScrollView>
        ) : null}

        <View style={[crew.row, { justifyContent: 'space-between', marginBottom: 6 }]}>
          <Text style={crew.mono}>{data ? `${data.total} ${data.total === 1 ? 'partner' : 'partners'}` : ''}{loading ? ' · updating…' : ''}</Text>
          <Text style={crew.mono}>{near ? `nearest to ${near.label} + ships` : 'featured first'}</Text>
        </View>
        {error ? <Text style={crew.error}>{error}</Text> : null}
        {loading && !data ? <ActivityIndicator color={colors.brass} style={{ marginTop: 24 }} /> : null}
        {data && data.partners.length === 0 ? <Text style={crew.empty}>{kind || q.trim() || near ? 'Nothing matches. Widen the distance or clear a filter.' : 'No partners listed yet.'}</Text> : null}
        {data ? data.partners.map((p) => <PartnerCard key={p.id} p={p} signedIn={signedIn} getToken={getToken} onSignIn={() => router.push('/account')} />) : null}

        <View style={[crew.panel, { marginTop: 8 }]}>
          <Text style={crew.label}>How codes open</Text>
          {data ? ['public', 'account', 'card', 'production', 'veteran'].map((k, i) => <Text key={k} style={[crew.muted, rank >= i && { color: colors.ink }]}>{rank >= i ? '✓ ' : '○ '}{data.rules.gates[k].label}</Text>) : null}
          <Text style={crew.mono}>{!signedIn ? 'Sign in to open codes.' : rank >= 4 ? 'Everything here is open to you.' : rank === 3 ? 'Veteran codes open at three confirmed jobs or released titles.' : rank === 2 ? 'Production codes open once you own or join a live production.' : 'Set up your working card to open the next rung.'}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function PartnerCard({ p, signedIn, getToken, onSignIn }) {
  const [code, setCode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  async function reveal() {
    setBusy(true);
    setMsg(null);
    try { setCode(await apiPost(`/api/partners/${p.id}/reveal`, {}, signedIn ? await freshToken(getToken) : null)); } catch (err) { setMsg(err.message); } finally { setBusy(false); }
  }
  async function copy() {
    await Clipboard.setStringAsync(code.code);
    setMsg('Copied.');
  }
  return (
    <View style={[crew.panel, p.featured && { borderColor: colors.brass }]}>
      <View style={[crew.row, { alignItems: 'flex-start' }]}>
        <View style={styles.logo}>{p.logoUrl ? <SmartImage uri={p.logoUrl} style={StyleSheet.absoluteFill} /> : <Text style={styles.logoText}>{p.name.slice(0, 2).toUpperCase()}</Text>}</View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={crew.nameRow}>
            <Text style={crew.name}>{p.name}</Text>
            {p.featured ? <Chip label="featured" tone="role" /> : null}
          </View>
          <View style={crew.metaRow}>
            <Chip label={p.kindLabel} />
            {p.place ? <Text style={crew.meta}>{p.place.label}{p.miles != null ? ` · ${p.miles} mi` : ''}</Text> : null}
            {p.ships ? <Text style={crew.meta}>📦 ships / remote</Text> : null}
          </View>
        </View>
      </View>
      {p.blurb ? <Text style={crew.muted}>{p.blurb}</Text> : null}
      {p.deal ? <View style={styles.deal}><Text style={crew.label}>The deal</Text><Text style={styles.dealText}>{p.deal}</Text></View> : null}
      <View style={[crew.row, { flexWrap: 'wrap' }]}>
        {p.url ? <Pressable style={crew.btnSm} onPress={() => Linking.openURL(p.url)}><Text style={crew.btnSmText}>Website ↗</Text></Pressable> : null}
        {p.hasCode ? (
          code ? (
            <>
              <Text style={styles.code}>{code.code}</Text>
              <Pressable style={crew.btnSm} onPress={copy}><Text style={crew.btnSmText}>Copy</Text></Pressable>
            </>
          ) : p.canReveal ? (
            <Pressable style={[crew.btnSm, crew.btnPrimary]} disabled={busy} onPress={reveal}><Text style={[crew.btnSmText, crew.btnPrimaryText]}>{busy ? 'Opening…' : 'Show the code'}</Text></Pressable>
          ) : !signedIn && p.codeGate !== 'public' ? (
            <Pressable style={crew.btnSm} onPress={onSignIn}><Text style={crew.btnSmText}>Sign in for the code</Text></Pressable>
          ) : <Chip label={`🔒 ${p.gateLabel}`} tone="mute" />
        ) : null}
      </View>
      {p.hasCode && !code && !p.canReveal && (signedIn || p.codeGate === 'public') ? <Text style={crew.mono}>{p.gateHint}</Text> : null}
      {code && code.note ? <Text style={crew.mono}>{code.note}</Text> : null}
      {msg ? <Text style={crew.mono}>{msg}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hrow: { flexDirection: 'row', gap: 6, paddingVertical: 6 },
  logo: { width: 48, height: 48, borderRadius: 10, backgroundColor: colors.surface2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  logoText: { fontFamily: fonts.displayBold, color: colors.inkDim, fontSize: 14 },
  deal: { backgroundColor: 'rgba(242,193,78,0.08)', borderWidth: 1, borderColor: 'rgba(242,193,78,0.3)', borderRadius: 8, padding: 8, gap: 2 },
  dealText: { fontFamily: fonts.displaySemi, fontSize: 15, color: colors.ink },
  code: { fontFamily: fonts.monoBold, fontSize: 15, color: colors.olive, letterSpacing: 1, paddingHorizontal: 8, paddingVertical: 6, backgroundColor: colors.surface2, borderRadius: 6 }
});
