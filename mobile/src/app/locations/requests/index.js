import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import * as WebBrowser from 'expo-web-browser';
import { apiGet } from '../../../lib/api';
import { colors } from '../../../lib/theme';
import TopNav from '../../../components/TopNav';
import { crew } from '../../../components/CrewBits';
import { RequestCard } from '../../../components/LocationBits';

// Your requests (pages/locations/requests on the web): places you've
// asked for, as a producer. Hosts answer theirs on Your places.
export default function MyRequests() {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken, userId } = useAuth();
  const signedIn = Boolean(isLoaded && isSignedIn);
  const tokenRef = useRef(null);
  const [state, setState] = useState({ loading: true, error: null, requests: [], hostCount: 0 });

  const load = useCallback(async () => {
    if (!signedIn) { setState({ loading: false, error: null, requests: [], hostCount: 0 }); return; }
    try {
      tokenRef.current = await Promise.race([getToken().catch(() => null), new Promise((r) => setTimeout(() => r(null), 4000))]);
      const d = await apiGet('/api/locations/requests', tokenRef.current);
      setState({ loading: false, error: null, requests: d.asProducer, hostCount: d.asHost.filter((r) => ['requested', 'countered'].includes(r.status)).length });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err.message }));
    }
  }, [signedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const update = (r) => setState((s) => ({ ...s, requests: s.requests.map((x) => (x.id === r.id ? r : x)) }));
  const onPay = async (url) => { await WebBrowser.openBrowserAsync(url); load(); };
  const open = state.requests.filter((r) => ['requested', 'countered', 'accepted', 'paid'].includes(r.status));
  const past = state.requests.filter((r) => !open.includes(r));
  const card = (r) => <RequestCard key={r.id} r={r} side="producer" token={tokenRef.current} userId={userId} onChange={update} onPay={onPay} onOpen={() => router.push(`/locations/requests/${r.id}`)} onMessage={() => router.push(`/messages/${r.threadId}`)} />;

  return (
    <SafeAreaView style={crew.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView contentContainerStyle={crew.stage} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.push('/locations')} hitSlop={8}><Text style={crew.mono}>‹ Locations</Text></Pressable>
        <Text style={[crew.eyebrow, { marginTop: 10 }]}>Locations</Text>
        <Text style={crew.h1}>Your requests</Text>
        <Text style={crew.lead}>Places you’ve asked for. A host has 48 hours to answer; once they accept, pay to confirm and the address unlocks.</Text>
        {!signedIn ? (
          <Pressable style={[crew.btn, crew.btnPrimary, { alignSelf: 'flex-start' }]} onPress={() => router.push('/account')}><Text style={[crew.btnText, crew.btnPrimaryText]}>Sign in</Text></Pressable>
        ) : (
          <>
            <View style={[crew.row, { marginBottom: 12, flexWrap: 'wrap' }]}>
              <Pressable style={[crew.btn, crew.btnPrimary]} onPress={() => router.push('/locations')}><Text style={[crew.btnText, crew.btnPrimaryText]}>Find a place</Text></Pressable>
              {state.hostCount > 0 ? <Pressable style={crew.btn} onPress={() => router.push('/locations/mine')}><Text style={crew.btnText}>{state.hostCount} waiting on you as a host</Text></Pressable> : null}
            </View>
            {state.loading ? <ActivityIndicator color={colors.brass} style={{ marginTop: 16 }} /> : null}
            {state.error ? <Text style={crew.error}>{state.error}</Text> : null}
            {!state.loading && state.requests.length === 0 ? <Text style={crew.empty}>No requests yet. Find a place and ask for dates.</Text> : null}
            {open.map(card)}
            {past.length > 0 ? <Text style={[crew.h3, { marginTop: 8, marginBottom: 6 }]}>Past</Text> : null}
            {past.map(card)}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
