import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import DashboardTabs from '../DashboardTabs';
import {
  DASH_WORDS, canAddTitles, currentPeriod, dashboardLatest, dashboardLink, dashboardMoney, dashboardMonths, dashboardNeeds,
  dashboardPitch, dashboardTiles, dashboardTitles, dashboardViews, monthShort, periodOptions
} from '../../../lib/creatorDashboardRules';
import { Latest, Money, Needs, Pitch, Tiles, Titles, YourLink } from './DashSections';
import { MonthBars, ViewsChart } from './DashCharts';

// The creator's Dashboard (/creator/dashboard; Jose, 2026-11-14, mockup
// https://claude.ai/artifact/Sbam9nFHvuM18YhjUFgZtp): every film and show
// with where it stands, its views and what it earned, what needs the
// creator, and the money, on one page. It reads the six creator routes
// that already exist (each with its own gate) and draws each section as
// its answer arrives; lib/creatorDashboardRules.js turns the answers into
// every number and sentence here. Nothing on this page moves money.
//
// A route that refuses (a sub-admin who is not a creator has no titles
// and no money page) leaves its section out; one that fails says so. A
// section is never drawn as zeros because its route didn't answer.

const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

// Wide enough for two columns? Decided before the first paint, so a
// laptop never sees the one-column order flash by. The two structures
// hold the same cards: what differs is which comes first, and on a wide
// screen that is two columns read top to bottom, not a re-ordered stack.
function useWide() {
  const [wide, setWide] = useState(false);
  useIsoLayoutEffect(() => {
    const mq = window.matchMedia('(min-width: 1101px)');
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return wide;
}

// One route's answer: state 'loading' | 'ok' | 'refused' | 'failed'.
function useRoute(url) {
  const [box, setBox] = useState({ url, data: null, state: 'loading' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let on = true;
    // A new address starts empty; a re-read keeps what is on screen.
    setBox((b) => (b.url === url ? b : { url, data: null, state: 'loading' }));
    fetch(url)
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!on) return;
        if (res.ok && data) setBox({ url, data, state: 'ok' });
        else setBox((b) => ({ url, data: b.url === url && res.status >= 500 ? b.data : null, state: res.status === 401 || res.status === 403 ? 'refused' : 'failed' }));
      })
      .catch(() => { if (on) setBox((b) => ({ url, data: b.url === url ? b.data : null, state: 'failed' })); });
    return () => { on = false; };
  }, [url, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data: box.url === url ? box.data : null, state: box.url === url ? box.state : 'loading', reload };
}

export default function CreatorDashboard({ role, name = null }) {
  const [period, setPeriod] = useState(null);
  const [now] = useState(() => Date.now());
  const [busy, setBusy] = useState(null);
  const [flash, setFlash] = useState(null); // { ok, text }
  const [filter, setFilter] = useState('all');
  const [allRows, setAllRows] = useState(false);
  const wide = useWide();
  const creator = canAddTitles(role);

  const subs = useRoute('/api/creator/my-submissions');
  const shows = useRoute('/api/show?mine=1');
  const drafts = useRoute('/api/creator/drafts');
  const mine = useRoute('/api/payees/mine');
  const moneyRoute = useRoute(`/api/creator/money${period ? `?period=${encodeURIComponent(period)}` : ''}`);
  const numbersRoute = useRoute('/api/creator/analytics?days=30&compare=1');

  const submissions = subs.data && Array.isArray(subs.data.submissions) ? subs.data.submissions : null;
  const showList = shows.data && Array.isArray(shows.data.shows) ? shows.data.shows : null;
  const draftList = drafts.data && Array.isArray(drafts.data.drafts) ? drafts.data.drafts : null;
  const invites = mine.data && Array.isArray(mine.data.invites) ? mine.data.invites : null;
  const money = moneyRoute.data && moneyRoute.data.top ? moneyRoute.data : null;
  const numbers = numbersRoute.data && numbersRoute.data.totals ? numbersRoute.data : null;
  const shownPeriod = period || (money && money.period) || currentPeriod(now);

  const tiles = useMemo(() => dashboardTiles({ money, numbers, period: shownPeriod, now }), [money, numbers, shownPeriod, now]);
  const titles = useMemo(() => dashboardTitles({ submissions, shows: showList, drafts: draftList, numbers, money, now }), [submissions, showList, draftList, numbers, money, now]);
  const needs = useMemo(() => dashboardNeeds({ submissions, shows: showList, invites, money }), [submissions, showList, invites, money]);
  const moneyCard = useMemo(() => dashboardMoney(money, { period: shownPeriod, now }), [money, shownPeriod, now]);
  const months = useMemo(() => dashboardMonths(money), [money]);
  const views = useMemo(() => dashboardViews(numbers), [numbers]);
  const latest = useMemo(() => dashboardLatest({ money, submissions, now }), [money, submissions, now]);
  const pitch = useMemo(() => dashboardPitch(money), [money]);
  const link = useMemo(() => dashboardLink(money), [money]);
  const periods = useMemo(() => periodOptions(money, now), [money, now]);

  // A tile whose route answered "no" or failed shows a dash, not a
  // loading bar that never ends.
  const settled = { earned: moneyRoute.state !== 'loading', owed: moneyRoute.state !== 'loading', supporters: moneyRoute.state !== 'loading', views: numbersRoute.state !== 'loading' };
  const shownTiles = tiles.map((tile) => (tile.value == null && settled[tile.key] ? { ...tile, value: '—' } : tile));

  const reloadSubs = subs.reload;
  const reloadShows = shows.reload;
  const publish = useCallback(async (action) => {
    if (!window.confirm(DASH_WORDS.makePublicAsk(action.name))) return;
    setBusy(action.showId);
    setFlash(null);
    try {
      const res = await fetch(`/api/show/${encodeURIComponent(action.showId)}/public`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not make it public.');
      setFlash({ ok: true, text: `${action.name} is public. Its approved episodes are on the site; the next ones go live as they’re approved.` });
      reloadSubs();
      reloadShows();
    } catch (err) {
      setFlash({ ok: false, text: err.message });
    } finally {
      setBusy(null);
    }
  }, [reloadSubs, reloadShows]);

  const titlesLoading = subs.state === 'loading' || shows.state === 'loading';
  const who = name || (money && money.creator && money.creator.displayName) || null;

  return (
    <main id="main-content" className="dash">
      <div className="dash-head">
        <div className="dash-head-text">
          <div className="dash-kicker">{DASH_WORDS.kicker}{who ? ` · ${who}` : ''}</div>
          <h1 className="dash-h1">{DASH_WORDS.heading}</h1>
          <p className="dash-lede">{DASH_WORDS.lede}</p>
        </div>
        {creator && (
          <div className="dash-head-acts">
            <label className="dash-period">
              <span className="visually-hidden">Month</span>
              <select value={shownPeriod} onChange={(e) => setPeriod(e.target.value === currentPeriod(now) ? null : e.target.value)}>
                {(periods.some((p) => p.value === shownPeriod) ? periods : [{ value: shownPeriod, label: shownPeriod }, ...periods]).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </label>
            <Link href="/creator/show/new" className="apl-btn-secondary dash-head-btn">{DASH_WORDS.newShow}</Link>
            <Link href="/creator/submit" className="apl-btn dash-head-btn">+ {DASH_WORDS.submit}</Link>
          </div>
        )}
      </div>

      <DashboardTabs current="overview" isCreator={Boolean(role && role.isCreator)} isAdmin={Boolean(role && role.isAdmin)} canAccessAdmin={Boolean(role && role.canAccessAdmin)} />

      {flash && <div className={`dash-flash${flash.ok ? '' : ' bad'}`} role={flash.ok ? 'status' : 'alert'}>{flash.text}</div>}
      {!creator && <p className="dash-flash quiet" role="note">{DASH_WORDS.teamOnly}</p>}

      {(creator || moneyRoute.state === 'ok' || numbersRoute.state === 'ok') && <Tiles tiles={shownTiles} />}

      {(() => {
        const viewsCard = numbersRoute.state !== 'refused' ? (
          <section key="views" className="dash-card dash-views-card" aria-labelledby="dash-views-h">
            <div className="dash-card-head baseline">
              <h2 id="dash-views-h" className="dash-k">{DASH_WORDS.views}</h2>
              <Link href="/creator/analytics" className="dash-link">{DASH_WORDS.openNumbers} →</Link>
            </div>
            {!views ? (
              <p className="dash-empty">{numbersRoute.state === 'loading' ? 'Counting…' : 'The views couldn’t be loaded just now.'}</p>
            ) : !views.tracking ? (
              <p className="dash-empty">{DASH_WORDS.noTracking}</p>
            ) : views.empty ? (
              <p className="dash-empty">No views in the last 30 days yet.</p>
            ) : (
              <ViewsChart views={views} />
            )}
          </section>
        ) : null;
        if (!creator) return viewsCard ? <div className="dash-stack">{viewsCard}</div> : null;
        const needsCard = <Needs key="needs" needs={needs} loading={titlesLoading || mine.state === 'loading'} busy={busy} onPublish={publish} />;
        const titlesCard = <Titles key="titles" titles={titles} loading={titlesLoading} failed={subs.state === 'failed'} busy={busy} onPublish={publish} monthShort={monthShort(shownPeriod)} filter={filter} setFilter={setFilter} all={allRows} setAll={setAllRows} />;
        const moneyCardEl = <Money key="money" card={moneyCard} loading={moneyRoute.state === 'loading'} failed={moneyRoute.state === 'failed'} />;
        const monthsCard = months ? (
          <section key="months" className="dash-card dash-months-card" aria-labelledby="dash-months-h">
            <h2 id="dash-months-h" className="dash-k">{DASH_WORDS.months}</h2>
            {months.empty ? <p className="dash-empty">Nothing earned in these six months yet.</p> : <MonthBars months={months} />}
            {months.note && !months.empty && <p className="dash-fine">{months.note}</p>}
          </section>
        ) : null;
        const latestCard = <Latest key="latest" rows={latest} loading={moneyRoute.state === 'loading' && subs.state === 'loading'} />;
        const pitchCard = <Pitch key="pitch" pitch={pitch} />;
        const linkCard = <YourLink key="link" link={link} />;
        return wide ? (
          <div className="dash-cols">
            <div className="dash-col">{titlesCard}{viewsCard}{latestCard}</div>
            <div className="dash-col">{needsCard}{moneyCardEl}{monthsCard}{pitchCard}{linkCard}</div>
          </div>
        ) : (
          <div className="dash-stack">{needsCard}{titlesCard}{moneyCardEl}{viewsCard}{monthsCard}{latestCard}{pitchCard}{linkCard}</div>
        );
      })()}
    </main>
  );
}
