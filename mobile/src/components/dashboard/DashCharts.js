import { useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Line, Polygon, Polyline, Text as SvgText } from 'react-native-svg';
import { count } from '../../lib/creatorDashboardRules';
import { colors, fonts, inkTint } from '../../lib/theme';

// The Dashboard's drawings in the app (2026-11-14; the website's
// components/creator/dashboard/DashCharts.js and the signed-off phone
// board). One colour each: views are the theme's sky, the months the
// theme's gold with the month so far in the accent. Text is always one of
// the theme's inks, never the line's colour. Every number a chart shows
// comes from lib/creatorDashboardRules.js; these only place it.

// A round number at or above `max` for the top grid line.
function niceTop(max) {
  if (!(max > 0)) return 10;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * pow >= max) return step * pow;
  return 10 * pow;
}

const HEIGHT = 166;
const TOP = 20;
const BASE = 140;
const LEFT = 30;
const RIGHT_PAD = 10;
const TICK = 10.5;
// IBM Plex Mono: every glyph is 0.6 em wide.
const textWidth = (words, size) => String(words || '').length * size * 0.6;

// Views a day: a 2pt line with a light fill under it, the best day marked
// with a dot and its words (views.peak.label), the first and last day under
// the axis. `views` is dashboardViews(numbers); the caller draws the words
// for "no tracking" and "no views yet" instead of an empty chart.
export function ViewsChart({ views }) {
  const [width, setWidth] = useState(0);
  const points = views.points;
  const top = niceTop(views.max);
  // Room on the left for the widest tick ("1,000"), never less than the
  // board's 30pt.
  const left = Math.max(LEFT, Math.ceil(textWidth(count(top), TICK)) + 8);
  const right = Math.max(left + 1, width - RIGHT_PAD);
  const step = points.length > 1 ? (right - left) / (points.length - 1) : 0;
  const x = (i) => left + i * step;
  const y = (v) => BASE - (v / top) * (BASE - TOP);
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.views).toFixed(1)}`).join(' ');
  const peakIndex = views.peak ? points.findIndex((p) => p.date === views.peak.date) : -1;
  // The peak's words stay inside the drawing at either end.
  const half = views.peak ? textWidth(views.peak.label, TICK) / 2 : 0;
  const peakX = peakIndex >= 0 ? Math.max(left + half, Math.min(right - half, x(peakIndex))) : 0;
  // …and sit just over the dot, or over the top grid line when the dot is
  // close enough under it that the words would lie across the line.
  const overDot = peakIndex >= 0 ? y(points[peakIndex].views) - 11 : 0;
  const peakY = Math.max(11, overDot <= TOP + 12 ? Math.min(overDot, TOP - 6) : overDot);
  const tick = { fontFamily: fonts.mono, fontSize: TICK, fill: colors.inkFaint };

  return (
    <View
      style={{ height: HEIGHT }}
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
      accessible
      accessibilityRole="image"
      accessibilityLabel={views.summary}
    >
      {width > 0 ? (
        <Svg width={width} height={HEIGHT}>
          <Line x1={left} y1={TOP} x2={right} y2={TOP} stroke={inkTint(0.08)} strokeWidth={1} />
          <Line x1={left} y1={(TOP + BASE) / 2} x2={right} y2={(TOP + BASE) / 2} stroke={inkTint(0.08)} strokeWidth={1} />
          <Line x1={left} y1={BASE} x2={right} y2={BASE} stroke={inkTint(0.22)} strokeWidth={1} />
          <SvgText {...tick} x={left - 6} y={TOP + 4} textAnchor="end">{count(top)}</SvgText>
          <SvgText {...tick} x={left - 6} y={(TOP + BASE) / 2 + 4} textAnchor="end">{count(top / 2)}</SvgText>
          <SvgText {...tick} x={left - 6} y={BASE + 4} textAnchor="end">0</SvgText>
          {points.length > 1 ? <Polygon points={`${line} ${right},${BASE} ${left},${BASE}`} fill={colors.sky} fillOpacity={0.12} /> : null}
          {points.length > 1 ? <Polyline points={line} fill="none" stroke={colors.sky} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /> : null}
          {peakIndex >= 0 ? (
            <>
              <Circle cx={x(peakIndex)} cy={y(points[peakIndex].views)} r={5} fill={colors.sky} stroke={colors.surface1} strokeWidth={2} />
              <SvgText fontFamily={fonts.mono} fontSize={TICK} fill={colors.inkDim} x={peakX} y={peakY} textAnchor="middle">{views.peak.label}</SvgText>
            </>
          ) : null}
          <SvgText {...tick} x={left} y={HEIGHT - 6} textAnchor="start">{views.firstLabel}</SvgText>
          <SvgText {...tick} x={right} y={HEIGHT - 6} textAnchor="end">{views.lastLabel}</SvgText>
        </Svg>
      ) : null}
    </View>
  );
}

// A live row's own views over the 30 days, as a small line (row.spark).
// Nothing when there is no line to draw.
export function Spark({ values, label, width = 62, height = 22 }) {
  if (!Array.isArray(values) || values.length < 2) return null;
  const max = Math.max(...values, 1);
  const stepX = (width - 4) / (values.length - 1);
  const pts = values.map((v, i) => `${(2 + i * stepX).toFixed(1)},${(height - 3 - (v / max) * (height - 6)).toFixed(1)}`).join(' ');
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label}>
      <Svg width={width} height={height}>
        <Polyline points={pts} fill="none" stroke={colors.sky} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </View>
  );
}

// Earned · last six months: six bars from one baseline, oldest first, each
// month's short name under its bar (2026-11-14, when the Dashboard was
// fleshed out; the first build left them off the phone). `months` is
// dashboardMonths(money). The month so far is the accent bar. The amounts
// sit over the bars when the longest of them fits a column; on a narrow
// phone only the last bar — the month the page is showing — carries its
// amount, the others are in the spoken summary.
const BAR_AREA = 96;
const BAR_GAP = 8;
const AMOUNT = 10.5;
// The amounts follow the phone's text size, up to this much.
const AMOUNT_SCALE_MAX = 1.3;

export function MonthBars({ months }) {
  const [width, setWidth] = useState(0);
  const { fontScale } = useWindowDimensions();
  const bars = months.bars;
  const column = bars.length ? Math.max(0, (width - BAR_GAP * (bars.length - 1)) / bars.length) : 0;
  const size = AMOUNT * Math.min(AMOUNT_SCALE_MAX, Math.max(1, fontScale || 1));
  const widest = Math.max(0, ...bars.map((bar) => textWidth(bar.value, size)));
  const every = column > 0 && widest <= column;
  return (
    <View
      style={mb.wrap}
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
      accessible
      accessibilityRole="image"
      accessibilityLabel={months.summary}
    >
      {width > 0 ? bars.map((bar, i) => {
        const last = i === bars.length - 1;
        // A bar with money in it is never drawn as nothing.
        const height = bar.cents > 0 ? Math.max(3, Math.round(bar.share * BAR_AREA)) : 0;
        return (
          <View key={bar.period} style={[mb.column, { width: column, marginLeft: i > 0 ? BAR_GAP : 0 }]}>
            <View style={mb.amountRow}>
              {every || last ? (
                <View style={every ? mb.amountFit : mb.amountLoose}>
                  <Text style={[mb.amount, bar.current && mb.amountOn]} numberOfLines={1} maxFontSizeMultiplier={AMOUNT_SCALE_MAX}>{bar.value}</Text>
                </View>
              ) : null}
            </View>
            <View style={mb.track}>
              <View style={[mb.bar, bar.current && mb.barOn, { height, width: Math.min(30, column * 0.7) }]} />
            </View>
            <Text style={[mb.name, bar.current && mb.nameOn]} numberOfLines={1} maxFontSizeMultiplier={AMOUNT_SCALE_MAX}>{bar.label}</Text>
          </View>
        );
      }) : null}
    </View>
  );
}

const mb = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'flex-end', minHeight: BAR_AREA + 44 },
  column: { alignItems: 'center', gap: 5 },
  amountRow: { height: 18, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'flex-end' },
  amount: { fontFamily: fonts.mono, fontSize: AMOUNT, color: colors.inkDim, fontVariant: ['tabular-nums'] },
  amountOn: { color: colors.ink },
  amountFit: { alignSelf: 'stretch', alignItems: 'center' },
  // Alone over the last bar it may be wider than its column: it keeps its
  // right edge on the column's and runs left over the bars that carry none.
  amountLoose: { position: 'absolute', right: 0, bottom: 0, width: 160, alignItems: 'flex-end' },
  track: { height: BAR_AREA, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'flex-end', borderBottomWidth: 1, borderBottomColor: inkTint(0.22) },
  bar: { borderTopLeftRadius: 4, borderTopRightRadius: 4, backgroundColor: colors.olive },
  barOn: { backgroundColor: colors.brass },
  name: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.inkFaint },
  nameOn: { color: colors.ink }
});
