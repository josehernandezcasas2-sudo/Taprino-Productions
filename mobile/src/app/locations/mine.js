import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import * as WebBrowser from 'expo-web-browser';
import { apiGet, apiPatch, apiPost } from '../../lib/api';
import { colors } from '../../lib/theme';
import TopNav from '../../components/TopNav';
import PayoutsCard from '../../components/PayoutsCard';
import SmartImage from '../../components/SmartImage';
import { crew, Chip } from '../../components/CrewBits';
import { StatusPill, RequestCard, MonthCalendar, resolveToken, loc } from '../../components/LocationBits';
import { thisMonth, todayIso } from '../../lib/locationRules';

// Your places (pages/locations/mine on the web): every place you've
// listed, the requests waiting on you, blocked days, the Payouts card.
export default function MyLocations() {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken, userId } = useAuth();
  const signedIn = Boolean(isLoaded && isSignedIn);
  const tokenRef = useRef(null);
  const [state, setState] = useState({ loading: true, error: null, listings: [], requests: [] });
  const [busy, setBusy] = useState(null);
  const [blocking, setBlocking] = useState(null);
  const [showPast, setShowPast] = useState(false);

  const load = useCallback(async () => {
    if (!signedIn) { setState({ loading: false, error: null, listings: [], requests: [] }); return; }
    try {
      tokenRef.current = await Promise.race([getToken().catch(() => null), new Promise((r) => setTimeout(() => r(null), 4000))]);
      const [m, r] = await Promise.all([apiGet('/api/locations/mine', tokenRef.current), apiGet('/api/locations/requests', tokenRef.current)]);
      setState({ loading: false, error: null, listings: m.listings, requests: r.asHost });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err.message }));
    }
  }, [signedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function setStatus(l, status) {
    const go = async () => {
      setBusy(l.id);
      try {
        const d = await apiPatch(`/api/locations/${l.id}`, { status }, await resolveToken(getToken));
        // A status change answers with the listing itself (not { listing }),
        // or { ok, status } for a removal; fall back to the status we asked for.
        const listing = d && d.id ? d : d && d.listing ? d.listing : { status };
        setState((s) => ({ ...s, listings: status === 'removed' ? s.listings.filter((x) => x.id !== l.id) : s.listings.map((x) => (x.id === l.id ? { ...x, ...listing } : x)) }));
      } catch (err) {
        Alert.alert('Could not change that', err.message);
      } finally {
        setBusy(null);
      }
    };
    if (status === 'removed') Alert.alert(`Remove “${l.title}”?`, 'Confirmed bookings stay in your records; the listing goes.', [{ text: 'Keep it', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: go }]);
    else go();
  }
  const updateRequest = (r) => setState((s) => ({ ...s, requests: s.requests.map((x) => (x.id === r.id ? r : x)) }));
  const onPay = async (url) => { await WebBrowser.openBrowserAsync(url); load(); };

  const { listings, requests } = state;
  const waiting = requests.filter((r) => r.status === 'requested').length;
  const open = requests.filter((r) => ['requested', 'countered', 'accepted', 'paid'].includes(r.status));
  const past = requests.filter((r) => !open.includes(r));

  return (
    <SafeAreaView style={crew.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView contentContainerStyle={crew.stage} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.push('/locations')} hitSlop={8}><Text style={crew.mono}>‹ Locations</Text></Pressable>
        <Text style={[crew.eyebrow, { marginTop: 10 }]}>Locations</Text>
        <Text style={crew.h1}>Your places</Text>
        {!signedIn ? (
          <View style={crew.panel}>
            <Text style={crew.lead}>List a place, answer requests, see what you’ve earned.</Text>
            <Pressable style={[crew.btn, crew.btnPrimary, { alignSelf: 'flex-start' }]} onPress={() => router.push('/account')}><Text style={[crew.btnText, crew.btnPrimaryText]}>Sign in</Text></Pressable>
          </View>
        ) : (
          <>
            <Text style={crew.lead}>{listings.length === 0 ? 'Nothing listed yet. If you hold the keys to somewhere a crew could shoot, list it.' : `${listings.filter((l) => l.status === 'listed').length} listed${waiting ? ` · ${waiting} ${waiting === 1 ? 'request' : 'requests'} waiting on you` : ''}.`}</Text>
            <Pressable style={[crew.btn, crew.btnPrimary, { alignSelf: 'flex-start', marginBottom: 14 }]} onPress={() => router.push('/locations/new')}><Text style={[crew.btnText, crew.btnPrimaryText]}>+ List a place</Text></Pressable>
            {state.loading ? <ActivityIndicator color={colors.brass} style={{ marginTop: 16 }} /> : null}
            {state.error ? <Text style={crew.error}>{state.error}</Text> : null}

            <Text style={crew.h3}>Requests{waiting ? ` · ${waiting} waiting · 48 hours to answer` : ''}</Text>
            {!state.loading && requests.length === 0 ? <Text style={[crew.muted, { marginBottom: 10 }]}>When a producer asks for dates, the request lands here and in your Messages, with 48 hours to accept, counter or decline.</Text> : null}
            {open.map((r) => <RequestCard key={r.id} r={r} side="host" token={getToken} userId={userId} onChange={updateRequest} onPay={onPay} onOpen={() => router.push(`/locations/requests/${r.id}`)} onMessage={() => router.push(`/messages/${r.threadId}`)} />)}
            {past.length > 0 ? <Pressable onPress={() => setShowPast((v) => !v)}><Text style={[crew.mono, { marginBottom: 8 }]}>{showPast ? '▾' : '▸'} {past.length} past {past.length === 1 ? 'request' : 'requests'}</Text></Pressable> : null}
            {showPast ? past.map((r) => <RequestCard key={r.id} r={r} side="host" token={getToken} userId={userId} onChange={updateRequest} onPay={onPay} onOpen={() => router.push(`/locations/requests/${r.id}`)} onMessage={() => router.push(`/messages/${r.threadId}`)} />) : null}

            <Text style={[crew.h3, { marginTop: 8 }]}>Your places · {listings.length} of 10</Text>
            {listings.map((l) => (
              <View key={l.id} style={crew.panel}>
                <Pressable style={[crew.row, { alignItems: 'flex-start' }]} onPress={() => router.push(`/locations/${l.id}`)}>
                  <View style={loc.thumb}>{l.coverUrl ? <SmartImage uri={l.coverUrl} style={StyleSheet.absoluteFill} /> : null}</View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={crew.name}>{l.title}</Text>
                    <View style={[crew.chips, { marginTop: 4 }]}><StatusPill status={l.status} />{l.verified ? <Chip label="✓ verified" tone="ok" /> : null}</View>
                    <Text style={[crew.mono, { marginTop: 4 }]}>{l.kindLabel} · {l.place ? l.place.label : ''} · {l.rateLine} · {l.photos.length} {l.photos.length === 1 ? 'photo' : 'photos'}{l.shootsCount ? ` · hosted ${l.shootsCount}` : ''}</Text>
                  </View>
                </Pressable>
                {l.status === 'rejected' ? <Text style={crew.error}>Not approved{l.rejectionReason ? `: ${l.rejectionReason}` : ''}. Edit and save to resubmit.</Text> : null}
                {l.status === 'pending' ? <Text style={crew.mono}>Waiting on an admin — they check your proof, then it’s public.</Text> : null}
                <View style={[crew.row, { flexWrap: 'wrap' }]}>
                  <Pressable style={crew.btnSm} onPress={() => router.push(`/locations/new?edit=${l.id}`)}><Text style={crew.btnSmText}>Edit</Text></Pressable>
                  {l.status === 'listed' ? <Pressable style={crew.btnSm} disabled={busy === l.id} onPress={() => setStatus(l, 'paused')}><Text style={crew.btnSmText}>Pause</Text></Pressable> : null}
                  {l.status === 'paused' ? <Pressable style={crew.btnSm} disabled={busy === l.id} onPress={() => setStatus(l, 'listed')}><Text style={crew.btnSmText}>Resume</Text></Pressable> : null}
                  {['listed', 'paused'].includes(l.status) ? <Pressable style={crew.btnSm} onPress={() => setBlocking(blocking === l.id ? null : l.id)}><Text style={crew.btnSmText}>{blocking === l.id ? 'Close calendar' : 'Block days'}</Text></Pressable> : null}
                  <Pressable style={[crew.btnSm, crew.btnGhost]} disabled={busy === l.id} onPress={() => setStatus(l, 'removed')}><Text style={[crew.btnSmText, { color: colors.danger }]}>Remove</Text></Pressable>
                </View>
                {blocking === l.id ? <BlockDays listing={l} token={getToken} /> : null}
              </View>
            ))}

            {listings.length > 0 ? <View style={{ marginTop: 8 }}><PayoutsCard showEarningsLink={false} /></View> : null}
            <Text style={[crew.muted, { marginTop: 12 }]}>A place is public once an admin has checked you can let a crew in. The street address stays private until a booking is paid. Studio Tapa keeps 10% of a booking; the producer covers the card fee.</Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function BlockDays({ listing, token }) {
  const [month, setMonth] = useState(thisMonth());
  const [days, setDays] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  useFocusEffect(useCallback(() => {
    let alive = true;
    resolveToken(token).then((t) => apiGet(`/api/locations/${listing.id}`, t)).then((d) => { if (alive) setDays(new Set(d.listing.blockedDays || [])); }).catch(() => { if (alive) setDays(new Set()); });
    return () => { alive = false; };
  }, [listing.id, token]));

  const marks = {};
  for (const d of days || []) marks[d] = 'blocked';
  const pick = (iso) => setDays((s) => { const n = new Set(s); if (n.has(iso)) n.delete(iso); else n.add(iso); return n; });
  async function save() {
    setBusy(true);
    setNote(null);
    try {
      await apiPost(`/api/locations/${listing.id}/blocked-days`, { days: [...days] }, await resolveToken(token));
      setNote('Saved.');
    } catch (err) {
      setNote(err.message);
    } finally {
      setBusy(false);
    }
  }
  if (!days) return <ActivityIndicator color={colors.brass} />;
  return (
    <View style={{ gap: 8, backgroundColor: colors.surface2, borderRadius: 10, padding: 10 }}>
      <Text style={crew.mono}>Tap a day to block or unblock it. Paid bookings block days on their own.</Text>
      <MonthCalendar month={month} onMonth={setMonth} marks={marks} min={todayIso()} onPick={pick} />
      <View style={crew.row}>
        <Pressable style={[crew.btnSm, crew.btnPrimary, busy && { opacity: 0.5 }]} disabled={busy} onPress={save}><Text style={[crew.btnSmText, crew.btnPrimaryText]}>{busy ? 'Saving…' : 'Save blocked days'}</Text></Pressable>
        <Text style={crew.mono}>{days.size} blocked{note ? ` · ${note}` : ''}</Text>
      </View>
    </View>
  );
}
