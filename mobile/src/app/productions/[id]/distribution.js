import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { apiGet, apiPatch, apiPost, apiDelete, freshToken, API_BASE_URL } from '../../../lib/api';
import { colors, fonts } from '../../../lib/theme';
import TopNav from '../../../components/TopNav';
import { crew, Chip } from '../../../components/CrewBits';

// A production's distribution page (pages/productions/<id>/distribution
// on the web, migration 109): the release checklist, the festival
// tracker, premiere / trailer / press kit, and private screener links.
const FESTIVAL_STATUS = { planning: 'Planning', submitted: 'Submitted', accepted: 'Accepted', declined: 'Declined', screened: 'Screened', skipped: 'Skipped' };
const DAYS = [3, 7, 14, 30, 60];
const fmtDate = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');

export default function DistributionScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const { getToken } = useAuth();
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [details, setDetails] = useState(null);
  const [fest, setFest] = useState({ name: '', deadline: '', feeCents: '', url: '' });
  const [scr, setScr] = useState({ episodeId: '', label: '', recipientEmail: '', days: 14, maxViews: '10' });
  const [newLink, setNewLink] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await apiGet(`/api/productions/${id}/distribution`, await freshToken(getToken));
      setState({ loading: false, error: null, data: d });
      setDetails((cur) => cur || { premiereOn: d.premiereOn || '', premiereNote: d.premiereNote || '', trailerUrl: d.trailerUrl || '', pressKitUrl: d.pressKitUrl || '', notes: d.notes || '' });
      setScr((s) => ({ ...s, episodeId: s.episodeId || (d.episodes[0] ? d.episodes[0].id : '') }));
    } catch (err) {
      setState((s) => ({ loading: false, error: s.data ? null : err.message, data: s.data }));
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function act(fn, okNote) {
    setBusy(true);
    setNote(null);
    try {
      const d = await fn(await freshToken(getToken));
      if (d && d.checklist) setState((s) => ({ ...s, data: d })); else await load();
      if (okNote) setNote(okNote);
      return d || true;
    } catch (err) {
      setNote(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  const d = state.data;
  const c = d ? d.checklist : null;
  const saveFestivals = (list) => act((t) => apiPatch(`/api/productions/${id}/distribution`, { festivals: list }, t));

  return (
    <SafeAreaView style={crew.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView contentContainerStyle={crew.stage} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.push(`/productions/${id}`)} hitSlop={8}><Text style={crew.mono}>‹ Back to the production</Text></Pressable>
        {state.loading ? <ActivityIndicator color={colors.brass} style={{ marginTop: 32 }} /> : null}
        {state.error ? <Text style={crew.error}>{state.error}</Text> : null}
        {d ? (
          <>
            <Text style={[crew.eyebrow, { marginTop: 10 }]}>Distribution</Text>
            <Text style={crew.h1}>{d.production.title}</Text>
            <Text style={crew.lead}>Where it goes after the cut: Studio Tapa, Buy to own, early screenings, festivals, press — and private screeners for the people who decide.</Text>
            {note ? <Text style={[crew.mono, { color: colors.ok, marginBottom: 8 }]}>{note}</Text> : null}

            <View style={crew.panel}>
              <Text style={crew.h3}>The release plan</Text>
              {[
                ['On Studio Tapa', c.released, d.release ? `Released as ${d.release.title}.` : 'Upload the title, then link it on the production page.'],
                ['Buy to own', c.buyToOwn, c.buyToOwn ? 'Priced.' : d.release ? 'Set a price from My Work.' : 'Opens once released.'],
                ['Early screening', c.earlyScreening, c.earlyScreening ? 'Premium members see it first.' : 'A future release date gives Premium the first day.'],
                ['Festivals', c.festivalsSubmitted > 0, d.festivals.length ? `${c.festivalsSubmitted} submitted · ${c.festivalsIn} in` : 'Nothing on the tracker yet.'],
                ['Trailer', c.trailer, c.trailer ? 'Linked.' : 'Add a link below.'],
                ['Press kit', c.pressKit, c.pressKit ? 'Linked.' : 'Stills, logline, bios, poster — one folder link.'],
                ['Shot here', c.shotHere > 0, c.shotHere ? `${c.shotHere} ${c.shotHere === 1 ? 'place credits' : 'places credit'} the title.` : 'Credit the places from their listings.'],
                ['Screeners', c.screenersLive > 0, c.screenersLive ? `${c.screenersLive} live.` : 'Make a private link below.']
              ].map(([k, on, v]) => (
                <View key={k} style={styles.check}>
                  <Text style={[styles.checkK, on && { color: colors.ink }]}>{on ? '✓ ' : '○ '}{k}</Text>
                  <Text style={styles.checkV}>{v}</Text>
                </View>
              ))}
            </View>

            {details ? (
              <View style={crew.panel}>
                <Text style={crew.h3}>Premiere, trailer, press kit</Text>
                <View style={crew.row}>
                  <TextInput style={[crew.input, { flex: 1 }]} value={details.premiereOn} onChangeText={(v) => setDetails({ ...details, premiereOn: v })} placeholder="Premiere (YYYY-MM-DD)" placeholderTextColor={colors.inkFaint} autoCapitalize="none" />
                  <TextInput style={[crew.input, { flex: 2 }]} value={details.premiereNote} onChangeText={(v) => setDetails({ ...details, premiereNote: v })} placeholder="Where" placeholderTextColor={colors.inkFaint} maxLength={200} />
                </View>
                <TextInput style={crew.input} value={details.trailerUrl} onChangeText={(v) => setDetails({ ...details, trailerUrl: v })} placeholder="Trailer link" placeholderTextColor={colors.inkFaint} autoCapitalize="none" autoCorrect={false} />
                <TextInput style={crew.input} value={details.pressKitUrl} onChangeText={(v) => setDetails({ ...details, pressKitUrl: v })} placeholder="Press kit link (a Drive / Dropbox folder)" placeholderTextColor={colors.inkFaint} autoCapitalize="none" autoCorrect={false} />
                <TextInput style={[crew.input, { minHeight: 70, textAlignVertical: 'top' }]} value={details.notes} onChangeText={(v) => setDetails({ ...details, notes: v })} placeholder="Notes to self" placeholderTextColor={colors.inkFaint} multiline maxLength={4000} />
                <Pressable style={[crew.btn, crew.btnPrimary, { alignSelf: 'flex-start' }, busy && { opacity: 0.6 }]} disabled={busy} onPress={() => act((t) => apiPatch(`/api/productions/${id}/distribution`, details, t), 'Saved.')}><Text style={[crew.btnText, crew.btnPrimaryText]}>Save</Text></Pressable>
              </View>
            ) : null}

            <View style={crew.panel}>
              <Text style={crew.h3}>Festival tracker · {d.festivals.length}</Text>
              {d.festivals.length === 0 ? <Text style={crew.muted}>Add the festivals you’re aiming at, with deadlines and fees, and mark what comes back.</Text> : null}
              {[...d.festivals].sort((a, b) => String(a.deadline || '9999').localeCompare(String(b.deadline || '9999'))).map((f) => (
                <View key={f.id} style={styles.fest}>
                  <Pressable onPress={() => f.url && Linking.openURL(f.url)}><Text style={styles.festName}>{f.name}{f.url ? ' ↗' : ''}</Text></Pressable>
                  <Text style={crew.mono}>{f.deadline ? `deadline ${fmtDate(f.deadline)}` : 'no deadline'}{f.feeCents != null ? ` · fee $${(f.feeCents / 100).toFixed(0)}` : ''}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 4 }}>
                    {Object.entries(FESTIVAL_STATUS).map(([k, v]) => <Chip key={k} label={v} on={f.status === k} onPress={() => f.status !== k && saveFestivals(d.festivals.map((x) => (x.id === f.id ? { ...x, status: k } : x)))} />)}
                    <Chip label="✕ remove" onPress={() => Alert.alert('Take this festival off the tracker?', f.name, [{ text: 'Keep' }, { text: 'Remove', style: 'destructive', onPress: () => saveFestivals(d.festivals.filter((x) => x.id !== f.id)) }])} />
                  </ScrollView>
                </View>
              ))}
              <View style={{ gap: 6, marginTop: 4 }}>
                <Text style={crew.label}>Add a festival</Text>
                <TextInput style={crew.input} value={fest.name} onChangeText={(v) => setFest({ ...fest, name: v })} placeholder="Slamdance" placeholderTextColor={colors.inkFaint} maxLength={100} />
                <View style={crew.row}>
                  <TextInput style={[crew.input, { flex: 1 }]} value={fest.deadline} onChangeText={(v) => setFest({ ...fest, deadline: v })} placeholder="Deadline (YYYY-MM-DD)" placeholderTextColor={colors.inkFaint} autoCapitalize="none" />
                  <TextInput style={[crew.input, { width: 90 }]} value={fest.feeCents} onChangeText={(v) => setFest({ ...fest, feeCents: v.replace(/[^0-9.]/g, '') })} placeholder="Fee $" placeholderTextColor={colors.inkFaint} keyboardType="decimal-pad" />
                </View>
                <TextInput style={crew.input} value={fest.url} onChangeText={(v) => setFest({ ...fest, url: v })} placeholder="Link (filmfreeway…)" placeholderTextColor={colors.inkFaint} autoCapitalize="none" autoCorrect={false} />
                <Pressable style={[crew.btn, crew.btnPrimary, { alignSelf: 'flex-start' }, (!fest.name.trim() || busy) && { opacity: 0.6 }]} disabled={!fest.name.trim() || busy} onPress={() => saveFestivals([...d.festivals, { ...fest, feeCents: fest.feeCents === '' ? null : Math.round(Number(fest.feeCents) * 100), status: 'planning' }]).then((r) => r && setFest({ name: '', deadline: '', feeCents: '', url: '' }))}><Text style={[crew.btnText, crew.btnPrimaryText]}>Add to the tracker</Text></Pressable>
              </View>
            </View>

            <View style={crew.panel}>
              <Text style={crew.h3}>Screeners · {d.screeners.filter((s) => s.state === 'live').length} live</Text>
              <Text style={crew.muted}>A private link to the video for one person or committee: labelled, watermarked with who it’s for, expiring, capped on opens, logged, revocable.</Text>
              {newLink ? (
                <View style={styles.created}>
                  <Text style={crew.label}>Ready to send</Text>
                  <Text style={styles.link} selectable>{API_BASE_URL}{newLink.path}</Text>
                  <View style={crew.row}>
                    <Pressable style={crew.btnSm} onPress={async () => { await Clipboard.setStringAsync(`${API_BASE_URL}${newLink.path}`); setNote('Link copied.'); }}><Text style={crew.btnSmText}>Copy link</Text></Pressable>
                    <Pressable style={crew.btnSm} onPress={() => setNewLink(null)}><Text style={crew.btnSmText}>Done</Text></Pressable>
                  </View>
                </View>
              ) : null}
              {d.screeners.map((s) => (
                <View key={s.id} style={[styles.scr, s.state !== 'live' && { opacity: 0.65 }]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.festName}>{s.label}{s.recipientEmail ? <Text style={crew.mono}> · {s.recipientEmail}</Text> : null}</Text>
                    <Text style={crew.mono}>{s.state} · {s.views}/{s.maxViews} opens · until {new Date(s.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text>
                  </View>
                  {s.state === 'live' ? <Pressable style={crew.btnSm} onPress={async () => { await Clipboard.setStringAsync(`${API_BASE_URL}${s.path}`); setNote('Link copied.'); }}><Text style={crew.btnSmText}>Copy</Text></Pressable> : null}
                  {s.state === 'live' ? <Pressable style={crew.btnSm} disabled={busy} onPress={() => Alert.alert('Take down this screener?', 'The link stops working right away.', [{ text: 'Keep' }, { text: 'Take down', style: 'destructive', onPress: () => act((t) => apiDelete(`/api/productions/${id}/screeners`, { screenerId: s.id }, t)) }])}><Text style={crew.btnSmText}>Take down</Text></Pressable> : null}
                </View>
              ))}
              {d.episodes.length === 0 ? <Text style={crew.mono}>Upload the title (even before it’s approved) and it shows here to screen.</Text> : (
                <View style={{ gap: 6, marginTop: 4 }}>
                  <Text style={crew.label}>New screener · which cut</Text>
                  <View style={crew.chips}>{d.episodes.map((ep) => <Chip key={ep.id} label={`${ep.title}${ep.status === 'pending' ? ' (in review)' : ''}`} on={scr.episodeId === ep.id} onPress={() => setScr({ ...scr, episodeId: ep.id })} />)}</View>
                  <TextInput style={crew.input} value={scr.label} onChangeText={(v) => setScr({ ...scr, label: v })} placeholder="For (Sundance programmers)" placeholderTextColor={colors.inkFaint} maxLength={80} />
                  <TextInput style={crew.input} value={scr.recipientEmail} onChangeText={(v) => setScr({ ...scr, recipientEmail: v })} placeholder="Their email (optional, goes on the watermark)" placeholderTextColor={colors.inkFaint} autoCapitalize="none" keyboardType="email-address" />
                  <Text style={crew.label}>Good for</Text>
                  <View style={crew.chips}>{DAYS.map((n) => <Chip key={n} label={`${n} days`} on={scr.days === n} onPress={() => setScr({ ...scr, days: n })} />)}</View>
                  <View style={crew.row}>
                    <Text style={crew.label}>Opens allowed</Text>
                    <TextInput style={[crew.input, { width: 80 }]} value={scr.maxViews} onChangeText={(v) => setScr({ ...scr, maxViews: v.replace(/[^0-9]/g, '') })} keyboardType="number-pad" placeholder="10" placeholderTextColor={colors.inkFaint} />
                  </View>
                  <Pressable style={[crew.btn, crew.btnPrimary, { alignSelf: 'flex-start' }, (busy || !scr.episodeId || scr.label.trim().length < 2) && { opacity: 0.6 }]} disabled={busy || !scr.episodeId || scr.label.trim().length < 2} onPress={() => act(async (t) => { const r = await apiPost(`/api/productions/${id}/screeners`, scr, t); setNewLink(r.screener); setScr({ ...scr, label: '', recipientEmail: '' }); return null; })}><Text style={[crew.btnText, crew.btnPrimaryText]}>Make the link</Text></Pressable>
                </View>
              )}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  check: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  checkK: { fontFamily: fonts.displaySemi, fontSize: 13.5, color: colors.inkFaint, width: 130 },
  checkV: { fontFamily: fonts.body, fontSize: 13, color: colors.inkDim, flex: 1, lineHeight: 18 },
  fest: { backgroundColor: colors.surface2, borderRadius: 10, padding: 10, gap: 2, borderLeftWidth: 3, borderLeftColor: colors.sky },
  festName: { fontFamily: fonts.displaySemi, fontSize: 14.5, color: colors.ink },
  created: { gap: 6, padding: 10, borderRadius: 10, backgroundColor: 'rgba(132,205,152,0.1)', borderWidth: 1, borderColor: 'rgba(132,205,152,0.4)' },
  link: { fontFamily: fonts.mono, fontSize: 11.5, color: colors.olive },
  scr: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface2, borderRadius: 10, padding: 10 }
});
