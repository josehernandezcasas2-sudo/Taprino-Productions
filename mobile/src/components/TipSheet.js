import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';
import Svg, { Circle, Path } from 'react-native-svg';
import { apiPost } from '../lib/api';
import { colors, fonts, oliveTint, brassTint, absoluteFill } from '../lib/theme';
import { Avatar } from './CrewBits';
import { dollars } from '../lib/purchaseRules';
import { tipQuote, parseTipAmount, validateTipInput, MAX_NOTE_CHARS, MIN_TIP_CENTS, DEFAULT_TIP_MAX_CENTS, TIP_PRESETS_CENTS } from '../lib/tipRules';

// Tips, the app's side (mockup 2026-10-24): mirrors components/TipSheet.js
// on the website. `tipping` is what /api/profile and /api/episode-page
// carry from lib/tips.js getTipping: { enabled, creatorId, creatorName,
// creatorAvatar, cutPercent, maxCents, minCents, presets, fiscalSponsor }
// or { enabled: false } (payouts not ready, your own profile, not a
// creator); every button here renders nothing then. Paying opens Stripe
// Checkout in the in-app browser like backing; Checkout returns to the
// website, so the fan closes the browser when it's done.

const short = (name) => (name || 'the creator').trim().split(/\s+/)[0];
const whole = (cents) => dollars(cents).replace(/\.00$/, '');

// The tip coin (components/PlayerIcons.js TipIcon): never backing's
// diamond or the wishlist's heart.
export function TipGlyph({ size = 14, color = colors.olive }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="12" cy="12" r="9" />
      <Path d="M12 7v10" />
      <Path d="M14.6 9.6c-.4-.9-1.4-1.5-2.6-1.5-1.5 0-2.6.8-2.6 1.9 0 2.6 5.2 1.3 5.2 3.9 0 1.2-1.1 2-2.6 2-1.3 0-2.3-.6-2.7-1.6" />
    </Svg>
  );
}

export function promptTipSignIn(router) {
  Alert.alert('Sign in to tip', 'Tips go straight to the creator through their Stripe account.', [
    { text: 'Not now', style: 'cancel' },
    { text: 'Sign in', onPress: () => router.push('/account') }
  ]);
}

export function TipSheet({ tipping, visible, initialAmountCents = 500, onClose, getToken, returnTo, onDone }) {
  const presets = (tipping && tipping.presets) || TIP_PRESETS_CENTS;
  const [amountCents, setAmountCents] = useState(initialAmountCents);
  const [custom, setCustom] = useState(false);
  const [customInput, setCustomInput] = useState('25');
  const [note, setNote] = useState('');
  const [showName, setShowName] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!visible) return;
    setAmountCents(initialAmountCents);
    setCustom(!presets.includes(initialAmountCents));
    setCustomInput(presets.includes(initialAmountCents) ? '25' : String(initialAmountCents / 100));
    setError(null);
    setBusy(false);
  }, [visible, initialAmountCents]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!tipping || !tipping.enabled) return null;

  const name = short(tipping.creatorName);
  const maxCents = tipping.maxCents || DEFAULT_TIP_MAX_CENTS;
  const minCents = tipping.minCents || MIN_TIP_CENTS;
  const cents = custom ? parseTipAmount(customInput) : amountCents;
  const check = validateTipInput({ amountCents: cents, note, showName }, { maxCents });
  const quote = check.ok ? tipQuote(check.amountCents, tipping.cutPercent) : null;

  async function send() {
    if (!check.ok) { setError(check.error); return; }
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const data = await apiPost('/api/tips/checkout', { creatorId: tipping.creatorId, amountCents: check.amountCents, note: check.note, showName: check.showName, returnTo }, token);
      if (!data.url) throw new Error('Could not start the tip.');
      await WebBrowser.openBrowserAsync(data.url);
      onClose();
      if (onDone) onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetWrap} pointerEvents="box-none">
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 14 }}>
            <View style={styles.head}>
              <Avatar userId={tipping.creatorId} name={tipping.creatorName} src={tipping.creatorAvatar ? tipping.creatorAvatar.url : null} position={tipping.creatorAvatar ? tipping.creatorAvatar.position : null} zoom={tipping.creatorAvatar ? tipping.creatorAvatar.zoom : 1} size={40} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><TipGlyph size={11} /><Text style={styles.kicker}>Fan support</Text></View>
                <Text style={styles.title}>Tip {tipping.creatorName}</Text>
              </View>
              <Pressable onPress={onClose} accessibilityLabel="Close" hitSlop={10} style={styles.close}><Text style={styles.closeText}>×</Text></Pressable>
            </View>

            <View style={styles.presets}>
              {presets.map((p) => (
                <Pressable key={p} style={[styles.preset, !custom && amountCents === p && styles.presetOn]} onPress={() => { setCustom(false); setAmountCents(p); setError(null); }}>
                  <Text style={[styles.presetText, !custom && amountCents === p && styles.presetTextOn]}>{whole(p)}</Text>
                </Pressable>
              ))}
              <Pressable style={[styles.preset, custom && styles.presetOn]} onPress={() => { setCustom(true); setError(null); }}>
                <Text style={[styles.presetText, custom && styles.presetTextOn]}>Custom</Text>
              </Pressable>
            </View>
            {custom ? (
              <View style={{ gap: 6 }}>
                <Text style={styles.label}>Your amount, {whole(minCents)} to {whole(maxCents)}</Text>
                <TextInput value={customInput} onChangeText={(v) => { setCustomInput(v); setError(null); }} keyboardType="decimal-pad" style={[styles.input, { fontFamily: fonts.mono }]} placeholderTextColor={colors.inkFaint} autoFocus />
              </View>
            ) : null}

            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={styles.label}>Say something (optional)</Text>
                <Text style={[styles.label, { fontFamily: fonts.mono, fontSize: 11 }]}>{MAX_NOTE_CHARS - note.length}</Text>
              </View>
              <TextInput value={note} onChangeText={(v) => setNote(v.slice(0, MAX_NOTE_CHARS))} multiline numberOfLines={2} style={[styles.input, { minHeight: 64, textAlignVertical: 'top' }]} placeholder={`what you loved about ${name}’s work`} placeholderTextColor={colors.inkFaint} maxLength={MAX_NOTE_CHARS} />
            </View>

            <View style={styles.math}>
              <View style={styles.mathRow}><Text style={styles.mathLabel}>{name} receives</Text><Text style={styles.mathValue}>{quote ? dollars(quote.creatorCents) : '—'}</Text></View>
              <View style={styles.mathRow}><Text style={styles.mathLabel}>Studio Tapa TV ({tipping.cutPercent}%)</Text><Text style={styles.mathValue}>{quote ? dollars(quote.cutCents) : '—'}</Text></View>
              <View style={styles.mathRow}><Text style={[styles.mathLabel, { flex: 1 }]}>Card processing, covered by you so {name} keeps more</Text><Text style={styles.mathValue}>{quote ? dollars(quote.feeCents) : '—'}</Text></View>
              <View style={[styles.mathRow, styles.mathTotal]}><Text style={styles.mathTotalText}>You pay</Text><Text style={styles.mathTotalText}>{quote ? dollars(quote.totalCents) : '—'}</Text></View>
            </View>

            <View style={styles.switchRow}>
              <Text style={[styles.label, { flex: 1, fontSize: 14 }]}>Show my name to {name} <Text style={{ color: colors.inkFaint }}>· otherwise “a fan”</Text></Text>
              <Switch value={showName} onValueChange={setShowName} trackColor={{ true: colors.brass, false: colors.oceanInk }} thumbColor={colors.ink} />
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable style={[styles.go, (busy || !check.ok) && { opacity: 0.6 }]} disabled={busy || !check.ok} onPress={send}>
              <Text style={styles.goText}>{busy ? 'Opening Stripe…' : `Tip ${quote ? whole(quote.amountCents) : ''} →`}</Text>
            </Pressable>
            <Text style={styles.fine}>
              Opens Stripe Checkout in the browser, like backing. A tip is a thank-you, not a purchase and not a donation: it buys nothing, isn’t tax-deductible and is final unless the studio refunds it. Your note is moderated; be kind.
              {tipping.fiscalSponsor && tipping.fiscalSponsor.url ? ` Prefer a tax-deductible donation? ${name}’s work is fiscally sponsored by ${tipping.fiscalSponsor.name || 'a nonprofit'}: ` : ''}
              {tipping.fiscalSponsor && tipping.fiscalSponsor.url ? <Text style={styles.link} onPress={() => WebBrowser.openBrowserAsync(tipping.fiscalSponsor.url)}>give through them</Text> : null}
              {tipping.fiscalSponsor && tipping.fiscalSponsor.url ? '.' : ''}
            </Text>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// A button that opens the sheet. `style`/`textStyle` come from the screen
// (the profile's action pill, the episode's credit chip); the coin sits
// before the label in `iconColor`. Renders nothing when the creator
// can't be tipped.
export function TipButton({ tipping, isSignedIn, router, getToken, returnTo, style, textStyle, iconColor = colors.olive, iconSize = 13, children, presetCents = 500, onDone }) {
  const [open, setOpen] = useState(false);
  if (!tipping || !tipping.enabled) return null;
  return (
    <>
      <Pressable style={[style, { flexDirection: 'row', alignItems: 'center', gap: 5 }]} onPress={() => (isSignedIn ? setOpen(true) : promptTipSignIn(router))} accessibilityLabel={`Tip ${tipping.creatorName}`}>
        <TipGlyph size={iconSize} color={iconColor} />
        <Text style={textStyle}>{children || `Tip ${short(tipping.creatorName)}`}</Text>
      </Pressable>
      <TipSheet tipping={tipping} visible={open} initialAmountCents={presetCents} onClose={() => setOpen(false)} getToken={getToken} returnTo={returnTo} onDone={onDone} />
    </>
  );
}

// Once per title: remembered in SecureStore (the website uses localStorage).
const SEEN_KEY = 'tip_end_seen';
let seenCache = null;
async function loadSeen() {
  if (seenCache) return seenCache;
  try {
    seenCache = new Set(JSON.parse((await SecureStore.getItemAsync(SEEN_KEY)) || '[]'));
  } catch {
    seenCache = new Set();
  }
  return seenCache;
}
export async function tipEndCardSeen(episodeId) {
  return (await loadSeen()).has(episodeId);
}
export async function markTipEndCardSeen(episodeId) {
  const seen = await loadSeen();
  seen.add(episodeId);
  try {
    // SecureStore values are small: keep the last 40 titles.
    await SecureStore.setItemAsync(SEEN_KEY, JSON.stringify([...seen].slice(-40)));
  } catch { /* keep the in-memory copy */ }
}

// Over the player after the credits start. In a series, counts down to the
// next episode so autoplay still happens.
export function TipEndCard({ tipping, title, isSignedIn, router, getToken, returnTo, onNext, nextSeconds = 10, onClose }) {
  const [sheet, setSheet] = useState(null);
  const [left, setLeft] = useState(onNext ? nextSeconds : null);
  useEffect(() => {
    if (!onNext || sheet) return undefined;
    if (left <= 0) { onNext(); return undefined; }
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left, onNext, sheet]);
  if (!tipping || !tipping.enabled) return null;
  const name = short(tipping.creatorName);
  const tip = (cents) => (isSignedIn ? setSheet(cents) : promptTipSignIn(router));
  return (
    <View style={[absoluteFill, styles.endWrap]}>
      <View style={styles.endCard}>
        <Pressable onPress={onClose} accessibilityLabel="Close" hitSlop={10} style={[styles.close, { position: 'absolute', top: 8, right: 8 }]}><Text style={styles.closeText}>×</Text></Pressable>
        <Text style={[styles.kicker, { color: colors.inkDim }]} numberOfLines={1}>That was {title}</Text>
        <Text style={styles.endTitle}>Liked it? Tip {name}.</Text>
        <Text style={styles.endBody}>Tips go straight to {name}’s Stripe account. $3 covers a coffee; $10 covers a hard drive’s worth of footage.</Text>
        <View style={styles.endActions}>
          <Pressable style={styles.endBtn} onPress={() => tip(300)}><TipGlyph size={14} color={colors.onBrass} /><Text style={styles.endBtnText}>Tip $3</Text></Pressable>
          <Pressable style={styles.endBtn} onPress={() => tip(500)}><TipGlyph size={14} color={colors.onBrass} /><Text style={styles.endBtnText}>Tip $5</Text></Pressable>
          {onNext ? (
            <Pressable style={[styles.endBtn, styles.endBtnGhost]} onPress={onNext}><Text style={[styles.endBtnText, { color: colors.ink }]}>Next episode{left != null && !sheet ? ` in ${left}s` : ''} →</Text></Pressable>
          ) : null}
        </View>
      </View>
      <TipSheet tipping={tipping} visible={sheet != null} initialAmountCents={sheet || 500} onClose={() => { setSheet(null); setLeft(null); }} getToken={getToken} returnTo={returnTo} />
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(12,19,31,0.6)' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface1, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderTopWidth: 1, borderColor: colors.oceanInk, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 28, maxHeight: '92%' },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.oceanInk, alignSelf: 'center', marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  kicker: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 1.1, textTransform: 'uppercase', color: colors.olive },
  title: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink },
  close: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.oceanInk, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: colors.inkDim, fontSize: 18, lineHeight: 20 },
  presets: { flexDirection: 'row', gap: 8 },
  preset: { flex: 1, minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.oceanInk, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  presetOn: { borderColor: colors.brass, backgroundColor: brassTint(0.16) },
  presetText: { fontFamily: fonts.displayBold, fontSize: 15, color: colors.ink },
  presetTextOn: { color: colors.brass },
  label: { fontFamily: fonts.body, fontSize: 13, color: colors.inkDim },
  input: { fontFamily: fonts.body, fontSize: 15, color: colors.ink, backgroundColor: colors.surface0, borderWidth: 1, borderColor: colors.oceanInk, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, minHeight: 44 },
  math: { gap: 5, padding: 12, borderRadius: 12, backgroundColor: colors.surface0 },
  mathRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 },
  mathLabel: { fontFamily: fonts.body, fontSize: 13.5, color: colors.inkDim },
  mathValue: { fontFamily: fonts.mono, fontSize: 13.5, color: colors.ink },
  mathTotal: { borderTopWidth: 1, borderTopColor: colors.oceanInk, paddingTop: 6, marginTop: 2 },
  mathTotalText: { fontFamily: fonts.displayBold, fontSize: 15, color: colors.ink },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  go: { minHeight: 48, borderRadius: 999, backgroundColor: colors.brass, alignItems: 'center', justifyContent: 'center' },
  goText: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.onBrass },
  fine: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.inkFaint },
  link: { color: colors.olive, textDecorationLine: 'underline' },
  error: { fontFamily: fonts.body, fontSize: 13, color: colors.danger },
  endWrap: { backgroundColor: 'rgba(12,19,31,0.86)', alignItems: 'center', justifyContent: 'center', padding: 12 },
  endCard: { width: '100%', maxWidth: 440, backgroundColor: colors.surface3, borderRadius: 16, padding: 16, paddingTop: 18, gap: 8 },
  endTitle: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink, paddingRight: 36 },
  endBody: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.inkDim },
  endActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  endBtn: { minHeight: 40, paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.olive, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  endBtnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.ink },
  endBtnText: { fontFamily: fonts.displaySemi, fontSize: 13.5, color: colors.onBrass }
});

export const tipChipStyles = StyleSheet.create({
  chip: { borderWidth: 1, borderColor: oliveTint(0.6), backgroundColor: oliveTint(0.08), borderRadius: 999, paddingHorizontal: 11, paddingVertical: 4 },
  chipText: { fontFamily: fonts.mono, fontSize: 10.9, color: colors.olive }
});
