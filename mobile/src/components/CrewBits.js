import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import { apiGet } from '../lib/api';
import { colors, fonts } from '../lib/theme';
import SmartImage from './SmartImage';

// Pieces shared by the Crew Call screens (crew/index, crew/card) and the
// profile screen's "Working card" block. Mirrors components/crew/CrewBits.js
// on the website; vocabularies come from /api/crew/options.

const AVATAR_COLORS = ['#f85f73', '#e7a255', '#93d0a4', '#8499dc', '#c85924', '#f2bf88', '#d67c51', '#84cd98'];
export const GEAR_FLAGS = { brings: 'Brings it to set', lends: 'Open to lending', ask: 'Ask' };
export const WITHIN_CHOICES = [10, 25, 50, 100, 0];
export const DEFAULT_WITHIN = 50;

function colorFor(id) {
  let h = 0;
  for (const ch of String(id || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
const initialsOf = (name) => String(name || '?').split(/\s+/).map((w) => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase();

export function Avatar({ userId, name, src, size = 48 }) {
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (src) return <SmartImage uri={src} style={[box, { backgroundColor: colors.surface2 }]} />;
  return (
    <View style={[box, { backgroundColor: colorFor(userId || name), alignItems: 'center', justifyContent: 'center' }]}>
      <Text style={{ fontFamily: fonts.displayBold, fontSize: size * 0.36, color: '#1b0a0e' }}>{initialsOf(name)}</Text>
    </View>
  );
}

export const flagLabel = (flag) => GEAR_FLAGS[flag] || GEAR_FLAGS.brings;
export function flagStyle(flag) {
  if (flag === 'lends') return [crew.chip, crew.chipOk];
  if (flag === 'brings') return [crew.chip, crew.chipGear];
  return [crew.chip, crew.chipMute];
}

export function rateLabel(card) {
  if (card.ratesHidden) return 'Sign in to see rates';
  if (card.rateMin == null && card.rateMax == null) return 'Rate on request';
  if (card.rateMin != null && card.rateMax != null && card.rateMin !== card.rateMax) return `$${card.rateMin}–${card.rateMax}/day`;
  return `$${card.rateMax == null ? card.rateMin : card.rateMax}/day`;
}
export function availLabel(card) {
  if (card.availability === 'open') return 'Open to work';
  if (!card.bookedUntil) return 'Booked';
  const d = new Date(`${card.bookedUntil}T12:00:00`);
  return `Booked until ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

export function Chip({ label, on = false, tone, onPress, style }) {
  const toneStyle = tone === 'role' ? crew.chipRole : tone === 'gear' ? crew.chipGear : tone === 'ok' ? crew.chipOk : tone === 'mute' ? crew.chipMute : null;
  const body = <Text style={[crew.chipText, toneStyle, on && crew.chipOnText]}>{label}</Text>;
  if (!onPress) return <View style={[crew.chip, toneStyle && { backgroundColor: toneStyle.backgroundColor }, style]}>{body}</View>;
  return (
    <Pressable onPress={onPress} style={[crew.chip, crew.chipPress, on && crew.chipOn, style]} accessibilityState={{ selected: on }}>
      {body}
    </Pressable>
  );
}

// The track-record tier next to a name (lib/crewCallRules.js on the web):
// New crew / Crew / Veteran, with confirmed jobs + released titles behind it.
const TIER_LABEL = { new: 'New crew', crew: 'Crew', veteran: 'Veteran' };
const TIER_COLOR = { new: colors.inkFaint, crew: colors.sky, veteran: colors.brass };
export function TierChip({ person }) {
  if (!person || !person.tier) return null;
  const tier = TIER_LABEL[person.tier] ? person.tier : 'new';
  const c = TIER_COLOR[tier];
  return (
    <View style={[crew.tier, { borderColor: c }]}>
      <View style={[crew.tierDot, { backgroundColor: c }]} />
      <Text style={[crew.tierText, { color: c }]}>{TIER_LABEL[tier].toUpperCase()}{person.done > 0 ? ` · ${person.done}` : ''}</Text>
    </View>
  );
}

export function Avail({ card }) {
  const open = card.availability === 'open';
  return (
    <View style={crew.avail}>
      <View style={[crew.dot, { backgroundColor: open ? colors.ok : colors.olive }]} />
      <Text style={crew.meta}>{availLabel(card)}</Text>
    </View>
  );
}

// A place box: type a city and pick a suggestion, or "Near me". `value`
// is { label, lat, lng, ... } or null.
export function PlaceBox({ value, onChange, placeholder = 'City or neighborhood' }) {
  const [text, setText] = useState(value ? value.label : '');
  const [places, setPlaces] = useState([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const timer = useRef(null);

  useEffect(() => { setText(value ? value.label : ''); if (value) setPlaces([]); }, [value]);

  function typed(q) {
    setText(q);
    if (value) onChange(null);
    clearTimeout(timer.current);
    if (q.trim().length < 2) { setPlaces([]); return; }
    timer.current = setTimeout(async () => {
      try {
        const data = await apiGet(`/api/crew/geocode?q=${encodeURIComponent(q.trim())}`);
        setPlaces(data.places || []);
        setNote(null);
      } catch (err) {
        setPlaces([]);
        setNote(err.message);
      }
    }, 350);
  }

  async function locate() {
    setBusy(true);
    setNote(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setNote('Location was turned down — type your city instead.'); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
      const data = await apiGet(`/api/crew/geocode?lat=${pos.coords.latitude.toFixed(4)}&lng=${pos.coords.longitude.toFixed(4)}`);
      const p = data.places && data.places[0];
      if (p) onChange(p); else setNote('Couldn’t name that spot — type your city instead.');
    } catch (err) {
      setNote('Couldn’t get a location — type your city instead.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 6 }}>
      <View style={crew.row}>
        <TextInput
          style={[crew.input, { flex: 1 }]}
          value={text}
          onChangeText={typed}
          placeholder={placeholder}
          placeholderTextColor={colors.inkFaint}
          autoCapitalize="words"
          autoCorrect={false}
        />
        {value ? (
          <Pressable style={crew.btnSm} onPress={() => { onChange(null); setText(''); }} accessibilityLabel="Clear place"><Text style={crew.btnSmText}>✕</Text></Pressable>
        ) : (
          <Pressable style={crew.btnSm} onPress={locate} disabled={busy}>{busy ? <ActivityIndicator color={colors.ink} size="small" /> : <Text style={crew.btnSmText}>◎ Near me</Text>}</Pressable>
        )}
      </View>
      {places.length > 0 ? (
        <View style={crew.suggest}>
          {places.map((p) => (
            <Pressable key={`${p.lat},${p.lng}`} style={crew.suggestRow} onPress={() => { onChange(p); setPlaces([]); }}>
              <Text style={crew.suggestText}>{p.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {!value && text.trim().length >= 2 && places.length === 0 && !note ? <Text style={crew.mono}>Pick a place from the list.</Text> : null}
      {note ? <Text style={[crew.mono, { color: colors.warn }]}>{note}</Text> : null}
    </View>
  );
}

export function PersonCard({ p, onOpen, onMessage }) {
  const where = [p.place, p.miles != null ? `${p.miles} mi` : null].filter(Boolean).join(' · ');
  const gearTop = p.gear.slice(0, 3).map((g) => g.name).join(' · ');
  return (
    <Pressable style={crew.panel} onPress={onOpen}>
      <View style={[crew.row, { alignItems: 'flex-start' }]}>
        <Avatar userId={p.userId} name={p.displayName} src={p.avatarUrl} size={48} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={crew.nameRow}>
            <Text style={crew.name}>{p.displayName}</Text>
            {p.verified ? <Text style={crew.ver}>✓ CREATOR</Text> : null}
            <TierChip person={p} />
            {p.handle ? <Text style={crew.handle}>@{p.handle}</Text> : null}
          </View>
          <View style={crew.metaRow}>
            <Avail card={p} />
            {where ? <Text style={crew.meta}>{where}{p.travelMiles ? ` · travels ${p.travelMiles} mi` : ''}</Text> : null}
            {p.remoteOk ? <Text style={crew.meta}>Remote OK</Text> : null}
            <Text style={crew.meta}>{rateLabel(p)}</Text>
            <Text style={crew.meta}>{p.creditCount} {p.creditCount === 1 ? 'credit' : 'credits'} on Studio Tapa</Text>
          </View>
        </View>
      </View>
      {p.roles.length ? <View style={crew.chips}>{p.roles.map((r) => <Chip key={r} label={r} tone="role" />)}</View> : null}
      {gearTop ? <Text style={crew.gearline}><Text style={crew.gearlineB}>Gear </Text>{gearTop}{p.gear.length > 3 ? ` +${p.gear.length - 3}` : ''}</Text> : null}
      {p.bio ? <Text style={crew.bio} numberOfLines={3}>{p.bio}</Text> : null}
      <View style={[crew.row, { marginTop: 2 }]}>
        <Pressable style={crew.btnSm} onPress={onOpen}><Text style={crew.btnSmText}>View profile</Text></Pressable>
        {onMessage ? <Pressable style={[crew.btnSm, crew.btnPrimary]} onPress={onMessage}><Text style={[crew.btnSmText, crew.btnPrimaryText]}>Message</Text></Pressable> : null}
      </View>
    </Pressable>
  );
}

export function GearCard({ g, onOpen, onAsk }) {
  const o = g.owner;
  return (
    <Pressable style={crew.panel} onPress={onOpen}>
      <View style={[crew.row, { justifyContent: 'space-between', alignItems: 'flex-start' }]}>
        <Text style={[crew.name, { flex: 1 }]}>{g.name}</Text>
        <View style={flagStyle(g.flag)}><Text style={[crew.chipText, g.flag === 'lends' ? crew.chipOk : g.flag === 'brings' ? crew.chipGear : crew.chipMute]}>{flagLabel(g.flag)}</Text></View>
      </View>
      <Text style={crew.mono}>{g.category}</Text>
      <View style={crew.row}>
        <Avatar userId={o.userId} name={o.displayName} src={o.avatarUrl} size={28} />
        <Text style={crew.meta}>{o.displayName}{o.miles != null ? ` · ${o.miles} mi` : o.place ? ` · ${o.place}` : ''}{o.verified ? ' · ✓' : ''}</Text>
      </View>
      {onAsk ? (
        <View style={crew.row}>
          <Pressable style={[crew.btnSm, crew.btnPrimary]} onPress={onAsk}><Text style={[crew.btnSmText, crew.btnPrimaryText]}>Ask about it</Text></Pressable>
          <Pressable style={crew.btnSm} onPress={onOpen}><Text style={crew.btnSmText}>View profile</Text></Pressable>
        </View>
      ) : null}
    </Pressable>
  );
}

export function GearRows({ gear, onRemove }) {
  if (!gear || gear.length === 0) return <Text style={crew.muted}>Nothing listed.</Text>;
  return (
    <View style={{ gap: 6 }}>
      {gear.map((g, i) => (
        <View key={g.id || i} style={crew.gearRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={crew.cat}>{g.category}</Text>
            <Text style={crew.rowText}>{g.name}</Text>
          </View>
          <View style={flagStyle(g.flag)}><Text style={[crew.chipText, g.flag === 'lends' ? crew.chipOk : g.flag === 'brings' ? crew.chipGear : crew.chipMute]}>{flagLabel(g.flag)}</Text></View>
          {onRemove ? <Pressable onPress={() => onRemove(i)} hitSlop={8} accessibilityLabel={`Remove ${g.name}`}><Text style={crew.x}>✕</Text></Pressable> : null}
        </View>
      ))}
    </View>
  );
}

export function CreditRows({ auto = [], manual = [], onRemove, onOpenWork }) {
  if (auto.length === 0 && manual.length === 0) return <Text style={crew.muted}>No credits yet.</Text>;
  const kind = (w) => (w.contentType === 'series' || w.type === 'series' ? 'Series' : w.contentType === 'movie' ? 'Film' : w.contentType === 'podcast' ? 'Podcast' : 'Short');
  return (
    <View style={{ gap: 6 }}>
      {auto.map((w) => (
        <Pressable key={`${w.type}-${w.id}`} style={crew.gearRow} onPress={onOpenWork ? () => onOpenWork(w) : undefined}>
          <Text style={[crew.rowText, { flex: 1 }]}>{w.title} <Text style={crew.cat}>· {kind(w)}{w.createdAt ? ` · ${new Date(w.createdAt).getFullYear()}` : ''}</Text></Text>
          <View style={[crew.chip, crew.chipOk]}><Text style={[crew.chipText, crew.chipOk]}>✓ on Studio Tapa</Text></View>
        </Pressable>
      ))}
      {manual.map((c, i) => (
        <View key={c.id || i} style={crew.gearRow}>
          <Text style={[crew.rowText, { flex: 1 }]}>{c.title} <Text style={crew.cat}>{c.role ? `· ${c.role}` : ''}{c.year ? ` · ${c.year}` : ''}</Text></Text>
          <View style={[crew.chip, crew.chipMute]}><Text style={[crew.chipText, crew.chipMute]}>outside work</Text></View>
          {onRemove ? <Pressable onPress={() => onRemove(i)} hitSlop={8} accessibilityLabel={`Remove ${c.title}`}><Text style={crew.x}>✕</Text></Pressable> : null}
        </View>
      ))}
    </View>
  );
}

// The read-only card on a profile screen.
export function CrewCardView({ card, creditedWork = [], isOwn = false, onEdit, onFind, onOpenWork }) {
  const facts = [];
  if (card.place) facts.push(`Based in ${card.place.label}${card.travelMiles ? ` · travels ${card.travelMiles} mi` : ''}`);
  if (card.remoteOk) facts.push('Remote OK');
  facts.push(rateLabel(card));
  if (card.languages.length) facts.push(card.languages.join(', '));
  return (
    <View style={{ gap: 10 }}>
      <View style={crew.metaRow}>
        <Avail card={card} />
        {facts.map((f) => <Text key={f} style={crew.meta}>{f}</Text>)}
      </View>
      {card.roles.length ? <View style={crew.chips}>{card.roles.map((r) => <Chip key={r} label={r} tone="role" />)}</View> : <Text style={crew.muted}>{isOwn ? 'No roles yet — add some on your card.' : 'No roles listed.'}</Text>}
      <Text style={crew.h4}>Gear</Text>
      <GearRows gear={card.gear} />
      <Text style={crew.h4}>Credits</Text>
      <CreditRows auto={creditedWork} manual={card.credits} onOpenWork={onOpenWork} />
      <View style={[crew.row, { marginTop: 4 }]}>
        {isOwn && onEdit ? <Pressable style={crew.btn} onPress={onEdit}><Text style={crew.btnText}>Edit card</Text></Pressable> : null}
        {onFind ? <Pressable style={[crew.btn, crew.btnGhost]} onPress={onFind}><Text style={[crew.btnText, { color: colors.inkDim }]}>Find people on Crew Call →</Text></Pressable> : null}
      </View>
    </View>
  );
}

export const crew = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  stage: { padding: 16, paddingBottom: 130 },
  eyebrow: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: colors.brass },
  h1: { fontFamily: fonts.displayBold, fontSize: 28, lineHeight: 31, color: colors.ink, marginTop: 4, marginBottom: 8 },
  lead: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.inkDim, marginBottom: 14 },
  h3: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: colors.inkFaint, marginBottom: 2 },
  h4: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 1, textTransform: 'uppercase', color: colors.inkFaint, marginTop: 2 },
  label: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.inkFaint },
  panel: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.oceanInk, borderRadius: 12, padding: 12, gap: 8, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.oceanInk, color: colors.ink, borderRadius: 8, paddingVertical: 9, paddingHorizontal: 10, fontFamily: fonts.body, fontSize: 14 },
  btn: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.oceanInk, borderRadius: 8, paddingVertical: 9, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: colors.brass, borderColor: colors.brass },
  btnGhost: { backgroundColor: 'transparent', borderColor: 'transparent' },
  btnText: { fontFamily: fonts.displaySemi, fontSize: 13.5, color: colors.ink },
  btnPrimaryText: { color: colors.onBrass },
  btnSm: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.oceanInk, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, minWidth: 40, alignItems: 'center' },
  btnSmText: { fontFamily: fonts.displaySemi, fontSize: 12.5, color: colors.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingVertical: 4, paddingHorizontal: 9, borderRadius: 5, backgroundColor: colors.surface3 },
  chipPress: { borderRadius: 999, borderWidth: 1, borderColor: colors.oceanInk, backgroundColor: colors.surface2 },
  chipOn: { backgroundColor: 'rgba(132,153,220,0.25)', borderColor: colors.sky },
  chipText: { fontFamily: fonts.mono, fontSize: 11, color: colors.inkDim },
  chipOnText: { color: colors.ink },
  chipRole: { backgroundColor: 'rgba(132,153,220,0.18)', color: colors.sky },
  chipGear: { backgroundColor: 'rgba(231,162,85,0.16)', color: colors.olive },
  chipOk: { backgroundColor: 'rgba(132,205,152,0.16)', color: colors.ok },
  chipMute: { backgroundColor: colors.surface3, color: colors.inkFaint },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  name: { fontFamily: fonts.displaySemi, fontSize: 15.5, color: colors.ink },
  handle: { fontFamily: fonts.mono, fontSize: 11, color: colors.inkFaint },
  ver: { fontFamily: fonts.mono, fontSize: 9, letterSpacing: 0.6, color: colors.mint, borderWidth: 1, borderColor: 'rgba(147,208,164,0.5)', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 3 },
  meta: { fontFamily: fonts.mono, fontSize: 11, color: colors.inkDim, lineHeight: 16 },
  mono: { fontFamily: fonts.mono, fontSize: 11, color: colors.inkFaint, lineHeight: 16 },
  muted: { fontFamily: fonts.body, fontSize: 13.5, color: colors.inkFaint, lineHeight: 19 },
  avail: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  gearline: { fontFamily: fonts.body, fontSize: 13.5, color: colors.inkDim, lineHeight: 19 },
  gearlineB: { fontFamily: fonts.displaySemi, color: colors.ink, fontSize: 12.5 },
  bio: { fontFamily: fonts.body, fontSize: 13.5, color: colors.inkFaint, lineHeight: 19 },
  gearRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface2, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10 },
  rowText: { fontFamily: fonts.body, fontSize: 13.5, color: colors.ink },
  cat: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.inkFaint },
  x: { color: colors.inkDim, fontSize: 14, paddingHorizontal: 4 },
  suggest: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.oceanInk, borderRadius: 8, padding: 4 },
  suggestRow: { paddingVertical: 9, paddingHorizontal: 10, borderRadius: 6 },
  suggestText: { fontFamily: fonts.body, fontSize: 14, color: colors.ink },
  empty: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.hairline, borderStyle: 'dashed', borderRadius: 12, padding: 16, color: colors.inkDim, fontFamily: fonts.body, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  error: { color: colors.danger, fontFamily: fonts.body, fontSize: 14, marginTop: 8 },
  toggle: { flexDirection: 'row', backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.oceanInk, borderRadius: 999, padding: 3, gap: 3, alignSelf: 'flex-start' },
  toggleBtn: { borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  toggleOn: { backgroundColor: colors.surface3 },
  toggleText: { fontFamily: fonts.mono, fontSize: 11.5, color: colors.inkDim },
  toggleTextOn: { color: colors.ink },
  tier: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 999, paddingVertical: 1, paddingHorizontal: 7 },
  tierDot: { width: 6, height: 6, borderRadius: 3 },
  tierText: { fontFamily: fonts.mono, fontSize: 9, letterSpacing: 0.6 },
  payPaid: { backgroundColor: 'rgba(132,205,152,0.16)', color: colors.ok },
  payDeferred: { backgroundColor: 'rgba(231,162,85,0.16)', color: colors.olive },
  payUnpaid: { backgroundColor: colors.surface3, color: colors.inkDim }
});

export const payStyle = (t) => (t === 'paid' || t === 'union' ? crew.payPaid : t === 'deferred' ? crew.payDeferred : crew.payUnpaid);
export function fmtRange(a, b) {
  const f = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (!a) return 'Dates to confirm';
  return !b || b === a ? f(a) : `${f(a)}–${f(b)}`;
}

// One call on the board or a project page.
export function CallCard({ c, onOpen }) {
  return (
    <Pressable style={crew.panel} onPress={onOpen}>
      <View style={[crew.nameRow, { gap: 6 }]}>
        <Text style={crew.name}>{c.title}</Text>
        <View style={[crew.chip, payStyle(c.payType)]}><Text style={[crew.chipText, { color: payStyle(c.payType).color }]}>{c.payLabel.toLowerCase()}</Text></View>
        {c.projectTitle ? <Chip label={`${c.projectType === 'pitch' ? 'Pitch Room' : 'Series'} · ${c.projectTitle}`} tone="ok" /> : null}
        {c.matches ? <Chip label="matches your card" tone="ok" /> : null}
        {c.mine ? <Chip label="yours" tone="role" /> : null}
      </View>
      <View style={crew.metaRow}>
        <Text style={crew.meta}>{c.role}{c.spots > 1 ? ` · ${c.spots} spots` : ''}</Text>
        <Text style={crew.meta}>{fmtRange(c.startsOn, c.endsOn)}</Text>
        <Text style={crew.meta}>{c.remote ? 'Remote' : c.place}{c.miles != null ? ` · ${c.miles} mi` : ''}</Text>
        {c.payNote ? <Text style={crew.meta}>{c.payNote}</Text> : null}
      </View>
      {c.poster ? (
        <View style={crew.row}>
          <Avatar userId={c.poster.userId} name={c.poster.displayName} src={c.poster.avatarUrl} size={26} />
          <Text style={crew.meta}>{c.poster.displayName}</Text>
          <TierChip person={c.poster} />
          <Text style={crew.meta}>· {c.responsesCount} {c.responsesCount === 1 ? 'response' : 'responses'}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}
