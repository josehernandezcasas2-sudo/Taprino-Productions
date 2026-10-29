import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors, fonts, absoluteFill } from '../lib/theme';
import { formatRuntimeLong, parseRuntimeToSeconds } from '../lib/runtime';
import SmartImage from './SmartImage';
import WishlistHeart from './WishlistHeart';

const CONTENT_TYPE_LABEL = { movie: 'Movie', short: 'Short', vertical: 'Vertical', podcast: 'Podcast', bonus: 'Bonus' };
const TYPE_LINE_COLOR = { series: colors.brass, movie: colors.mint, short: colors.sky, vertical: colors.rust, podcast: colors.olive, bonus: colors.inkFaint };

// The stage's horizontal padding on every screen that renders a row
// (stream, the type browser, the episode screen: paddingHorizontal 19).
// A row bleeds out of it to the screen edge, as on the website, so the
// next card peeks in at the edge instead of being cut at the padding.
export const ROW_GUTTER = 19;

// How many cards fit (Jose, 2026-10-29, option A of the "Stream cards
// sizing" canvas — HBO Max / Prime Video proportions; the website's
// .cat-row-track variables carry the same numbers): a row runs from the
// gutter to the screen edge, and a card is as wide as it has to be for
// `across` of them to fit with one gap each plus a peek of the next.
// Posters are 2:3, Continue Watching is 16:9.
// The column count steps with the screen the way HBO Max and Prime Video
// add columns instead of growing the poster (the website's .cat-row-track
// carries the same table, 2026-10-29): a phone 3, an iPad portrait 4,
// a 10.9" iPad landscape or a 12.9" portrait 5, a 12.9" landscape 6, and
// the wider steps only ever apply to a desktop window. A poster stays
// between about 165 and 240pt everywhere.
const ROW_TIERS = [
  { min: 2400, across: 10, landscape: 8, gap: 16, peek: 20 },
  { min: 2100, across: 9, landscape: 7, gap: 16, peek: 20 },
  { min: 1800, across: 8, landscape: 6, gap: 16, peek: 20 },
  { min: 1536, across: 7, landscape: 5, gap: 16, peek: 20 },
  { min: 1200, across: 6, landscape: 4, gap: 16, peek: 20 },
  { min: 900, across: 5, landscape: 4, gap: 14, peek: 16 },
  { min: 641, across: 4, landscape: 3, gap: 14, peek: 16 },
  { min: 0, across: 3, landscape: 2, gap: 10, peek: 10 }
];

export function rowMetrics(width) {
  const tier = ROW_TIERS.find((t) => width >= t.min) || ROW_TIERS[ROW_TIERS.length - 1];
  const { across, landscape: landscapeAcross, gap, peek } = tier;
  const row = width - ROW_GUTTER;
  const posterW = Math.floor((row - across * gap - peek) / across);
  const landscapeW = Math.floor((row - landscapeAcross * gap - peek) / landscapeAcross);
  return { gap, posterW, posterH: Math.round(posterW * 1.5), landscapeW, landscapeH: Math.round(landscapeW * 9 / 16) };
}

// Mirrors components/GenreRow.js's tierBadge classes: free-ads = olive-deep
// pill, free-noads = green, premium = brass.
function cardBadge(tier, adsEnabled) {
  if (tier === 'premium') return { label: 'Tapa +', bg: colors.brass, fg: '#241a05' };
  if (adsEnabled === false) return { label: 'Free', bg: colors.ok, fg: '#14261a' };
  return { label: 'Free with ads', bg: colors.oliveDeep, fg: colors.ink };
}

function PlayGlyph({ size = 11 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="rgba(251,232,211,0.5)">
      <Path d="M8 5v14l11-7z" />
    </Svg>
  );
}

function RowHeading({ title, onSeeAll }) {
  return (
    <View style={styles.rowHeadingRow}>
      <Text style={styles.rowHeading}>{title}</Text>
      {onSeeAll ? <Pressable onPress={onSeeAll} hitSlop={8}><Text style={styles.seeAll}>See all</Text></Pressable> : null}
    </View>
  );
}

// The horizontal track: bleeds out of the stage's padding so the cards run
// to the screen edge, with the gutter restored inside as the first card's
// left edge.
function Track({ gap, children }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.track} contentContainerStyle={[styles.trackContent, { gap }]}>
      {children}
    </ScrollView>
  );
}

// components/GenreRow.js: the art is the card (2:3, radius 8, no box), the
// tier badge and the heart sit on it, and the title + "runtime · type"
// line sit under it — not over the art on a scrim, so a frame-grab
// thumbnail still names the title and the smaller card keeps its whole
// picture. `cards` are the consolidated cards from lib/libraryCards.js
// (one per series, one per standalone title).
export function CardRow({ title, cards, onPressCard, onSeeAll, isWishlisted, onToggleWishlist }) {
  const { width } = useWindowDimensions();
  if (!cards || cards.length === 0) return null;
  const m = rowMetrics(width);
  return (
    <View style={styles.catRow}>
      <RowHeading title={title} onSeeAll={onSeeAll} />
      <Track gap={m.gap}>
        {cards.map((card) => {
          const badge = cardBadge(card.tier, card.adsEnabled);
          const isSeries = card.type === 'series';
          const typeKey = isSeries ? 'series' : card.contentType;
          const typeLabel = isSeries ? '▤ Series' : (CONTENT_TYPE_LABEL[card.contentType] || 'Short');
          const first = isSeries ? `${card.episodeCount} episode${card.episodeCount === 1 ? '' : 's'}` : (formatRuntimeLong(card.runtime) || card.runtime || '');
          return (
            <Pressable key={card.id} style={{ width: m.posterW }} onPress={() => onPressCard(card)}>
              <View style={[styles.thumb, { width: m.posterW, height: m.posterH }]}>
                {card.thumbnail ? <SmartImage uri={card.thumbnail} style={absoluteFill} /> : (
                  <Text style={styles.thumbFallback}>{card.tier === 'premium' ? 'locked' : isSeries ? '▤ series' : '▶ preview'}</Text>
                )}
                {card.hasNew ? <View style={styles.newBanner}><Text style={styles.newBannerText}>New episode</Text></View> : null}
                {onToggleWishlist ? <WishlistHeart active={isWishlisted(card.id)} onToggle={() => onToggleWishlist(card.id)} top={card.hasNew ? 27 : 7} /> : null}
                <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                  <Text style={[styles.badgeText, { color: badge.fg }]}>{badge.label}</Text>
                </View>
              </View>
              <View style={styles.info}>
                <Text style={styles.cardTitle} numberOfLines={2}>{card.title}</Text>
                <Text style={styles.cardMeta} numberOfLines={1}>
                  {first}{first ? ' · ' : ''}<Text style={{ color: TYPE_LINE_COLOR[typeKey] || colors.inkDim }}>{typeLabel}</Text>
                </Text>
              </View>
            </Pressable>
          );
        })}
      </Track>
    </View>
  );
}

// "S1 E4 · 12 min left" for an episode of a show, "12 min left" for a film
// or short, the maker's name when the runtime isn't known (the website's
// components/ContinueWatchingRow.js resumeMeta).
function resumeMeta(ep, totalSeconds) {
  const parts = [];
  if (ep.contentType === 'series' && ep.seriesOrder) parts.push(`S${ep.season || 1} E${ep.seriesOrder}`);
  if (totalSeconds && ep.resumeSeconds != null) {
    const left = Math.max(1, Math.round((totalSeconds - ep.resumeSeconds) / 60));
    parts.push(`${left} min left`);
  }
  return parts.length > 0 ? parts.join(' · ') : (ep.artist || '');
}

// components/ContinueWatchingRow.js — one card per in-progress episode
// (never consolidated into a series card), landscape 16:9 as on HBO Max
// and Prime Video, with the 4px resume-progress bar along the bottom of
// the art and the episode + time-left line under it.
export function ContinueWatchingRow({ items, onPressItem }) {
  const { width } = useWindowDimensions();
  if (!items || items.length === 0) return null;
  const m = rowMetrics(width);
  return (
    <View style={styles.catRow}>
      <RowHeading title="Continue Watching" />
      <Track gap={m.gap}>
        {items.slice(0, 15).map((ep) => {
          const total = parseRuntimeToSeconds(ep.runtime);
          const pct = total ? Math.min(100, Math.round((ep.resumeSeconds / total) * 100)) : null;
          return (
            <Pressable key={ep.id} style={{ width: m.landscapeW }} onPress={() => onPressItem(ep)}>
              <View style={[styles.thumb, { width: m.landscapeW, height: m.landscapeH }]}>
                {ep.thumbnail ? <SmartImage uri={ep.thumbnail} style={absoluteFill} /> : (
                  <View style={styles.resumeFallback}><PlayGlyph /><Text style={styles.thumbFallback}> Resume</Text></View>
                )}
                {pct !== null ? (
                  <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${pct}%` }]} /></View>
                ) : null}
              </View>
              <View style={styles.info}>
                <Text style={styles.cardTitle} numberOfLines={2}>{ep.title}</Text>
                <Text style={styles.cardMeta} numberOfLines={1}>{resumeMeta(ep, total)}</Text>
              </View>
            </Pressable>
          );
        })}
      </Track>
    </View>
  );
}

function CheckGlyph({ size = 9 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={colors.ok} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4 12l5 5L20 6" />
    </Svg>
  );
}

// The episode page's season strip (the "After Play" canvas, 2026-10-29;
// the website's EpisodeStrip in pages/episode/[id].js): landscape cards
// at the Continue Watching size, a Watched tick on finished ones, the
// one playing now outlined with a "Now playing" pill, a progress bar on
// anything partway through. `items` are /api/episode-page's
// seasonEpisodes ({ id, title, season, seriesOrder, runtime, thumbnail,
// watched, resumeSeconds, current }); the standalone title's "Watch next"
// picks use it too, without the codes.
export function EpisodeStrip({ title, items, onPressItem, onSeeAll, showCode = true }) {
  const { width } = useWindowDimensions();
  if (!items || items.length === 0) return null;
  const m = rowMetrics(width);
  return (
    <View style={styles.catRow}>
      <RowHeading title={title} onSeeAll={onSeeAll} />
      <Track gap={m.gap}>
        {items.map((ep) => {
          const total = parseRuntimeToSeconds(ep.runtime);
          const pct = ep.resumeSeconds && total ? Math.min(100, Math.round((ep.resumeSeconds / total) * 100)) : 0;
          const code = showCode && ep.seriesOrder ? `S${ep.season || 1} E${ep.seriesOrder}` : null;
          const mins = total ? `${Math.max(1, Math.round(total / 60))} min` : (ep.runtime || '');
          return (
            <Pressable key={ep.id} style={{ width: m.landscapeW }} onPress={() => onPressItem(ep)} accessibilityState={{ selected: Boolean(ep.current) }}>
              <View style={[styles.thumb, { width: m.landscapeW, height: m.landscapeH }, ep.current && styles.thumbCurrent, ep.watched && !ep.current && { opacity: 0.75 }]}>
                {ep.thumbnail ? <SmartImage uri={ep.thumbnail} style={absoluteFill} /> : null}
                {ep.current ? (
                  <View style={[styles.stripPill, styles.stripPillNow]}><Text style={styles.stripPillNowText}>Now playing</Text></View>
                ) : ep.watched ? (
                  <View style={styles.stripPill}><CheckGlyph /><Text style={styles.stripPillText}>Watched</Text></View>
                ) : (
                  <PlayGlyph size={20} />
                )}
                {pct > 0 ? (
                  <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${pct}%` }]} /></View>
                ) : null}
              </View>
              <View style={styles.info}>
                <Text style={styles.cardTitle} numberOfLines={2}>{ep.title}</Text>
                <Text style={styles.cardMeta} numberOfLines={1}>{[code, mins].filter(Boolean).join(' · ')}</Text>
              </View>
            </Pressable>
          );
        })}
      </Track>
    </View>
  );
}

const styles = StyleSheet.create({
  // .cat-row / .cat-row-heading / .cat-row-track
  catRow: { marginBottom: 26 },
  rowHeadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11 },
  rowHeading: { fontFamily: fonts.mono, fontSize: 20, letterSpacing: 2, textTransform: 'uppercase', color: colors.inkDim },
  seeAll: { fontFamily: fonts.mono, fontSize: 11.5, letterSpacing: 0.7, textTransform: 'uppercase', color: colors.brass },
  track: { marginHorizontal: -ROW_GUTTER },
  trackContent: { flexDirection: 'row', paddingLeft: ROW_GUTTER, paddingRight: ROW_GUTTER, paddingTop: 2, paddingBottom: 6 },

  // .row-card .ep-thumb / .ep-info
  thumb: { borderRadius: 8, overflow: 'hidden', backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  thumbFallback: { fontFamily: fonts.mono, fontSize: 9.6, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(251,232,211,0.5)' },
  resumeFallback: { flexDirection: 'row', alignItems: 'center' },
  // Bottom-left of the art: on a 110pt card it can't share the top edge
  // with the heart (the website's .row-card .ep-thumb .ep-badge).
  badge: { position: 'absolute', left: 7, bottom: 7, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999 },
  badgeText: { fontFamily: fonts.mono, fontSize: 8, letterSpacing: 0.6, textTransform: 'uppercase' },
  newBanner: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: colors.sky, paddingVertical: 5 },
  newBannerText: { color: colors.surface0, fontFamily: fonts.monoBold, fontSize: 9, letterSpacing: 0.8, textTransform: 'uppercase', textAlign: 'center' },
  info: { paddingTop: 7, gap: 2 },
  cardTitle: { fontFamily: fonts.displaySemi, fontSize: 12.8, lineHeight: 16, color: colors.ink },
  cardMeta: { fontFamily: fonts.mono, fontSize: 9.3, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.inkDim },

  // .cw-progress-track / .cw-progress-fill
  progressTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, backgroundColor: 'rgba(0,0,0,0.5)' },
  progressFill: { height: '100%', backgroundColor: colors.olive },

  // .ep-strip-card.is-current / .ep-strip-pill
  thumbCurrent: { borderWidth: 2, borderColor: colors.brass },
  stripPill: { position: 'absolute', left: 7, top: 7, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(12,19,31,0.78)' },
  stripPillText: { fontFamily: fonts.mono, fontSize: 8, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.ink },
  stripPillNow: { backgroundColor: colors.brass },
  stripPillNowText: { fontFamily: fonts.monoBold, fontSize: 8, letterSpacing: 0.8, textTransform: 'uppercase', color: '#241a05' }
});
