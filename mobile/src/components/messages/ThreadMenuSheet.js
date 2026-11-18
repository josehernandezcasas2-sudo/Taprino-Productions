import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MESSAGE_WORDS, contextLink, firstName } from '../../lib/messageRules';
import { colors, dangerTint, fonts, inkTint } from '../../lib/theme';
import MessageSheet from './MessageSheet';
import { ContextGlyph, MessageGlyph } from './MessageIcons';

// A conversation's ⋯ (2026-11-18, the ThreadMenu board): View profile, the
// subject's link when it has one, Mute / Unmute, then Block / Unblock (a
// confirm first) and Report (the reasons, then Send report). Each action
// is the screen's (`onMute`, `onBlock`, `onReport` return promises and
// throw on failure); the sheet closes when one works and says why when it
// doesn't.

// The same reasons as lib/reportReasons.js REPORT_REASONS on the website
// (POST /api/messages/report checks them).
export const REPORT_REASONS = [
  ['copyright', 'Stolen or copyrighted'],
  ['sexual', 'Sexual content'],
  ['violence', 'Violence or graphic'],
  ['hate', 'Hate or harassment'],
  ['spam', 'Spam or misleading'],
  ['broken', "Won't play or broken"]
];

export default function ThreadMenuSheet({ visible, onClose, thread, onViewProfile, onOpen, onMute, onBlock, onReport }) {
  return (
    <MessageSheet visible={visible} onClose={onClose} label={MESSAGE_WORDS.more}>
      {thread ? <MenuBody visible={visible} thread={thread} onClose={onClose} onViewProfile={onViewProfile} onOpen={onOpen} onMute={onMute} onBlock={onBlock} onReport={onReport} /> : null}
    </MessageSheet>
  );
}

function MenuBody({ visible, thread, onClose, onViewProfile, onOpen, onMute, onBlock, onReport }) {
  const [view, setView] = useState('menu'); // menu | block | report
  const [reason, setReason] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { setError(null); }, [view]);
  // Each opening starts at the menu (not on closing: the sheet would
  // change under the person as it slides away).
  useEffect(() => {
    if (visible) { setView('menu'); setReason(null); setError(null); }
  }, [visible]);

  const other = thread.other || {};
  const name = other.displayName || '';
  const first = firstName(name);
  const link = contextLink(thread.context, other);
  const hasThread = Boolean(thread.id);

  async function run(fn) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      onClose();
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  if (view === 'block') {
    return (
      <ScrollView style={st.scroll} contentContainerStyle={st.body}>
        <Text style={st.confirm}>{MESSAGE_WORDS.blockConfirm(name)}</Text>
        {error ? <Text style={st.error}>{error}</Text> : null}
        <Pressable style={[st.danger, busy && { opacity: 0.6 }]} disabled={busy} onPress={() => run(() => onBlock(true))} accessibilityRole="button">
          {busy ? <ActivityIndicator color={colors.ink} /> : <Text style={st.dangerText}>{`${MESSAGE_WORDS.block} ${first}`}</Text>}
        </Pressable>
        <Pressable style={st.cancel} onPress={() => setView('menu')} accessibilityRole="button"><Text style={st.cancelText}>{MESSAGE_WORDS.cancel}</Text></Pressable>
      </ScrollView>
    );
  }

  if (view === 'report') {
    return (
      <ScrollView style={st.scroll} contentContainerStyle={st.body}>
        <Text style={st.heading} accessibilityRole="header">{MESSAGE_WORDS.report}</Text>
        <Text style={st.line}>{MESSAGE_WORDS.reportLine}</Text>
        <Text style={st.label}>{MESSAGE_WORDS.reportPick}</Text>
        <View accessibilityRole="radiogroup">
          {REPORT_REASONS.map(([key, words]) => {
            const on = reason === key;
            return (
              <Pressable key={key} style={st.reason} onPress={() => setReason(key)} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                <View style={[st.radio, on && st.radioOn]}>{on ? <View style={st.radioDot} /> : null}</View>
                <Text style={st.reasonText}>{words}</Text>
              </Pressable>
            );
          })}
        </View>
        {error ? <Text style={st.error}>{error}</Text> : null}
        <Pressable style={[st.primary, (!reason || busy) && { opacity: 0.5 }]} disabled={!reason || busy} onPress={() => run(() => onReport(reason))} accessibilityRole="button" accessibilityState={{ disabled: !reason || busy }}>
          {busy ? <ActivityIndicator color={colors.onBrass} /> : <Text style={st.primaryText}>{MESSAGE_WORDS.reportSend}</Text>}
        </Pressable>
        <Pressable style={st.cancel} onPress={() => setView('menu')} accessibilityRole="button"><Text style={st.cancelText}>{MESSAGE_WORDS.cancel}</Text></Pressable>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={st.scroll} contentContainerStyle={st.list}>
      <Item icon={<MessageGlyph name="profile" size={20} color={colors.inkDim} />} label={MESSAGE_WORDS.viewProfile} onPress={() => { onClose(); onViewProfile(); }} role="link" />
      {link ? <Item icon={<ContextGlyph context={thread.context} size={20} />} label={link.label} onPress={() => { onClose(); onOpen(link.href); }} role="link" /> : null}
      {hasThread ? (
        <Item
          icon={<MessageGlyph name={thread.muted ? 'bell' : 'bellOff'} size={20} color={colors.inkDim} />}
          label={thread.muted ? MESSAGE_WORDS.unmute : MESSAGE_WORDS.mute}
          sub={thread.muted ? null : MESSAGE_WORDS.muteLine}
          busy={busy}
          onPress={() => run(() => onMute(!thread.muted))}
        />
      ) : null}
      <View style={st.rule} />
      <Item
        icon={<MessageGlyph name="block" size={20} color={thread.iBlocked ? colors.inkDim : colors.danger} />}
        label={`${thread.iBlocked ? MESSAGE_WORDS.unblock : MESSAGE_WORDS.block} ${first}`}
        danger={!thread.iBlocked}
        busy={busy}
        onPress={() => (thread.iBlocked ? run(() => onBlock(false)) : setView('block'))}
      />
      {hasThread ? <Item icon={<MessageGlyph name="flag" size={20} color={colors.danger} />} label={MESSAGE_WORDS.report} danger onPress={() => setView('report')} /> : null}
      {error ? <Text style={st.error}>{error}</Text> : null}
      <Pressable style={st.cancel} onPress={onClose} accessibilityRole="button"><Text style={st.cancelText}>{MESSAGE_WORDS.cancel}</Text></Pressable>
    </ScrollView>
  );
}

function Item({ icon, label, sub, danger, busy, onPress, role = 'button' }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [st.item, sub ? st.itemTall : null, pressed && { backgroundColor: inkTint(0.05) }]}
      accessibilityRole={role}
      accessibilityLabel={sub ? `${label}. ${sub}` : label}
    >
      {icon}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={[st.itemText, danger && st.itemDanger]}>{label}</Text>
        {sub ? <Text style={st.itemSub}>{sub}</Text> : null}
      </View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  scroll: { flexGrow: 0 },
  list: { gap: 4 },
  body: { gap: 12, paddingTop: 4 },
  item: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 12, marginHorizontal: -8, paddingHorizontal: 8 },
  itemTall: { minHeight: 60 },
  itemText: { fontFamily: fonts.display, fontSize: 16, color: colors.ink },
  itemDanger: { color: colors.danger },
  itemSub: { fontFamily: fonts.display, fontSize: 12, color: colors.inkFaint },
  rule: { height: 1, backgroundColor: inkTint(0.08), marginVertical: 4 },
  cancel: { marginTop: 8, minHeight: 48, borderRadius: 14, backgroundColor: inkTint(0.08), alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontFamily: fonts.displaySemi, fontSize: 15, color: colors.ink },
  confirm: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: colors.ink },
  danger: { minHeight: 48, borderRadius: 14, backgroundColor: dangerTint(0.18), borderWidth: 1, borderColor: dangerTint(0.5), alignItems: 'center', justifyContent: 'center' },
  dangerText: { fontFamily: fonts.displayBold, fontSize: 15, color: colors.danger },
  heading: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink },
  line: { fontFamily: fonts.body, fontSize: 14.5, lineHeight: 21, color: colors.inkDim },
  label: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 2, color: colors.inkFaint, textTransform: 'uppercase' },
  reason: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: inkTint(0.3), alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.brass },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brass },
  reasonText: { fontFamily: fonts.display, fontSize: 15.5, color: colors.ink },
  primary: { minHeight: 48, borderRadius: 14, backgroundColor: colors.brass, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontFamily: fonts.displayBold, fontSize: 15, color: colors.onBrass },
  error: { fontFamily: fonts.display, fontSize: 13.5, color: colors.danger, backgroundColor: dangerTint(0.08), borderRadius: 10, padding: 10, overflow: 'hidden' }
});
