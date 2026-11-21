import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SCREENING_WORDS, SCREENING_WORDS_APP, screeningHref, screeningText, screeningsList } from '../../lib/screeningRules';
import { colors } from '../../lib/theme';
import NewLinkSheet from './NewLinkSheet';
import { Btn, ChoiceChip, LoadState, PartsLine, PlusButton, StatePill, TonePill, WindowBar, idPart, sb, screeningCall, useCopy, useNow } from './ScreeningBits';

// The Private screenings tab in the app (2026-11-21; the canvas board
// AppList, mockups/private-screenings-contract.md "App"): one body for a
// title's dashboard (target episode) and a show's page (target series).
// GET /api/screenings?target=<type>:<id> → { target, links, suggestion };
// lib/screeningRules.js screeningsList turns the links into the filter
// chips, the cards that still work (live first, then the soonest to open)
// and the ended ones. A card opens the link's own screen
// (creator/screenings/[id]); Copy link / Copy password copy at once;
// an ended card has Run it again (the New link sheet, prefilled) and
// Discard… (asked first). The round + opens New link.
//
// Read on every visit, every 30 s while the screen is in front (the
// "watching" counts and the states move), after every change, and when
// the screen around it is pulled to refresh (`refreshKey`).
const POLL_MS = 30000;

export default function ScreeningsList({ target, getToken, refreshKey = 0 }) {
  const router = useRouter();
  const [box, setBox] = useState({ state: 'loading', data: null, error: null, code: null });
  const [filter, setFilter] = useState('all');
  const [sheet, setSheet] = useState(null); // { mode: 'new' | 'again', link? }
  // What the sheet shows while it slides away after closing.
  const lastSheet = useRef({ mode: 'new', link: null });
  if (sheet) lastSheet.current = sheet;
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [now, setNow] = useNow(POLL_MS);
  const { copied, copy } = useCopy();
  const seq = useRef(0);
  const type = target && target.type;
  const id = target && target.id;
  const path = `/api/screenings?target=${encodeURIComponent(`${type}:${id}`)}`;

  const load = useCallback(async () => {
    if (!type || !id) return;
    const mine = ++seq.current;
    const r = await screeningCall('GET', path, null, getToken);
    if (mine !== seq.current) return;
    setNow(Date.now());
    if (r.ok) setBox({ state: 'ok', data: r.data, error: null, code: null });
    // A failed re-read keeps what was on screen.
    else setBox((b) => (b.state === 'ok' && r.status !== 403 && r.status !== 503 ? b : { state: 'failed', data: null, error: r.error, code: r.code }));
  }, [type, id, path, getToken, setNow]);

  useFocusEffect(useCallback(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]));
  useEffect(() => { if (refreshKey) load(); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const data = box.data;
  const links = data && Array.isArray(data.links) ? data.links : [];
  const tgt = data && data.target ? data.target : null;
  const list = screeningsList(links, now, filter);
  const byId = new Map(links.map((l) => [l.id, l]));
  const open = (linkId) => router.push(screeningHref(linkId));

  function discard(card) {
    Alert.alert(
      screeningText('discardAsk', { label: card.label }),
      SCREENING_WORDS.discardLine,
      [
        { text: SCREENING_WORDS.keep, style: 'cancel' },
        {
          text: SCREENING_WORDS.discardYes,
          style: 'destructive',
          onPress: async () => {
            setBusy(`discard:${card.id}`);
            setNotice(null);
            const r = await screeningCall('DELETE', `/api/screenings/${idPart(card.id)}`, {}, getToken);
            setBusy(null);
            if (!r.ok) setNotice({ tone: 'error', text: r.error });
            load();
          }
        }
      ]
    );
  }

  const head = (
    <View style={sb.between}>
      <Text style={sb.h2} accessibilityRole="header">{SCREENING_WORDS.tab}</Text>
      {box.state === 'ok' ? <PlusButton label={SCREENING_WORDS_APP.newLinkTitle} onPress={() => setSheet({ mode: 'new' })} /> : null}
    </View>
  );

  if (box.state !== 'ok') {
    const behind = box.code === 'migration-128' || box.code === 'not-yours';
    return (
      <View style={st.body}>
        {head}
        <View style={sb.card}>
          <LoadState state={box.state} error={box.error} onRetry={behind ? null : () => { setBox((b) => ({ ...b, state: 'loading' })); load(); }} />
        </View>
      </View>
    );
  }

  return (
    <View style={st.body}>
      {head}
      {notice ? <Text style={notice.tone === 'error' ? sb.error : sb.ok} accessibilityLiveRegion="polite">{notice.text}</Text> : null}

      {list.empty ? (
        <View style={[sb.card, st.empty]}>
          <Text style={sb.label}>{SCREENING_WORDS.emptyTitle}</Text>
          <Text style={sb.small}>{SCREENING_WORDS.emptyLine}</Text>
          {tgt && tgt.type === 'series' ? <Text style={sb.fine}>{SCREENING_WORDS.showNote}</Text> : null}
          <Btn label={SCREENING_WORDS.newLink} kind="primary" onPress={() => setSheet({ mode: 'new' })} style={{ alignSelf: 'flex-start' }} />
        </View>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.filters} accessibilityRole="radiogroup">
            {list.filters.map((f) => <ChoiceChip key={f.key} label={f.text} on={f.on} onPress={() => setFilter(f.key)} />)}
          </ScrollView>

          {list.open.map((card) => {
            const link = byId.get(card.id);
            return (
              <View key={card.id} style={[sb.card, card.state.key === 'scheduled' && sb.cardScheduled]}>
                <Pressable onPress={() => open(card.id)} style={({ pressed }) => [st.cardTop, pressed && sb.pressed]} accessibilityRole="link" accessibilityLabel={`${card.label}. ${card.state.label}. ${card.windowLine}`}>
                  <View style={sb.between}>
                    <StatePill state={card.state} />
                    {card.watchingLine ? <TonePill label={card.watchingLine} tone="brass" dot /> : <Text style={sb.k} numberOfLines={1}>{card.access}</Text>}
                  </View>
                  <Text style={sb.label}>{card.label}</Text>
                  {card.state.key !== 'scheduled' ? <WindowBar progress={card.progress} /> : null}
                  <Text style={[sb.k, { color: card.soon ? colors.warn : colors.ink }]}>{card.windowLine}</Text>
                  <PartsLine parts={card.parts} />
                </Pressable>
                <View style={sb.wrap}>
                  {card.actions.copy && link && link.url ? <Btn small label={copied === `l:${card.id}` ? SCREENING_WORDS.copied : SCREENING_WORDS.copyLink} onPress={() => copy(`l:${card.id}`, link.url)} /> : null}
                  {card.actions.copy && link && link.password ? <Btn small label={copied === `p:${card.id}` ? SCREENING_WORDS.copied : SCREENING_WORDS.copyPassword} onPress={() => copy(`p:${card.id}`, link.password)} /> : null}
                  <Btn small label={SCREENING_WORDS.open} onPress={() => open(card.id)} />
                </View>
              </View>
            );
          })}
          {!list.open.length && filter !== 'ended' ? <Text style={sb.small}>{SCREENING_WORDS_APP.nothingHere}</Text> : null}

          {list.ended.length ? (
            <View style={st.ended}>
              <Text style={sb.k} accessibilityRole="header">{SCREENING_WORDS.endedHead}</Text>
              <Text style={sb.fine}>{SCREENING_WORDS.endedLine}</Text>
              {list.ended.map((card) => (
                <View key={card.id} style={[sb.card, sb.cardEnded]}>
                  <Pressable onPress={() => open(card.id)} style={({ pressed }) => [st.cardTop, pressed && sb.pressed]} accessibilityRole="link" accessibilityLabel={`${card.label}. ${card.state.label}`}>
                    <Text style={sb.label}>{card.label}</Text>
                    <Text style={sb.small}>{[card.state.label, card.endedLine].filter(Boolean).join(' · ')}</Text>
                  </Pressable>
                  <View style={sb.wrap}>
                    <Btn small label={SCREENING_WORDS.runAgain} kind="primary" onPress={() => setSheet({ mode: 'again', link: byId.get(card.id) })} />
                    <Btn small label={SCREENING_WORDS.discard} kind="danger" busy={busy === `discard:${card.id}`} onPress={() => discard(card)} />
                  </View>
                </View>
              ))}
            </View>
          ) : filter === 'ended' ? <Text style={sb.small}>{SCREENING_WORDS_APP.nothingHere}</Text> : null}
        </>
      )}

      {tgt ? (
        <NewLinkSheet
          visible={Boolean(sheet)}
          mode={lastSheet.current.mode}
          link={lastSheet.current.link || null}
          target={tgt}
          suggestion={data.suggestion || ''}
          getToken={getToken}
          onClose={() => setSheet(null)}
          onSaved={() => load()}
          onOpenLink={(linkId) => { setSheet(null); open(linkId); }}
        />
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  body: { gap: 14 },
  empty: { gap: 10 },
  filters: { gap: 8, paddingRight: 8 },
  cardTop: { gap: 8 },
  ended: { gap: 10, marginTop: 6 }
});
