import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';
import { count } from '../../lib/creatorDashboardRules';
import { TITLE_WORDS } from '../../lib/titleDashRules';
import { brassTint, colors, fonts, inkTint, oliveTint } from '../../lib/theme';
import SmartImage from '../SmartImage';
import { ChevronIcon, KebabIcon, Pill, ss } from '../show/ShowBits';
import { ClockIcon, ExternalLinkIcon, WarningIcon } from '../WorkIcons';
import { ON_WEBSITE, isWebsiteAction } from './WorkActions';

// The pieces Your work, a title's dashboard and a show's Overview share in
// the app (2026-11-15, mockups/work-revamp-contract.md "Builder C"; the
// phone board of the canvas https://claude.ai/artifact/6LuuNpyuaKTS5PkCij8Nfc).
// Every word and number they draw comes from lib/workListRules.js or
// lib/titleDashRules.js; these only place it, in the theme's tokens.

// The rules' pill tones (live | review | declined | quiet, and a show's
// ready) on ShowBits' Pill tones.
const PILL_TONE = { live: 'ok', review: 'review', ready: 'review', declined: 'danger', quiet: 'neutral' };
export function WorkPill({ pill, style }) {
  if (!pill || !pill.label) return null;
  return <Pill label={pill.label} tone={PILL_TONE[pill.tone] || 'neutral'} dot={pill.tone === 'live'} style={style} />;
}

// --- a row of tabs ----------------------------------------------------------

// A title's tabs (Overview · Details · …) and a show's (Overview ·
// Episodes): a sideways row, 44pt tall, the current one underlined in the
// accent. `onPick(key)`.
export function TabRow({ tabs, current, onPick, label, style }) {
  return (
    <View style={[w.tabsWrap, style]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={w.tabs} accessibilityRole="tablist" accessibilityLabel={label}>
        {tabs.map((t) => {
          const on = t.key === current;
          return (
            <Pressable
              key={t.key}
              style={({ pressed }) => [w.tab, on && w.tabOn, pressed && !on && ss.pressed]}
              onPress={() => onPick(t.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
            >
              <Text style={[w.tabText, on && w.tabTextOn]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// --- lines under a title ----------------------------------------------------------

// What needs the creator (the accent, a warning sign) and what waits for
// the team (gold, a clock).
export function NeedLine({ text, style }) {
  if (!text) return null;
  return (
    <View style={[w.line, style]}>
      <View style={w.lineIcon}><WarningIcon size={14} color={colors.brass} /></View>
      <Text style={[w.lineText, { color: colors.brass }]}>{text}</Text>
    </View>
  );
}
export function WaitLine({ text, style }) {
  if (!text) return null;
  return (
    <View style={[w.line, style]}>
      <View style={w.lineIcon}><ClockIcon size={14} color={colors.olive} /></View>
      <Text style={[w.lineText, { color: colors.olive }]}>{text}</Text>
    </View>
  );
}

// The one next step (outlined gold, 44pt): "Add artwork", "Replace the
// file", "Cancel the request", "Fix it". One the app hands to the website
// says so.
export function NextButton({ step, onPress, busy = false, web = false, style }) {
  if (!step) return null;
  return (
    <Pressable
      style={({ pressed }) => [w.next, pressed && ss.pressed, busy && ss.disabled, style]}
      disabled={busy}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={web ? `${step.label}, ${ON_WEBSITE}` : step.label}
    >
      {busy ? <ActivityIndicator size="small" color={colors.olive} /> : null}
      <Text style={w.nextText}>{step.label}</Text>
      {web ? <ExternalLinkIcon size={13} color={colors.olive} /> : null}
    </Pressable>
  );
}

// A plain outlined button for a card's action (Edit, Sell it, Who gets
// paid, Ask to remove it…), gold when `gold`, red when `danger`.
export function ActButton({ label, onPress, busy = false, disabled = false, gold = false, danger = false, web = false, style }) {
  return (
    <Pressable
      style={({ pressed }) => [w.act, gold && w.actGold, danger && w.actDanger, pressed && ss.pressed, (busy || disabled) && ss.disabled, style]}
      disabled={busy || disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={web ? `${label}, ${ON_WEBSITE}` : label}
      accessibilityState={{ disabled: Boolean(busy || disabled) }}
    >
      {busy ? <ActivityIndicator size="small" color={gold ? colors.oliveShadow : colors.ink} /> : null}
      <Text style={[w.actText, gold && w.actTextGold, danger && { color: colors.danger }]}>{label}</Text>
      {web ? <ExternalLinkIcon size={13} color={gold ? colors.oliveShadow : colors.ink} /> : null}
    </Pressable>
  );
}

// --- one title, the same design everywhere -------------------------------------------

// A row of buildWorkList: the 16:9 picture, the code and title (the whole
// left part opens it), the pill and the meta line; ⋯ on the right; then
// what needs the creator, what waits, the row's own error or done line,
// and the one next step. `actions` is useWorkActions' answer.
export function TitleRow({ row, actions, onOpen, first = false, indent = false }) {
  const err = actions.errors[row.id];
  const notice = actions.notices[row.id];
  const extracting = actions.extract && actions.extract.id === row.id ? actions.extract : null;
  const running = actions.busy[row.id];
  const nextWeb = Boolean(row.next) && row.kind === 'title' && isWebsiteAction(row.next.key);
  return (
    <View style={[w.row, !first && w.rowLine, indent && w.rowIndent]} nativeID={`row-${row.id}`}>
      <View style={w.rowTop}>
        <Pressable
          style={({ pressed }) => [w.rowLink, pressed && ss.pressed]}
          onPress={() => onOpen(row)}
          accessibilityRole="link"
          accessibilityLabel={[row.code, row.title, row.pill ? row.pill.label : '', row.meta].filter(Boolean).join(', ')}
        >
          {row.thumb ? <SmartImage uri={row.thumb} style={w.thumb} /> : <View style={[w.thumb, w.thumbEmpty]} />}
          <View style={w.rowText}>
            <Text style={w.rowTitle} numberOfLines={2}>
              {row.code ? <Text style={w.code}>{`${row.code}  `}</Text> : null}
              {row.title}
            </Text>
            {row.showName ? <Text style={w.rowShow} numberOfLines={1}>{row.showName}</Text> : null}
            {row.meta ? <Text style={w.rowMeta}>{row.meta}</Text> : null}
            <WorkPill pill={row.pill} style={w.rowPill} />
          </View>
        </Pressable>
        <Pressable
          style={({ pressed }) => [w.more, pressed && w.morePressed]}
          onPress={() => actions.openMenu(row)}
          accessibilityRole="button"
          accessibilityLabel={`More for ${row.title}`}
        >
          <KebabIcon size={18} color={colors.ink} />
        </Pressable>
      </View>
      <NeedLine text={row.need} style={w.rowLineGap} />
      <WaitLine text={row.waiting} style={w.rowLineGap} />
      {extracting ? <Text style={[w.lineText, w.rowLineGap, { color: colors.inkDim }]} accessibilityLiveRegion="polite">{`Extracting the audio…${extracting.percent != null ? ` ${Math.round(Number(extracting.percent))}%` : ''}`}</Text> : null}
      {notice ? <Text style={[w.lineText, w.rowLineGap, { color: colors.ok }]} accessibilityLiveRegion="polite">{notice}</Text> : null}
      {err ? <Text style={[w.lineText, w.rowLineGap, { color: colors.danger }]} accessibilityRole="alert">{err}</Text> : null}
      <NextButton step={row.next} web={nextWeb} busy={Boolean(row.next && running === row.next.key)} onPress={() => actions.run(row.next.key, row)} style={w.rowNext} />
    </View>
  );
}

// A section's heading: a button that folds it (the chevron, the label, the
// count) and a hairline to the right.
export function SectionHead({ label, count: n, open, onToggle }) {
  return (
    <View style={w.sectionHead}>
      <Pressable
        style={({ pressed }) => [w.sectionBtn, pressed && ss.pressed]}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${label}, ${n}`}
      >
        <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}><ChevronIcon size={14} color={colors.inkDim} /></View>
        <Text style={w.sectionLabel}>{label}</Text>
        <Text style={w.sectionCount}>{n}</Text>
      </Pressable>
      <View style={w.sectionRule} />
    </View>
  );
}

// --- the bars ------------------------------------------------------------------------

// A round number at or above `max` for the top grid line.
function niceTop(max) {
  if (!(max > 0)) return 10;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * pow >= max) return step * pow;
  return 10 * pow;
}
const BARS_H = 150;
const BARS_TOP = 14;
const BARS_BASE = 124;
const TICK = 10.5;
const textWidth = (words, size) => String(words || '').length * size * 0.6;

// A chart of titleDashboard's / showOverview's `chart`: one bar a day (or
// a bucket of days), from one baseline, the best one at full strength and
// the rest lighter; the top grid line's number on the left, the first and
// last day under it. Views are the theme's sky (the Dashboard's colour for
// views), watch time its gold.
export function Bars({ chart }) {
  const [width, setWidth] = useState(0);
  const list = Array.isArray(chart.list) ? chart.list : [];
  const top = niceTop(chart.max);
  const left = Math.max(26, Math.ceil(textWidth(count(top), TICK)) + 8);
  const n = list.length;
  const gap = n > 20 ? 2 : 6;
  const barW = n ? Math.max(1, (width - left - gap * (n - 1)) / n) : 0;
  const peak = list.reduce((best, b, i) => (b.value > (best >= 0 ? list[best].value : -1) ? i : best), -1);
  const fill = chart.mode === 'watch' ? colors.olive : colors.sky;
  const tick = { fontFamily: fonts.mono, fontSize: TICK, fill: colors.inkFaint };
  const label = `${chart.title}${chart.from ? `, ${chart.from} to ${chart.to}` : ''}. Most in one bar: ${count(chart.max)} ${chart.unit}.`;
  return (
    <View style={{ height: BARS_H }} onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))} accessible accessibilityRole="image" accessibilityLabel={label}>
      {width > 0 ? (
        <Svg width={width} height={BARS_H}>
          <Line x1={left} y1={BARS_TOP} x2={width} y2={BARS_TOP} stroke={inkTint(0.08)} strokeWidth={1} />
          <Line x1={left} y1={BARS_BASE} x2={width} y2={BARS_BASE} stroke={inkTint(0.22)} strokeWidth={1} />
          <SvgText {...tick} x={left - 6} y={BARS_TOP + 4} textAnchor="end">{count(top)}</SvgText>
          <SvgText {...tick} x={left - 6} y={BARS_BASE + 4} textAnchor="end">0</SvgText>
          {list.map((b, i) => {
            const h = b.value > 0 ? Math.max(2, (b.value / top) * (BARS_BASE - BARS_TOP)) : 0;
            return <Rect key={`${b.date}-${i}`} x={left + i * (barW + gap)} y={BARS_BASE - h} width={barW} height={h} rx={Math.min(3, barW / 2)} fill={fill} fillOpacity={i === peak ? 1 : 0.5} />;
          })}
          {chart.from ? <SvgText {...tick} x={left} y={BARS_H - 4} textAnchor="start">{chart.from}</SvgText> : null}
          {chart.to ? <SvgText {...tick} x={width} y={BARS_H - 4} textAnchor="end">{chart.to}</SvgText> : null}
        </Svg>
      ) : null}
    </View>
  );
}

// --- the money card -------------------------------------------------------------------

// titleDashboard's / showOverview's `money` card: its rows, the total, the
// month's part, the note and the link to the Money screen. `state` is the
// money route's: 'loading' | 'ok' | 'failed' (a refused route draws no
// card at all: the caller leaves it out).
export function MoneyCard({ card, heading, state, onOpenMoney, onRetry }) {
  return (
    <View style={w.card}>
      <View style={w.cardHead}>
        <Text style={w.k} accessibilityRole="header">{heading}{card && card.available && card.yearLabel ? ` · ${card.yearLabel}` : ''}</Text>
        {card && card.available ? <Text style={w.total}>{card.total}</Text> : null}
      </View>
      {!card || !card.available ? (
        <View style={{ gap: 6 }}>
          <Text style={w.empty}>{state === 'loading' ? TITLE_WORDS.loading : TITLE_WORDS.failed}</Text>
          {state === 'failed' && onRetry ? <ActButton label="Try again" onPress={onRetry} /> : null}
        </View>
      ) : (
        <>
          {card.rows.map((r) => (
            <View key={r.key} style={w.moneyRow} accessible accessibilityLabel={`${r.label}, ${r.detail}: ${r.amount}`}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={w.moneyLabel}>{r.label}</Text>
                <Text style={w.moneyDetail}>{r.detail}</Text>
              </View>
              <Text style={w.moneyAmount}>{r.amount}</Text>
            </View>
          ))}
          <Text style={w.small}>{card.month}</Text>
          <Text style={w.fine}>{TITLE_WORDS.moneyNote} {card.note}</Text>
        </>
      )}
      <Pressable style={({ pressed }) => [w.cardLink, pressed && ss.pressed]} onPress={onOpenMoney} accessibilityRole="link">
        <Text style={w.linkText}>{TITLE_WORDS.openMoney}</Text>
        <ChevronIcon size={13} color={colors.olive} />
      </Pressable>
    </View>
  );
}

// A card's loading / couldn't-load words with Try again.
export function CardState({ state, onRetry }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={w.empty}>{state === 'loading' ? TITLE_WORDS.loading : TITLE_WORDS.failed}</Text>
      {state === 'failed' && onRetry ? <ActButton label="Try again" onPress={onRetry} /> : null}
    </View>
  );
}

export const w = StyleSheet.create({
  // tabs
  tabsWrap: { borderBottomWidth: 1, borderBottomColor: inkTint(0.14) },
  tabs: { gap: 20, paddingRight: 12 },
  tab: { minHeight: 44, minWidth: 44, justifyContent: 'center', borderBottomWidth: 3, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: colors.brass },
  tabText: { fontFamily: fonts.displaySemi, fontSize: 14.5, color: colors.inkDim },
  tabTextOn: { color: colors.ink },

  // lines
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  lineIcon: { paddingTop: 2 },
  lineText: { flex: 1, fontFamily: fonts.body, fontSize: 14, lineHeight: 19 },

  // buttons
  next: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.olive, paddingHorizontal: 16 },
  nextText: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.olive },
  act: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 999, borderWidth: 1, borderColor: inkTint(0.22), paddingHorizontal: 16, alignSelf: 'flex-start' },
  actGold: { backgroundColor: colors.olive, borderColor: colors.olive },
  actDanger: { borderColor: colors.danger },
  actText: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.ink },
  actTextGold: { color: colors.oliveShadow },

  // a row
  row: { paddingTop: 14, paddingBottom: 14, paddingLeft: 16, paddingRight: 8 },
  rowLine: { borderTopWidth: 1, borderTopColor: inkTint(0.06) },
  rowIndent: { paddingLeft: 12 },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  rowLink: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'flex-start', gap: 12, minHeight: 44 },
  thumb: { width: 80, height: 45, borderRadius: 6, backgroundColor: colors.surface1 },
  thumbEmpty: { borderWidth: 1, borderColor: oliveTint(0.55) },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: fonts.displaySemi, fontSize: 16, lineHeight: 20, color: colors.ink },
  code: { fontFamily: fonts.mono, fontSize: 12, color: colors.olive },
  rowShow: { fontFamily: fonts.mono, fontSize: 11.5, color: colors.inkFaint, marginTop: 2 },
  rowMeta: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.inkDim, marginTop: 4 },
  rowPill: { marginTop: 6 },
  more: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  morePressed: { backgroundColor: inkTint(0.12) },
  rowLineGap: { marginTop: 10, marginRight: 8 },
  rowNext: { marginTop: 10, marginRight: 8 },

  // a section's heading
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionBtn: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 12 },
  sectionLabel: { fontFamily: fonts.monoMedium, fontSize: 12, letterSpacing: 1.7, textTransform: 'uppercase', color: colors.inkDim },
  sectionCount: { fontFamily: fonts.mono, fontSize: 12, color: colors.inkFaint },
  sectionRule: { flex: 1, height: 1, backgroundColor: inkTint(0.1) },

  // cards
  card: { borderRadius: 14, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.oceanInk, padding: 16, gap: 10 },
  cardNeed: { borderColor: brassTint(0.55), backgroundColor: brassTint(0.06) },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  k: { fontFamily: fonts.monoMedium, fontSize: 10.5, letterSpacing: 1.7, textTransform: 'uppercase', color: colors.inkDim, flexShrink: 1 },
  total: { fontFamily: fonts.displayBold, fontSize: 20, color: colors.ink, fontVariant: ['tabular-nums'] },
  empty: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.inkDim },
  small: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.inkDim },
  fine: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: colors.inkFaint },
  cardLink: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  linkText: { fontFamily: fonts.displaySemi, fontSize: 13.5, color: colors.olive },
  moneyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 4 },
  moneyLabel: { fontFamily: fonts.displaySemi, fontSize: 14.5, color: colors.ink },
  moneyDetail: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.inkDim },
  moneyAmount: { fontFamily: fonts.mono, fontSize: 14, color: colors.ink, fontVariant: ['tabular-nums'] }
});
