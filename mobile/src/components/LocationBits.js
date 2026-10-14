import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { apiPatch, apiPost } from '../lib/api';
import { colors, fonts } from '../lib/theme';
import { crew, Avatar, Chip } from './CrewBits';
import SmartImage from './SmartImage';
import { dollars, fmtRange, fmtDay, hoursLabel, STATUS_LABEL } from '../lib/locationRules';

// Pieces shared by the Locations screens (locations/*): mirrors
// components/locations/LocationBits.js + RequestBits.js on the website.

export function HostedChip({ host }) {
  if (!host) return null;
  const n = host.hosted || 0;
  return <Chip label={n > 0 ? `Hosted ${n}` : 'New host'} tone={n > 0 ? 'gear' : 'role'} />;
}

export function StatusPill({ status }) {
  const tone = status === 'listed' ? 'ok' : status === 'pending' ? 'gear' : 'mute';
  return <Chip label={STATUS_LABEL[status] || status} tone={tone} />;
}

export function hoursLeft(iso) {
  if (!iso) return null;
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 3600000));
}

export function StatusChip({ r }) {
  const tone = { requested: 'gear', countered: 'gear', accepted: 'ok', paid: 'ok', done: 'ok', refunded: 'mute' }[r.status] || 'mute';
  const left = ['requested', 'countered'].includes(r.status) ? hoursLeft(r.respondsBy) : null;
  return <Chip label={`${r.statusLabel}${left != null ? ` · ${left} h left` : ''}${r.outcome && r.outcome !== 'as_agreed' ? ` · ${r.outcome.replace('_', ' ')}` : ''}`} tone={tone} />;
}

// A listing in the directory.
export function ListingCard({ l, from, onOpen }) {
  const cover = l.coverUrl || (l.photos[0] && l.photos[0].url);
  const facts = [l.sqFt ? `${l.sqFt.toLocaleString()} sq ft` : null, l.crewMax ? `crew up to ${l.crewMax}` : null, l.features.includes('quiet') ? 'quiet' : null].filter(Boolean);
  return (
    <Pressable style={loc.card} onPress={onOpen}>
      <View style={loc.cardPh}>
        {cover ? <SmartImage uri={cover} style={StyleSheet.absoluteFill} /> : null}
        <Text style={loc.k}>{l.photoCount} {l.photoCount === 1 ? 'photo' : 'photos'}</Text>
        {from && l.openOnDates ? <Text style={loc.pin}>Open {fmtRange(from)}</Text> : null}
      </View>
      <View style={{ padding: 12, gap: 4 }}>
        <Text style={crew.mono}>{l.kindLabel.toUpperCase()} · {l.place ? l.place.label.split(',')[0].toUpperCase() : ''}{l.miles != null ? ` · ${l.miles} MI` : ''}</Text>
        <Text style={loc.cardT}>{l.title}</Text>
        {facts.length ? <Text style={crew.mono}>{facts.join(' · ')}</Text> : null}
        <Text style={loc.rate}><Text style={{ color: colors.olive }}>{l.rateLine}</Text>{l.hourlyCents ? ` · ${l.minHours} hr min` : ''}</Text>
        <View style={[crew.row, { marginTop: 4, flexWrap: 'wrap' }]}>
          <Avatar userId={l.host.userId} name={l.host.displayName} src={l.host.avatarUrl} position={l.host.avatarPosition} zoom={l.host.avatarZoom || 1} size={24} />
          <Text style={crew.meta}>{l.host.displayName}</Text>
          <HostedChip host={l.host} />
          {l.verified ? <Chip label="✓" tone="ok" /> : null}
        </View>
      </View>
    </Pressable>
  );
}

// A month at a time. `marks` is { iso: 'booked' | 'blocked' | 'sel' };
// onPick(iso) for a tap on an open day.
export function MonthCalendar({ month, onMonth, marks = {}, min, onPick }) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < lead; i += 1) cells.push(null);
  for (let d = 1; d <= daysIn; d += 1) cells.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  while (cells.length % 7) cells.push(null);
  const shift = (n) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); onMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`); };
  const bg = { booked: 'rgba(248,95,115,0.16)', blocked: colors.surface3, sel: colors.olive, open: colors.surface2, past: colors.surface1 };
  const fg = { booked: colors.brass, blocked: colors.inkFaint, sel: colors.onBrass, open: colors.inkDim, past: colors.inkFaint };
  return (
    <View style={{ gap: 6 }}>
      <View style={[crew.row, { justifyContent: 'space-between' }]}>
        <Pressable style={crew.btnSm} onPress={() => shift(-1)}><Text style={crew.btnSmText}>‹</Text></Pressable>
        <Text style={{ fontFamily: fonts.displaySemi, color: colors.ink, fontSize: 14 }}>{first.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</Text>
        <Pressable style={crew.btnSm} onPress={() => shift(1)}><Text style={crew.btnSmText}>›</Text></Pressable>
      </View>
      <View style={loc.calRow}>{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <Text key={i} style={loc.calH}>{d}</Text>)}</View>
      {Array.from({ length: cells.length / 7 }).map((_, r) => (
        <View key={r} style={loc.calRow}>
          {cells.slice(r * 7, r * 7 + 7).map((iso, i) => {
            if (!iso) return <View key={`e${i}`} style={loc.calCell} />;
            const past = min && iso < min;
            const mark = marks[iso] || (past ? 'past' : 'open');
            const tappable = !past && onPick && (mark === 'open' || mark === 'sel' || mark === 'blocked');
            return (
              <Pressable key={iso} style={[loc.calCell, { backgroundColor: bg[mark] }]} disabled={!tappable} onPress={() => onPick(iso)}>
                <Text style={[loc.calD, { color: fg[mark] }, mark === 'booked' && { textDecorationLine: 'line-through' }]}>{Number(iso.slice(8))}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
      <View style={[crew.row, { flexWrap: 'wrap' }]}>
        {[['open', 'Open'], ['booked', 'Booked'], ['blocked', 'Blocked'], ['sel', 'Your dates']].map(([k, label]) => <View key={k} style={crew.row}><View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: bg[k] }} /><Text style={crew.mono}>{label}</Text></View>)}
      </View>
    </View>
  );
}

// Picks a photo from the library, shrinks it, and sends it up. Returns
// the stored URL.
export async function pickAndUpload(token, purpose = 'photo', width = 1600) {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('Photo library access is needed to pick an image.');
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  if (result.canceled || !result.assets || !result.assets[0]) return null;
  const rendered = await ImageManipulator.manipulate(result.assets[0].uri).resize({ width }).renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.85, base64: true });
  const data = await apiPost('/api/locations/upload', { base64: `data:image/jpeg;base64,${saved.base64}`, fileName: 'photo.jpg', purpose }, token);
  return data.url;
}

export async function requestAction(id, body, token) {
  return apiPatch(`/api/locations/requests/${id}`, body, token);
}

export function MoneyLine({ r, side }) {
  if (side === 'host') return <Text style={crew.mono}>You receive <Text style={{ color: colors.ink }}>{dollars(r.hostPayoutCents)}</Text> of {dollars(r.bookingCents)} after the {r.cutPercent}% cut{r.cleaningCents ? ` (incl. ${dollars(r.cleaningCents)} cleaning)` : ''}</Text>;
  return <Text style={crew.mono}>{dollars(r.bookingCents)} for the place{r.cleaningCents ? ` incl. ${dollars(r.cleaningCents)} cleaning` : ''}, <Text style={{ color: colors.ink }}>{dollars(r.totalChargedCents)}</Text> with the card fee</Text>;
}

// Host's answer: accept / counter / decline.
export function HostAnswer({ r, token, onChange }) {
  const [mode, setMode] = useState(null);
  const [counter, setCounter] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (!['requested', 'countered'].includes(r.status)) return null;
  const run = async (body) => {
    setBusy(true);
    setError(null);
    try { onChange((await requestAction(r.id, body, token)).request); setMode(null); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <View style={{ gap: 8 }}>
      {!mode ? (
        <View style={[crew.row, { flexWrap: 'wrap' }]}>
          {r.status === 'requested' ? <Pressable style={[crew.btnSm, crew.btnPrimary, busy && { opacity: 0.5 }]} disabled={busy} onPress={() => run({ action: 'accept' })}><Text style={[crew.btnSmText, crew.btnPrimaryText]}>Accept {dollars(r.bookingCents)}</Text></Pressable> : null}
          {r.status === 'countered' ? <Text style={crew.mono}>You countered {dollars(r.counterCents)} · waiting on {r.producer.displayName.split(' ')[0]}</Text> : null}
          {r.status === 'requested' ? <Pressable style={crew.btnSm} disabled={busy} onPress={() => setMode('counter')}><Text style={crew.btnSmText}>Counter</Text></Pressable> : null}
          <Pressable style={crew.btnSm} disabled={busy} onPress={() => setMode('decline')}><Text style={[crew.btnSmText, { color: colors.danger }]}>Decline</Text></Pressable>
        </View>
      ) : null}
      {mode === 'counter' ? (
        <View style={loc.answerForm}>
          <Text style={crew.label}>Counter with ($ for the whole booking, before cleaning)</Text>
          <TextInput style={crew.input} value={counter} onChangeText={(v) => setCounter(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder={String(Math.round(r.subtotalCents / 100))} placeholderTextColor={colors.inkFaint} />
          <TextInput style={crew.input} value={note} onChangeText={setNote} placeholder="A note (optional)" placeholderTextColor={colors.inkFaint} maxLength={300} />
          <View style={crew.row}>
            <Pressable style={[crew.btnSm, crew.btnPrimary, (busy || !(Number(counter) > 0)) && { opacity: 0.5 }]} disabled={busy || !(Number(counter) > 0)} onPress={() => run({ action: 'counter', counter, note })}><Text style={[crew.btnSmText, crew.btnPrimaryText]}>Send counter</Text></Pressable>
            <Pressable style={crew.btnSm} onPress={() => setMode(null)}><Text style={crew.btnSmText}>Back</Text></Pressable>
          </View>
        </View>
      ) : null}
      {mode === 'decline' ? (
        <View style={loc.answerForm}>
          <TextInput style={crew.input} value={note} onChangeText={setNote} placeholder="Why (optional, shown to them)" placeholderTextColor={colors.inkFaint} maxLength={300} />
          <View style={crew.row}>
            <Pressable style={crew.btnSm} disabled={busy} onPress={() => run({ action: 'decline', reason: note })}><Text style={[crew.btnSmText, { color: colors.danger }]}>Decline the request</Text></Pressable>
            <Pressable style={crew.btnSm} onPress={() => setMode(null)}><Text style={crew.btnSmText}>Back</Text></Pressable>
          </View>
        </View>
      ) : null}
      {error ? <Text style={crew.error}>{error}</Text> : null}
    </View>
  );
}

// Producer: take a counter, pay (in the in-app browser), cancel.
export function ProducerActions({ r, token, onChange, onPay }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (body) => {
    setBusy(true);
    setError(null);
    try {
      const data = await requestAction(r.id, body, token);
      if (data.url) { await onPay(data.url); return; }
      onChange(data.request);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const cancel = () => {
    const msg = r.status === 'paid' && r.refundPreview
      ? (r.refundPreview.cents > 0 ? `${dollars(r.refundPreview.cents)} (${r.refundPreview.percent}%) goes back to your card under the host’s cancellation policy.` : 'No refund inside the cancellation window.')
      : 'The host will be told.';
    Alert.alert(r.status === 'paid' ? 'Cancel this booking?' : 'Withdraw this request?', msg, [{ text: 'Keep it', style: 'cancel' }, { text: r.status === 'paid' ? 'Cancel booking' : 'Withdraw', style: 'destructive', onPress: () => run({ action: 'cancel' }) }]);
  };
  return (
    <View style={{ gap: 6 }}>
      <View style={[crew.row, { flexWrap: 'wrap' }]}>
        {r.status === 'countered' ? <Pressable style={[crew.btnSm, crew.btnPrimary, busy && { opacity: 0.5 }]} disabled={busy} onPress={() => run({ action: 'accept_counter' })}><Text style={[crew.btnSmText, crew.btnPrimaryText]}>Accept {dollars(r.counterCents)}{r.cleaningCents ? ` + ${dollars(r.cleaningCents)} cleaning` : ''}</Text></Pressable> : null}
        {r.status === 'accepted' ? <Pressable style={[crew.btnSm, crew.btnPrimary, busy && { opacity: 0.5 }]} disabled={busy} onPress={() => run({ action: 'pay' })}><Text style={[crew.btnSmText, crew.btnPrimaryText]}>{busy ? 'Opening Stripe…' : `Pay ${dollars(r.totalChargedCents)} to confirm`}</Text></Pressable> : null}
        {['requested', 'countered', 'accepted', 'paid'].includes(r.status) ? <Pressable style={crew.btnSm} disabled={busy} onPress={cancel}><Text style={[crew.btnSmText, { color: colors.inkDim }]}>{r.status === 'paid' ? 'Cancel booking' : 'Withdraw'}</Text></Pressable> : null}
      </View>
      {error ? <Text style={crew.error}>{error}</Text> : null}
    </View>
  );
}

// Host, after the last day.
export function OutcomeForm({ r, token, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [issue, setIssue] = useState(null);
  const [note, setNote] = useState('');
  if (r.status !== 'paid' || r.outcome || !r.pastEnd) return null;
  const run = async (outcome) => {
    setBusy(true);
    setError(null);
    try { onChange((await requestAction(r.id, { action: 'outcome', outcome, note }, token)).request); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <View style={loc.outcome}>
      <Text style={crew.mono}>Did the shoot go as agreed? This builds your record and their credit.</Text>
      {!issue ? (
        <View style={[crew.row, { flexWrap: 'wrap' }]}>
          <Pressable style={[crew.btnSm, crew.btnPrimary]} disabled={busy} onPress={() => run('as_agreed')}><Text style={[crew.btnSmText, crew.btnPrimaryText]}>Yes, as agreed</Text></Pressable>
          <Pressable style={crew.btnSm} disabled={busy} onPress={() => setIssue('damage')}><Text style={crew.btnSmText}>There was damage</Text></Pressable>
          <Pressable style={crew.btnSm} disabled={busy} onPress={() => setIssue('no_show')}><Text style={crew.btnSmText}>They didn’t show</Text></Pressable>
        </View>
      ) : (
        <View style={{ gap: 6 }}>
          <TextInput style={[crew.input, { minHeight: 70, textAlignVertical: 'top' }]} value={note} onChangeText={setNote} placeholder="What happened (an admin reads this)" placeholderTextColor={colors.inkFaint} multiline maxLength={1000} />
          <View style={crew.row}>
            <Pressable style={[crew.btnSm, (busy || note.trim().length < 5) && { opacity: 0.5 }]} disabled={busy || note.trim().length < 5} onPress={() => run(issue)}><Text style={crew.btnSmText}>Report {issue === 'damage' ? 'damage' : 'a no-show'}</Text></Pressable>
            <Pressable style={crew.btnSm} onPress={() => setIssue(null)}><Text style={crew.btnSmText}>Back</Text></Pressable>
          </View>
        </View>
      )}
      {error ? <Text style={crew.error}>{error}</Text> : null}
    </View>
  );
}

export function EndorseForm({ r, userId, token, onChange }) {
  const [line, setLine] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (r.outcome !== 'as_agreed' || r.viewerEndorsed) return null;
  const other = userId === r.hostId ? r.producer : r.host;
  const run = async () => {
    setBusy(true);
    setError(null);
    try { onChange((await requestAction(r.id, { action: 'endorse', line, wouldAgain: true }, token)).request); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <View style={{ gap: 6 }}>
      <TextInput style={crew.input} value={line} onChangeText={setLine} placeholder={`One line about ${other.displayName.split(' ')[0]} — it shows on their profile`} placeholderTextColor={colors.inkFaint} maxLength={200} />
      <Pressable style={[crew.btnSm, crew.btnPrimary, { alignSelf: 'flex-start' }, (busy || !line.trim()) && { opacity: 0.5 }]} disabled={busy || !line.trim()} onPress={run}><Text style={[crew.btnSmText, crew.btnPrimaryText]}>Post it</Text></Pressable>
      {error ? <Text style={crew.error}>{error}</Text> : null}
    </View>
  );
}

// One request in a list, from one side.
export function RequestCard({ r, side, token, userId, onChange, onOpen, onPay, onMessage }) {
  const other = side === 'host' ? r.producer : r.host;
  const hot = side === 'host' ? r.status === 'requested' : r.status === 'countered';
  return (
    <View style={[crew.panel, hot && { borderColor: colors.olive }]}>
      <Pressable onPress={onOpen}>
        <View style={[crew.row, { justifyContent: 'space-between', alignItems: 'flex-start' }]}>
          <Text style={[crew.name, { flex: 1 }]}>{r.projectTitle || r.shooting} · {fmtRange(r.startsOn, r.endsOn)}</Text>
          <StatusChip r={r} />
        </View>
        <Text style={crew.mono}>{r.listing ? r.listing.title : 'A place'}{r.hoursFrom && r.hoursTo ? ` · ${hoursLabel(r.hoursFrom, r.hoursTo)}` : ''}{r.crewSize ? ` · crew ${r.crewSize}` : ''}</Text>
      </Pressable>
      <View style={[crew.row, { flexWrap: 'wrap' }]}>
        <Avatar userId={other.userId} name={other.displayName} src={other.avatarUrl} position={other.avatarPosition} zoom={other.avatarZoom || 1} size={24} />
        <Text style={crew.rowText}>{other.displayName}</Text>
        {side === 'producer' ? <HostedChip host={other} /> : null}
      </View>
      <MoneyLine r={r} side={side} />
      {r.message && hot ? <Text style={crew.bio}>{r.pricing === 'offer' && r.status === 'requested' ? `Offer: ${dollars(r.subtotalCents)} for the dates. ` : ''}{r.message}</Text> : null}
      {r.status === 'countered' && side === 'producer' ? <Text style={crew.bio}>{other.displayName.split(' ')[0]} countered with {dollars(r.counterCents)}{r.counterNote ? ` — “${r.counterNote}”` : ''}</Text> : null}
      {side === 'host' ? <HostAnswer r={r} token={token} onChange={onChange} /> : <ProducerActions r={r} token={token} onChange={onChange} onPay={onPay} />}
      {side === 'host' ? <OutcomeForm r={r} token={token} onChange={onChange} /> : null}
      <EndorseForm r={r} userId={userId} token={token} onChange={onChange} />
      <View style={[crew.row, { flexWrap: 'wrap' }]}>
        <Pressable style={crew.btnSm} onPress={onOpen}><Text style={crew.btnSmText}>Open</Text></Pressable>
        {r.threadId && onMessage ? <Pressable style={crew.btnSm} onPress={onMessage}><Text style={crew.btnSmText}>Message</Text></Pressable> : null}
      </View>
    </View>
  );
}

export function KV({ k, v }) {
  if (v == null || v === '') return null;
  return (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: colors.hairline }}>
      <Text style={[crew.rowText, { color: colors.inkDim, width: 96 }]}>{k}</Text>
      <Text style={[crew.meta, { flex: 1, textAlign: 'right', color: colors.ink }]}>{String(v)}</Text>
    </View>
  );
}

export const loc = StyleSheet.create({
  card: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.oceanInk, borderRadius: 14, overflow: 'hidden', marginBottom: 10 },
  cardPh: { aspectRatio: 4 / 3, backgroundColor: colors.surface2 },
  k: { position: 'absolute', left: 8, bottom: 8, fontFamily: fonts.mono, fontSize: 10, color: colors.ink, backgroundColor: 'rgba(12,19,31,0.82)', paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, overflow: 'hidden' },
  pin: { position: 'absolute', right: 8, bottom: 8, fontFamily: fonts.mono, fontSize: 9, letterSpacing: 0.6, textTransform: 'uppercase', color: '#0f1f12', backgroundColor: colors.ok, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, overflow: 'hidden' },
  cardT: { fontFamily: fonts.displayBold, fontSize: 16, lineHeight: 20, color: colors.ink },
  rate: { fontFamily: fonts.mono, fontSize: 12, color: colors.ink },
  calRow: { flexDirection: 'row', gap: 3 },
  calCell: { flex: 1, minHeight: 34, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  calH: { flex: 1, textAlign: 'center', fontFamily: fonts.mono, fontSize: 9, color: colors.inkFaint, letterSpacing: 1 },
  calD: { fontFamily: fonts.mono, fontSize: 12 },
  answerForm: { gap: 6, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.oceanInk, borderRadius: 10, padding: 10 },
  outcome: { gap: 6, padding: 8, borderRadius: 8, backgroundColor: 'rgba(231,162,85,0.1)', borderWidth: 1, borderColor: 'rgba(231,162,85,0.35)' },
  money: { backgroundColor: colors.surface2, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.oceanInk, borderRadius: 8, padding: 10 },
  moneyText: { fontFamily: fonts.mono, fontSize: 11, color: colors.inkDim, lineHeight: 17 },
  tile: { flex: 1, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.oceanInk, borderRadius: 10, padding: 10, minWidth: 0 },
  tileB: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.ink },
  tileS: { fontFamily: fonts.mono, fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: colors.inkFaint, marginTop: 2 },
  thumb: { width: 72, aspectRatio: 4 / 3, borderRadius: 8, backgroundColor: colors.surface2, overflow: 'hidden' },
  photo: { width: 96, aspectRatio: 4 / 3, borderRadius: 8, backgroundColor: colors.surface2, overflow: 'hidden' },
  photoAdd: { width: 96, aspectRatio: 4 / 3, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(248,95,115,0.6)', alignItems: 'center', justifyContent: 'center' },
  type: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.oceanInk, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12 },
  typeOn: { borderColor: colors.brass },
  typeText: { fontFamily: fonts.displaySemi, fontSize: 12.5, color: colors.ink },
  typeN: { fontFamily: fonts.mono, fontSize: 10, color: colors.inkFaint },
  sticky: { position: 'absolute', left: 12, right: 12, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.olive, borderRadius: 14, padding: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }
});

export { fmtRange, fmtDay };
