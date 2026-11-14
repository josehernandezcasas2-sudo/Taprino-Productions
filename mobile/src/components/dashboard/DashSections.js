import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import SmartImage from '../SmartImage';
import { ChevronIcon } from '../show/ShowBits';
import { API_BASE_URL } from '../../lib/api';
import { DASH_WORDS, TITLE_FILTERS, TITLES_LIMIT, count, dollars, filterTitles } from '../../lib/creatorDashboardRules';
import { brassTint, colors, dangerTint, fonts, inkTint, okTint, oliveTint } from '../../lib/theme';
import { Spark, ViewsChart } from './DashCharts';

// The Dashboard's sections in the app (2026-11-14; the website's
// components/creator/dashboard/DashSections.js, laid out like the signed-off
// phone board). Each takes what lib/creatorDashboardRules.js built and
// draws it: no number or sentence about a title or about money is worked
// out here. The few lines for "still loading" and "couldn't load" are the
// website's own.
//
// `onOpen(href)` takes a website path (every href the rules hand out is
// one) and opens the app's screen for it; `onPublish(action)` is Make it
// public; `busy` is the show id being made public.

const PAPER = colors.oliveShadow;

// "Couldn't load" with a way to ask again.
function Retry({ onPress }) {
  if (!onPress) return null;
  return (
    <Pressable style={({ pressed }) => [d.retry, pressed && d.pressed]} onPress={onPress} accessibilityRole="button">
      <Text style={d.linkText}>Retry</Text>
    </Pressable>
  );
}

// --- the four numbers ------------------------------------------------------------

// Two across. A tile whose value is null is still loading.
export function Tiles({ tiles }) {
  const pairs = [];
  for (let i = 0; i < tiles.length; i += 2) pairs.push(tiles.slice(i, i + 2));
  return (
    <View style={d.tiles}>
      {pairs.map((pair) => (
        <View key={pair[0].key} style={d.tileRow}>
          {pair.map((tile) => {
            const accent = tile.tone === 'accent';
            return (
              <View
                key={tile.key}
                style={[d.tile, accent && d.tileAccent]}
                accessible
                accessibilityLabel={`${tile.label}: ${tile.value == null ? 'loading' : tile.value}${tile.sub ? `. ${tile.sub}` : ''}`}
              >
                <Text style={[d.tileK, accent && d.tileKAccent]}>{tile.label}</Text>
                {tile.value == null
                  ? <View style={d.skel} />
                  : <Text style={d.tileV} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{tile.value}</Text>}
                {tile.sub ? <Text style={d.tileSub}>{tile.sub}</Text> : null}
              </View>
            );
          })}
          {pair.length === 1 ? <View style={d.tileGhost} /> : null}
        </View>
      ))}
    </View>
  );
}

// --- needs you -------------------------------------------------------------------

export function Needs({ needs, loading, busy, onOpen, onPublish }) {
  return (
    <View style={[d.card, d.cardNeeds]}>
      <Text style={[d.k, d.kAccent]} accessibilityRole="header">{DASH_WORDS.needs}{needs.total > 0 ? ` · ${needs.total}` : ''}</Text>
      {needs.rows.length === 0 ? (
        <Text style={[d.empty, d.emptyInCard]}>{loading ? 'Loading…' : DASH_WORDS.needsNone}</Text>
      ) : needs.rows.map((row, i) => {
        const action = row.action;
        const publishing = Boolean(action && action.kind === 'publish' && busy === action.showId);
        return (
          <View key={row.key} style={[d.need, i > 0 && d.lineTop]}>
            <View style={d.needText}>
              <Text style={d.needTitle}>{row.title}</Text>
              {row.sub ? <Text style={d.needSub}>{row.sub}</Text> : null}
            </View>
            {action ? (
              <Pressable
                style={({ pressed }) => [d.needAct, pressed && d.pressed, publishing && d.disabled]}
                disabled={Boolean(busy)}
                onPress={() => (action.kind === 'publish' ? onPublish(action) : onOpen(action.href))}
                accessibilityRole={action.kind === 'publish' ? 'button' : 'link'}
                accessibilityLabel={`${action.label}: ${row.title}`}
                hitSlop={6}
              >
                <Text style={d.linkText}>{publishing ? 'Making it public…' : action.label}</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
      {needs.more > 0 ? (
        <Pressable style={({ pressed }) => [d.cardLink, d.lineTop, pressed && d.pressed]} onPress={() => onOpen('/creator/my-work?attention=1')} accessibilityRole="link">
          <Text style={d.linkText}>{needs.more} more in Your work</Text>
          <ChevronIcon size={13} color={colors.olive} />
        </Pressable>
      ) : null}
    </View>
  );
}

// --- your titles -----------------------------------------------------------------

// Where a row stands, as the small pill beside its meta line.
const CHIP = {
  live: { fg: colors.ok, bg: okTint(0.16), dot: true },
  review: { fg: colors.olive, bg: oliveTint(0.16) },
  ready: { fg: colors.ok, bg: okTint(0.12) },
  private: { fg: colors.inkDim, bg: inkTint(0.08) },
  draft: { fg: colors.inkFaint, bg: inkTint(0.06) },
  declined: { fg: colors.brass, bg: brassTint(0.16) },
  pulled: { fg: colors.danger, bg: dangerTint(0.14) },
  removal: { fg: colors.inkDim, bg: inkTint(0.08) }
};

function StateChip({ state, label }) {
  const c = CHIP[state] || CHIP.private;
  return (
    <View style={[d.chip, { backgroundColor: c.bg }]}>
      {c.dot ? <View style={[d.chipDot, { backgroundColor: c.fg }]} /> : null}
      <Text style={[d.chipText, { color: c.fg }]}>{label}</Text>
    </View>
  );
}

function Thumb({ row }) {
  if (row.poster) return <SmartImage uri={row.poster} style={d.thumb} resizeMode="cover" />;
  return <View style={[d.thumb, row.state === 'draft' ? d.thumbDraft : d.thumbEmpty]} />;
}

function viewsWords(views) {
  return `${count(views)} ${views === 1 ? 'view' : 'views'}`;
}

// `stack`: on a narrow phone a row's button goes under its words instead of
// beside them, so "Ready to go public" and the show's name keep their line.
function TitleRow({ row, busy, stack, onOpen, onPublish }) {
  const live = row.state === 'live';
  const action = row.action;
  const publish = Boolean(action && action.kind === 'publish');
  const publishing = publish && busy === action.showId;
  const heard = [
    row.title,
    row.stateLabel,
    row.meta,
    live && row.views != null ? viewsWords(row.views) : null,
    live && row.watchedPct != null ? `${row.watchedPct}% watched` : null,
    live && row.earnedCents != null ? `earned ${dollars(row.earnedCents)}` : null,
    live && row.earnedDetail ? row.earnedDetail : null,
    row.needsWhy,
    !live ? row.note : null
  ].filter(Boolean).join(', ');
  const under = Boolean(stack && !live && action);
  return (
    <View style={[d.row, under && d.rowStack, d.lineTop]}>
      <Pressable style={({ pressed }) => [d.rowMain, !under && d.rowMainBeside, pressed && d.pressed]} onPress={() => onOpen(row.href)} accessibilityRole="link" accessibilityLabel={heard}>
        <Thumb row={row} />
        <View style={d.rowText}>
          <Text style={d.rowTitle} numberOfLines={2}>{row.title}</Text>
          <View style={d.rowMeta}>
            <StateChip state={row.state} label={row.stateLabel} />
            {row.meta ? <Text style={d.rowMetaText}>{row.meta}</Text> : null}
          </View>
          {live && row.watchedPct != null ? <Text style={d.rowMetaText}>{row.watchedPct}% watched</Text> : null}
          {row.needsWhy ? <Text style={d.rowWhy}>{row.needsWhy}</Text> : null}
          {!live && row.note ? <Text style={d.rowNote}>{row.note}</Text> : null}
        </View>
        {live ? (
          <View style={d.rowNums}>
            <Text style={d.rowEarned}>{row.earnedCents == null ? '—' : dollars(row.earnedCents)}</Text>
            <Text style={d.rowMetaText}>{row.views == null ? '—' : viewsWords(row.views)}</Text>
            <Spark values={row.spark} label={`Views over the last 30 days: ${row.views == null ? 'not known' : count(row.views)}`} />
          </View>
        ) : null}
      </Pressable>
      {!live && action ? (
        <Pressable
          style={({ pressed }) => [d.rowBtn, publish && d.rowBtnGold, under && d.rowBtnUnder, pressed && d.pressed, publishing && d.disabled]}
          disabled={Boolean(busy)}
          onPress={() => (publish ? onPublish(action) : onOpen(action.href))}
          accessibilityRole={publish ? 'button' : 'link'}
          accessibilityLabel={`${action.label}: ${row.title}`}
        >
          <Text style={[d.rowBtnText, publish && d.rowBtnTextGold]}>{publishing ? 'Making it public…' : action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// Under this width a row's button no longer fits beside its words.
const STACK_UNDER = 380;

export function Titles({ titles, loading, failed, busy, onOpen, onPublish, onRetry }) {
  const { width } = useWindowDimensions();
  const [filter, setFilter] = useState('all');
  const [all, setAll] = useState(false);
  const rows = filterTitles(titles.rows, filter);
  const shown = all ? rows : rows.slice(0, TITLES_LIMIT);
  // Until the titles have answered the filters carry no counts (a row of
  // zeros would read as "you have nothing").
  const counted = !(loading && titles.counts.all === 0);
  return (
    <View style={[d.card, d.cardFlush]}>
      <View style={d.titlesHead}>
        <Text style={d.h2} accessibilityRole="header">{DASH_WORDS.titles}</Text>
        <Pressable style={({ pressed }) => [d.headLink, pressed && d.pressed]} onPress={() => onOpen('/creator/my-work')} accessibilityRole="link">
          <Text style={d.linkText}>{DASH_WORDS.seeAll}</Text>
          <ChevronIcon size={13} color={colors.olive} />
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={d.filters}>
        {TITLE_FILTERS.map((f) => {
          const on = filter === f.key;
          return (
            <Pressable
              key={f.key}
              style={[d.filter, on && d.filterOn]}
              onPress={() => { setFilter(f.key); setAll(false); }}
              hitSlop={{ top: 4, bottom: 4 }}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={counted ? `${f.label}, ${titles.counts[f.key]}` : f.label}
            >
              <Text style={[d.filterText, on && d.filterTextOn]}>{f.label}{counted ? <Text style={d.filterCount}>{` ${titles.counts[f.key]}`}</Text> : null}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {shown.length === 0 ? (
        <View style={[d.titlesEmpty, d.lineTop]}>
          <Text style={d.empty}>{loading ? 'Loading your titles…' : failed ? 'Your titles couldn’t be loaded.' : filter === 'all' ? DASH_WORDS.noTitles : 'Nothing in this group.'}</Text>
          {!loading && failed ? <Retry onPress={onRetry} /> : null}
        </View>
      ) : shown.map((row) => <TitleRow key={row.key} row={row} busy={busy} stack={width < STACK_UNDER} onOpen={onOpen} onPublish={onPublish} />)}
      {rows.length > TITLES_LIMIT ? (
        <Pressable style={({ pressed }) => [d.showAll, d.lineTop, pressed && d.pressed]} onPress={() => setAll((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: all }}>
          <Text style={d.linkText}>{all ? 'Show fewer' : `Show all ${rows.length}`}</Text>
        </Pressable>
      ) : null}
      <Text style={d.foot}>{DASH_WORDS.earnedNote}</Text>
    </View>
  );
}

// --- money this month ------------------------------------------------------------

// IBM Plex Mono at 12.5pt: a glyph is 7.5pt wide. The amounts share one
// column as wide as the longest of them, so every bar starts and stops on
// the same lines.
const amountWidth = (lanes) => Math.max(58, Math.ceil(Math.max(0, ...lanes.map((l) => dollars(l.cents).length)) * 7.5) + 2);

export function Money({ card, loading, failed, onOpen, onRetry }) {
  return (
    <View style={[d.card, d.cardMoney]}>
      <View style={d.cardHead}>
        <Text style={d.k} accessibilityRole="header">{card ? card.label : DASH_WORDS.money}</Text>
        {card ? <Text style={d.total}>{card.total}</Text> : null}
      </View>
      {!card ? (
        <View>
          <Text style={d.empty}>{loading ? 'Adding it up…' : 'The money couldn’t be loaded just now.'}</Text>
          {!loading && failed ? <Retry onPress={onRetry} /> : null}
        </View>
      ) : (
        <>
          <View style={d.lanes}>
            {card.lanes.map((lane) => (
              <View key={lane.key} style={d.lane} accessible accessibilityLabel={`${lane.label}: ${dollars(lane.cents)}`}>
                <Text style={d.laneName} numberOfLines={1}>{lane.label}</Text>
                <View style={d.laneTrack}><View style={[d.laneBar, { width: `${Math.round(lane.share * 100)}%` }]} /></View>
                <Text style={[d.laneValue, { width: amountWidth(card.lanes) }]}>{dollars(lane.cents)}</Text>
              </View>
            ))}
          </View>
          <Text style={d.fine}>{card.adShareNote}</Text>
          <View style={d.moves}>
            {[card.onFirst, card.stripe].filter(Boolean).map((move) => (
              <View key={move.title} style={d.move}>
                <View style={d.moveText}>
                  <Text style={d.moveTitle}>{move.title}</Text>
                  <Text style={d.moveSub}>{move.sub}</Text>
                </View>
                <Text style={d.moveValue}>{move.value}</Text>
              </View>
            ))}
            {card.stripeError ? <Text style={d.fine}>{card.stripeError}</Text> : null}
          </View>
        </>
      )}
      <Pressable style={({ pressed }) => [d.cardLink, pressed && d.pressed]} onPress={() => onOpen('/creator/money')} accessibilityRole="link">
        {/* The app's Money screen has every line and Stripe; the CSV the
            website's words promise is on the website only. */}
        <Text style={d.linkText}>{DASH_WORDS.openMoney.split(':')[0]}</Text>
        <ChevronIcon size={13} color={colors.olive} />
      </Pressable>
    </View>
  );
}

// --- views a day -----------------------------------------------------------------

export function Views({ views, loading, onOpen, onRetry }) {
  return (
    <View style={[d.card, d.cardViews]}>
      <View style={d.cardHead}>
        <Text style={[d.k, d.kShrink]} accessibilityRole="header">{DASH_WORDS.views}</Text>
        <Pressable style={({ pressed }) => [d.headLink, pressed && d.pressed]} onPress={() => onOpen('/creator/analytics')} accessibilityRole="link">
          <Text style={d.linkText}>{DASH_WORDS.openNumbers}</Text>
          <ChevronIcon size={13} color={colors.olive} />
        </Pressable>
      </View>
      {!views ? (
        <View>
          <Text style={d.empty}>{loading ? 'Counting…' : 'The views couldn’t be loaded just now.'}</Text>
          {!loading ? <Retry onPress={onRetry} /> : null}
        </View>
      ) : !views.tracking ? (
        <Text style={d.empty}>{DASH_WORDS.noTracking}</Text>
      ) : views.empty ? (
        <Text style={d.empty}>No views in the last 30 days yet.</Text>
      ) : (
        <ViewsChart views={views} />
      )}
    </View>
  );
}

// --- latest ----------------------------------------------------------------------

export function Latest({ rows, loading, onOpen }) {
  return (
    <View style={[d.card, d.cardLatest]}>
      <Text style={d.k} accessibilityRole="header">{DASH_WORDS.latest}</Text>
      {rows.length === 0 ? (
        <Text style={[d.empty, d.emptyInCard]}>{loading ? 'Loading…' : DASH_WORDS.latestNone}</Text>
      ) : rows.map((row, i) => (
        <Pressable key={row.key} style={({ pressed }) => [d.latestRow, i > 0 && d.lineTop, pressed && d.pressed]} onPress={() => onOpen(row.href)} accessibilityRole="link">
          <Text style={d.latestText}>{row.text}{row.amount ? <Text style={d.latestAmount}>{` · ${row.amount}`}</Text> : null}</Text>
          <Text style={d.latestWhen}>{row.when}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// --- also yours ------------------------------------------------------------------

// The pitch that raised most and the creator's link. Nothing when the
// creator has neither.
export function AlsoYours({ pitch, link, onOpen }) {
  const [copied, setCopied] = useState(false);
  if (!pitch && !link) return null;
  const host = API_BASE_URL.replace(/^https?:\/\//, '');
  async function copy() {
    try {
      await Clipboard.setStringAsync(`${API_BASE_URL}${link.path}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <View style={[d.card, d.cardLatest]}>
      <Text style={d.k} accessibilityRole="header">Also yours</Text>
      {pitch ? (
        <Pressable style={({ pressed }) => [d.also, pressed && d.pressed]} onPress={() => onOpen(pitch.href)} accessibilityRole="link" accessibilityLabel={`${DASH_WORDS.pitch}: ${pitch.title}. ${pitch.line}. ${pitch.action}`}>
          <View style={d.alsoText}>
            <Text style={d.needTitle}>{DASH_WORDS.pitch} · {pitch.title}</Text>
            <Text style={d.needSub}>{pitch.line}</Text>
            {pitch.share != null ? <View style={d.progress}><View style={[d.progressFill, { width: `${Math.round(pitch.share * 100)}%` }]} /></View> : null}
          </View>
          <ChevronIcon size={16} color={colors.inkDim} />
        </Pressable>
      ) : null}
      {link ? (
        <View style={[d.also, pitch && d.lineTop]}>
          <View style={d.alsoText}>
            <Text style={d.needTitle}>{DASH_WORDS.link} · {host}{link.path}</Text>
            <Text style={d.needSub}>{link.joined}</Text>
            <Text style={d.needSub}>{link.bonus}</Text>
          </View>
          <Pressable style={({ pressed }) => [d.rowBtn, pressed && d.pressed]} onPress={copy} accessibilityRole="button" accessibilityLabel={copied ? 'Copied' : 'Copy your link'}>
            <Text style={d.rowBtnText}>{copied ? 'Copied' : 'Copy'}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

// The board's sizes, in the theme's own tokens (mobile/src/lib/theme.js).
export const d = StyleSheet.create({
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
  lineTop: { borderTopWidth: 1, borderTopColor: inkTint(0.08) },
  linkText: { fontFamily: fonts.displaySemi, fontSize: 13.5, color: colors.olive },
  retry: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  empty: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.inkDim },
  emptyInCard: { paddingTop: 8, paddingBottom: 12 },
  fine: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: colors.inkFaint },

  // cards
  card: { borderRadius: 14, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.oceanInk },
  cardNeeds: { borderColor: brassTint(0.45), paddingTop: 16, paddingHorizontal: 16, paddingBottom: 4 },
  // The heads of Your titles and Views carry a 44pt link, which brings its
  // own room above and below.
  cardFlush: { paddingTop: 6 },
  cardMoney: { paddingTop: 16, paddingHorizontal: 16, paddingBottom: 2, gap: 12 },
  cardViews: { paddingTop: 6, paddingHorizontal: 16, paddingBottom: 10 },
  cardLatest: { paddingTop: 16, paddingHorizontal: 16, paddingBottom: 4 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  cardLink: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4 },
  headLink: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 },
  k: { fontFamily: fonts.monoMedium, fontSize: 10.5, letterSpacing: 1.7, textTransform: 'uppercase', color: colors.inkDim },
  kAccent: { color: colors.brass },
  kShrink: { flexShrink: 1 },
  h2: { fontFamily: fonts.displayBold, fontSize: 19, color: colors.ink, flexShrink: 1 },
  total: { fontFamily: fonts.displayBold, fontSize: 20, color: colors.ink, fontVariant: ['tabular-nums'] },

  // the four numbers
  tiles: { gap: 12 },
  tileRow: { flexDirection: 'row', alignItems: 'stretch', gap: 12 },
  tile: { flex: 1, minHeight: 106, paddingVertical: 13, paddingHorizontal: 14, borderRadius: 14, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.oceanInk, gap: 3 },
  tileAccent: { borderColor: brassTint(0.55) },
  tileGhost: { flex: 1 },
  tileK: { fontFamily: fonts.mono, fontSize: 9.5, lineHeight: 13, letterSpacing: 1.1, textTransform: 'uppercase', color: colors.inkDim },
  tileKAccent: { color: colors.brass },
  tileV: { fontFamily: fonts.displayBold, fontSize: 26, lineHeight: 30, color: colors.ink, fontVariant: ['tabular-nums'] },
  tileSub: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17, color: colors.inkDim },
  skel: { height: 22, width: '62%', marginVertical: 4, borderRadius: 6, backgroundColor: inkTint(0.1) },

  // needs you
  need: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 64, paddingVertical: 8 },
  needText: { flex: 1, minWidth: 0, gap: 1 },
  needTitle: { fontFamily: fonts.displaySemi, fontSize: 14.5, lineHeight: 19, color: colors.ink },
  needSub: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.inkDim },
  needAct: { minHeight: 44, justifyContent: 'center', flexShrink: 0, maxWidth: '46%' },

  // your titles
  titlesHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 16 },
  filters: { gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  filter: { height: 36, paddingHorizontal: 13, borderRadius: 18, borderWidth: 1, borderColor: inkTint(0.25), justifyContent: 'center' },
  filterOn: { borderColor: colors.olive, backgroundColor: oliveTint(0.18) },
  filterText: { fontFamily: fonts.displaySemi, fontSize: 12.5, color: colors.inkDim },
  filterTextOn: { color: colors.ink },
  filterCount: { fontFamily: fonts.mono, fontSize: 11 },
  titlesEmpty: { paddingHorizontal: 16, paddingVertical: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 78, paddingVertical: 8, paddingHorizontal: 16 },
  rowMain: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
  // Beside its button (or alone), the words take the room that is left.
  rowMainBeside: { flex: 1 },
  // The narrow layout: the words on their own line, the button under them,
  // in line with the words (past the 38pt thumb and its 12pt gap).
  rowStack: { flexDirection: 'column', alignItems: 'stretch', justifyContent: 'center', paddingBottom: 12 },
  rowBtnUnder: { alignSelf: 'flex-start', marginLeft: 50 },
  thumb: { width: 38, height: 54, borderRadius: 6, backgroundColor: colors.surface2 },
  thumbEmpty: { borderWidth: 1, borderColor: inkTint(0.12) },
  thumbDraft: { backgroundColor: 'transparent', borderWidth: 1, borderStyle: 'dashed', borderColor: inkTint(0.35) },
  rowText: { flex: 1, minWidth: 0, gap: 4 },
  rowTitle: { fontFamily: fonts.displaySemi, fontSize: 15, lineHeight: 19, color: colors.ink },
  rowMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 6, rowGap: 3 },
  rowMetaText: { fontFamily: fonts.mono, fontSize: 10.5, lineHeight: 14, color: colors.inkFaint },
  rowWhy: { fontFamily: fonts.mono, fontSize: 10.5, lineHeight: 14, color: colors.brass },
  rowNote: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17, color: colors.inkDim },
  rowNums: { alignItems: 'flex-end', gap: 2, flexShrink: 0 },
  rowEarned: { fontFamily: fonts.displayBold, fontSize: 15.5, color: colors.ink, fontVariant: ['tabular-nums'] },
  rowBtn: { minHeight: 44, paddingHorizontal: 12, borderRadius: 22, borderWidth: 1, borderColor: inkTint(0.3), alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  rowBtnGold: { backgroundColor: colors.olive, borderColor: colors.olive },
  rowBtnText: { fontFamily: fonts.displaySemi, fontSize: 13.5, color: colors.ink },
  rowBtnTextGold: { fontFamily: fonts.displayBold, color: PAPER },
  // A long one ("Ready to go public") breaks onto a second line rather
  // than run under the row's button.
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 1, paddingHorizontal: 6, borderRadius: 10, flexShrink: 1, maxWidth: '100%' },
  chipDot: { width: 5, height: 5, borderRadius: 3 },
  chipText: { fontFamily: fonts.mono, fontSize: 10.5, lineHeight: 14, letterSpacing: 0.6, textTransform: 'uppercase', flexShrink: 1 },
  showAll: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  foot: { paddingTop: 12, paddingHorizontal: 16, paddingBottom: 14, borderTopWidth: 1, borderTopColor: inkTint(0.1), fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: colors.inkFaint },

  // money this month
  lanes: { gap: 10 },
  lane: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  laneName: { width: 106, fontFamily: fonts.body, fontSize: 13.5, color: colors.ink },
  laneTrack: { flex: 1, height: 10 },
  laneBar: { height: 10, borderTopRightRadius: 4, borderBottomRightRadius: 4, backgroundColor: colors.olive },
  laneValue: { textAlign: 'right', fontFamily: fonts.mono, fontSize: 12.5, color: colors.ink, fontVariant: ['tabular-nums'] },
  moves: { gap: 10, paddingTop: 12, borderTopWidth: 1, borderTopColor: inkTint(0.1) },
  move: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  moveText: { flex: 1, minWidth: 0, gap: 1 },
  moveTitle: { fontFamily: fonts.displaySemi, fontSize: 14.5, color: colors.ink },
  moveSub: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.inkDim },
  moveValue: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.ink, fontVariant: ['tabular-nums'] },

  // latest
  latestRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 44, paddingVertical: 9 },
  latestText: { flex: 1, minWidth: 0, fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.ink },
  latestAmount: { color: colors.inkDim },
  latestWhen: { flexShrink: 0, fontFamily: fonts.mono, fontSize: 11.5, color: colors.inkFaint },

  // also yours
  also: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 60, paddingVertical: 10 },
  alsoText: { flex: 1, minWidth: 0, gap: 1 },
  progress: { height: 6, borderRadius: 3, backgroundColor: inkTint(0.12), overflow: 'hidden', marginTop: 6 },
  progressFill: { height: '100%', backgroundColor: colors.olive }
});
