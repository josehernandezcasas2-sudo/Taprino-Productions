import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, inkTint, mintTint, oliveTint } from '../../lib/theme';
import { CREW_WORDS, callRow, castRow, gearRow, personRow } from '../../lib/crewDirectoryRules';
import { Avatar, TierChip, avatarColor, avatarInitials } from '../CrewBits';
import PositionedImage from '../PositionedImage';
import SmartImage from '../SmartImage';
import { CrewGlyph } from './CrewIcons';

// Crew Call's rows (Crew Call, simpler, 2026-11-18): a call, a person
// (People B: one gear line), a performer (Cast B: a small headshot) and a
// piece of gear. The lines are built by lib/crewDirectoryRules.js; these
// only draw them and say where a tap goes.

const TAG_COLORS = { urgent: colors.danger, cast: colors.olive, ok: colors.mint, mine: colors.brass, muted: colors.inkFaint };
const PAY_COLORS = { paid: colors.mint, union: colors.sky, deferred: colors.olive, muted: colors.inkFaint };
const STATUS_COLORS = { free: colors.brass, open: colors.mint, booked: colors.olive };
const GEAR_VERB_COLORS = { brings: colors.olive, lends: colors.mint };
const FLAG_COLORS = { brings: colors.olive, lends: colors.mint, muted: colors.inkDim };

// A call: the whole row opens it.
export function CallRow({ call, onOpen }) {
  const r = callRow(call);
  return (
    <Pressable onPress={onOpen} style={({ pressed }) => [s.row, s.callRow, pressed && s.rowPressed]} accessibilityRole="link" accessibilityLabel={`${r.title}. ${r.meta}`}>
      {r.tags.length ? (
        <Text style={s.tags} numberOfLines={1}>
          {r.tags.map((t, i) => (
            <Text key={`${t.tone}-${i}`} style={{ color: TAG_COLORS[t.tone] || colors.inkFaint }}>{i ? ` · ${t.text}` : t.text}</Text>
          ))}
        </Text>
      ) : null}
      <Text style={s.callTitle} numberOfLines={2}>{r.title}</Text>
      <Text style={s.callMeta} numberOfLines={2}>{r.meta}</Text>
      <Text style={s.small} numberOfLines={1}>
        <Text style={[s.strong, { color: PAY_COLORS[r.pay.tone] || colors.inkFaint }]}>{r.pay.text}</Text>
        {r.poster ? ` · ${r.poster}` : ''}
        {` · ${r.answered}`}
      </Text>
    </Pressable>
  );
}

// The photo with its mark: the orange ring when free right now, a small
// green dot when open to work.
function MarkedAvatar({ p, mark, size = 52 }) {
  const photo = <Avatar userId={p.userId} name={p.displayName} src={p.avatarUrl} position={p.avatarPosition} zoom={p.avatarZoom || 1} size={size} />;
  if (mark === 'free') return <View style={[s.ring, { borderRadius: (size + 8) / 2 }]}>{photo}</View>;
  return (
    <View style={s.plain}>
      {photo}
      {mark === 'open' ? <View style={s.openDot} /> : null}
    </View>
  );
}

function NameLine({ name, person, verified }) {
  return (
    <View style={s.nameRow}>
      <Text style={s.name} numberOfLines={1}>{name}</Text>
      <View style={s.keep}><TierChip person={person} /></View>
      {verified ? <Text style={s.ver} numberOfLines={1}>✓ CREATOR</Text> : null}
    </View>
  );
}

function StatusLine({ status, meta }) {
  if (!status && !meta) return null;
  return (
    <Text style={s.small} numberOfLines={1}>
      {status ? <Text style={[s.strong, { color: STATUS_COLORS[status.tone] || colors.inkDim }]}>{status.text}</Text> : null}
      {status && meta ? ' · ' : ''}
      {meta || ''}
    </Text>
  );
}

function MessageButton({ name, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.msgBtn, pressed && s.pressed]} accessibilityRole="button" accessibilityLabel={`${CREW_WORDS.message} ${name}`} hitSlop={4}>
      <CrewGlyph name="message" size={17} color={colors.ink} />
    </Pressable>
  );
}

// A person (People B): photo + lines open the profile; the round button
// writes to them about their card.
export function PersonRow({ person, onOpen, onMessage }) {
  const r = personRow(person);
  return (
    <View style={s.row}>
      <Pressable onPress={onOpen} style={({ pressed }) => [s.rowMain, pressed && s.pressed]} accessibilityRole="link" accessibilityLabel={[r.name, r.roles, r.status && r.status.text].filter(Boolean).join(', ')}>
        <MarkedAvatar p={person} mark={r.mark} />
        <View style={s.lines}>
          <NameLine name={r.name} person={person} verified={r.verified} />
          {r.roles ? <Text style={s.roles} numberOfLines={1}>{r.roles}</Text> : null}
          <StatusLine status={r.status} meta={r.meta} />
          {r.gear ? (
            <Text style={[s.small, { color: colors.inkDim }]} numberOfLines={1} ellipsizeMode="tail">
              <Text style={[s.strong, { color: GEAR_VERB_COLORS[r.gear.tone] || colors.inkDim }]}>{r.gear.verb}</Text>
              {` ${r.gear.text}`}
            </Text>
          ) : null}
        </View>
      </Pressable>
      <MessageButton name={r.name} onPress={onMessage} />
    </View>
  );
}

// A performer (Cast B): a 54×68 headshot (or their photo in that frame),
// then the lines and the round Message button.
function Headshot({ p, url, free }) {
  const box = { width: 54, height: 68, borderRadius: 10 };
  let inner;
  if (url) inner = <SmartImage uri={url} style={[box, { backgroundColor: colors.surface2 }]} />;
  else if (p.avatarUrl) inner = <PositionedImage uri={p.avatarUrl} position={p.avatarPosition} zoom={p.avatarZoom || 1} style={[box, { backgroundColor: colors.surface2 }]} />;
  else {
    inner = (
      <View style={[box, { backgroundColor: avatarColor(p.userId, p.displayName), alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={s.shotInitials}>{avatarInitials(p.displayName)}</Text>
      </View>
    );
  }
  return free ? <View style={s.shotRing}>{inner}</View> : <View style={s.plain}>{inner}</View>;
}

export function CastRow({ person, onOpen, onMessage }) {
  const r = castRow(person);
  return (
    <View style={[s.row, s.castRow]}>
      <Pressable onPress={onOpen} style={({ pressed }) => [s.rowMain, pressed && s.pressed]} accessibilityRole="link" accessibilityLabel={[r.name, r.playing, r.status && r.status.text].filter(Boolean).join(', ')}>
        <Headshot p={person} url={r.headshot} free={r.mark === 'free'} />
        <View style={s.lines}>
          <NameLine name={r.name} person={person} verified={r.verified} />
          {r.playing ? <Text style={s.roles} numberOfLines={1}>{r.playing}</Text> : null}
          <StatusLine status={r.status} meta={r.meta} />
        </View>
      </Pressable>
      <MessageButton name={r.name} onPress={onMessage} />
    </View>
  );
}

// A piece of gear: the category tile, the name, "category · flag", the
// owner; the row opens the owner's profile, Ask writes to them about it.
export function GearRow({ item, onOpen, onAsk }) {
  const r = gearRow(item);
  const o = item.owner || {};
  return (
    <View style={s.row}>
      <Pressable onPress={onOpen} style={({ pressed }) => [s.rowMain, pressed && s.pressed]} accessibilityRole="link" accessibilityLabel={`${r.name}, ${r.category}, ${r.flag.text}, ${r.owner}`}>
        <View style={s.gearTile}><CrewGlyph name={r.category} size={22} color={colors.olive} /></View>
        <View style={s.lines}>
          <Text style={s.name} numberOfLines={1}>{r.name}</Text>
          <Text style={s.small} numberOfLines={1}>
            {r.category ? `${r.category} · ` : ''}
            <Text style={[s.strong, { color: FLAG_COLORS[r.flag.tone] || colors.inkDim }]}>{r.flag.text}</Text>
          </Text>
          <View style={s.owner}>
            <Avatar userId={o.userId} name={o.displayName} src={o.avatarUrl} position={o.avatarPosition} zoom={o.avatarZoom || 1} size={18} />
            <Text style={[s.small, { color: colors.inkDim, flexShrink: 1 }]} numberOfLines={1}>{r.owner}</Text>
          </View>
        </View>
      </Pressable>
      <Pressable onPress={onAsk} style={({ pressed }) => [s.ask, pressed && s.pressed]} accessibilityRole="button" accessibilityLabel={`${CREW_WORDS.ask}: ${r.name}`}>
        <Text style={s.askText}>{CREW_WORDS.ask}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  pressed: { opacity: 0.8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: inkTint(0.07) },
  rowPressed: { backgroundColor: inkTint(0.04) },
  rowMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
  lines: { flex: 1, minWidth: 0, gap: 3 },

  callRow: { flexDirection: 'column', alignItems: 'stretch', gap: 4, paddingVertical: 12 },
  tags: { fontFamily: fonts.monoMedium, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' },
  callTitle: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.ink },
  callMeta: { fontFamily: fonts.display, fontSize: 13, color: colors.inkDim },
  small: { fontFamily: fonts.display, fontSize: 12, color: colors.inkFaint },
  strong: { fontFamily: fonts.displaySemi },

  ring: { padding: 2, borderWidth: 2, borderColor: colors.brass },
  plain: { padding: 4 },
  openDot: { position: 'absolute', right: 4, bottom: 5, width: 12, height: 12, borderRadius: 6, backgroundColor: colors.mint, borderWidth: 2, borderColor: colors.surface0 },
  // The name comes first; the tier and the creator mark go under it when
  // the line is too short for all three (a 320pt phone).
  nameRow: { flexDirection: 'row', alignItems: 'center', columnGap: 7, rowGap: 3, flexWrap: 'wrap' },
  name: { flexShrink: 1, maxWidth: '100%', fontFamily: fonts.displayBold, fontSize: 16, color: colors.ink },
  keep: { flexShrink: 0 },
  ver: { flexShrink: 0, fontFamily: fonts.mono, fontSize: 9, letterSpacing: 0.6, color: colors.mint, borderWidth: 1, borderColor: mintTint(0.5), borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
  roles: { fontFamily: fonts.display, fontSize: 14, color: colors.inkDim },
  msgBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: inkTint(0.22), alignItems: 'center', justifyContent: 'center' },

  castRow: { paddingVertical: 10 },
  shotRing: { padding: 2, borderWidth: 2, borderColor: colors.brass, borderRadius: 14 },
  shotInitials: { fontFamily: fonts.bodyBold, fontSize: 22, color: colors.onBrass },

  gearTile: { width: 48, height: 48, borderRadius: 12, backgroundColor: oliveTint(0.12), alignItems: 'center', justifyContent: 'center' },
  owner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ask: { height: 36, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: inkTint(0.22), alignItems: 'center', justifyContent: 'center' },
  askText: { fontFamily: fonts.displaySemi, fontSize: 13, color: colors.ink }
});
