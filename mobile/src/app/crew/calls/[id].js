import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { apiGet, apiPatch, apiPost } from '../../../lib/api';
import { colors, fonts } from '../../../lib/theme';
import TopNav from '../../../components/TopNav';
import ReportSheet from '../../../components/ReportSheet';
import { crew, Chip, Avatar, TierChip, payStyle, fmtRange } from '../../../components/CrewBits';

// One call (pages/crew/calls/<id> on the web). Respond = a message to the
// poster with the call attached. The poster books people here and, after
// the last day, says who worked it — the confirmed job on their record.
export default function CallScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const { isLoaded, isSignedIn, getToken, userId } = useAuth();
  const signedIn = Boolean(isLoaded && isSignedIn);
  const tokenRef = useRef(null);
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [endorsing, setEndorsing] = useState(null);
  const [line, setLine] = useState('');

  const load = useCallback(async () => {
    try {
      tokenRef.current = signedIn ? await Promise.race([getToken().catch(() => null), new Promise((r) => setTimeout(() => r(null), 4000))]) : null;
      const data = await apiGet(`/api/crew/calls/${id}`, tokenRef.current);
      setState({ loading: false, error: null, data });
    } catch (err) {
      setState((s) => ({ loading: false, error: s.data ? null : err.message, data: s.data }));
    }
  }, [id, signedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function act(fn, okNote) {
    setBusy(true);
    setNote(null);
    try {
      const data = await fn();
      if (data && data.call) setState((s) => ({ ...s, data }));
      else await load();
      if (okNote) setNote(okNote);
    } catch (err) {
      setNote(err.message);
    } finally {
      setBusy(false);
    }
  }

  const data = state.data;
  const call = data ? data.call : null;
  const isPoster = Boolean(call && userId && call.poster.userId === userId);

  const respond = () => act(async () => {
    await apiPost(`/api/crew/calls/${id}/respond`, { message: reply }, tokenRef.current);
    setReply('');
    return null;
  }, `Sent — it's in your Messages with the call attached.`);
  const book = (responseId, action) => act(() => apiPost(`/api/crew/calls/${id}/book`, { responseId, action }, tokenRef.current));
  const outcome = (responseId, value) => act(async () => {
    const d = await apiPost(`/api/crew/calls/${id}/outcome`, { responseId, outcome: value }, tokenRef.current);
    if (value === 'worked') setEndorsing(responseId);
    return d;
  });
  const setStatus = (status) => act(() => apiPatch(`/api/crew/calls/${id}`, { status }, tokenRef.current));
  const endorse = () => act(async () => {
    await apiPost('/api/crew/endorse', { responseId: endorsing, line, wouldAgain: true }, tokenRef.current);
    setEndorsing(null);
    setLine('');
    return null;
  }, 'Thanks — it shows on their profile.');

  const first = (name) => String(name || '').split(' ')[0];

  return (
    <SafeAreaView style={crew.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView contentContainerStyle={crew.stage} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.push('/crew/calls'))} hitSlop={8}><Text style={crew.mono}>‹ Calls</Text></Pressable>
        {state.loading ? <ActivityIndicator color={colors.brass} style={{ marginTop: 32 }} /> : null}
        {state.error ? <Text style={crew.error}>{state.error}</Text> : null}
        {call ? (
          <>
            <Text style={[crew.eyebrow, { marginTop: 10 }]}>{call.status === 'open' ? 'Open call' : 'Closed'}{call.projectTitle ? ` · ${call.projectType === 'pitch' ? 'Pitch Room' : 'Series'} · ${call.projectTitle}` : ''}</Text>
            <Text style={crew.h1}>{call.title}</Text>
            <View style={crew.panel}>
              <KV k="Role" v={`${call.role}${call.spots > 1 ? ` · ${call.spots} spots` : ''}${isPoster ? ` · ${data.booked} booked` : ''}`} />
              <KV k="When" v={fmtRange(call.startsOn, call.endsOn)} />
              <KV k="Where" v={call.remote ? 'Remote — anyone with the role, anywhere' : `${call.place}${call.miles != null ? ` · ${call.miles} mi from you` : ''}`} />
              <View style={crew.row}>
                <Text style={crew.label}>Pay</Text>
                <View style={[crew.chip, payStyle(call.payType)]}><Text style={[crew.chipText, { color: payStyle(call.payType).color }]}>{call.payLabel.toLowerCase()}</Text></View>
                <Text style={crew.rowText}>{call.payNote}</Text>
              </View>
              <Pressable style={[crew.row, { marginTop: 4 }]} onPress={() => router.push(call.poster.profilePath)}>
                <Avatar userId={call.poster.userId} name={call.poster.displayName} src={call.poster.avatarUrl} size={30} />
                <Text style={crew.rowText}>{call.poster.displayName}</Text>
                {call.poster.verified ? <Text style={crew.ver}>✓ CREATOR</Text> : null}
                <TierChip person={call.poster} />
              </Pressable>
              {call.details ? <Text style={[crew.rowText, { color: colors.inkDim, lineHeight: 20 }]}>{call.details}</Text> : null}
              <Text style={crew.mono}>{first(call.poster.displayName)} has posted {call.poster.posted} {call.poster.posted === 1 ? 'call' : 'calls'} · {call.poster.filled} filled · {call.poster.jobs} confirmed {call.poster.jobs === 1 ? 'job' : 'jobs'} worked</Text>
            </View>

            {note ? <Text style={[crew.mono, { color: colors.ok, marginBottom: 8 }]}>{note}</Text> : null}

            {/* responder side */}
            {!isPoster && call.status === 'open' && !signedIn ? (
              <Pressable style={[crew.btn, crew.btnPrimary, { alignSelf: 'flex-start' }]} onPress={() => router.push('/account')}><Text style={[crew.btnText, crew.btnPrimaryText]}>Sign in to respond</Text></Pressable>
            ) : null}
            {!isPoster && data.canRespond ? (
              <View style={crew.panel}>
                <Text style={crew.label}>Respond</Text>
                <TextInput style={[crew.input, { minHeight: 90, textAlignVertical: 'top' }]} value={reply} onChangeText={setReply} placeholder="Say when you're free, what you bring, and your rate." placeholderTextColor={colors.inkFaint} multiline maxLength={2000} />
                <Pressable style={[crew.btn, crew.btnPrimary, { alignSelf: 'flex-start' }, (busy || reply.trim().length < 2) && { opacity: 0.5 }]} onPress={respond} disabled={busy || reply.trim().length < 2}><Text style={[crew.btnText, crew.btnPrimaryText]}>Send response</Text></Pressable>
                <Text style={crew.mono}>Goes to {first(call.poster.displayName)}'s inbox with the call attached.</Text>
              </View>
            ) : null}
            {!isPoster && data.viewerResponse ? (
              <View style={crew.panel}>
                <View style={crew.chips}>
                  {data.viewerResponse.status === 'booked' ? <Chip label="You're booked" tone="ok" /> : null}
                  {data.viewerResponse.status === 'declined' ? <Chip label="Not this time" tone="mute" /> : null}
                  {data.viewerResponse.status === 'sent' ? <Chip label="You responded" /> : null}
                  {data.viewerResponse.outcome === 'worked' ? <Chip label="✓ Confirmed job — on your track record" tone="ok" /> : null}
                </View>
                <View style={crew.row}>
                  {data.viewerResponse.threadId ? <Pressable style={crew.btnSm} onPress={() => router.push(`/messages/${data.viewerResponse.threadId}`)}><Text style={crew.btnSmText}>Open the conversation</Text></Pressable> : null}
                  {data.viewerResponse.outcome === 'worked' && !data.viewerResponse.endorsed && !endorsing ? <Pressable style={[crew.btnSm, crew.btnPrimary]} onPress={() => setEndorsing(data.viewerResponse.id)}><Text style={[crew.btnSmText, crew.btnPrimaryText]}>Leave {first(call.poster.displayName)} a line</Text></Pressable> : null}
                </View>
                {endorsing ? <Endorse line={line} setLine={setLine} onSend={endorse} onSkip={() => setEndorsing(null)} busy={busy} who={first(call.poster.displayName)} /> : null}
              </View>
            ) : null}

            {/* poster side */}
            {isPoster ? (
              <View style={crew.panel}>
                <View style={crew.row}>
                  <Pressable style={crew.btnSm} onPress={() => setStatus(call.status === 'open' ? 'closed' : 'open')} disabled={busy}><Text style={crew.btnSmText}>{call.status === 'open' ? 'Close the call' : 'Reopen'}</Text></Pressable>
                  <Text style={crew.mono}>{data.booked} of {call.spots} booked</Text>
                </View>
                <Text style={crew.h4}>Responses{data.responses && data.responses.length ? ` · ${data.responses.length}` : ''}</Text>
                {!data.responses || data.responses.length === 0 ? <Text style={crew.muted}>No responses yet. Matching people were told when you posted.</Text> : null}
                {(data.responses || []).map((r) => (
                  <View key={r.id} style={[styles.resp, (r.status === 'booked' || r.outcome === 'worked') && styles.respBooked]}>
                    <Pressable style={crew.row} onPress={() => router.push(r.person.profilePath)}>
                      <Avatar userId={r.person.userId} name={r.person.displayName} src={r.person.avatarUrl} size={30} />
                      <View style={{ flex: 1 }}>
                        <View style={crew.nameRow}><Text style={crew.name}>{r.person.displayName}</Text>{r.person.verified ? <Text style={crew.ver}>✓ CREATOR</Text> : null}<TierChip person={r.person} /></View>
                        <Text style={crew.mono}>{r.person.jobs} confirmed {r.person.jobs === 1 ? 'job' : 'jobs'} · {r.person.titles} released {r.person.titles === 1 ? 'title' : 'titles'}{r.person.wouldAgain ? ` · ${r.person.wouldAgain} would work again` : ''}</Text>
                      </View>
                    </Pressable>
                    <Text style={[crew.bio, { color: colors.inkDim }]}>“{r.message}”</Text>
                    <View style={crew.chips}>
                      {r.status === 'booked' && !r.outcome ? <Chip label="Booked" tone="ok" /> : null}
                      {r.status === 'declined' ? <Chip label="Declined" tone="mute" /> : null}
                      {r.outcome === 'worked' ? <Chip label="✓ Worked it" tone="ok" /> : null}
                      {r.outcome === 'no_show' ? <Chip label="Didn't happen" tone="mute" /> : null}
                    </View>
                    {r.status === 'booked' && !r.outcome && data.pastEnd ? (
                      <View style={styles.outcome}>
                        <Text style={crew.mono}>Did they work the job?</Text>
                        <View style={crew.row}>
                          <Pressable style={[crew.btnSm, crew.btnPrimary]} disabled={busy} onPress={() => outcome(r.id, 'worked')}><Text style={[crew.btnSmText, crew.btnPrimaryText]}>Yes, worked it</Text></Pressable>
                          <Pressable style={crew.btnSm} disabled={busy} onPress={() => outcome(r.id, 'no_show')}><Text style={crew.btnSmText}>Didn't happen</Text></Pressable>
                        </View>
                      </View>
                    ) : null}
                    {endorsing === r.id ? <Endorse line={line} setLine={setLine} onSend={endorse} onSkip={() => setEndorsing(null)} busy={busy} who={first(r.person.displayName)} /> : null}
                    <View style={[crew.row, { flexWrap: 'wrap' }]}>
                      {r.threadId ? <Pressable style={crew.btnSm} onPress={() => router.push(`/messages/${r.threadId}`)}><Text style={crew.btnSmText}>Message</Text></Pressable> : null}
                      {r.status === 'sent' && call.status === 'open' ? <Pressable style={[crew.btnSm, crew.btnPrimary]} disabled={busy} onPress={() => book(r.id, 'book')}><Text style={[crew.btnSmText, crew.btnPrimaryText]}>Book</Text></Pressable> : null}
                      {r.status === 'sent' ? <Pressable style={crew.btnSm} disabled={busy} onPress={() => book(r.id, 'decline')}><Text style={crew.btnSmText}>Decline</Text></Pressable> : null}
                      {r.status === 'booked' && !r.outcome ? <Pressable style={crew.btnSm} disabled={busy} onPress={() => book(r.id, 'unbook')}><Text style={crew.btnSmText}>Unbook</Text></Pressable> : null}
                      {r.outcome === 'worked' && !r.endorsedByPoster && endorsing !== r.id ? <Pressable style={crew.btnSm} onPress={() => setEndorsing(r.id)}><Text style={crew.btnSmText}>Leave a line</Text></Pressable> : null}
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            {!isPoster && signedIn ? (
              <View style={{ alignItems: 'flex-start', marginTop: 4 }}>
                <ReportSheet targetType="call" targetId={call.id} title={call.title} />
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function KV({ k, v }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
      <Text style={[crew.label, { width: 52, marginTop: 3 }]}>{k}</Text>
      <Text style={[crew.rowText, { flex: 1 }]}>{v}</Text>
    </View>
  );
}

function Endorse({ line, setLine, onSend, onSkip, busy, who }) {
  return (
    <View style={{ gap: 6, marginTop: 6 }}>
      <TextInput style={crew.input} value={line} onChangeText={setLine} placeholder={`One line about working with ${who}`} placeholderTextColor={colors.inkFaint} maxLength={200} />
      <View style={crew.row}>
        <Pressable style={[crew.btnSm, crew.btnPrimary, (!line.trim() || busy) && { opacity: 0.5 }]} disabled={!line.trim() || busy} onPress={onSend}><Text style={[crew.btnSmText, crew.btnPrimaryText]}>Post it</Text></Pressable>
        <Pressable style={crew.btnSm} onPress={onSkip}><Text style={crew.btnSmText}>Skip</Text></Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  resp: { gap: 8, backgroundColor: colors.surface2, borderRadius: 10, padding: 10 },
  respBooked: { borderWidth: 1, borderColor: 'rgba(132,205,152,0.5)' },
  outcome: { gap: 6, padding: 8, borderRadius: 8, backgroundColor: 'rgba(231,162,85,0.1)', borderWidth: 1, borderColor: 'rgba(231,162,85,0.35)' }
});
