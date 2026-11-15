import { useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { TITLE_WORDS, showOverview } from '../../lib/titleDashRules';
import { DASH_WORDS, count } from '../../lib/creatorDashboardRules';
import { WORK_WORDS } from '../../lib/workListRules';
import { SITE } from '../../lib/siteConfig';
import { BarChart, MoneyCard, NeedLine, NumberTiles, bg, useRoute } from '../creator/title/TitleBits';
import { PREVIEW_BUILT, countLine, publicHref } from './ShowCards';
import { ExternalLinkIcon, EyeIcon } from '../PlayerIcons';

// A show's Overview (/creator/show/<id>?tab=overview; the canvas's
// "Dashboard · a series", mockups/work-revamp-contract.md): the show's
// four numbers, its last 30 days as ten bars of three days, every episode
// with its views and how far people watch, and beside them what needs the
// creator, what waits on the team, who's on it and what the show has
// earned. It reads the show (GET /api/show/<id>), the creator's numbers
// and this year's money; lib/titleDashRules.js showOverview turns them
// into every number and sentence. The Episodes tab is the control room.

const STATE_CHIP = { live: 'state-live', ready: 'state-ready', review: 'state-private', drafts: 'state-private', empty: 'state-private', pulled: 'state-pulled', removal: 'state-removal', declined: 'state-declined' };

// GET /api/show/<id> carries the show's waiting season art as a list ([]
// when nothing waits) and a waiting title image as titleImageUrl /
// titleImageRemoval; the rules read a truthy `seasonArt` and `titleImage`.
// Said the way the rules read it, so an empty list isn't "a change waiting".
function forRules(view) {
  if (!view || !view.show) return view;
  const st = view.show.staged;
  if (!st) return view;
  const staged = {
    ...st,
    seasonArt: Array.isArray(st.seasonArt) ? (st.seasonArt.length ? st.seasonArt : null) : st.seasonArt || null,
    titleImage: Boolean(st.titleImage || st.titleImageUrl || st.titleImageRemoval)
  };
  return { ...view, show: { ...view.show, staged } };
}

// Ten bars of three days, oldest first: which days one covers.
function stepWords(i, total) {
  const days = total > 0 ? Math.round(30 / total) : 3;
  const newest = (total - 1 - i) * days;
  if (newest === 0) return `The last ${days === 3 ? 'three' : days} days`;
  return `${newest + days - 1}–${newest} days ago`;
}

function chartLabel(chart) {
  const total = chart.list.length;
  const at = chart.list.findIndex((b) => b.value === chart.max);
  const peak = at >= 0 && chart.max > 0 ? ` The busiest: ${stepWords(at, total).toLowerCase()}, ${count(chart.max)} ${chart.max === 1 ? 'view' : 'views'}.` : '';
  return `Views of the show over the last 30 days, in ${total} steps of three days.${peak}`;
}

export default function ShowOverview({ showId }) {
  const [now] = useState(() => Date.now());
  const year = new Date(now).getUTCFullYear();
  const showRoute = useRoute(`/api/show/${encodeURIComponent(showId)}`);
  const numbersRoute = useRoute('/api/creator/analytics?days=30&compare=1');
  const moneyRoute = useRoute(`/api/creator/money?period=${year}`);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null); // { ok, text }

  const view = showRoute.data && showRoute.data.show ? showRoute.data : null;
  const numbers = numbersRoute.state === 'ok' && numbersRoute.data && numbersRoute.data.totals ? numbersRoute.data : null;
  const money = moneyRoute.state === 'ok' ? moneyRoute.data : null;
  const o = useMemo(() => showOverview({ show: forRules(view), numbers, money, now }), [view, numbers, money, now]);

  if (!view || !o) {
    const missing = showRoute.state === 'missing' || showRoute.state === 'refused';
    return (
      <main id="main-content" className="td-page td-show">
        {showRoute.state === 'loading' ? (
          <div className="td-skeleton" aria-busy="true" aria-label={TITLE_WORDS.loading}><span /><span /><span /></div>
        ) : (
          <div className="dash-card td-card td-missing" role="alert">
            <p className="td-value">{missing ? 'That show isn’t there. It may have been removed, or it belongs to someone else.' : TITLE_WORDS.failed}</p>
            {missing ? <Link href="/creator/my-work" className="td-btn">{TITLE_WORDS.back}</Link> : <button type="button" className="td-btn" onClick={showRoute.reload}>Try again</button>}
          </div>
        )}
      </main>
    );
  }

  const show = view.show;
  const art = show.art || {};
  const viewer = view.viewer || {};
  const canPublish = show.state === 'ready' && view.makePublic && view.makePublic.ok && (viewer.isOwner || viewer.isAdmin);
  const name = show.name || 'Your show';

  async function makePublic() {
    if (!window.confirm(DASH_WORDS.makePublicAsk(name))) return;
    setBusy(true);
    setFlash(null);
    try {
      const res = await fetch(`/api/show/${encodeURIComponent(showId)}/public`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not make it public.');
      setFlash({ ok: true, text: `${name} is public. Its approved episodes are on the site; the next ones go live as they’re approved.` });
      showRoute.reload();
    } catch (err) {
      setFlash({ ok: false, text: err instanceof TypeError ? DASH_WORDS.offline : err.message });
    } finally {
      setBusy(false);
    }
  }

  const loading = [];
  if (numbersRoute.state === 'loading') loading.push('views', 'watched', 'kept');
  if (moneyRoute.state === 'loading') loading.push('earned');
  const chart = o.chart;

  return (
    <main id="main-content" className="td-page td-show">
      <Head>
        <title>{`${name} — Overview — ${SITE.name}`}</title>
        <meta name="robots" content="noindex" />
      </Head>

      <header className="td-head">
        <span className={`td-poster${art.poster ? '' : ' empty'}`} style={bg(art.poster)} aria-hidden="true">{!art.poster && <span>{name}</span>}</span>
        <div className="td-head-text">
          <div className="td-chips">
            <span className={`cs-chip ${show.kind === 'podcast' ? 'kind-podcast' : 'kind-series'}`}>{show.kind === 'podcast' ? 'Podcast' : show.kind === 'vertical' ? 'Vertical' : 'Series'}</span>
            {show.statusLabel && <span className={`cs-chip ${STATE_CHIP[show.state] || 'state-private'}`}>{show.state === 'live' ? <i /> : null}{show.statusLabel}</span>}
          </div>
          <h1 className="td-h1">{name}</h1>
          <p className="td-meta">{countLine(view.seasons)}</p>
        </div>
        <div className="td-head-acts">
          {canPublish && (
            <button type="button" className="td-btn solid" disabled={busy} onClick={makePublic}>{busy ? 'Making it public…' : WORK_WORDS.makePublic}</button>
          )}
          {show.isPublic ? (
            <a className="td-btn" href={publicHref(show)} target="_blank" rel="noopener noreferrer"><ExternalLinkIcon size={16} /> View its page<span className="visually-hidden"> (opens in a new tab)</span></a>
          ) : PREVIEW_BUILT ? (
            <a className="td-btn" href={publicHref(show, true)} target="_blank" rel="noopener noreferrer"><EyeIcon size={16} /> Preview · not public yet<span className="visually-hidden"> (opens in a new tab)</span></a>
          ) : null}
        </div>
      </header>

      {flash && <div className={`dash-flash${flash.ok ? '' : ' bad'}`} role={flash.ok ? 'status' : 'alert'}>{flash.text}</div>}

      <div className="td-cols">
        <div className="td-col">
          <NumberTiles tiles={o.tiles} loading={loading} className="td-o1" />
          {o.trackingOff && !o.tiles.some((t) => t.note === TITLE_WORDS.noTracking) && <p className="dash-fine td-o1">{TITLE_WORDS.noTracking}</p>}
          {numbersRoute.state !== 'refused' && !(o.trackingOff && chart.empty) && (
            <section className="dash-card td-card td-o2" aria-labelledby="td-show-chart-h">
              <h2 id="td-show-chart-h" className="td-h2">{chart.title}</h2>
              {!chart.available ? (
                numbersRoute.state === 'loading' ? <p className="dash-empty">{TITLE_WORDS.loading}</p> : (
                  <div className="td-failed" role="alert">
                    <p className="dash-empty">{TITLE_WORDS.failed}</p>
                    <button type="button" className="td-btn" onClick={numbersRoute.reload}>Try again</button>
                  </div>
                )
              ) : chart.empty ? (
                <p className="dash-empty">{TITLE_WORDS.chartEmpty}</p>
              ) : (
                <BarChart
                  chart={chart}
                  label={chartLabel(chart)}
                  hint="Point at a bar, or use the arrow keys, to read it."
                  readOf={(i, bar) => `${stepWords(i, chart.list.length)} · ${count(bar.value)} ${bar.value === 1 ? 'view' : 'views'}`}
                />
              )}
            </section>
          )}
          <section className="dash-card td-card td-eps-card td-o3" aria-labelledby="td-eps-h">
            <h2 id="td-eps-h" className="td-h2">{TITLE_WORDS.episodes}</h2>
            <p className="td-sub">{TITLE_WORDS.episodesNote}</p>
            {o.episodes.length === 0 ? (
              <p className="dash-empty">No episodes yet.</p>
            ) : (
              <div className="td-table-box" tabIndex={0} role="region" aria-labelledby="td-eps-h">
                <table className="td-table">
                  <thead>
                    <tr>
                      <th scope="col">Episode</th>
                      <th scope="col" className="num">{TITLE_WORDS.views}</th>
                      <th scope="col" className="num">{TITLE_WORDS.avgWatch}</th>
                      <th scope="col" className="bar">{TITLE_WORDS.watched}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.episodes.map((e) => (
                      <tr key={e.id}>
                        <td>
                          <Link href={e.href} className="td-ep-link">
                            <span className="td-ep-code">{e.code}</span>
                            <span className="td-ep-title">{e.title}</span>
                          </Link>
                        </td>
                        <td className="num">{e.views}</td>
                        <td className="num">{e.avg}</td>
                        <td className="bar">
                          {e.pill ? (
                            <span className={`td-chip tone-${e.pill.tone}`}>{e.pill.label}</span>
                          ) : e.pct != null ? (
                            <span className="td-pct">
                              <span className="td-pct-track" aria-hidden="true"><span className="td-pct-fill" style={{ width: `${Math.max(0, Math.min(100, e.pct))}%` }} /></span>
                              <span className="td-pct-n">{e.pct}%</span>
                            </span>
                          ) : <span className="td-dim">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className="td-col">
          <section className="dash-card td-card td-needs-card td-o0" aria-labelledby="td-show-needs-h">
            <h2 id="td-show-needs-h" className="td-h2">{TITLE_WORDS.needs}</h2>
            {o.needs.length === 0 ? <p className="dash-empty">{TITLE_WORDS.needsNone}</p> : (
              <ul className="td-list">
                {o.needs.map((x) => <NeedLine key={x.key} text={x.text} tone="need" as="li" />)}
              </ul>
            )}
            {o.needs.length > 0 && <Link href={`/creator/show/${encodeURIComponent(showId)}`} className="dash-link" shallow>Fix them in Episodes →</Link>}
          </section>
          <section className="dash-card td-card td-o4" aria-labelledby="td-show-wait-h">
            <h2 id="td-show-wait-h" className="td-h2">{TITLE_WORDS.waiting}</h2>
            {o.waiting.length === 0 ? <p className="dash-empty">{TITLE_WORDS.waitingNone}</p> : (
              <ul className="td-list">
                {o.waiting.map((x) => <NeedLine key={x.key} text={x.text} tone="wait" as="li" />)}
              </ul>
            )}
          </section>
          {o.people.length > 0 && (
            <section className="dash-card td-card td-o5" aria-labelledby="td-show-people-h">
              <h2 id="td-show-people-h" className="td-h2">{TITLE_WORDS.people}</h2>
              <dl className="td-people">
                {o.people.map((p) => (
                  <div key={p.key} className="td-person">
                    <dt>{p.label}</dt>
                    <dd>{p.value}</dd>
                  </div>
                ))}
              </dl>
              {show.canEditShow && <Link href={`/creator/show/${encodeURIComponent(showId)}/edit`} className="dash-link">Edit show →</Link>}
            </section>
          )}
          <MoneyCard card={o.money} heading={TITLE_WORDS.moneyShow} state={moneyRoute.state} onRetry={moneyRoute.reload} id="td-show-money-h" className="td-o6" />
        </div>
      </div>
    </main>
  );
}
