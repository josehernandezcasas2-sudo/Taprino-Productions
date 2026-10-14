import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import * as WebBrowser from 'expo-web-browser';
import { apiGet } from '../../../lib/api';
import { colors } from '../../../lib/theme';
import TopNav from '../../../components/TopNav';
import SmartImage from '../../../components/SmartImage';
import { crew, Chip, Avatar } from '../../../components/CrewBits';
import { StatusChip, MoneyLine, HostAnswer, ProducerActions, OutcomeForm, EndorseForm, HostedChip, KV, loc } from '../../../components/LocationBits';
import { dollars, fmtRange, hoursLabel } from '../../../lib/locationRules';

// One booking request, both sides (pages/locations/requests/<id> on the
// web). Once paid, the producer sees the street address here. Paying
// opens Stripe Checkout in the in-app browser; the request is re-read
// when it closes.
const STEPS = [['requested', 'Requested'], ['accepted', 'Accepted'], ['paid', 'Paid'], ['done', 'Done']];
const stepIndex = (r) => (r.status === 'done' || r.status === 'refunded' ? 3 : r.status === 'paid' ? 2 : r.status === 'accepted' ? 1 : 0);

export default function RequestScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const { isLoaded, isSignedIn, getToken, userId } = useAuth();
  const signedIn = Boolean(isLoaded && isSignedIn);
  const tokenRef = useRef(null);
  const [state, setState] = useState({ loading: true, error: null, r: null, rules: null });

  const load = useCallback(async () => {
    if (!signedIn) { setState({ loading: false, error: 'Sign in to see this request.', r: null, rules: null }); return; }
    try {
      tokenRef.current = await Promise.race([getToken().catch(() => null), new Promise((r) => setTimeout(() => r(null), 4000))]);
      const [d, rules] = await Promise.all([apiGet(`/api/locations/requests/${id}`, tokenRef.current), apiGet('/api/locations/requests', tokenRef.current).then((x) => x.rules).catch(() => null)]);
      setState({ loading: false, error: null, r: d.request, rules });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: s.r ? null : err.message }));
    }
  }, [id, signedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const setR = (r) => setState((s) => ({ ...s, r }));
  const onPay = async (url) => { await WebBrowser.openBrowserAsync(url); load(); };
  const r = state.r;
  const side = r ? (r.mineAsHost ? 'host' : r.mineAsProducer ? 'producer' : 'admin') : null;
  const other = r ? (side === 'host' ? r.producer : r.host) : null;
  const l = r ? r.listing : null;
  const dead = r ? ['declined', 'expired', 'cancelled'].includes(r.status) : false;
  const paidSide = r ? ['paid', 'done', 'refunded'].includes(r.status) : false;
  const policy = l && state.rules ? state.rules.cancellation[l.cancellation] : null;

  return (
    <SafeAreaView style={crew.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView contentContainerStyle={crew.stage} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.push(side === 'host' ? '/locations/mine' : '/locations/requests'))} hitSlop={8}><Text style={crew.mono}>‹ {side === 'host' ? 'Your places' : 'Your requests'}</Text></Pressable>
        {state.loading ? <ActivityIndicator color={colors.brass} style={{ marginTop: 32 }} /> : null}
        {state.error ? <Text style={crew.error}>{state.error}</Text> : null}
        {r ? (
          <>
            <Text style={[crew.eyebrow, { marginTop: 10 }]}>{side === 'host' ? 'A request for your place' : 'Your request'}</Text>
            <Text style={crew.h1}>{r.projectTitle || r.shooting}</Text>
            <Text style={[crew.lead, { marginBottom: 8 }]}>{l ? l.title : 'A place'} · {fmtRange(r.startsOn, r.endsOn)}{r.hoursFrom && r.hoursTo ? ` · ${hoursLabel(r.hoursFrom, r.hoursTo)}` : ''} · {r.days} {r.days === 1 ? 'day' : 'days'}</Text>
            <View style={[crew.chips, { marginBottom: 10 }]}>
              <StatusChip r={r} />
              {STEPS.map(([k, label], i) => <Chip key={k} label={label} tone={(i <= stepIndex(r) && !dead) || (dead && i === 0) ? 'ok' : 'mute'} />)}
            </View>

            <View style={crew.panel}>
              <Text style={crew.h3}>The ask</Text>
              <KV k="Dates" v={fmtRange(r.startsOn, r.endsOn)} />
              <KV k="Hours" v={r.hoursFrom && r.hoursTo ? `${hoursLabel(r.hoursFrom, r.hoursTo)} · ${r.hoursPerDay} hrs a day` : `${r.hoursPerDay} hrs a day`} />
              <KV k="Crew" v={r.crewSize} />
              <KV k="Vehicles" v={r.vehicles} />
              <KV k="Project" v={r.projectTitle} />
              <KV k="Shooting" v={r.shooting} />
              {r.message ? <Text style={[crew.bio, { marginTop: 6 }]}>“{r.message}”</Text> : null}
            </View>

            <View style={crew.panel}>
              <Text style={crew.h3}>Money</Text>
              <KV k={r.pricing === 'offer' ? 'Offer' : 'Posted rate'} v={`${dollars(r.subtotalCents)} for ${r.days} ${r.days === 1 ? 'day' : 'days'}`} />
              {r.cleaningCents > 0 ? <KV k="Cleaning" v={dollars(r.cleaningCents)} /> : null}
              {r.status === 'countered' ? <KV k="Host’s counter" v={`${dollars(r.counterCents)}${r.counterNote ? ` · “${r.counterNote}”` : ''}`} /> : null}
              <KV k="Card fee" v={`${dollars(r.feeCoverCents)} (producer)`} />
              <KV k="Producer pays" v={dollars(r.totalChargedCents)} />
              <KV k="Host receives" v={`${dollars(r.hostPayoutCents)} after ${r.cutPercent}%`} />
              {r.refundCents != null ? <KV k="Refunded" v={`${dollars(r.refundCents)}${r.refundReason ? ` · ${r.refundReason}` : ''}`} /> : null}
              {policy ? <KV k="Cancellation" v={`${policy.label} · ${policy.text}`} /> : null}
              <MoneyLine r={r} side={side === 'host' ? 'host' : 'producer'} />
            </View>

            {paidSide && l && (l.address || l.accessNotes) ? (
              <View style={[crew.panel, { borderColor: colors.ok }]}>
                <Text style={crew.h3}>Address &amp; access · unlocked by the paid booking</Text>
                <KV k="Address" v={l.address} />
                <KV k="Access" v={l.accessNotes} />
                {l.rules ? <Text style={crew.muted}><Text style={{ color: colors.ink }}>House rules: </Text>{l.rules}</Text> : null}
              </View>
            ) : null}

            {r.outcome ? (
              <View style={crew.panel}>
                <Text style={crew.h3}>How it went</Text>
                <View style={crew.chips}>{r.outcome === 'as_agreed' ? <Chip label="✓ As agreed — a credit on the listing" tone="ok" /> : <Chip label={`${r.outcome.replace('_', ' ')} · an admin is looking at it`} tone="mute" />}</View>
                {r.outcomeNote ? <Text style={crew.muted}>{r.outcomeNote}</Text> : null}
                {r.endorsements.map((e) => <KV key={e.fromUserId} k={`${e.fromUserId === r.hostId ? r.host.displayName : r.producer.displayName} said`} v={`“${e.line}”`} />)}
              </View>
            ) : null}

            <View style={crew.panel}>
              <Text style={crew.h3}>{side === 'host' ? 'Your answer' : 'Next'}</Text>
              {side === 'host' ? <HostAnswer r={r} token={tokenRef.current} onChange={setR} /> : null}
              {side === 'producer' ? <ProducerActions r={r} token={tokenRef.current} onChange={setR} onPay={onPay} /> : null}
              {side === 'host' ? <OutcomeForm r={r} token={tokenRef.current} onChange={setR} /> : null}
              <EndorseForm r={r} userId={userId} token={tokenRef.current} onChange={setR} />
              {side === 'host' && r.status === 'accepted' ? <Text style={crew.mono}>Accepted — waiting on {other.displayName.split(' ')[0]} to pay. The dates stay open until they do.</Text> : null}
              {r.status === 'paid' && !r.pastEnd ? <Text style={crew.mono}>Confirmed. {side === 'host' ? 'After the last day you’ll be asked how it went.' : 'Take load-in and wrap photos and drop them in the conversation.'}</Text> : null}
              {side === 'host' && ['requested', 'countered'].includes(r.status) ? <Text style={crew.mono}>Accepting needs a payout account (Your places → Payouts).</Text> : null}
              {dead ? <Text style={crew.mono}>{r.declineReason ? `“${r.declineReason}”` : 'Nothing more to do here.'}</Text> : null}
              {r.threadId ? <Pressable style={[crew.btnSm, { alignSelf: 'flex-start' }]} onPress={() => router.push(`/messages/${r.threadId}`)}><Text style={crew.btnSmText}>Open the conversation</Text></Pressable> : null}
            </View>

            <View style={crew.panel}>
              <Pressable style={crew.row} onPress={() => router.push(other.profilePath)}>
                <Avatar userId={other.userId} name={other.displayName} src={other.avatarUrl} position={other.avatarPosition} zoom={other.avatarZoom || 1} size={40} />
                <View style={{ flex: 1 }}>
                  <View style={crew.nameRow}><Text style={crew.name}>{other.displayName}</Text>{side === 'producer' ? <HostedChip host={other} /> : null}</View>
                  <Text style={crew.mono}>{side === 'host' ? 'The producer' : 'The host'}</Text>
                </View>
              </Pressable>
              {l ? (
                <Pressable style={[crew.row, { alignItems: 'flex-start' }]} onPress={() => router.push(`/locations/${l.id}`)}>
                  <View style={loc.thumb}>{l.coverUrl ? <SmartImage uri={l.coverUrl} style={StyleSheet.absoluteFill} /> : null}</View>
                  <View style={{ flex: 1 }}><Text style={crew.name}>{l.title}</Text><Text style={crew.mono}>{l.kindLabel} · {l.place ? l.place.label : ''} · {l.rateLine}</Text></View>
                </Pressable>
              ) : null}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
