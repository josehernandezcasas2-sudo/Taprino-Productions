import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { pageNotesBoxShows } from '../../PageNotesField';
import { CheckIcon, ClockIcon, WarningIcon } from '../../PlayerIcons';
import { TITLE_WORDS } from '../../../lib/titleDashRules';
import { count } from '../../../lib/creatorDashboardRules';
import { cssUrl } from '../../../lib/cssUrl';

// The pieces a title's dashboard (/creator/title/<id>) and a show's
// Overview (/creator/show/<id>?tab=overview) share (2026-11-15; the build
// agreement is mockups/work-revamp-contract.md). Every number and sentence
// they draw is worked out in lib/titleDashRules.js; these only place it.

// One route's answer: state 'idle' (no address) | 'loading' | 'ok' |
// 'refused' (401/403: leave its part out) | 'failed'. A re-read keeps what
// is on screen until the new answer is in.
export function useRoute(url) {
  const [box, setBox] = useState({ url, data: null, state: url ? 'loading' : 'idle' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) {
      setBox({ url, data: null, state: 'idle' });
      return undefined;
    }
    let on = true;
    setBox((b) => (b.url === url ? b : { url, data: null, state: 'loading' }));
    fetch(url)
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!on) return;
        if (res.ok && data) setBox({ url, data, state: 'ok' });
        else setBox((b) => ({ url, data: b.url === url && res.status >= 500 ? b.data : null, state: res.status === 401 || res.status === 403 ? 'refused' : res.status === 404 ? 'missing' : 'failed' }));
      })
      .catch(() => { if (on) setBox((b) => ({ url, data: b.url === url ? b.data : null, state: 'failed' })); });
    return () => { on = false; };
  }, [url, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const same = box.url === url;
  return { data: same ? box.data : null, state: same ? box.state : (url ? 'loading' : 'idle'), reload };
}

// What RequestEditModal needs about a title of its own: its words now,
// what waits for approval and where it stands (the same values Your work
// hands it, pages/creator/my-work.js).
export function editValuesFor(s) {
  return {
    id: s.id,
    title: s.title,
    description: s.description || '',
    pageNotes: s.pageNotes || '',
    notesShown: pageNotesBoxShows(s),
    status: s.status,
    held: Boolean(s.held),
    deletionRequested: Boolean(s.deletionRequested),
    withdrawnAt: s.withdrawnAt || null,
    pendingTitle: s.pendingTitle || null,
    pendingDescription: s.pendingDescription || null,
    pendingPageNotes: typeof s.pendingPageNotes === 'string' ? s.pendingPageNotes : null,
    pageNotesWaitReady: s.pageNotesWaitReady !== false,
    hasFlashingLights: s.hasFlashingLights === true,
    contentType: s.contentType || null,
    downloadsAllowed: s.downloadsAllowed !== false,
    downloadsAllowedReady: s.downloadsAllowedReady !== false
  };
}

export function bg(url) {
  return url ? { backgroundImage: cssUrl(url) } : undefined;
}

// The four numbers. `loading` holds the keys whose route hasn't answered
// yet: they show a bar instead of the rules' dash.
export function NumberTiles({ tiles, loading = [], className = '' }) {
  return (
    <div className={`dash-tiles td-tiles${className ? ` ${className}` : ''}`}>
      {tiles.map((tile) => {
        const waiting = loading.includes(tile.key);
        const tone = /^\+/.test(tile.note || '') ? ' up' : /^−/.test(tile.note || '') ? ' down' : '';
        return (
          <div key={tile.key} className="dash-tile td-tile">
            <div className="dash-tile-k">{tile.label}</div>
            <div className="dash-tile-v">{waiting ? <span className="dash-skel" aria-label={TITLE_WORDS.loading} /> : tile.value}</div>
            {!waiting && tile.note ? <div className={`dash-tile-sub td-tile-note${tone}`}>{tile.note}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

// Bars from one baseline: the busiest bar in full, the rest lighter, the
// bar under the pointer (or picked with the arrow keys) read out below.
// `readOf(i, bar)` gives that line; `label` is the chart's whole story for
// a screen reader (the range and the peak).
export function BarChart({ chart, label, readOf, hint }) {
  const [at, setAt] = useState(null);
  const list = Array.isArray(chart.list) ? chart.list : [];
  const max = Math.max(0, Number(chart.max) || 0);
  const peak = list.findIndex((b) => b.value === max && max > 0);
  function indexAt(e) {
    const box = e.currentTarget.getBoundingClientRect();
    if (!box.width || !list.length) return null;
    return Math.max(0, Math.min(list.length - 1, Math.floor(((e.clientX - box.left) / box.width) * list.length)));
  }
  function onKey(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    setAt((cur) => {
      if (e.key === 'Home') return 0;
      if (e.key === 'End') return list.length - 1;
      const from = cur == null ? (peak >= 0 ? peak : list.length - 1) : cur;
      return Math.max(0, Math.min(list.length - 1, from + (e.key === 'ArrowRight' ? 1 : -1)));
    });
  }
  const shown = at != null && list[at] ? list[at] : null;
  return (
    <div className="td-chart">
      <p className="td-chart-top" aria-hidden="true">{count(max)} {chart.unit}</p>
      <div
        className="td-bars"
        role="img"
        aria-label={label}
        tabIndex={0}
        onPointerMove={(e) => setAt(indexAt(e))}
        onPointerDown={(e) => setAt(indexAt(e))}
        onPointerLeave={() => setAt(null)}
        onBlur={() => setAt(null)}
        onKeyDown={onKey}
      >
        {list.map((bar, i) => {
          const share = max > 0 ? bar.value / max : 0;
          return (
            <span
              key={`${bar.date}-${i}`}
              aria-hidden="true"
              className={`td-bar${i === peak ? ' peak' : ''}${i === at ? ' at' : ''}${bar.value ? '' : ' zero'}`}
              style={{ height: bar.value ? `${Math.max(2, Math.round(share * 100))}%` : undefined }}
            />
          );
        })}
      </div>
      <div className="td-chart-axis" aria-hidden="true"><span>{chart.from}</span><span>{chart.to}</span></div>
      <p className="td-readout" aria-live="polite">{shown ? readOf(at, shown) : hint}</p>
    </div>
  );
}

// "What it has earned": the rows, the total, this month's part, the note.
// `state` is the money route's: refused leaves the card out.
export function MoneyCard({ card, heading, state, onRetry, id, className = '' }) {
  if (state === 'refused' || state === 'idle') return null;
  return (
    <section className={`dash-card td-card td-money${className ? ` ${className}` : ''}`} aria-labelledby={id}>
      <h2 id={id} className="td-h2">{heading}</h2>
      <p className="td-sub">{TITLE_WORDS.moneyNote}</p>
      {!card || !card.available ? (
        state === 'loading' ? <p className="dash-empty">{TITLE_WORDS.loading}</p> : (
          <div className="td-failed" role="alert">
            <p className="dash-empty">{TITLE_WORDS.failed}</p>
            {onRetry && <button type="button" className="td-btn" onClick={onRetry}>Try again</button>}
          </div>
        )
      ) : (
        <>
          <ul className="td-money-rows">
            {card.rows.map((row) => (
              <li key={row.key} className="td-money-row">
                <span className="td-money-label">{row.label}{row.detail ? <span className="td-dim"> · {row.detail}</span> : null}</span>
                <span className="td-amount">{row.amount}</span>
              </li>
            ))}
            <li className="td-money-row total">
              <span className="td-money-label">Total · {card.yearLabel}</span>
              <span className="td-amount">{card.total}</span>
            </li>
          </ul>
          {card.month && <p className="td-sub">{card.month}</p>}
          {card.note && <p className="dash-fine">{card.note}</p>}
        </>
      )}
      <Link href="/creator/money" className="dash-link">{TITLE_WORDS.openMoney} →</Link>
    </section>
  );
}

// A line of what needs the creator (orange) or waits for the team (gold).
export function NeedLine({ text, tone = 'need', as: Tag = 'p', className = '' }) {
  if (!text) return null;
  return (
    <Tag className={`td-line ${tone}${className ? ` ${className}` : ''}`}>
      {tone === 'need' ? <WarningIcon size={16} /> : <ClockIcon size={16} />}
      <span>{text}</span>
    </Tag>
  );
}

export function DoneMark({ done }) {
  return done
    ? <span className="td-mark done" aria-hidden="true"><CheckIcon size={16} /></span>
    : <span className="td-mark todo" aria-hidden="true" />;
}

// An action's error, under the card it came from.
export function ActionError({ error, where }) {
  if (!error || error.where !== where) return null;
  return <p className="dash-error" role="alert">{error.text}</p>;
}
