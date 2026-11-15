import { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { TITLE_WORDS, showOverview } from '../../lib/titleDashRules';
import { colors, fonts, inkTint } from '../../lib/theme';
import { Tiles } from '../dashboard/DashSections';
import { ss } from './ShowBits';
import { Bars, CardState, MoneyCard, WorkPill, w } from '../work/WorkBits';
import { dataOf, useRouteBoxes } from '../work/useRouteBoxes';

// A show's Overview in the app (2026-11-15; the canvas
// https://claude.ai/artifact/6LuuNpyuaKTS5PkCij8Nfc, board "Dashboard · a
// series", and mockups/work-revamp-contract.md "Builder C"): the show
// page's first tab (?tab=overview; Episodes is the room as it was). In the
// phone's order: four numbers two across, the last 30 days as ten bars of
// three days, Episode by episode (each opens its editor), Needs you,
// Waiting on us, Who's on it, and what the show has earned this year.
//
// Every number and sentence is lib/titleDashRules.js showOverview, the
// file the website reads, from the show page's own read (`view`, GET
// /api/show/<id>, which the screen already has) and two routes read here:
// GET /api/creator/analytics?days=30&compare=1 and /api/creator/money?
// period=<this year>. A route that refuses leaves its part out; one that
// fails says so in its part with Try again.

// Which route each of the four numbers comes from.
const TILE_BOX = { views: 'numbers', watched: 'numbers', kept: 'numbers', earned: 'money' };

export default function ShowOverview({ view, getToken, onOpen }) {
  const year = String(new Date().getUTCFullYear());
  const paths = useMemo(() => ({
    numbers: '/api/creator/analytics?days=30&compare=1',
    money: `/api/creator/money?period=${year}`
  }), [year]);
  const { boxes, read, readAll } = useRouteBoxes(paths, { getToken, enabled: true });
  useFocusEffect(useCallback(() => { readAll(); }, [readAll]));

  const o = useMemo(() => showOverview({ show: view, numbers: dataOf(boxes.numbers), money: dataOf(boxes.money) }), [view, boxes.numbers, boxes.money]);
  if (!o) return null;

  const tiles = o.tiles
    .filter((t) => boxes[TILE_BOX[t.key]].state !== 'refused')
    .map((t) => ({ ...t, value: boxes[TILE_BOX[t.key]].state === 'loading' ? null : t.value, sub: t.note }));

  return (
    <View style={ov.body}>
      <Tiles tiles={tiles} />
      {o.trackingOff ? <Text style={w.fine}>{TITLE_WORDS.noTracking}</Text> : null}

      {boxes.numbers.state !== 'refused' ? (
        <View style={w.card}>
          <Text style={w.k} accessibilityRole="header">{o.chart.title}</Text>
          {!o.chart.available ? <CardState state={boxes.numbers.state} onRetry={() => read('numbers')} />
            : o.chart.empty ? <Text style={w.empty}>{TITLE_WORDS.chartEmpty}</Text>
              : <Bars chart={o.chart} />}
        </View>
      ) : null}

      {o.episodes.length ? (
        <View style={w.card}>
          <Text style={w.k} accessibilityRole="header">{TITLE_WORDS.episodes}</Text>
          <Text style={w.fine}>{TITLE_WORDS.episodesNote}</Text>
          {o.episodes.map((e, i) => (
            <Pressable
              key={e.id}
              style={({ pressed }) => [ov.episode, i > 0 && ov.lineTop, pressed && ss.pressed]}
              onPress={() => onOpen(e.href)}
              accessibilityRole="link"
              accessibilityLabel={[e.code, e.title, e.pill ? e.pill.label : `${TITLE_WORDS.views} ${e.views}, ${TITLE_WORDS.avgWatch} ${e.avg}${e.pct != null ? `, ${TITLE_WORDS.watched} ${e.pct}%` : ''}`].filter(Boolean).join(', ')}
            >
              <Text style={ov.epTitle} numberOfLines={2}>
                <Text style={ov.code}>{`${e.code}  `}</Text>
                {e.title}
              </Text>
              {e.pill ? <WorkPill pill={e.pill} /> : (
                <>
                  <View style={ov.nums}>
                    <Text style={ov.num}><Text style={ov.numK}>{`${TITLE_WORDS.views} `}</Text>{e.views}</Text>
                    <Text style={ov.num}><Text style={ov.numK}>{`${TITLE_WORDS.avgWatch} `}</Text>{e.avg}</Text>
                  </View>
                  {e.pct != null ? (
                    <View style={ov.barRow}>
                      <View style={ov.barTrack}><View style={[ov.barFill, { width: `${Math.max(0, Math.min(100, e.pct))}%` }]} /></View>
                      <Text style={ov.pct}>{`${e.pct}%`}</Text>
                    </View>
                  ) : null}
                </>
              )}
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={[w.card, o.needs.length ? w.cardNeed : null]}>
        <Text style={[w.k, o.needs.length ? { color: colors.brass } : null]} accessibilityRole="header">{TITLE_WORDS.needs}</Text>
        {o.needs.length ? o.needs.map((x) => <Text key={x.key} style={[ov.item, { color: colors.brass }]}>{x.text}</Text>) : <Text style={w.empty}>{TITLE_WORDS.needsNone}</Text>}
      </View>

      <View style={w.card}>
        <Text style={w.k} accessibilityRole="header">{TITLE_WORDS.waiting}</Text>
        {o.waiting.length ? o.waiting.map((x) => <Text key={x.key} style={[ov.item, { color: colors.olive }]}>{x.text}</Text>) : <Text style={w.empty}>{TITLE_WORDS.waitingNone}</Text>}
      </View>

      {o.people.length ? (
        <View style={w.card}>
          <Text style={w.k} accessibilityRole="header">{TITLE_WORDS.people}</Text>
          {o.people.map((p, i) => (
            <View key={p.key} style={[ov.person, i > 0 && ov.lineTop]}>
              <Text style={ov.personLabel}>{p.label}</Text>
              <Text style={ov.personValue}>{p.value}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {boxes.money.state !== 'refused' ? (
        <MoneyCard card={o.money} heading={TITLE_WORDS.moneyShow} state={boxes.money.state} onRetry={() => read('money')} onOpenMoney={() => onOpen('/creator/money')} />
      ) : null}
    </View>
  );
}

const ov = StyleSheet.create({
  body: { gap: 16 },
  lineTop: { borderTopWidth: 1, borderTopColor: inkTint(0.08) },
  episode: { minHeight: 44, gap: 6, paddingVertical: 10 },
  epTitle: { fontFamily: fonts.displaySemi, fontSize: 15, lineHeight: 19, color: colors.ink },
  code: { fontFamily: fonts.mono, fontSize: 12, color: colors.olive },
  nums: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 2 },
  num: { fontFamily: fonts.mono, fontSize: 12.5, color: colors.ink, fontVariant: ['tabular-nums'] },
  numK: { color: colors.inkFaint },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: inkTint(0.12), overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: colors.olive },
  pct: { width: 40, textAlign: 'right', fontFamily: fonts.mono, fontSize: 12, color: colors.inkDim },
  item: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
  person: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, paddingVertical: 8 },
  personLabel: { flex: 1, minWidth: 0, fontFamily: fonts.body, fontSize: 14, color: colors.inkDim },
  personValue: { fontFamily: fonts.displaySemi, fontSize: 14.5, color: colors.ink, flexShrink: 1, textAlign: 'right' }
});
