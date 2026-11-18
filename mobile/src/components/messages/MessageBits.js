import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Avatar } from '../CrewBits';
import { hrefToRoute } from '../PushListener';
import { CONTEXT_LABELS, FILTERS, MAX_MESSAGE_CHARS, MESSAGE_WORDS, contextLine, contextLink, filterLabel, listTime, personLine } from '../../lib/messageRules';
import { brassTint, colors, fonts, inkTint, oliveTint, surfaceTint } from '../../lib/theme';
import { ContextGlyph, MessageGlyph, contextTint } from './MessageIcons';

// The pieces both Messages screens draw (2026-11-18, the simpler Messages:
// the canvas https://claude.ai/artifact/SgXAPeJijp7A1EzSQckyhf and
// mockups/messages-simpler-contract.md). Every word, label, time and
// grouping comes from lib/messageRules.js (the website's file word for
// word); this file only draws them, in the boards' sizes.

// A website path (a subject's link, a profile) as a screen, or the website
// when the app has none.
export function openHref(router, href) {
  const where = hrefToRoute(href);
  if (!where) return;
  if (where.route) router.push(where.route);
  else Linking.openURL(where.url).catch(() => {});
}

// Write to someone, about something or nothing: the conversation already
// there when the caller has the inbox and finds one (the subject then
// rides on the next message, `pendingAbout`), else /messages/new, which
// looks for one itself before it starts a new conversation.
export function startConversation(router, { to, kind, ref, label, threads } = {}) {
  if (!to) return;
  const about = {};
  if (kind) {
    about.kind = String(kind);
    if (ref) about.ref = String(ref);
    if (label) about.label = String(label);
  }
  const found = Array.isArray(threads) ? threads.find((t) => t && t.other && t.other.userId === to) : null;
  if (found) router.push({ pathname: '/messages/[id]', params: { id: found.id, ...about } });
  else router.push({ pathname: '/messages/new', params: { to: String(to), ...about } });
}

/* ---------- the inbox ---------- */

// One conversation in the list: the photo, the name (bold while unread),
// the time, the last line ("You: " when it was yours), the unread dot, the
// bell struck through when muted, and what it is about.
export function ThreadRow({ thread, viewerId, onPress }) {
  const other = thread.other || {};
  const unread = Boolean(thread.unread);
  const mine = Boolean(thread.lastSenderId) && (viewerId ? thread.lastSenderId === viewerId : thread.lastSenderId !== other.userId);
  const preview = thread.preview ? `${mine ? MESSAGE_WORDS.you : ''}${thread.preview}` : MESSAGE_WORDS.newConversation;
  const about = contextLine(thread.context);
  const time = listTime(thread.lastMessageAt);
  const spoken = [other.displayName, unread ? MESSAGE_WORDS.unread : null, thread.muted ? MESSAGE_WORDS.muted : null, preview, about, time].filter(Boolean).join(', ');
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.row, pressed && s.rowPressed]} accessibilityRole="button" accessibilityLabel={spoken}>
      <Avatar userId={other.userId} name={other.displayName} src={other.avatarUrl} position={other.avatarPosition} zoom={other.avatarZoom || 1} size={52} />
      <View style={s.rowBody}>
        <View style={s.rowTop}>
          <View style={s.nameWrap}>
            <Text style={[s.name, unread && s.nameUnread]} numberOfLines={1}>{other.displayName}</Text>
            {thread.muted ? <MessageGlyph name="bellOff" size={14} color={colors.inkFaint} /> : null}
          </View>
          <Text style={[s.time, unread && s.timeUnread]}>{time}</Text>
        </View>
        <View style={s.previewRow}>
          <Text style={[s.preview, unread && s.previewUnread]} numberOfLines={1}>{preview}</Text>
          {unread ? <View style={s.dot} /> : null}
        </View>
        <View style={s.about}>
          <ContextGlyph context={thread.context} size={13} />
          <Text style={s.aboutText} numberOfLines={1}>{about}</Text>
        </View>
      </View>
    </Pressable>
  );
}

// All / Unread.
export function FilterChips({ filter, threads, onChange }) {
  return (
    <View style={s.chips}>
      {FILTERS.map((f) => {
        const on = filter === f;
        return (
          <Pressable key={f} onPress={() => onChange(f)} style={[s.chip, on && s.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
            <Text style={[s.chipText, on && s.chipTextOn]}>{filterLabel(f, threads)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// The search box over the list (16pt: iOS zooms into a smaller field on
// the website, and the app keeps the same size).
export function SearchField({ value, onChangeText, placeholder, style }) {
  return (
    <View style={[s.search, style]}>
      <MessageGlyph name="search" size={16} color={colors.inkFaint} />
      <TextInput
        style={s.searchInput}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.inkFaint}
        accessibilityLabel={placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
      />
    </View>
  );
}

// The round orange New message button.
export function NewMessageButton({ onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.newBtn, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel={MESSAGE_WORDS.newMessage} hitSlop={4}>
      <MessageGlyph name="pencil" size={20} strokeWidth={2.2} color={colors.onBrass} />
    </Pressable>
  );
}

// No conversations at all.
export function InboxEmpty({ onCrewCall, onWrite }) {
  return (
    <View style={s.empty}>
      <View style={s.emptyIcon}><MessageGlyph name="direct" size={32} strokeWidth={1.8} color={colors.olive} /></View>
      <Text style={s.emptyTitle} accessibilityRole="header">{MESSAGE_WORDS.emptyTitle}</Text>
      <Text style={s.emptyLine}>{MESSAGE_WORDS.emptyLine}</Text>
      <Pressable style={s.emptyPrimary} onPress={onCrewCall} accessibilityRole="button"><Text style={s.emptyPrimaryText}>{MESSAGE_WORDS.findPeople}</Text></Pressable>
      <Pressable style={s.emptySecondary} onPress={onWrite} accessibilityRole="button"><Text style={s.emptySecondaryText}>{MESSAGE_WORDS.writeTo}</Text></Pressable>
    </View>
  );
}

// One person on New message: the photo, the name, @handle · why.
export function PersonRow({ person, onPress }) {
  const line = personLine(person);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.person, pressed && s.rowPressed]} accessibilityRole="button" accessibilityLabel={[person.displayName, line].filter(Boolean).join(', ')}>
      <Avatar userId={person.userId} name={person.displayName} src={person.avatarUrl} position={person.avatarPosition} zoom={person.avatarZoom || 1} size={44} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={s.personName} numberOfLines={1}>{person.displayName}</Text>
        {line ? <Text style={s.personLine} numberOfLines={1}>{line}</Text> : null}
      </View>
    </Pressable>
  );
}

/* ---------- a conversation ---------- */

// The card under the top row: what the conversation is about, and the way
// back to it when lib/messageRules.js contextLink gives one.
export function SubjectCard({ context, other, onOpen, style }) {
  const { width } = useWindowDimensions();
  if (!context || !CONTEXT_LABELS[context.kind]) return null;
  const link = contextLink(context, other);
  const tint = contextTint(context);
  const kicker = CONTEXT_LABELS[context.kind];
  // On a narrow phone the link goes under the label, so the label isn't
  // squeezed to a word.
  const stacked = width < 370;
  const linkText = link ? <Text style={[s.subjectOpen, stacked && s.subjectOpenStacked]} numberOfLines={1}>{`${link.label} ›`}</Text> : null;
  const body = (
    <>
      <View style={[s.subjectIcon, { backgroundColor: tint.fill }]}><ContextGlyph context={context} size={17} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Text style={[s.subjectKicker, { color: tint.color }]} numberOfLines={1}>{kicker}</Text>
        {context.label ? <Text style={s.subjectLabel} numberOfLines={1}>{context.label}</Text> : null}
        {stacked ? linkText : null}
      </View>
      {stacked ? null : linkText}
    </>
  );
  if (!link) return <View style={[s.subject, style]} accessibilityLabel={[kicker, context.label].filter(Boolean).join(': ')}>{body}</View>;
  return (
    <Pressable style={({ pressed }) => [s.subject, style, pressed && { backgroundColor: colors.surface2 }]} onPress={() => onOpen(link.href)} accessibilityRole="link" accessibilityLabel={`${[kicker, context.label].filter(Boolean).join(': ')}. ${link.label}`}>
      {body}
    </Pressable>
  );
}

// The messages by day (lib/messageRules.js dayGroups): a day label, the
// bubbles (theirs on the left, mine in brass on the right), the time under
// the last of a run.
export function MessageDays({ groups }) {
  return groups.map((g) => (
    <View key={g.key} style={s.dayGroup}>
      <Text style={s.day} accessibilityRole="header">{g.label}</Text>
      {g.items.map((m) => (
        <View key={m.id} style={m.time ? s.runEnd : null}>
          <View style={[s.bubble, m.mine ? s.mine : s.theirs]}>
            <Text style={[s.bubbleText, m.mine && s.mineText]} selectable>{m.body}</Text>
          </View>
          {m.time ? <Text style={[s.msgTime, m.mine && s.msgTimeMine]}>{m.time}</Text> : null}
        </View>
      ))}
    </View>
  ));
}

// "Your next message is about …" with an ×, over the composer.
export function PendingChip({ context, line, onDrop, style }) {
  return (
    <View style={[s.pending, style]}>
      <ContextGlyph context={context} size={14} />
      <Text style={s.pendingText} numberOfLines={2}>{line}</Text>
      <Pressable onPress={onDrop} style={s.pendingDrop} hitSlop={8} accessibilityRole="button" accessibilityLabel={MESSAGE_WORDS.dropAbout}>
        <MessageGlyph name="close" size={14} color={colors.inkDim} />
      </Pressable>
    </View>
  );
}

// The composer: a rounded box that grows to about six lines (16pt), a
// round send button (brass with something to send), and the count once
// within 200 of the limit. On a phone Enter is a new line.
export function Composer({ value, onChangeText, onSend, busy, placeholder, padBottom, padLeft = 0, padRight = 0 }) {
  const left = MAX_MESSAGE_CHARS - value.length;
  const has = value.trim().length > 0;
  const can = has && !busy;
  return (
    <View style={[s.composer, { paddingBottom: padBottom, paddingLeft: 12 + padLeft, paddingRight: 12 + padRight }]}>
      {left <= 200 ? <Text style={[s.count, left <= 0 && s.countOver]} accessibilityLiveRegion="polite">{left}</Text> : null}
      <View style={s.composeRow}>
        <View style={s.inputWrap}>
          <TextInput
            style={s.input}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={colors.inkFaint}
            accessibilityLabel={placeholder}
            maxLength={MAX_MESSAGE_CHARS}
            multiline
            textAlignVertical="center"
          />
        </View>
        <Pressable
          onPress={onSend}
          disabled={!can}
          style={[s.send, can && s.sendOn]}
          accessibilityRole="button"
          accessibilityLabel={MESSAGE_WORDS.send}
          accessibilityState={{ disabled: !can, busy: Boolean(busy) }}
        >
          {busy ? <ActivityIndicator size="small" color={colors.inkDim} /> : <MessageGlyph name="send" size={20} strokeWidth={2.2} color={can ? colors.onBrass : colors.inkFaint} />}
        </Pressable>
      </View>
    </View>
  );
}

// A short line that comes and goes (Muted., Blocked., Reported…).
export function Toast({ text }) {
  if (!text) return null;
  return (
    <View style={s.toastWrap} pointerEvents="none">
      <Text style={s.toast} accessibilityLiveRegion="polite">{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  // the inbox
  row: { flexDirection: 'row', gap: 12, paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: inkTint(0.07) },
  rowPressed: { backgroundColor: inkTint(0.04) },
  rowBody: { flex: 1, minWidth: 0, gap: 3 },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  nameWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, minWidth: 0 },
  name: { fontFamily: fonts.displaySemi, fontSize: 16, color: colors.ink, flexShrink: 1 },
  nameUnread: { fontFamily: fonts.displayBold },
  time: { fontFamily: fonts.mono, fontSize: 11, color: colors.inkFaint },
  timeUnread: { color: colors.brass },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  preview: { flex: 1, minWidth: 0, fontFamily: fonts.body, fontSize: 14, color: colors.inkDim },
  previewUnread: { color: colors.ink },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.brass },
  about: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  aboutText: { flex: 1, minWidth: 0, fontFamily: fonts.display, fontSize: 12, color: colors.inkFaint },

  chips: { flexDirection: 'row', gap: 8 },
  chip: { height: 34, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: inkTint(0.16), alignItems: 'center', justifyContent: 'center' },
  chipOn: { borderColor: brassTint(0.6), backgroundColor: brassTint(0.16) },
  chipText: { fontFamily: fonts.displaySemi, fontSize: 13, color: colors.inkDim },
  chipTextOn: { color: colors.brass },

  search: { height: 44, borderRadius: 14, borderWidth: 1, borderColor: inkTint(0.12), backgroundColor: colors.surface1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  searchInput: { flex: 1, minWidth: 0, height: 42, paddingVertical: 0, color: colors.ink, fontFamily: fonts.display, fontSize: 16 },

  newBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brass, alignItems: 'center', justifyContent: 'center' },

  empty: { marginTop: 56, alignItems: 'center', gap: 14, paddingHorizontal: 12 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: oliveTint(0.12), alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontFamily: fonts.displayBold, fontSize: 22, color: colors.ink, textAlign: 'center' },
  emptyLine: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24, color: colors.inkDim, textAlign: 'center' },
  emptyPrimary: { marginTop: 8, minHeight: 48, paddingHorizontal: 22, borderRadius: 999, backgroundColor: colors.brass, alignItems: 'center', justifyContent: 'center' },
  emptyPrimaryText: { fontFamily: fonts.displayBold, fontSize: 15, color: colors.onBrass },
  emptySecondary: { minHeight: 44, paddingHorizontal: 18, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  emptySecondaryText: { fontFamily: fonts.displaySemi, fontSize: 15, color: colors.ink },

  person: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 16 },
  personName: { fontFamily: fonts.displaySemi, fontSize: 16, color: colors.ink },
  personLine: { fontFamily: fonts.display, fontSize: 13, color: colors.inkFaint },

  // a conversation
  subject: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, marginHorizontal: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, backgroundColor: colors.surface1, borderWidth: 1, borderColor: inkTint(0.1) },
  subjectIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  subjectKicker: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase' },
  subjectLabel: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.ink },
  subjectOpen: { fontFamily: fonts.display, fontSize: 13, color: colors.inkDim, flexShrink: 0, maxWidth: '48%' },
  subjectOpenStacked: { maxWidth: '100%', marginTop: 2 },

  dayGroup: { gap: 6 },
  day: { alignSelf: 'center', fontFamily: fonts.mono, fontSize: 11, color: colors.inkFaint, marginVertical: 4 },
  runEnd: { marginBottom: 6 },
  bubble: { maxWidth: '78%', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 18 },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.surface2, borderBottomLeftRadius: 6 },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.brass, borderBottomRightRadius: 6 },
  bubbleText: { fontFamily: fonts.display, fontSize: 15, lineHeight: 21, color: colors.ink },
  mineText: { color: colors.onBrass },
  msgTime: { alignSelf: 'flex-start', fontFamily: fonts.display, fontSize: 11, color: colors.inkFaint, marginTop: 4, marginHorizontal: 6 },
  msgTimeMine: { alignSelf: 'flex-end' },

  pending: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 12, marginBottom: 6, paddingVertical: 6, paddingLeft: 12, paddingRight: 6, borderRadius: 999, backgroundColor: colors.surface1, borderWidth: 1, borderColor: inkTint(0.12), alignSelf: 'flex-start', maxWidth: '100%' },
  pendingText: { flexShrink: 1, fontFamily: fonts.display, fontSize: 13, color: colors.inkDim },
  pendingDrop: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: inkTint(0.06) },

  composer: { paddingTop: 8, backgroundColor: colors.surface0, borderTopWidth: 1, borderTopColor: inkTint(0.08) },
  composeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  inputWrap: { flex: 1, minWidth: 0, minHeight: 44, borderRadius: 22, borderWidth: 1, borderColor: inkTint(0.16), backgroundColor: colors.surface1, paddingHorizontal: 16, justifyContent: 'center' },
  // Six lines of 22pt plus the box's own padding.
  input: { color: colors.ink, fontFamily: fonts.display, fontSize: 16, lineHeight: 22, paddingTop: 10, paddingBottom: 10, maxHeight: 6 * 22 + 20 },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: inkTint(0.1), alignItems: 'center', justifyContent: 'center' },
  sendOn: { backgroundColor: colors.brass },
  count: { alignSelf: 'flex-end', fontFamily: fonts.mono, fontSize: 11, color: colors.inkFaint, marginBottom: 4, marginRight: 56 },
  countOver: { color: colors.danger },

  toastWrap: { position: 'absolute', left: 16, right: 16, bottom: 10, alignItems: 'center' },
  toast: { overflow: 'hidden', borderRadius: 14, backgroundColor: surfaceTint(0.94), borderWidth: 1, borderColor: inkTint(0.14), paddingVertical: 9, paddingHorizontal: 14, fontFamily: fonts.display, fontSize: 13.5, color: colors.ink, textAlign: 'center' }
});
