import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../lib/stableAuth';
import { TYPE_WORDS, askCards, askDue, continueLabel, makeMain, normalizeMain, normalizeTypes, toggleType } from '../lib/accountTypeRules';
import { isNotReady, readAccountTypes, saveAccountTypes } from '../lib/accountTypes';
import { TYPE_TINT, TickBox, TypeGlyph } from '../components/account/AccountTypeBits';
import { brassTint, colors, fonts, inkTint } from '../lib/theme';

// "What brings you here?" (Jose, 2026-11-18; the Main board of
// https://claude.ai/artifact/GxAa8Qj57oQRuBF7c5xo4q; the website's
// pages/start.js): the four account types as cards to tick, the first one
// ticked the main, Continue saves them and Skip says "here to watch". It
// comes up once, after a general sign-in (components/dashboard/
// useSignInLanding.js) or from the Account hub's nudge, and goes on to
// `next` either way. Every word and rule is lib/accountTypeRules.js.
//
// No site header and no bottom bar (BottomNav leaves /start out): the brand
// strip with Skip, as on the website's /welcome.

const CANT_LOAD = 'This didn’t load. Check your connection and try again.';
const TRY_AGAIN = 'Try again';
const NOT_NOW = 'Not now';

// Where to go on: a path in the app, never another address (a link into
// the app could carry anything as ?next=).
function nextRoute(value) {
  const v = Array.isArray(value) ? value[0] : value;
  if (typeof v !== 'string' || v.length > 400) return '/';
  if (!/^\/(?![/\\])[^\s\\]*$/.test(v) || v.startsWith('/start')) return '/';
  return v;
}

export default function Start() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const next = nextRoute(params.next);
  const { isLoaded, isSignedIn, getToken } = useAuth();
  // loading | ask | failed | leaving
  const [phase, setPhase] = useState('loading');
  const [pick, setPick] = useState({ types: [], main: null });
  const [busy, setBusy] = useState(null); // 'save' | 'skip'
  const [error, setError] = useState(null);
  const left = useRef(false);

  // On to `next`: back down the stack to it when it is there, else in this
  // screen's place (dismissTo = React Navigation's POP_TO).
  const goOn = useCallback(() => {
    if (left.current) return;
    left.current = true;
    setPhase('leaving');
    try {
      router.dismissTo(next);
    } catch {
      router.replace(next);
    }
  }, [next]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    setPhase('loading');
    try {
      const state = await readAccountTypes(getToken);
      // Answered already (or the database isn't ready): straight on.
      if (!askDue({ signedIn: true, state })) { goOn(); return; }
      const types = normalizeTypes(state.suggested);
      setPick({ types, main: normalizeMain(types, types[0]) });
      setPhase('ask');
    } catch {
      // Never ask on a guess: a skip from here would wipe types the person
      // already has. (Clerk says signed in, so a refusal here is the server
      // not seeing the session yet: Try again.)
      setPhase('failed');
    }
  }, [getToken, goOn]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isLoaded || left.current) return;
    if (!isSignedIn) {
      left.current = true;
      router.replace('/account');
      return;
    }
    load();
  }, [isLoaded, isSignedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(body, kind) {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try {
      await saveAccountTypes(getToken, body);
      goOn();
    } catch (err) {
      // Before migration 126 the question can't be saved: on, silently.
      if (isNotReady(err)) { goOn(); return; }
      setError(TYPE_WORDS.failed);
      setBusy(null);
    }
  }

  const cards = askCards(pick);
  const ticked = cards.filter((c) => c.checked);
  const none = pick.types.length === 0;
  const asking = phase === 'ask';

  return (
    <SafeAreaView style={st.screen} edges={['top', 'bottom', 'left', 'right']}>
      <View style={st.bar}>
        <Text style={st.brand} accessibilityRole="header" accessibilityLabel="Studio Tapa">Studio <Text style={st.brandStrong}>Tapa</Text></Text>
        {asking ? (
          <Pressable style={({ pressed }) => [st.barSkip, pressed && st.pressedText]} onPress={() => save({ skip: true }, 'skip')} disabled={Boolean(busy)} accessibilityRole="button" hitSlop={6}>
            <Text style={st.barSkipText}>{TYPE_WORDS.skip}</Text>
          </Pressable>
        ) : null}
      </View>

      {phase === 'loading' || phase === 'leaving' ? (
        <View style={st.center}><ActivityIndicator color={colors.brass} /></View>
      ) : phase === 'failed' ? (
        <View style={st.center}>
          <Text style={st.failed}>{CANT_LOAD}</Text>
          <Pressable style={({ pressed }) => [st.retry, pressed && st.pressedFill]} onPress={load} accessibilityRole="button">
            <Text style={st.retryText}>{TRY_AGAIN}</Text>
          </Pressable>
          <Pressable style={({ pressed }) => [st.later, pressed && st.pressedText]} onPress={goOn} accessibilityRole="button">
            <Text style={st.laterText}>{NOT_NOW}</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <ScrollView style={st.scroll} contentContainerStyle={st.main}>
            <View style={st.column}>
              <Text style={st.title} accessibilityRole="header">{TYPE_WORDS.askTitle}</Text>
              <Text style={st.intro}>{TYPE_WORDS.askIntro}</Text>
              <View style={st.cards}>
                {cards.map((c) => {
                  const tint = TYPE_TINT[c.type];
                  return (
                    <Pressable
                      key={c.type}
                      style={({ pressed }) => [st.card, c.checked && (c.main ? st.cardMain : st.cardOn), pressed && st.cardPressed]}
                      onPress={() => { setError(null); setPick((p) => toggleType(p, c.type)); }}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: c.checked }}
                      accessibilityLabel={`${c.label}${c.main ? `, ${TYPE_WORDS.main}` : ''}. ${c.blurb}`}
                    >
                      <View style={[st.icon, { backgroundColor: tint.tint }]}>
                        <TypeGlyph type={c.type} color={tint.color} />
                      </View>
                      <View style={st.cardText}>
                        <View style={st.cardLabelRow}>
                          <Text style={st.cardLabel}>{c.label}</Text>
                          {c.main ? <View style={st.mainChip}><Text style={st.mainChipText}>{TYPE_WORDS.mainChip}</Text></View> : null}
                        </View>
                        <Text style={[st.blurb, c.checked && st.blurbOn]}>{c.blurb}</Text>
                      </View>
                      <TickBox checked={c.checked} />
                    </Pressable>
                  );
                })}
              </View>

              {/* Two or more ticked: the main can change without unticking. */}
              {ticked.length >= 2 ? (
                <View style={st.mainRow}>
                  <Text style={st.mainLabel}>{TYPE_WORDS.main}</Text>
                  <View style={st.mainChips} accessibilityRole="radiogroup" accessibilityLabel={TYPE_WORDS.main}>
                    {ticked.map((c) => (
                      <Pressable
                        key={c.type}
                        style={({ pressed }) => [st.radio, c.main ? st.radioOn : st.radioOff, pressed && !c.main && st.pressed]}
                        onPress={() => setPick((p) => makeMain(p, c.type))}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: c.main }}
                        accessibilityLabel={c.label}
                        hitSlop={4}
                      >
                        <Text style={c.main ? st.radioOnText : st.radioText}>{c.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}

              <Text style={st.skipNote}>{TYPE_WORDS.askSkipNote}</Text>
            </View>
          </ScrollView>

          <View style={st.foot}>
            <View style={st.column}>
              {error ? <Text style={st.error} accessibilityLiveRegion="polite">{error}</Text> : null}
              <Pressable
                style={({ pressed }) => [st.continue, (none || busy) && st.continueOff, pressed && !none && st.pressedFill]}
                onPress={() => save({ types: pick.types, main: pick.main }, 'save')}
                disabled={none || Boolean(busy)}
                accessibilityRole="button"
                accessibilityState={{ disabled: none || Boolean(busy), busy: busy === 'save' }}
              >
                {busy === 'save' ? <ActivityIndicator color={colors.onBrass} /> : <Text style={st.continueText}>{continueLabel(pick.types, pick.main)}</Text>}
              </Pressable>
              <Pressable style={({ pressed }) => [st.skipLong, pressed && st.pressedText]} onPress={() => save({ skip: true }, 'skip')} disabled={Boolean(busy)} accessibilityRole="button">
                {busy === 'skip' ? <ActivityIndicator color={colors.inkDim} /> : <Text style={st.skipLongText}>{TYPE_WORDS.skipLong}</Text>}
              </Pressable>
            </View>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  pressed: { backgroundColor: inkTint(0.06) },
  pressedText: { opacity: 0.7 },
  pressedFill: { opacity: 0.85 },
  // The brand strip (the website's .welcome-bar): wordmark left, Skip right.
  bar: { height: 64, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { fontFamily: fonts.display, fontSize: 17, color: colors.ink },
  brandStrong: { fontFamily: fonts.displayBold, color: colors.brass },
  barSkip: { minHeight: 44, minWidth: 44, paddingHorizontal: 4, alignItems: 'flex-end', justifyContent: 'center' },
  barSkipText: { fontFamily: fonts.display, fontSize: 14, color: colors.inkDim },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 12 },
  failed: { fontFamily: fonts.display, fontSize: 15, lineHeight: 22, color: colors.inkDim, textAlign: 'center' },
  retry: { minHeight: 48, paddingHorizontal: 28, borderRadius: 14, backgroundColor: colors.brass, alignItems: 'center', justifyContent: 'center' },
  retryText: { fontFamily: fonts.displayBold, fontSize: 15, color: colors.onBrass },
  later: { minHeight: 44, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  laterText: { fontFamily: fonts.display, fontSize: 14, color: colors.inkDim },

  scroll: { flex: 1 },
  main: { paddingTop: 6, paddingHorizontal: 20, paddingBottom: 16 },
  // A phone's whole width; on a tablet the same column, centred.
  column: { width: '100%', maxWidth: 520, alignSelf: 'center', gap: 12 },
  title: { fontFamily: fonts.bodyBold, fontSize: 30, lineHeight: 35, color: colors.ink },
  intro: { fontFamily: fonts.display, fontSize: 15, lineHeight: 22, color: colors.inkDim, marginBottom: 2 },
  cards: { gap: 10 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: inkTint(0.14), backgroundColor: colors.surface1 },
  // Ticked: the main in the full accent, the others in a softer one (the
  // border is 2 wide, so a point less padding keeps the card the same size).
  cardMain: { borderWidth: 2, borderColor: colors.brass, backgroundColor: brassTint(0.08), paddingVertical: 11, paddingHorizontal: 13 },
  cardOn: { borderWidth: 2, borderColor: brassTint(0.6), backgroundColor: brassTint(0.05), paddingVertical: 11, paddingHorizontal: 13 },
  cardPressed: { opacity: 0.88 },
  icon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  cardText: { flex: 1, gap: 2 },
  cardLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardLabel: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.ink },
  mainChip: { borderRadius: 999, backgroundColor: colors.brass, paddingVertical: 2, paddingHorizontal: 7 },
  mainChipText: { fontFamily: fonts.mono, fontSize: 9, letterSpacing: 1, color: colors.onBrass },
  blurb: { fontFamily: fonts.display, fontSize: 13, lineHeight: 17.5, color: colors.inkFaint },
  blurbOn: { color: colors.inkDim },
  mainRow: { gap: 8, marginTop: 2 },
  mainLabel: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', color: colors.inkFaint },
  mainChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  radio: { height: 40, paddingHorizontal: 16, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: colors.brass },
  radioOff: { borderWidth: 1, borderColor: inkTint(0.2) },
  radioOnText: { fontFamily: fonts.displayBold, fontSize: 14, color: colors.onBrass },
  radioText: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.inkDim },
  skipNote: { fontFamily: fonts.display, fontSize: 13, lineHeight: 19, color: colors.inkFaint, marginTop: 2 },

  foot: { paddingTop: 14, paddingHorizontal: 20, paddingBottom: 16 },
  error: { fontFamily: fonts.display, fontSize: 13.5, lineHeight: 19, color: colors.danger, textAlign: 'center' },
  // 52 tall; four types on a narrow phone wrap the label to two lines and
  // the button grows with it.
  continue: { minHeight: 52, borderRadius: 14, backgroundColor: colors.brass, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  continueOff: { opacity: 0.55 },
  continueText: { fontFamily: fonts.displayBold, fontSize: 16, lineHeight: 21, color: colors.onBrass, textAlign: 'center' },
  skipLong: { alignSelf: 'center', minHeight: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  skipLongText: { fontFamily: fonts.display, fontSize: 14, color: colors.inkDim }
});
