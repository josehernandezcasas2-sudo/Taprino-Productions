import { useRef, useState } from 'react';
import { count, dayLabel } from '../../../lib/creatorDashboardRules';

// The Dashboard's three drawings (2026-11-14). Plain SVG and plain boxes,
// one colour each: the views line is the theme's sky, money is the theme's
// gold. Text is always ink. Every number a chart shows is worked out in
// lib/creatorDashboardRules.js; these only place it.

// A round number at or above `max` for the top grid line.
function niceTop(max) {
  if (max <= 0) return 10;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * pow >= max) return step * pow;
  return 10 * pow;
}

const W = 720;
const H = 216;
const LEFT = 48;
const RIGHT = 700;
const TOP = 30;
const BASE = 190;

// Views a day: a 2px line with a light fill under it, the best day marked,
// and the day under the pointer read out (mouse, finger or arrow keys).
export function ViewsChart({ views }) {
  const svgRef = useRef(null);
  const [at, setAt] = useState(null);
  const points = views.points;
  const top = niceTop(views.max);
  const step = points.length > 1 ? (RIGHT - LEFT) / (points.length - 1) : 0;
  const x = (i) => LEFT + i * step;
  const y = (v) => BASE - (v / top) * (BASE - TOP);
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.views).toFixed(1)}`).join(' ');
  const peakIndex = views.peak ? points.findIndex((p) => p.date === views.peak.date) : -1;

  function nearest(clientX) {
    const box = svgRef.current ? svgRef.current.getBoundingClientRect() : null;
    if (!box || !box.width || !points.length) return null;
    const inView = ((clientX - box.left) / box.width) * W;
    return Math.max(0, Math.min(points.length - 1, Math.round((inView - LEFT) / (step || 1))));
  }
  function onKey(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setAt((cur) => {
      const from = cur == null ? (peakIndex >= 0 ? peakIndex : points.length - 1) : cur;
      return Math.max(0, Math.min(points.length - 1, from + (e.key === 'ArrowRight' ? 1 : -1)));
    });
  }
  const shown = at != null && points[at] ? points[at] : null;
  // The peak's label stays inside the drawing at either end.
  const peakX = peakIndex >= 0 ? Math.max(LEFT + 125, Math.min(RIGHT - 125, x(peakIndex))) : 0;

  return (
    <div className="dash-views-chart">
      <svg
        ref={svgRef}
        className="dash-chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={views.summary}
        tabIndex={0}
        onPointerMove={(e) => setAt(nearest(e.clientX))}
        onPointerDown={(e) => setAt(nearest(e.clientX))}
        onPointerLeave={() => setAt(null)}
        onBlur={() => setAt(null)}
        onKeyDown={onKey}
      >
        <line className="dash-grid" x1={LEFT} y1={TOP} x2={RIGHT} y2={TOP} />
        <line className="dash-grid" x1={LEFT} y1={(TOP + BASE) / 2} x2={RIGHT} y2={(TOP + BASE) / 2} />
        <line className="dash-axis" x1={LEFT} y1={BASE} x2={RIGHT} y2={BASE} />
        <text className="dash-tick" x={LEFT - 10} y={TOP + 4} textAnchor="end">{count(top)}</text>
        <text className="dash-tick" x={LEFT - 10} y={(TOP + BASE) / 2 + 4} textAnchor="end">{count(top / 2)}</text>
        <text className="dash-tick" x={LEFT - 10} y={BASE + 4} textAnchor="end">0</text>
        {points.length > 1 && <polygon className="dash-area" points={`${line} ${RIGHT},${BASE} ${LEFT},${BASE}`} />}
        {points.length > 1 && <polyline className="dash-line" points={line} />}
        {peakIndex >= 0 && shown == null && (
          <>
            <circle className="dash-dot" cx={x(peakIndex)} cy={y(points[peakIndex].views)} r="5" />
            <text className="dash-callout" x={peakX} y={Math.max(14, y(points[peakIndex].views) - 14)} textAnchor="middle">{views.peak.label}</text>
          </>
        )}
        {shown && (
          <>
            <line className="dash-cross" x1={x(at)} y1={TOP - 8} x2={x(at)} y2={BASE} />
            <circle className="dash-dot" cx={x(at)} cy={y(shown.views)} r="5" />
          </>
        )}
        <text className="dash-tick" x={LEFT} y={H - 6} textAnchor="start">{views.firstLabel}</text>
        <text className="dash-tick" x={RIGHT} y={H - 6} textAnchor="end">{views.lastLabel}</text>
      </svg>
      <p className="dash-readout" aria-live="polite">
        {shown ? `${dayLabel(`${shown.date}T12:00:00Z`)} · ${count(shown.views)} ${shown.views === 1 ? 'view' : 'views'}` : 'Point at a day to read it.'}
      </p>
    </div>
  );
}

// A row's own views over the 30 days, as a small line.
export function Spark({ values, label }) {
  if (!Array.isArray(values) || values.length < 2) return null;
  const max = Math.max(...values, 1);
  const stepX = 58 / (values.length - 1);
  const pts = values.map((v, i) => `${(2 + i * stepX).toFixed(1)},${(19 - (v / max) * 16).toFixed(1)}`).join(' ');
  return (
    <svg className="dash-spark" width="62" height="22" viewBox="0 0 62 22" role="img" aria-label={label}>
      <polyline points={pts} />
    </svg>
  );
}

// The six months as bars from one baseline. The month so far is drawn
// lighter with an outline and carries its amount; the others show theirs
// under the pointer or on focus.
export function MonthBars({ months }) {
  return (
    <div className="dash-months" role="img" aria-label={months.summary}>
      {months.bars.map((bar, i) => (
        <div key={bar.period} className={`dash-month${bar.current ? ' current' : ''}${i === months.bars.length - 1 ? ' labelled' : ''}`} tabIndex={0}>
          <span className="dash-month-value">{bar.value}</span>
          <span className="dash-month-track"><span className="dash-month-bar" style={{ height: `${Math.round(bar.share * 100)}%` }} /></span>
          <span className="dash-month-name">{bar.label}</span>
        </div>
      ))}
    </div>
  );
}
