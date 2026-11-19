import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import DayForm from './DayForm';
import AddMember from './AddMember';
import { DASH_TABS, DASH_WORDS, OVERVIEW_ROWS, OVERVIEW_PEOPLE, TOLD_STATES, dashHref, dashTab, groupsUpTo, productionDashboard, removeQuestion, startedFlash } from '../../lib/productionDashRules';

// The production dashboard (2026-11-19; the DashPhone and DashLaptop boards
// on https://claude.ai/artifact/Kx7ZjgzAsG4xBxYBws2QKN). Everything it
// says comes from lib/productionDashRules.js productionDashboard(facts);
// this file lays it out and makes the writes the production page already
// makes (the status, the crew list, the call sheet's days), then reads the
// dashboard again. Styles: the .pd-* block in styles/globals.css.

const svg = (children, size = 20) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const ACTION_ICONS = {
  call: <path d="M12 5v14M5 12h14" />,
  day: <><rect x="4" y="5" width="16" height="15" rx="1.5" /><path d="M4 10h16M9 3v4M15 3v4" /></>,
  place: <><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.4" /></>,
  message: <><path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v8a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V16h0A1.5 1.5 0 0 1 4 14.5z" /></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></>
};

function Section({ id, title, add, children, className = '' }) {
  return (
    <section className={`pd-card pd-sec-${id} ${className}`} aria-labelledby={`pd-h-${id}`}>
      <div className="pd-card-head">
        <h2 id={`pd-h-${id}`} className="pd-card-title">{title}</h2>
        {add}
      </div>
      {children}
    </section>
  );
}

function SeeAll({ id, total, shown, onTab }) {
  if (total <= shown) return null;
  return <button type="button" className="pd-see-all" onClick={() => onTab(id)}>{DASH_WORDS.seeAll} {total} ›</button>;
}

export default function ProductionDashboard({ initialFacts, initialTab = 'overview', bookedPlaces = [] }) {
  const router = useRouter();
  const [facts, setFacts] = useState(initialFacts);
  const [tab, setTab] = useState(dashTab(initialTab));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);
  const [adding, setAdding] = useState(false);
  const [addingDay, setAddingDay] = useState(false);
  const view = useMemo(() => productionDashboard(facts), [facts]);
  const id = facts.production.id;

  useEffect(() => { setFacts(initialFacts); }, [initialFacts]);

  // The line after the start sheet, once; the tab from the address; the
  // add-a-day form when the address asks for it.
  useEffect(() => {
    if (!router.isReady) return;
    const q = router.query;
    if (q.started === '1') {
      setFlash(startedFlash(TOLD_STATES.includes(q.told) ? q.told : 'off'));
      router.replace(dashHref(id, dashTab(q.tab)), undefined, { shallow: true, scroll: false });
    }
    if (typeof window !== 'undefined' && window.location.hash === '#add-day') setAddingDay(true);
  }, [router.isReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`/api/productions/${id}/dashboard`, { headers: { Accept: 'application/json' } });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.facts) setFacts(data.facts);
      else if (data.code === 'not-manager' && data.productionHref) router.replace(data.productionHref);
    } catch (err) { /* keep what we have */ }
  }, [id, router]);

  // The production page's writes: the JSON, or null after saying why.
  const api = useCallback(async (url, body, method = 'POST') => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || DASH_WORDS.saveFailed);
      await reload();
      return json;
    } catch (err) {
      setError(err.message || DASH_WORDS.saveFailed);
      return null;
    } finally {
      setBusy(false);
    }
  }, [reload]);

  function go(next) {
    const t = dashTab(next);
    setTab(t);
    router.replace(dashHref(id, t), undefined, { shallow: true, scroll: false });
  }
  function onTabKey(e) {
    const ids = DASH_TABS.map((t) => t.id);
    const i = ids.indexOf(tab);
    let n = null;
    if (e.key === 'ArrowRight') n = ids[(i + 1) % ids.length];
    else if (e.key === 'ArrowLeft') n = ids[(i - 1 + ids.length) % ids.length];
    else if (e.key === 'Home') n = ids[0];
    else if (e.key === 'End') n = ids[ids.length - 1];
    if (!n) return;
    e.preventDefault();
    go(n);
    const el = document.getElementById(`pd-tab-${n}`);
    if (el) el.focus();
  }

  const { head, actions, tiles, needs, funding, calls, crew, days, places, money, release, crewView } = view;
  const overview = tab === 'overview';
  const limit = (rows) => (overview ? rows.slice(0, OVERVIEW_ROWS) : rows);

  const needsCard = (
    <section className="pd-card pd-needs pd-sec-needs" aria-labelledby="pd-h-needs">
      <h2 id="pd-h-needs" className="pd-needs-title">{needs.title}</h2>
      {needs.empty && <p className="pd-muted">{needs.empty}</p>}
      {needs.items.map((n) => (
        <div key={n.id} className="pd-need">
          <span className="pd-need-text">{n.text}{n.strong && <b>{n.strong}</b>}</span>
          <Link href={n.link.href} className="pd-need-link"><span className="pd-long">{n.link.label}</span><span className="pd-short">{n.link.short}</span>{'\u00a0›'}</Link>
        </div>
      ))}
    </section>
  );

  const fundingBody = (f, { full = false } = {}) => (f.none ? (
    <p className="pd-muted">{f.line}</p>
  ) : (
    <>
      {f.percent != null && <div className="pd-bar" aria-hidden="true"><span style={{ width: `${f.percent}%` }} /></div>}
      <p className="pd-line">{f.line}</p>
      {f.latest && <p className="pd-line pd-faint">{f.latest}</p>}
      <div className="pd-row-buttons">
        {f.canPost && (full
          ? null
          : <button type="button" className="pd-btn" onClick={() => go('money')}><span className="pd-long">{f.post.long}</span><span className="pd-short">{f.post.label}</span></button>)}
        <Link href={f.pitchLink.href} className="pd-btn">{f.pitchLink.label}</Link>
      </div>
      {full && f.canPost && <UpdateForm pitchId={facts.pitch.id} onPosted={() => { setFlash(DASH_WORDS.updatePosted); reload(); }} />}
    </>
  ));

  const fundingCard = (
    <Section id="funding" title={funding.title} add={funding.none ? null : <span className={`pd-state ${funding.open ? 'ok' : 'dim'}`}>{funding.state}</span>}>
      {fundingBody(funding)}
    </Section>
  );

  const callsCard = (
    <Section id="calls" title={calls.title} add={<Link href={calls.add.href} className="pd-add">{calls.add.label}</Link>}>
      {calls.empty && <p className="pd-muted">{calls.empty}</p>}
      {limit(calls.rows).map((c) => (
        <Link key={c.id} href={c.href} className="pd-row pd-call">
          <span className="pd-row-main"><b>{c.strong}</b>{c.line ? ` · ${c.line}` : ''}</span>
          <span className={`pd-tone-${c.answers.tone}`}>{c.answers.text}</span>
          <span className="pd-faint pd-closes">{c.closes}</span>
        </Link>
      ))}
      {overview && <SeeAll id="calls" total={calls.rows.length} shown={OVERVIEW_ROWS} onTab={go} />}
    </Section>
  );

  const peopleCount = crew.groups.reduce((n, g) => n + g.people.length, 0);
  const crewCard = (
    <Section id="crew" title={crew.title} add={<button type="button" className="pd-add" onClick={() => { if (overview) go('crew'); setAdding(true); }}>{crew.add.label}</button>}>
      {crew.empty && <p className="pd-muted">{crew.empty}</p>}
      {(overview ? groupsUpTo(crew.groups, OVERVIEW_PEOPLE) : crew.groups).map((g) => (
        <div key={g.name} className="pd-dept">
          <span className="pd-dept-name">{g.name}</span>
          <div className="pd-dept-people">
            {g.people.map((p) => (
              <div key={p.id} className="pd-person">
                <span className="pd-person-name">{p.profilePath ? <Link href={p.profilePath}>{p.label}</Link> : p.label}</span>
                <span className={`pd-tone-${p.state.tone}`}>{p.state.text}</span>
                {!overview && (
                  <span className="pd-person-acts">
                    {p.actions.message && <Link href={p.actions.message} className="pd-btn sm">{DASH_WORDS.message}</Link>}
                    {p.actions.worked && <button type="button" className="pd-btn sm primary" disabled={busy} onClick={() => api(`/api/productions/${id}/members`, { memberId: p.id, worked: true }, 'PATCH')}>{DASH_WORDS.workedIt}</button>}
                    {p.actions.remove && <button type="button" className="pd-btn sm ghost" disabled={busy} onClick={() => { if (window.confirm(removeQuestion(p.name))) api(`/api/productions/${id}/members`, { memberId: p.id }, 'DELETE'); }}>{DASH_WORDS.remove}</button>}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
      {overview && <SeeAll id="crew" total={peopleCount} shown={OVERVIEW_PEOPLE} onTab={go} />}
      {!overview && peopleCount > 0 && crew.hint && <p className="pd-faint">{crew.hint}</p>}
      {!overview && adding && <div id="add-crew" className="pd-add-form"><AddMember productionId={id} busy={busy} api={api} startOpen onDone={() => setAdding(false)} /></div>}
    </Section>
  );

  const daysCard = (
    <Section id="days" title={days.title} add={<button type="button" className="pd-add" onClick={() => { if (overview) go('days'); setAddingDay(true); }}>{days.add.label}</button>}>
      {days.empty && <p className="pd-muted">{days.empty}</p>}
      {limit(days.rows).map((d) => (
        <Link key={d.id} href={d.href} className={`pd-row pd-day${d.past ? ' past' : ''}`}>
          <span className="pd-row-main"><b>{d.label}</b>{d.when ? ` · ${d.when}` : ''}</span>
          <span className={`pd-tone-${d.place.tone}`}>{d.place.text}</span>
          {!overview && <span className="pd-faint">{DASH_WORDS.callSheet} ›</span>}
        </Link>
      ))}
      {overview && <SeeAll id="days" total={days.rows.length} shown={OVERVIEW_ROWS} onTab={go} />}
      {!overview && addingDay && (
        <div id="add-day" className="pd-add-form">
          <DayForm productionId={id} busy={busy} api={api} bookedPlaces={bookedPlaces} defaultDate={days.rows.length ? null : facts.production.startsOn} onDone={() => setAddingDay(false)} onCancel={() => setAddingDay(false)} />
        </div>
      )}
    </Section>
  );

  const placesCard = (
    <Section id="places" title={places.title} add={<Link href={places.add.href} className="pd-add">{places.add.label} ›</Link>}>
      {places.empty && <p className="pd-muted">{places.empty}</p>}
      {limit(places.rows).map((r) => (
        <Link key={r.id} href={r.href} className="pd-row pd-place">
          <span className="pd-row-main"><b>{r.title}</b>{r.when ? ` · ${r.when}` : ''}</span>
          <span className={`pd-tone-${r.state.tone}`}>{r.state.text}</span>
        </Link>
      ))}
      {overview && <SeeAll id="money" total={places.rows.length} shown={OVERVIEW_ROWS} onTab={go} />}
    </Section>
  );

  const releaseCard = (
    <Section id="release" title={release.title}>
      <p className="pd-line">{release.line}</p>
      {release.releaseLink && <p className="pd-line"><Link href={release.releaseLink.href}>{release.releaseLink.label} ›</Link></p>}
      {release.button && <Link href={release.button.href} className="pd-btn wide">{release.button.label}</Link>}
      {release.note && <p className="pd-faint">{release.note}</p>}
    </Section>
  );

  return (
    <div className="pd">
      <Link href={head.back.href} className="pd-back">‹ {head.back.label}</Link>
      <div className="pd-head">
        <div className="pd-head-main">
          <span className="pd-kicker">{head.kicker}</span>
          <h1 className="pd-title">{head.title}</h1>
          <div className="pd-meta">
            <label className={`pd-status s-${head.status.tone}`}>
              <span className="pd-sr">{DASH_WORDS.status}</span>
              <select value={head.status.value} disabled={busy || head.status.locked} onChange={(e) => api(`/api/productions/${id}`, { status: e.target.value }, 'PATCH')}>
                {head.status.options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
              </select>
              <span aria-hidden="true" className="pd-status-caret">▾</span>
            </label>
            {(head.meta.length > 0 || head.grewOut) && (
              <span className="pd-meta-text">
                {head.meta.join(' · ')}
                {head.grewOut && <span className="pd-grew">{head.meta.length ? ' · ' : ''}{head.grewOut.lead} <Link href={head.grewOut.href}>{head.grewOut.title}</Link></span>}
              </span>
            )}
          </div>
        </div>
        <div className="pd-actions">
          {actions.map((a) => (
            <Link key={a.id} href={a.href} className={`pd-action${a.primary ? ' primary' : ''}${a.quiet ? ' quiet' : ''}`} data-action={a.id}
              onClick={(e) => {
                if (a.tab) {
                  e.preventDefault();
                  go(a.tab);
                  if (a.id === 'day') setAddingDay(true);
                }
              }}>
              <span className="pd-action-icon">{svg(ACTION_ICONS[a.id] || ACTION_ICONS.edit, a.id === 'call' ? 22 : 19)}</span>
              <span className="pd-action-label">{a.label}</span>
            </Link>
          ))}
        </div>
      </div>

      <div className="pd-tabs" role="tablist" aria-label={DASH_WORDS.tabs} onKeyDown={onTabKey}>
        {DASH_TABS.map((t) => (
          <button key={t.id} id={`pd-tab-${t.id}`} type="button" role="tab" aria-selected={tab === t.id} tabIndex={tab === t.id ? 0 : -1} aria-controls="pd-panel" className={`pd-tab${tab === t.id ? ' on' : ''}`} onClick={() => go(t.id)}>
            <span className="pd-long">{t.label}</span><span className="pd-short">{t.short}</span>
          </button>
        ))}
      </div>

      {flash && <div className="pd-flash" role="status">{flash}</div>}
      {error && <div className="pd-error" role="alert">{error}</div>}

      <div id="pd-panel" role="tabpanel" aria-labelledby={`pd-tab-${tab}`} className={`pd-panel pd-panel-${tab}`}>
        {overview && (
          <>
            <div className="pd-tiles">
              {tiles.map((t) => (
                <div key={t.id} className="pd-tile" data-tile={t.id}>
                  <span className="pd-tile-label">{t.label}</span>
                  <b className="pd-tile-value">{t.value}</b>
                  <span className="pd-tile-sub">{t.subLong ? <><span className="pd-long">{t.subLong}</span><span className="pd-short">{t.sub}</span></> : t.sub}</span>
                </div>
              ))}
            </div>
            <div className="pd-grid">
              <div className="pd-col">
                {needsCard}
                {callsCard}
                {crewCard}
              </div>
              <div className="pd-col">
                {fundingCard}
                {daysCard}
                {placesCard}
                {releaseCard}
              </div>
            </div>
            <Link href={crewView.href} className="pd-crewview">{crewView.label} ›</Link>
          </>
        )}
        {tab === 'crew' && crewCard}
        {tab === 'calls' && callsCard}
        {tab === 'days' && daysCard}
        {tab === 'money' && (
          <div className="pd-stack">
            <Section id="funding" title={money.funding.title} add={money.funding.none ? null : <span className={`pd-state ${money.funding.open ? 'ok' : 'dim'}`}>{money.funding.state}</span>}>
              {fundingBody(money.funding, { full: true })}
            </Section>
            <Section id="crewpay" title={money.crewPay.title}>
              {money.crewPay.empty && <p className="pd-muted">{money.crewPay.empty}</p>}
              {money.crewPay.lines.map((l) => <p key={l.id} className={`pd-line pd-tone-${l.tone}`}>{l.text}</p>)}
            </Section>
            <Section id="placesmoney" title={money.places.title}>
              <p className="pd-line">{money.places.line}</p>
            </Section>
            {placesCard}
          </div>
        )}
        {tab === 'release' && releaseCard}
      </div>
    </div>
  );
}

// "Post an update" to the pitch's backers and followers (the pitch's own
// route, its three-a-day limit).
function UpdateForm({ pitchId, onPosted }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/creator/pitch-update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pitchId, title, body, alsoBackers: true }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || DASH_WORDS.saveFailed);
      setTitle('');
      setBody('');
      onPosted();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form id="update" className="pd-update" onSubmit={submit}>
      <label className="pd-field"><span>{DASH_WORDS.updateTitle}</span><input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} required /></label>
      <label className="pd-field"><span>{DASH_WORDS.updateBody}</span><textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} required /></label>
      {error && <div className="pd-error" role="alert">{error}</div>}
      <button type="submit" className="pd-btn primary" disabled={busy || !title.trim() || !body.trim()}>{busy ? DASH_WORDS.updatePosting : DASH_WORDS.updatePost}</button>
    </form>
  );
}
