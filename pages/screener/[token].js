import Head from 'next/head';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import VideoPlayer from '../../components/VideoPlayer';
import SignInHere from '../../components/SignInHere';
import { readViewerPage } from '../../lib/screenings';
import { SITE } from '../../lib/siteConfig';
import { cssUrl } from '../../lib/cssUrl';
import {
  SCREENING, SCREENING_WORDS_SERVER, VIEWER_WORDS,
  countriesLine, opensIn, passwordNote, viewerLine, whenLabel, timeLabel, yourOpensLine
} from '../../lib/screeningRules';

// A private screening (migration 128; mockups/private-screenings-contract.md,
// the canvas's Viewer boards): a film or a show its maker sent to the
// people they chose. No sign-in needed unless the link asks for one; the
// password opens a visit (one open covers it: moving between a show's
// episodes, or a reload in this tab, uses no other), the picture carries a
// moving watermark with who it's for, a beat every 20 seconds tells the
// maker how much was watched and keeps one screen at a time. Nothing here
// goes in watch history, view counts or the creator's numbers, and no ads
// play. Not indexed. The page reads the link without counting anything;
// the open, the video address and the beat are /api/screener/<token>/*.
export async function getServerSideProps({ req, res, params }) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const token = String((params && params.token) || '');
  try {
    const { page } = await readViewerPage(token, req);
    return { props: { page: JSON.parse(JSON.stringify(page)), token, renderedAt: Date.now() } };
  } catch (err) {
    console.error('screener page:', err && err.message ? err.message : err);
    return { props: { page: { state: 'unavailable', title: null, viewer: { signedIn: false, name: null } }, token, renderedAt: Date.now() } };
  }
}

const V = SCREENING_WORDS_SERVER.viewer;
const fill = (s, vars) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const storeKey = (token) => `tapa_scr:${token}`;
const KEEP_FORM = ['password', 'locked', 'screen', 'session', 'password_changed'];

function readStored(token) {
  try {
    const raw = window.sessionStorage.getItem(storeKey(token));
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v.session === 'string' ? v : null;
  } catch (err) {
    return null;
  }
}
function writeStored(token, value) {
  try { window.sessionStorage.setItem(storeKey(token), JSON.stringify(value)); } catch (err) { /* a private window: no resume */ }
}
function dropStored(token) {
  try { window.sessionStorage.removeItem(storeKey(token)); } catch (err) { /* nothing kept */ }
}

// Times: Pacific on the server's render, the viewer's own once the page
// is in their browser.
function useLocalZone() {
  const [zone, setZone] = useState(null);
  useEffect(() => {
    try { setZone(Intl.DateTimeFormat().resolvedOptions().timeZone || null); } catch (err) { setZone(null); }
  }, []);
  return zone;
}
function whenText(v, zone) {
  if (!v) return '';
  return zone ? `${whenLabel(v, { timeZone: zone, zone: false })} ${V.yourTime}` : whenLabel(v);
}
function clockText(v, zone) {
  if (!v) return '';
  return zone ? timeLabel(v, { timeZone: zone }) : `${timeLabel(v)} PT`;
}

async function postJson(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), credentials: 'same-origin' });
  let data = null;
  try { data = await res.json(); } catch (err) { data = null; }
  return { ok: res.ok, status: res.status, data: data || {} };
}

function Bar({ label }) {
  return (
    <header className="scr-bar">
      <Link href="/" className="scr-brand">{SITE.name}</Link>
      <span className="scr-kicker">{VIEWER_WORDS.kicker}{label ? <span className="scr-bar-label"> · {fill(V.forLabel, { label })}</span> : null}</span>
    </header>
  );
}

function Card({ kicker, title, line, children }) {
  return (
    <div className="scr-card">
      {kicker ? <span className="scr-kicker">{kicker}</span> : null}
      <h1>{title}</h1>
      {line ? <p>{line}</p> : null}
      {children}
    </div>
  );
}

function HomeLink() {
  return <Link href="/" className="scr-btn">{SITE.name}</Link>;
}

// The moving watermark over the picture (inside the full-screen element
// while the player is full screen) and the link's code in a corner.
function Watermark({ text, code }) {
  const [tick, setTick] = useState(0);
  const [host, setHost] = useState(null);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 9000);
    const onFs = () => setHost(document.fullscreenElement || document.webkitFullscreenElement || null);
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);
    return () => {
      clearInterval(t);
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('webkitfullscreenchange', onFs);
    };
  }, []);
  const spots = [{ top: '8%', left: '6%' }, { top: '70%', left: '52%' }, { top: '40%', left: '28%' }, { top: '15%', left: '58%' }, { top: '78%', left: '8%' }, { top: '55%', left: '40%' }];
  const marks = (
    <>
      <div className="scr-mark" style={spots[tick % spots.length]} aria-hidden="true">{text}</div>
      <div className="scr-mark scr-mark-fixed" aria-hidden="true">{code}</div>
    </>
  );
  return host ? createPortal(marks, host) : marks;
}

export default function ScreenerPage({ page, token, renderedAt }) {
  const zone = useLocalZone();
  const [now, setNow] = useState(renderedAt || 0);
  useEffect(() => { setNow(Date.now()); }, []);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null); // { reason, data } that keeps the form
  const [stop, setStop] = useState(null); // { reason, data } that ends it here
  const [watch, setWatch] = useState(null); // the open's answer, with current
  const [startAt, setStartAt] = useState(0);
  const [resuming, setResuming] = useState(page.state === 'password');
  const playerRef = useRef(null);
  const watchRef = useRef(null);
  watchRef.current = watch;

  const owner = page.ownerName || SCREENING_WORDS_SERVER.ownerFallback;
  const vars = useCallback((data = {}) => ({
    owner,
    opensIn: opensIn(page.startsAt, now),
    endsAt: whenText(page.endsAt, zone),
    endedAt: page.endedAt ? whenText(page.endedAt, zone) : '',
    countries: countriesLine(page.countries || []).replace(/^Only/, 'only'),
    perPerson: page.perPerson || (watch && watch.link && watch.link.perPerson) || '',
    retryAt: data.retryAt ? clockText(data.retryAt, zone) : '',
    triesLeft: data.triesLeft != null ? data.triesLeft : ''
  }), [owner, page.startsAt, page.endsAt, page.endedAt, page.countries, page.perPerson, now, zone, watch]);

  // Before it opens: the countdown, and the page again once it's time.
  useEffect(() => {
    if (page.state !== 'not_yet') return undefined;
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (Date.parse(page.startsAt) <= n) window.location.reload();
    }, 30000);
    return () => clearInterval(t);
  }, [page.state, page.startsAt]);

  const pauseVideo = () => {
    const v = playerRef.current ? playerRef.current.querySelector('video.tp-video') : null;
    if (v && !v.paused) { try { v.pause(); } catch (err) { /* already stopped */ } }
  };

  const halt = useCallback((reason, data = {}) => {
    pauseVideo();
    if (reason === 'session' || reason === 'password_changed') {
      dropStored(token);
      setWatch(null);
      setProblem({ reason, data });
      return;
    }
    setStop({ reason, data });
  }, [token]);

  // A visit kept in this tab: a reload picks it up without a new open.
  useEffect(() => {
    if (page.state !== 'password') return;
    const kept = readStored(token);
    if (!kept) { setResuming(false); return; }
    let cancelled = false;
    (async () => {
      const r = await postJson(`/api/screener/${encodeURIComponent(token)}/play`, { session: kept.session, episodeId: kept.episodeId });
      if (cancelled) return;
      if (r.ok && r.data.current) {
        setStartAt(Number(kept.position) || 0);
        setWatch({ ...kept, current: r.data.current });
      } else if (r.data && r.data.reason) {
        if (r.data.reason === 'session' || r.data.reason === 'password_changed') {
          dropStored(token);
          setProblem({ reason: r.data.reason, data: r.data });
        } else {
          setStop({ reason: r.data.reason, data: r.data });
        }
      } else {
        dropStored(token);
      }
      setResuming(false);
    })();
    return () => { cancelled = true; };
  }, [page.state, token]);

  // The beat: every 20 seconds while a visit is open.
  useEffect(() => {
    // A stopped visit (ended, another screen, not where it works…) sends no
    // more beats, and its place stays where it stopped.
    if (!watch || stop) return undefined;
    let stopped = false;
    const beat = async () => {
      const w = watchRef.current;
      if (!w || stopped) return;
      const v = playerRef.current ? playerRef.current.querySelector('video.tp-video') : null;
      if (!v) return;
      const position = v ? Math.floor(v.currentTime || 0) : 0;
      const duration = v && Number.isFinite(v.duration) ? Math.floor(v.duration) : 0;
      const playing = Boolean(v && !v.paused && !v.ended);
      writeStored(token, { ...w, current: undefined, episodeId: w.current.id, position });
      try {
        const r = await postJson(`/api/screener/${encodeURIComponent(token)}/beat`, { session: w.session, episodeId: w.current.id, position, duration, playing });
        if (!stopped && r.data && r.data.stop) halt(r.data.reason, r.data);
      } catch (err) {
        // A missed beat: the next one tries again.
      }
    };
    const t = setInterval(beat, SCREENING.beatSeconds * 1000);
    const onHide = () => { if (document.visibilityState === 'hidden') beat(); };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      stopped = true;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [watch && watch.session, watch && watch.current && watch.current.id, token, halt, Boolean(stop)]);

  const start = (data) => {
    const kept = { session: data.session, viewer: data.viewer, watermark: data.watermark, link: data.link, episodes: data.episodes, episodeId: data.current.id, position: 0 };
    writeStored(token, kept);
    setProblem(null);
    setStartAt(0);
    setWatch({ ...kept, current: data.current });
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const r = await postJson(`/api/screener/${encodeURIComponent(token)}/open`, { password });
      if (r.ok && r.data.session) start(r.data);
      else if (r.data && r.data.reason && KEEP_FORM.includes(r.data.reason)) setProblem({ reason: r.data.reason, data: r.data });
      else if (r.data && r.data.reason) setStop({ reason: r.data.reason, data: r.data });
      else setProblem({ reason: 'failed', data: {} });
    } catch (err) {
      setProblem({ reason: 'failed', data: {} });
    } finally {
      setBusy(false);
    }
  };

  const playEpisode = async (episodeId) => {
    const w = watchRef.current;
    if (!w || (w.current && w.current.id === episodeId)) return;
    pauseVideo();
    const r = await postJson(`/api/screener/${encodeURIComponent(token)}/play`, { session: w.session, episodeId });
    if (r.ok && r.data.current) {
      setStartAt(0);
      const next = { ...w, current: r.data.current, episodeId: r.data.current.id, position: 0 };
      writeStored(token, { ...next, current: undefined });
      setWatch(next);
    } else if (r.data && r.data.reason) {
      halt(r.data.reason, r.data);
    }
  };

  // The player's own refresh when its address runs out: a fresh one for
  // the same episode, no open counted.
  const refreshSrc = useCallback(async () => {
    const w = watchRef.current;
    if (!w) return null;
    const r = await postJson(`/api/screener/${encodeURIComponent(token)}/play`, { session: w.session, episodeId: w.current.id });
    if (r.ok && r.data.current) return r.data.current.src;
    if (r.data && r.data.reason) halt(r.data.reason, r.data);
    return null;
  }, [token, halt]);

  const onEnded = () => {
    const w = watchRef.current;
    if (!w || !Array.isArray(w.episodes)) return;
    const i = w.episodes.findIndex((e) => e.id === w.current.id);
    if (i >= 0 && i < w.episodes.length - 1) playEpisode(w.episodes[i + 1].id);
  };

  const tryScreenAgain = async () => {
    const w = watchRef.current;
    if (!w) { setStop(null); return; }
    const r = await postJson(`/api/screener/${encodeURIComponent(token)}/play`, { session: w.session, episodeId: w.current.id });
    if (r.ok && r.data.current) {
      setStop(null);
      setWatch({ ...w, current: r.data.current });
    } else if (r.data && r.data.reason) {
      halt(r.data.reason, r.data);
    }
  };

  const head = (
    <Head>
      <title>{page.title ? `${page.title} · ${VIEWER_WORDS.kicker} · ${SITE.name}` : `${VIEWER_WORDS.kicker} · ${SITE.name}`}</title>
      <meta name="robots" content="noindex, nofollow" />
    </Head>
  );

  const shell = (children, label = page.label) => (
    <>
      {head}
      <div className="scr-shell" onContextMenu={(e) => e.preventDefault()}>
        <Bar label={label} />
        <main className="scr-page">{children}</main>
      </div>
    </>
  );

  /* ---------- stopped while watching, or turned away at the door ---------- */
  if (stop) {
    const words = viewerLine(stop.reason, vars(stop.data));
    return shell(
      <Card kicker={page.title || VIEWER_WORDS.kicker} title={words.title} line={words.line}>
        {stop.reason === 'screen' && watch ? <button type="button" className="scr-btn primary" onClick={tryScreenAgain}>{V.tryAgain}</button> : <HomeLink />}
      </Card>
    );
  }

  /* ---------- watching ---------- */
  if (watch && watch.current) {
    const eps = Array.isArray(watch.episodes) ? watch.episodes : [];
    const ep = eps.find((e) => e.id === watch.current.id) || eps[0] || { id: watch.current.id, title: page.title };
    const isShow = page.kind === 'show';
    const link = watch.link || {};
    return shell(
      <div className="scr-layout">
        <div className="scr-main">
          <div className="scr-player" ref={playerRef}>
            <VideoPlayer
              key={watch.current.id}
              episode={{ id: watch.current.id, title: ep.title || page.title || '', src: watch.current.src, thumbnail: ep.thumbnail || page.still || null, poster: ep.thumbnail || page.still || null, contentType: ep.contentType || null }}
              adsEnabled={false}
              advisory={false}
              signedPlayback={Boolean(watch.current.signed)}
              refreshSrc={refreshSrc}
              initialPosition={startAt > 0 ? startAt : undefined}
              onEnded={onEnded}
              heading={{ kicker: isShow ? page.title : VIEWER_WORDS.kicker, title: ep.title || page.title || '' }}
            />
            <Watermark text={watch.watermark} code={link.code || page.code} />
          </div>
          <span className="scr-kicker">{isShow && ep.code ? `${page.title} · ${ep.code}` : fill(V.forLabel, { label: link.label || page.label })}</span>
          <h1 className="scr-title">{ep.title || page.title}</h1>
          <p className="scr-sub">{fill(V.from, { owner })} {fill(V.worksUntil, { endsAt: whenText(link.endsAt || page.endsAt, zone) })} {VIEWER_WORDS.dontShare}</p>
        </div>
        <aside className="scr-side">
          {isShow && eps.length > 0 ? (
            <section className="scr-panel" aria-label={V.episodes}>
              <div className="scr-panel-head"><b>{V.episodes}</b><span className="scr-kicker">{fill(V.thisLink, { count: plural(eps.length, 'episode', 'episodes') })}</span></div>
              <ul className="scr-eps">
                {eps.map((e) => {
                  const on = e.id === watch.current.id;
                  return (
                    <li key={e.id}>
                      <button type="button" className={`scr-ep${on ? ' on' : ''}`} aria-current={on ? 'true' : undefined} onClick={() => playEpisode(e.id)}>
                        <span className="scr-ep-thumb" style={e.thumbnail ? { backgroundImage: cssUrl(e.thumbnail) } : undefined} aria-hidden="true" />
                        <span className="scr-ep-text">
                          <b>{e.code ? `${e.code} · ${e.title}` : e.title}</b>
                          {on ? <span className="scr-ep-on">{V.playing}</span> : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
          <section className="scr-panel scr-facts">
            {link.oneScreen ? <div className="scr-fact"><span className="scr-kicker">{V.thisScreen}</span><span>{V.playingHere}</span></div> : null}
            <div className="scr-fact"><span className="scr-kicker">{VIEWER_WORDS.yourOpens}</span><span>{yourOpensLine(link.yourOpens || 1, link.perPerson)}</span></div>
            <div className="scr-fact"><span className="scr-kicker">{VIEWER_WORDS.worksUntil}</span><span>{whenText(link.endsAt || page.endsAt, zone)}</span></div>
          </section>
          {link.oneScreen ? <div className="scr-mini"><b>{VIEWER_WORDS.oneScreen}</b><span>{VIEWER_WORDS.oneScreenLine}</span></div> : null}
          <p className="scr-note">{watch.viewer && watch.viewer.signedIn && watch.viewer.name ? `${fill(V.signedInAs, { name: watch.viewer.name })} ` : ''}{VIEWER_WORDS.notCounted}</p>
          {isShow && eps.length > 1 ? <p className="scr-note">{VIEWER_WORDS.oneVisit}</p> : null}
        </aside>
      </div>
    );
  }

  /* ---------- the states before a visit ---------- */
  const st = page.state;
  if (st === 'gone' || st === 'unavailable') {
    const words = viewerLine(st, vars());
    return shell(<Card kicker={VIEWER_WORDS.kicker} title={words.title} line={words.line}><HomeLink /></Card>, null);
  }

  const still = page.still ? <div className="scr-still" style={{ backgroundImage: cssUrl(page.still) }} aria-hidden="true" /> : <div className="scr-still" aria-hidden="true" />;

  if (st === 'not_yet') {
    const words = viewerLine('not_yet', vars());
    return shell(
      <div className="scr-door">
        {still}
        {page.label ? <span className="scr-kicker">{page.label}</span> : null}
        <h1 className="scr-title">{page.title}</h1>
        <p className="scr-sub">{fill(V.from, { owner })}</p>
        <div className="scr-count">
          <span className="scr-kicker">{VIEWER_WORDS.kicker}</span>
          <b>{words.title}</b>
          <span>{whenText(page.startsAt, zone)}</span>
          <span className="scr-kicker">{fill(V.until, { time: whenText(page.endsAt, zone) })}</span>
        </div>
        <p className="scr-sub">{words.line}</p>
      </div>
    );
  }

  if (st === 'ended' || st === 'stopped' || st === 'country' || st === 'named_other') {
    const words = viewerLine(st, vars());
    return shell(<Card kicker={page.title} title={words.title} line={words.line}><HomeLink /></Card>);
  }

  if (st === 'signin' || st === 'named') {
    const words = viewerLine(st, vars());
    return shell(
      <Card kicker={page.title} title={words.title} line={words.line}>
        <SignInHere><button type="button" className="scr-btn primary">{V.signIn}</button></SignInHere>
      </Card>
    );
  }

  // st === 'password': the form (an older screener: Watch, no field).
  const shown = problem ? (problem.reason === 'failed' ? { title: V.failed, line: '' } : viewerLine(problem.reason, vars(problem.data))) : null;
  const locked = problem && problem.reason === 'locked';
  return shell(
    <div className="scr-door">
      {still}
      {page.label ? <span className="scr-kicker">{fill(V.forLabel, { label: page.label })}</span> : null}
      <h1 className="scr-title">{page.title}</h1>
      <p className="scr-sub">{fill(V.from, { owner })} {fill(V.worksUntil, { endsAt: whenText(page.endsAt, zone) })}</p>
      {shown ? (
        <div className="scr-error" role="alert">
          <b>{shown.title}</b>
          {shown.line ? <span>{shown.line}</span> : null}
        </div>
      ) : null}
      <form className="scr-form" onSubmit={onSubmit}>
        {page.legacy ? <p className="scr-note">{VIEWER_WORDS.noPasswordLine}</p> : (
          <label className="scr-field">
            <span className="scr-kicker">{VIEWER_WORDS.password_label}</span>
            <input type="password" name="password" autoComplete="off" autoCapitalize="none" spellCheck={false} value={password} onChange={(e) => setPassword(e.target.value)} maxLength={SCREENING.passwordMax} required disabled={busy || resuming || locked} />
          </label>
        )}
        <button type="submit" className="scr-btn primary" disabled={busy || resuming || locked}>{busy || resuming ? V.opening : VIEWER_WORDS.watch}</button>
      </form>
      <p className="scr-note">
        {passwordNote({ owner, signedIn: Boolean(page.viewer && page.viewer.signedIn), viewerName: (page.viewer && page.viewer.name) || '', access: page.access })}
        {!(page.viewer && page.viewer.signedIn) && page.access === 'anyone' ? <> <SignInHere><button type="button" className="scr-linkbtn">{V.signIn}</button></SignInHere></> : null}
      </p>
      <p className="scr-note">{VIEWER_WORDS.dontShare}</p>
    </div>
  );
}
