import { useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { getAccountContext } from '../../../lib/accountContext';
import { getPublicEpisodes } from '../../../lib/publicEpisodes';
import HeaderNav from '../../../components/HeaderNav';
import Footer from '../../../components/Footer';
import MobileTabBar from '../../../components/MobileTabBar';
import { BackArrowIcon } from '../../../components/PlayerIcons';
import NewLinkDialog, { Face } from '../../../components/creator/screenings/NewLinkDialog';
import {
  CloseButton, ConfirmSheet, CopyButton, RouteNote, Sheet, StatePill,
  callScreenings, errorLine, freshPassword, passwordProblem, useScreeningRoute, webText
} from '../../../components/creator/screenings/ScreeningBits';
import {
  SCREENING, SCREENING_WORDS, agoLabel, inviteText, linkDashboard, positionLabel, screeningHref,
  screeningText, targetTabHref
} from '../../../lib/screeningRules';
import { SITE } from '../../../lib/siteConfig';

// A screening link's own page (/creator/screenings/<id>; migration 128,
// 2026-11-21; the canvas's LinkDashboard and Ended boards,
// mockups/private-screenings-contract.md): the back pill to the title's or
// the show's Private screenings tab, the link's state, Copy link / Copy
// password / Copy the invite, when it works as a timeline (white dots:
// opens, red: turned away), four numbers, who watched, what was turned
// away, its settings (Edit settings, New password, Move the end), where it
// was opened, and End it now…; an ended link offers Run it again and
// Discard… instead. It reads GET /api/screenings/<id> and
// lib/screeningRules.js linkDashboard turns it into every line. Someone
// may be watching, so it reads the link again every 30 seconds while the
// page is in view.
//
// Who gets in is who gets into a title's dashboard (a creator or an
// admin); the route says whether this link is theirs.
export async function getServerSideProps({ req, res, params }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  if (!account.isCreator && !account.isAdmin) {
    return { redirect: { destination: '/stream', permanent: false } };
  }
  const id = typeof params.id === 'string' ? params.id : '';
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return { notFound: true };
  const episodes = await getPublicEpisodes();
  return {
    props: {
      id,
      isSignedIn: Boolean(account.isSignedIn),
      isSubscriber: Boolean(account.isSubscriber),
      email: account.email ?? null,
      isAdmin: Boolean(account.isAdmin),
      isCreator: Boolean(account.isCreator),
      mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))]
    }
  };
}

const REFRESH_MS = 30000;

export default function ScreeningLinkPage({ id, isSignedIn, isSubscriber, email, isAdmin, isCreator, mainGenres }) {
  return (
    <>
      <HeaderNav activeType="All" mainGenres={mainGenres} isSignedIn={isSignedIn} email={email} isAdmin={isAdmin} isCreator={isCreator} isSubscriber={isSubscriber} />
      <LinkPage key={id} id={id} />
      <Footer />
      <MobileTabBar />
    </>
  );
}

function LinkPage({ id }) {
  const router = useRouter();
  const route = useScreeningRoute(`/api/screenings/${encodeURIComponent(id)}`);
  const reload = route.reload;
  const [now, setNow] = useState(() => Date.now());
  const [box, setBox] = useState(null); // 'edit' | 'window' | 'again' | 'password' | 'end' | 'discard'
  const [withPw, setWithPw] = useState(false);

  useEffect(() => { setNow(Date.now()); }, [route.data]);

  // Read it again every 30 s while the page is in view, and at once when
  // it comes back into view.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') reload(); };
    const timer = setInterval(tick, REFRESH_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [reload]);

  const data = route.state === 'ok' && route.data && route.data.link ? route.data : null;
  const link = data ? data.link : null;
  const target = data ? data.target || { type: link.target && link.target.type, id: link.target && link.target.id, title: '' } : null;
  const views = data && Array.isArray(data.views) ? data.views : [];
  const refusals = data && Array.isArray(data.refusals) ? data.refusals : [];
  const dash = useMemo(() => (link ? linkDashboard({ link, target, views, refusals, now }) : null), [link, target, views, refusals, now]);

  const backHref = link ? targetTabHref(link.target) : '/creator/my-work';
  const backLabel = target && target.title ? `${target.title} · ${SCREENING_WORDS.tab}` : SCREENING_WORDS.tab;

  if (!dash) {
    return (
      <main id="main-content" className="scn-page">
        <Head><title>{`${SCREENING_WORDS.tab} — ${SITE.name}`}</title><meta name="robots" content="noindex" /></Head>
        <Link href={backHref} className="acct-back td-back"><BackArrowIcon size={14} /> {backLabel}</Link>
        <RouteNote state={route.state} onRetry={reload} />
      </main>
    );
  }

  const ended = dash.state.key === 'ended';
  const a = dash.actions;
  const invite = inviteText({ title: target.title, ownerName: target.ownerName, url: link.url, startsAt: link.startsAt, endsAt: link.endsAt, password: link.password, includePassword: withPw });
  const knownPeople = dash.people.filter((p) => p.userId).map((p) => ({ userId: p.userId, name: p.name, handle: p.handle }));

  async function end() {
    const r = await callScreenings(`/api/screenings/${encodeURIComponent(link.id)}`, { method: 'PATCH', body: { action: 'end' } });
    if (!r.ok) return errorLine(r);
    setBox(null);
    reload();
    return null;
  }
  async function discard() {
    const r = await callScreenings(`/api/screenings/${encodeURIComponent(link.id)}`, { method: 'DELETE' });
    if (!r.ok) return errorLine(r);
    setBox(null);
    router.replace(targetTabHref(link.target));
    return null;
  }

  return (
    <main id="main-content" className="scn-page">
      <Head>
        <title>{`${link.label} — ${SCREENING_WORDS.tab} — ${SITE.name}`}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <Link href={backHref} className="acct-back td-back"><BackArrowIcon size={14} /> {backLabel}</Link>

      <header className="scn-page-head">
        <div className="scn-page-head-text">
          <div className="scn-pills">
            <StatePill state={dash.state} />
            {dash.watchingLine && <span className="scn-pill tone-brass"><span aria-hidden="true">●</span>{dash.watchingLine}</span>}
          </div>
          <h1 className="scn-h1">{dash.label}</h1>
          <p className="scn-sub">{dash.sub}</p>
        </div>
        <div className="scn-page-acts">
          {a.copy && <CopyButton className="scn-btn" text={link.url} label={SCREENING_WORDS.copyLink} />}
          {a.copy && link.password && <CopyButton className="scn-btn" text={link.password} label={SCREENING_WORDS.copyPassword} />}
          {a.copy && <CopyButton className="scn-btn primary" text={invite} label={SCREENING_WORDS.copyInvite} />}
          {a.runAgain && <button type="button" className="scn-btn primary" onClick={() => setBox('again')}>{SCREENING_WORDS.runAgain}</button>}
          {a.discard && <button type="button" className="scn-btn danger" onClick={() => setBox('discard')}>{SCREENING_WORDS.discard}</button>}
        </div>
        {a.copy && link.password && (
          <label className="scn-check scn-page-check">
            <input type="checkbox" checked={withPw} onChange={(e) => setWithPw(e.target.checked)} />
            <span>{SCREENING_WORDS.includePassword}</span>
          </label>
        )}
      </header>

      {ended && <p className="scn-hint scn-ended-note">{SCREENING_WORDS.endedLine}</p>}

      <section className="scn-panel" aria-labelledby="scn-when-h">
        <div className="scn-panel-head">
          <h2 id="scn-when-h" className="scn-panel-h">{SCREENING_WORDS.whenItWorks}</h2>
          <span className="scn-k on">{dash.timeline.leftLabel}</span>
        </div>
        <Timeline timeline={dash.timeline} live={!ended} />
        <span className="scn-k">{SCREENING_WORDS.timelineKey}</span>
      </section>

      <div className="scn-tiles">
        {dash.tiles.map((tile) => (
          <div key={tile.key} className="scn-tile">
            <span className="scn-tile-k">{tile.label}</span>
            <b className="scn-tile-v">{tile.value}{tile.of ? <small> {tile.of}</small> : null}</b>
            {tile.sub ? <span className="scn-tile-sub">{tile.sub}</span> : null}
          </div>
        ))}
      </div>

      <div className="scn-cols">
        <div className="scn-col">
          <WhoWatched people={dash.people} perPerson={link.perPerson} now={now} />
          {dash.refusals.length > 0 && <TurnedAway rows={dash.refusals} />}
        </div>
        <div className="scn-col side">
          <section className="scn-panel" aria-labelledby="scn-set-h">
            <h2 id="scn-set-h" className="scn-panel-h">{SCREENING_WORDS.settings}</h2>
            <dl className="scn-set">
              {dash.settings.map((row) => (
                <div key={row.key} className="scn-set-row">
                  <dt className="scn-k">{row.label}</dt>
                  <dd className={row.mono ? 'scn-mono' : undefined}>{row.value}</dd>
                </div>
              ))}
            </dl>
            {(a.edit || a.newPassword) && (
              <>
                <div className="scn-card-acts">
                  {a.edit && <button type="button" className="scn-btn sm" onClick={() => setBox('edit')}>{SCREENING_WORDS.editSettings}</button>}
                  {a.newPassword && <button type="button" className="scn-btn sm" onClick={() => setBox('password')}>{SCREENING_WORDS.newPassword}</button>}
                  {a.edit && <button type="button" className="scn-btn sm" onClick={() => setBox('window')}>{webText('moveEnd')}</button>}
                </div>
                <p className="scn-hint">{SCREENING_WORDS.newPasswordLine}</p>
              </>
            )}
          </section>

          {dash.places.length > 0 && (
            <section className="scn-panel" aria-labelledby="scn-where-h">
              <h2 id="scn-where-h" className="scn-panel-h">{SCREENING_WORDS.whereOpened}</h2>
              <ul className="scn-places">
                {dash.places.map((p) => (
                  <li key={p.place} className={p.turnedAway ? 'away' : undefined}>
                    <span>{p.place}{p.turnedAway ? ` · ${webText('turnedAwayHere')}` : ''}</span>
                    <span className="scn-k">{p.line}</span>
                  </li>
                ))}
              </ul>
              <p className="scn-hint">{SCREENING_WORDS.placeNote}</p>
            </section>
          )}

          {a.end && (
            <section className="scn-panel danger" aria-labelledby="scn-end-h">
              <h2 id="scn-end-h" className="scn-panel-h">{SCREENING_WORDS.endYes}</h2>
              <p className="scn-hint">{SCREENING_WORDS.endLine}</p>
              <button type="button" className="scn-btn sm danger scn-self-start" onClick={() => setBox('end')}>{SCREENING_WORDS.endNow}</button>
            </section>
          )}
          <p className="scn-hint scn-refresh">{webText('refreshNote')}</p>
        </div>
      </div>

      {(box === 'edit' || box === 'window' || box === 'again') && (
        <NewLinkDialog
          mode={box}
          target={target}
          link={link}
          knownPeople={knownPeople}
          onSaved={() => { if (box !== 'again') reload(); }}
          onClose={(made) => {
            setBox(null);
            if (box === 'again' && made && made.id) router.push(screeningHref(made.id));
          }}
        />
      )}
      {box === 'password' && <PasswordSheet link={link} onClose={() => setBox(null)} onSaved={() => { setBox(null); reload(); }} />}
      {box === 'end' && (
        <ConfirmSheet
          id="scn-endask"
          title={screeningText('endAsk', { label: link.label })}
          line={SCREENING_WORDS.endLine}
          yes={SCREENING_WORDS.endYes}
          no={SCREENING_WORDS.cancel}
          onYes={end}
          onClose={() => setBox(null)}
        />
      )}
      {box === 'discard' && (
        <ConfirmSheet
          id="scn-discard"
          title={screeningText('discardAsk', { label: link.label })}
          line={SCREENING_WORDS.discardLine}
          yes={SCREENING_WORDS.discardYes}
          no={SCREENING_WORDS.keep}
          onYes={discard}
          onClose={() => setBox(null)}
        />
      )}
    </main>
  );
}

// The window as a line: the part gone by in orange, a NOW mark, a white
// dot per open and a red one per try turned away. Drawn at the width it
// has (so the dots stay round and the labels readable on a phone).
function Timeline({ timeline, live }) {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setW(Math.floor(el.clientWidth));
    if (typeof ResizeObserver !== 'function') return undefined;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0] && entries[0].contentRect;
      if (box) setW(Math.floor(box.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 52;
  const pad = 8;
  const span = Math.max(1, w - pad * 2);
  const x = (f) => pad + Math.max(0, Math.min(1, f)) * span;
  const progress = Math.max(0, Math.min(1, timeline.progress || 0));
  const nowX = x(progress);
  const nowText = webText('nowMark');
  const textX = Math.max(pad + 14, Math.min(w - pad - 14, nowX));
  const label = `${SCREENING_WORDS.whenItWorks}: ${timeline.startLabel} → ${timeline.endLabel}. ${timeline.leftLabel}.`;
  return (
    <div className="scn-timeline">
      <div className="scn-tl-ends scn-k" aria-hidden="true"><span>{timeline.startLabel}</span><span>{timeline.endLabel}</span></div>
      <div ref={ref} className="scn-tl-draw">
        {w > 0 && (
          <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img" aria-label={label}>
            <rect x={pad} y={14} width={span} height={10} rx={5} className="scn-tl-track" />
            {progress > 0 && <rect x={pad} y={14} width={Math.max(10, progress * span)} height={10} rx={5} className="scn-tl-fill" />}
            {timeline.opens.map((f, i) => <circle key={`o${i}`} cx={x(f)} cy={19} r={5} className="scn-tl-open" />)}
            {timeline.refused.map((f, i) => <circle key={`r${i}`} cx={x(f)} cy={19} r={5} className="scn-tl-refused" />)}
            {live && (
              <>
                <line x1={nowX} x2={nowX} y1={4} y2={34} className="scn-tl-now" />
                <text x={textX} y={48} textAnchor="middle" className="scn-tl-now-text">{nowText}</text>
              </>
            )}
          </svg>
        )}
      </div>
    </div>
  );
}

function barTone(p) {
  if (p.watchingNow) return 'brass';
  if (p.percent >= 100 || /^all of it/.test(p.watchedLine)) return 'mint';
  return 'olive';
}

// Who watched: one row per person, newest first.
function WhoWatched({ people, perPerson, now }) {
  return (
    <section className="scn-panel flush" aria-labelledby="scn-who-h">
      <div className="scn-panel-head pad">
        <h2 id="scn-who-h" className="scn-panel-h">{SCREENING_WORDS.whoWatched}</h2>
        <span className="scn-k">{SCREENING_WORDS.newestFirst}</span>
      </div>
      {people.length === 0 ? (
        <p className="scn-hint pad">{SCREENING_WORDS.nobodyYet}</p>
      ) : (
        <div className="scn-table" role="table" aria-labelledby="scn-who-h">
          <div className="scn-tr head" role="row">
            <span className="scn-k" role="columnheader">{webText('colPerson')}</span>
            <span className="scn-k" role="columnheader">{webText('colWhere')}</span>
            <span className="scn-k" role="columnheader">{webText('colOpened')}</span>
            <span className="scn-k" role="columnheader">{webText('colWatched')}</span>
          </div>
          {people.map((p) => {
            const opens = perPerson ? webText('opensOf', { opens: p.opens, per: perPerson }) : p.opens === 1 ? webText('openOne') : webText('openMany', { n: p.opens });
            return (
              <div key={p.key} className="scn-tr" role="row">
                <div className="c-person" role="cell">
                  <Face person={p} className={p.guest ? 'guest' : ''} />
                  <div className="scn-cell-text">
                    <b>{p.name}</b>
                    <span className="scn-cell-sub">{p.guest ? webText('notSignedIn') : p.handle ? `@${p.handle} · ${webText('signedIn')}` : webText('signedIn')}</span>
                  </div>
                </div>
                <div className="c-where" role="cell">
                  <span>{p.placeLine}</span>
                  {p.twoCities
                    ? <span className="scn-cell-sub warn"><span aria-hidden="true">⚠ </span>{p.twoCitiesLine}</span>
                    : p.device ? <span className="scn-cell-sub">{p.device}</span> : null}
                </div>
                <div className="c-opened" role="cell">
                  <span>{agoLabel(p.lastAt, now)}</span>
                  <span className={`scn-cell-sub${p.maxedOut ? ' warn' : ''}`}>{opens}{p.maxedOut ? ` · ${webText('noneLeft')}` : ''}</span>
                </div>
                <div className="c-watched" role="cell">
                  {p.watchingNow
                    ? <span className="scn-watching"><span aria-hidden="true">● </span>{webText('watching')} · {positionLabel(p.position)}</span>
                    : <span>{p.watchedLine}</span>}
                  <div className="scn-wb" aria-hidden="true"><span className={`tone-${barTone(p)}`} style={{ width: `${Math.max(0, Math.min(100, p.percent))}%` }} /></div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// Turned away: tries the link stopped (nothing played).
function TurnedAway({ rows }) {
  return (
    <section className="scn-panel flush" aria-labelledby="scn-away-h">
      <div className="scn-panel-head pad col">
        <h2 id="scn-away-h" className="scn-panel-h">{SCREENING_WORDS.turnedAway} · {rows.length}</h2>
        <p className="scn-hint">{SCREENING_WORDS.turnedAwayLine}</p>
      </div>
      <div className="scn-table" role="table" aria-labelledby="scn-away-h">
        {rows.map((r) => (
          <div key={`${r.key}|${r.at}`} className="scn-tr" role="row">
            <div className="c-person" role="cell">
              <div className="scn-cell-text"><b>{r.what}</b><span className="scn-cell-sub">{r.who}</span></div>
            </div>
            <div className="c-where" role="cell">
              <span>{r.place}</span>
              {r.device && <span className="scn-cell-sub">{r.device}</span>}
            </div>
            <div className="c-opened" role="cell"><span>{r.when}</span></div>
            <div className={`c-watched${r.reason === 'locked' || (r.reason === 'password' && r.count >= SCREENING.wrongTriesLock) ? ' warn' : ' dim'}`} role="cell"><span>{r.outcome}</span></div>
          </div>
        ))}
      </div>
    </section>
  );
}

// New password: a suggestion to take or a password typed by hand, then
// PATCH { action: 'password', password }.
function PasswordSheet({ link, onClose, onSaved }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(true);
  const [error, setError] = useState(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  async function suggest() {
    setAsking(true);
    const pw = await freshPassword();
    if (!alive.current) return;
    setAsking(false);
    if (pw) {
      setPassword(pw);
      setError(null);
    }
  }
  useEffect(() => { suggest(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function save(e) {
    e.preventDefault();
    if (busy) return;
    const problem = passwordProblem(password.trim());
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    const r = await callScreenings(`/api/screenings/${encodeURIComponent(link.id)}`, { method: 'PATCH', body: { action: 'password', password: password.trim() } });
    if (!alive.current) return;
    setBusy(false);
    if (!r.ok) {
      setError(errorLine(r));
      return;
    }
    onSaved(r.data && r.data.link);
  }
  const close = () => { if (!busy) onClose(); };
  return (
    <Sheet labelledBy="scn-pw-h" onClose={close} className="small">
      <div className="scn-sheet-head">
        <div className="scn-sheet-head-text">
          <span className="scn-k">{link.label}</span>
          <h2 id="scn-pw-h" className="scn-sheet-title" tabIndex={-1} data-autofocus>{SCREENING_WORDS.newPassword}</h2>
        </div>
        <CloseButton onClick={close} disabled={busy} />
      </div>
      <form className="scn-form" onSubmit={save} noValidate>
        <div className="scn-sheet-body">
          <div className="scn-confirm">
            <label htmlFor="scn-pw-new" className="scn-lbl">{webText('passwordHead')}</label>
            <div className="scn-inline">
              <input
                id="scn-pw-new"
                className="scn-field mono"
                type="text"
                value={password}
                maxLength={SCREENING.passwordMax}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => { setPassword(e.target.value); setError(null); }}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'scn-pw-e' : 'scn-pw-hint'}
              />
              <button type="button" className="scn-btn" onClick={suggest} disabled={asking}>{webText('newOne')}</button>
            </div>
            {error && <p id="scn-pw-e" className="scn-field-error" role="alert">{error}</p>}
            <p id="scn-pw-hint" className="scn-hint">{SCREENING_WORDS.newPasswordLine}</p>
          </div>
        </div>
        <div className="scn-sheet-foot">
          <button type="button" className="scn-btn" onClick={close} disabled={busy}>{SCREENING_WORDS.cancel}</button>
          <button type="submit" className="scn-btn primary" disabled={busy || !password.trim()} aria-busy={busy || undefined}>{webText('setPassword')}</button>
        </div>
      </form>
    </Sheet>
  );
}
