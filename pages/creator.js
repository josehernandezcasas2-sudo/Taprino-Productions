import { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { getAccountContext } from '../lib/accountContext';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import { listDrafts } from '../lib/creatorDrafts';
import { getSupabase } from '../lib/supabase';
import { SUBMIT_TYPES } from '../lib/submitRules';
import { bytesLabel } from '../lib/creatorRights';
import { needsYou } from '../lib/showRules';
import { episodeCode } from '../lib/seriesResume';
import { isTitleId } from '../lib/titleIds';
import HeaderNav from '../components/HeaderNav';
import Footer from '../components/Footer';
import { ClockIcon, PlusIcon } from '../components/PlayerIcons';
import { SITE } from '../lib/siteConfig';

// Creator Studio, the hub (2026-10-31, from the creator-path canvas): one
// Submit a title button, the types as pills under it, the drafts in
// flight, and three piles that answer "where are my things" without
// opening Your work — In review, Needs you, Live. The six-button modal
// page it replaces is gone; submitting is /creator/submit.
//
// The series revamp (slice 2, the Hub board): "Your shows" — one card per
// show from GET /api/show?mine=1 with its kind, where it stands in
// decision 2's words (Live / Ready to go public / Not public yet / Pulled
// / Removal requested / Not this time), its count line and a clock when a
// change waits for approval; the dashed "+ New show" card. A row of a show
// in the piles names the show and its place ("Night Bus · S1 E3") and
// opens the show page at that row. An approved episode of a show that
// isn't public yet is never Live: it waits in Needs you as "Ready to go
// public", with Make it public on the row (once per show). The "Series
// management" link is gone (/creator/series forwards to the show pages).
//
// SECURITY: same enforcement pattern as /admin — a non-creator is
// redirected server-side before this page (or any creator-only data) ever
// renders.
export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  if (!account.isCreator && !account.isAdmin) {
    return { redirect: { destination: '/stream', permanent: false } };
  }
  const [episodes, drafts] = await Promise.all([getPublicEpisodes(), listDrafts(account.userId)]);
  // The names of the shows the drafts are for, so a draft's row says
  // "in Night Bus" from the first paint (the strip's list comes later).
  const draftShowIds = [...new Set(drafts.map((d) => (d.form && d.form.seriesId ? String(d.form.seriesId) : null)).filter((id) => id && isTitleId(id)))];
  let draftShowNames = {};
  if (draftShowIds.length > 0) {
    const { data, error } = await getSupabase().from('series').select('id, name').in('id', draftShowIds);
    if (error) console.error('creator hub draft shows:', error.message);
    draftShowNames = Object.fromEntries((data || []).map((s) => [s.id, s.name ?? null]));
  }
  return {
    props: {
      mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
      drafts,
      draftShowNames,
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator
    }
  };
}

const PILE_LIMIT = 4;
// Laptop: up to this many show cards before "All N shows" (the "+ New
// show" card makes the fourth).
const STRIP_LIMIT = 3;
// A show's numbering lines worth a row in Needs you (the rest of its
// problems are rows of their own already: a failed file, no captions).
const NUMBERING = { gap: 'Add it or renumber', duplicate: 'Pick one', parked: 'Give it its own number', unnumbered: 'Give each one a number' };

function showHref(id, anchor) {
  return `/creator/show/${encodeURIComponent(id)}${anchor ? `#${anchor}` : ''}`;
}

// The show a title row belongs to: its own (an episode), or the one an
// extra is attached to — directly, or through the episode it follows when
// that episode is one of these titles (byId).
function showOf(s, byId) {
  if (s.seriesId) return s.seriesId;
  if (s.contentType !== 'bonus' || !s.bonusParentId) return null;
  if (s.bonusParentType === 'series') return s.bonusParentId;
  const parent = s.bonusParentType === 'episode' && byId ? byId.get(s.bonusParentId) : null;
  return parent && parent.seriesId ? parent.seriesId : null;
}

function displayTitle(s) {
  const own = typeof s.title === 'string' ? s.title.trim() : '';
  if (own) return own;
  return s.seriesOrder ? `Episode ${s.seriesOrder}` : 'Untitled';
}

// On the site: approved, not pulled or on its way out, and in no show or a
// public one. An extra carries no show status of its own (my-submissions
// reads series_id, which an extra doesn't have): the show it is attached
// to answers for it, when the strip has it.
function onSite(s, byId, showById) {
  if (s.status !== 'approved' || s.held || s.deletionRequested) return false;
  if (s.seriesId) return !s.seriesHeld && (s.seriesStatus === 'approved' || s.seriesStatus == null);
  const sid = showOf(s, byId);
  const sh = sid && showById ? showById.get(sid) : null;
  return !sh || sh.isPublic !== false;
}

function draftFileLine(d) {
  if (d.video) {
    const state = d.video.state === 'uploading' ? 'the upload stopped' : d.video.state === 'processing' ? 'the file is processing' : d.video.state === 'ready' ? 'ready to send' : 'the file failed to process';
    return `${state}${d.video.bytes ? ` · ${bytesLabel(d.video.bytes)}` : ''}`;
  }
  if (d.form && d.form.audioUrl) return 'ready to send';
  return 'no file yet';
}

function bg(url) {
  return url ? { backgroundImage: `url("${String(url).replace(/"/g, '%22')}")` } : undefined;
}

export default function CreatorStudio({ mainGenres, drafts: initialDrafts, draftShowNames, isSignedIn, isSubscriber, email, isAdmin, isCreator }) {
  const router = useRouter();
  const [subs, setSubs] = useState(null);
  const [drafts, setDrafts] = useState(initialDrafts || []);
  const [error, setError] = useState(null);
  // null while loading; the strip hides when it can't load.
  const [shows, setShows] = useState(null);
  const [showsFailed, setShowsFailed] = useState(false);
  const [allShows, setAllShows] = useState(false);
  const [busyShow, setBusyShow] = useState(null);
  const [publicNote, setPublicNote] = useState(null); // { ok, text, showId }
  const submitted = typeof router.query.submitted === 'string' ? router.query.submitted : null;
  const submittedShow = typeof router.query.show === 'string' && isTitleId(router.query.show) ? router.query.show : null;

  const loadSubs = useCallback(async () => {
    try {
      const d = await fetch('/api/creator/my-submissions').then((r) => r.json());
      if (d && Array.isArray(d.submissions)) setSubs(d.submissions);
      else setError((d && d.error) || 'Could not load your titles.');
    } catch {
      setError('Could not load your titles.');
    }
  }, []);

  const loadShows = useCallback(async () => {
    try {
      const res = await fetch('/api/show?mine=1');
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(d.shows)) throw new Error('shows');
      // Vertical series are the studio's; the strip is series and podcasts.
      setShows(d.shows.filter((sh) => sh && sh.kind !== 'vertical'));
      setShowsFailed(false);
    } catch {
      setShowsFailed(true);
    }
  }, []);

  useEffect(() => {
    loadSubs();
    loadShows();
  }, [loadSubs, loadShows]);

  async function discardDraft(id) {
    if (!window.confirm('Discard this draft? Its uploaded file is deleted too.')) return;
    try {
      const res = await fetch('/api/creator/drafts', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      if (!res.ok) throw new Error((await res.json()).error || 'Could not discard it.');
      setDrafts((d) => d.filter((x) => x.id !== id));
    } catch (err) {
      setError(err.message);
    }
  }

  // Decision 2: the show's owner (or a full admin) makes it public once an
  // episode is approved. One-way, so it asks first and says so.
  async function makePublic(showId, name) {
    const label = name || 'this show';
    if (!window.confirm(`Make ${label} public?\n\nIts approved episodes go on the site now, and the ones approved later go live as they’re approved. This is one-way: a public show only comes down if you remove it.`)) return;
    setBusyShow(showId);
    setPublicNote(null);
    try {
      const res = await fetch(`/api/show/${encodeURIComponent(showId)}/public`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not make it public.');
      setPublicNote({ ok: true, text: `${label} is public.`, showId });
      await Promise.all([loadSubs(), loadShows()]);
    } catch (err) {
      setPublicNote({ ok: false, text: err.message });
    } finally {
      setBusyShow(null);
    }
  }

  const list = subs || [];
  const titleById = new Map(list.map((s) => [s.id, s]));
  const showById = new Map((shows || []).map((sh) => [sh.id, sh]));
  const showName = (id, fallback) => (showById.get(id) && showById.get(id).name) || fallback || (draftShowNames && draftShowNames[id]) || 'a show';

  const inReview = list.filter((s) => s.status === 'pending');

  // Needs you: one "Ready to go public" row per private show (its approved
  // episodes, or the show alone when someone else uploaded them), the
  // titles' own reasons, then a show's numbering lines.
  const ready = new Map();
  const titleNeeds = [];
  for (const s of list) {
    const why = needsYou(s);
    if (!why) continue;
    if (why === 'Ready to go public' && s.seriesId) {
      const g = ready.get(s.seriesId) || { showId: s.seriesId, name: s.seriesName, rows: [] };
      g.rows.push(s);
      ready.set(s.seriesId, g);
      continue;
    }
    titleNeeds.push({ s, why });
  }
  for (const sh of shows || []) {
    if (sh.state === 'ready' && !ready.has(sh.id)) ready.set(sh.id, { showId: sh.id, name: sh.name, rows: [] });
  }
  const showNeeds = [];
  for (const sh of shows || []) {
    for (const p of sh.problems || []) if (NUMBERING[p.code]) showNeeds.push({ sh, p });
  }
  const readyRows = [...ready.values()].map((g) => ({ ...g, rows: [...g.rows].sort((a, b) => (a.season || 1) - (b.season || 1) || (a.seriesOrder || 0) - (b.seriesOrder || 0)) }));
  const needsCount = readyRows.length + titleNeeds.length + showNeeds.length;

  const live = list
    .filter((s) => onSite(s, titleById, showById))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  // Drafts: one row each, but a show's drafts (Add several makes up to
  // thirty at a time) share one row that opens the show.
  const looseDrafts = drafts.filter((d) => !(d.form && d.form.seriesId));
  const draftsByShow = new Map();
  for (const d of drafts) {
    const sid = d.form && d.form.seriesId ? String(d.form.seriesId) : null;
    if (!sid) continue;
    if (!draftsByShow.has(sid)) draftsByShow.set(sid, []);
    draftsByShow.get(sid).push(d);
  }

  const titleRow = (s, meta, fallbackHref) => {
    const sid = showOf(s, titleById);
    if (!sid) return <Row key={s.id} s={s} title={displayTitle(s)} meta={meta} href={fallbackHref} />;
    const code = s.contentType === 'bonus' ? 'extra' : episodeCode(s);
    return <Row key={s.id} s={s} eyebrow={<Eyebrow name={s.seriesName || showName(sid)} code={code} />} title={displayTitle(s)} meta={meta} href={showHref(sid, `ep-${s.id}`)} />;
  };

  let room = PILE_LIMIT;
  const readyShown = readyRows.slice(0, room);
  room -= readyShown.length;
  const titleNeedsShown = titleNeeds.slice(0, Math.max(0, room));
  room -= titleNeedsShown.length;
  const showNeedsShown = showNeeds.slice(0, Math.max(0, room));

  return (
    <>
      <Head><title>Creator Studio — {SITE.name}</title></Head>
      <HeaderNav activeType="All" mainGenres={mainGenres} isSignedIn={isSignedIn} email={email} isAdmin={isAdmin} isCreator={isCreator} isSubscriber={isSubscriber} />

      <main id="main-content" className="cs">
        <div className="cs-head">
          <div className="apl-eyebrow">Creator Studio</div>
          <h1 className="cs-h1">Your titles, in one place.</h1>
        </div>

        {submitted && (
          <div className="cs-flash" role="status">
            <strong>“{submitted}” is in.</strong> It sits under In review until we&rsquo;ve watched it; the upload keeps going in the corner if it hasn&rsquo;t finished.
            {submittedShow && <> <Link href={showHref(submittedShow)} className="cs-flash-link">Open the show page</Link></>}
          </div>
        )}

        <div className="cs-submit">
          <Link href="/creator/submit" className="apl-btn cs-submit-btn">Submit a title</Link>
          <div className="apl-pills cs-types">
            {SUBMIT_TYPES.map((t) => <Link key={t.value} href={`/creator/submit?type=${t.value}`} className="apl-pill">{t.label}</Link>)}
            <Link href="/creator/pitch/new" className="apl-pill">Pitch a project</Link>
          </div>
          <p className="apl-help">Three steps: the file (it uploads while you type), a few words about it, artwork. Saved as a draft as you go.</p>
        </div>

        {!showsFailed && <ShowsStrip shows={shows} expanded={allShows} onToggle={() => setAllShows((v) => !v)} />}

        {publicNote && (
          publicNote.ok
            ? <div className="cs-flash" role="status"><strong>{publicNote.text}</strong> Its approved episodes are on the site; the next ones go live as they&rsquo;re approved. <Link href={showHref(publicNote.showId)} className="cs-flash-link">Open the show page</Link></div>
            : <p className="admin-error" role="alert">{publicNote.text}</p>
        )}

        {drafts.length > 0 && (
          <section className="cs-pile cs-drafts">
            <div className="cs-pile-head"><span className="apl-card-k">Drafts</span><span className="cs-count">{drafts.length}</span></div>
            {[...draftsByShow.entries()].map(([sid, group]) => {
              const one = group.length === 1 ? group[0] : null;
              const code = one && one.form && one.form.seriesOrder ? `S${Number(one.form.season) || 1} E${one.form.seriesOrder}` : null;
              const title = one ? ((one.form && String(one.form.title || '').trim()) || (code ? `Episode ${one.form.seriesOrder}` : (one.video && one.video.name) || 'Untitled draft')) : `${group.length} drafts`;
              return (
                <div key={`show-${sid}`} className="cs-row">
                  <div className="cs-row-main">
                    <div className="cs-row-title">{title}</div>
                    <div className="cs-row-meta">
                      in {showName(sid)}{code ? ` · ${code}` : ''} · {one ? draftFileLine(one) : `${group.filter((d) => d.video && d.video.state === 'ready').length} ready to send`}
                    </div>
                  </div>
                  <div className="cs-row-acts">
                    <Link href={showHref(sid, one ? `draft-${one.id}` : null)} className="apl-btn-secondary small">Open show</Link>
                    {one && one.form && one.form.addedFrom !== 'show' && <Link href={`/creator/submit?draft=${encodeURIComponent(one.id)}`} className="apl-link">Continue here</Link>}
                    {one && <button type="button" className="apl-link" onClick={() => discardDraft(one.id)}>Discard</button>}
                  </div>
                </div>
              );
            })}
            {looseDrafts.map((d) => (
              <div key={d.id} className="cs-row">
                <div className="cs-row-main">
                  <div className="cs-row-title">{(d.form && d.form.title) || (d.video && d.video.name) || 'Untitled draft'}</div>
                  <div className="cs-row-meta">
                    {d.video ? `${d.video.state === 'uploading' ? 'the master’s upload stopped' : d.video.state === 'processing' ? 'the master is processing' : d.video.state === 'ready' ? 'the master is in' : 'the master failed to process'}${d.video.bytes ? ` · ${bytesLabel(d.video.bytes)}` : ''}` : 'no file yet'} · step {d.form && d.form.step ? d.form.step : 1} of 3
                  </div>
                </div>
                <div className="cs-row-acts">
                  <Link href={`/creator/submit?draft=${encodeURIComponent(d.id)}`} className="apl-btn-secondary small">Continue</Link>
                  <button type="button" className="apl-link" onClick={() => discardDraft(d.id)}>Discard</button>
                </div>
              </div>
            ))}
          </section>
        )}

        {error && <p className="admin-error" role="alert">{error}</p>}

        <div className="cs-piles">
          <Pile k="In review" count={inReview.length} empty={subs ? 'Nothing waiting on us.' : 'Loading…'} href="/creator/my-work?status=pending">
            {inReview.slice(0, PILE_LIMIT).map((s) => titleRow(s, `sent ${ago(s.createdAt)}${s.cloudflareState && s.cloudflareState !== 'ready' ? ` · ${cfLabel(s.cloudflareState)}` : ''}`, '/creator/my-work'))}
          </Pile>
          <Pile k="Needs you" count={needsCount} empty={subs ? 'Nothing to fix.' : 'Loading…'} href="/creator/my-work?attention=1" tone="warn">
            {readyShown.map((g) => {
              const sh = showById.get(g.showId);
              const first = g.rows[0] || null;
              const canPublish = Boolean(sh && sh.makePublic && sh.makePublic.ok);
              const name = g.name || showName(g.showId);
              return (
                <div key={`ready-${g.showId}`} className="cs-row cs-ready">
                  <Link href={showHref(g.showId, first ? `ep-${first.id}` : null)} className="cs-ready-link">
                    <span className="cs-thumb" style={bg((first && (first.thumbnail || first.poster)) || (sh && (sh.thumbnail || sh.poster)))} aria-hidden="true" />
                    <span className="cs-row-main">
                      <Eyebrow name={name} code={first ? episodeCode(first) : null} />
                      <span className="cs-row-title">{first ? displayTitle(first) : name}</span>
                      <span className="cs-row-meta">Ready to go public{g.rows.length > 1 ? ` · ${g.rows.length} episodes approved` : ''}</span>
                    </span>
                  </Link>
                  {canPublish && (
                    <button type="button" className="apl-btn cs-ready-btn" disabled={busyShow === g.showId} onClick={() => makePublic(g.showId, name)}>
                      {busyShow === g.showId ? 'Making it public…' : 'Make it public'}
                    </button>
                  )}
                </div>
              );
            })}
            {titleNeedsShown.map(({ s, why }) => titleRow(s, why, '/creator/my-work'))}
            {showNeedsShown.map(({ sh, p }) => (
              <Link key={`${sh.id}-${p.code}-${p.words}`} href={showHref(sh.id)} className="cs-row">
                <span className="cs-thumb cs-thumb-gap" aria-hidden="true">{p.code === 'gap' ? (/E\d+/.exec(p.words) || [''])[0] : '#'}</span>
                <span className="cs-row-main">
                  <span className="cs-row-eyebrow">{sh.name}</span>
                  <span className="cs-row-title">{p.words}</span>
                  <span className="cs-row-meta">{NUMBERING[p.code]}</span>
                </span>
              </Link>
            ))}
          </Pile>
          <Pile k="Live" count={live.length} empty={subs ? 'Nothing live yet. The first one is the hardest.' : 'Loading…'} href="/creator/my-work?status=approved" tone="ok">
            {live.slice(0, PILE_LIMIT).map((s) => titleRow(s, `${s.viewCount} view${s.viewCount === 1 ? '' : 's'}`, `/episode/${s.id}`))}
          </Pile>
        </div>

        <nav className="cs-links" aria-label="Creator Studio">
          <Link href="/creator/my-work">Your work</Link>
          <Link href="/creator/analytics">Your numbers</Link>
          <Link href="/creator/money">Money</Link>
          <Link href="/creator/pitch/dashboard">Pitch Room</Link>
        </nav>
      </main>
      <Footer />
    </>
  );
}

// "Your shows": a strip of cards on a phone, a grid of up to four on a
// laptop ("All N shows" for the rest); skeletons while it loads.
function ShowsStrip({ shows, expanded, onToggle }) {
  const loading = shows === null;
  const list = shows || [];
  return (
    <section className="cs-shows" aria-labelledby="cs-shows-h">
      <h2 id="cs-shows-h" className="cs-shows-h">Your shows{!loading && list.length > 0 && <span className="cs-count"> · {list.length}</span>}</h2>
      {!loading && list.length === 0 ? (
        <Link href="/creator/show/new" className="cs-show-start">
          <span className="cs-show-start-plus" aria-hidden="true"><PlusIcon size={18} /></span>
          <span className="cs-show-start-text">
            <span className="cs-show-start-k">Start a show</span>
            <span className="cs-show-start-sub">A series or a podcast gets its own page: its episodes in order, its art, one place to run it.</span>
          </span>
        </Link>
      ) : (
        <div className={`cs-shows-row${expanded ? ' all' : ''}`} aria-busy={loading || undefined}>
          {loading && [0, 1, 2].map((i) => (
            <span key={i} className="cs-show-card is-skeleton" aria-hidden="true">
              <span className="cs-show-poster" />
              <span className="cs-skel" />
              <span className="cs-skel short" />
            </span>
          ))}
          {!loading && list.map((sh, i) => <ShowCard key={sh.id} sh={sh} extra={i >= STRIP_LIMIT} />)}
          {!loading && (
            <Link href="/creator/show/new" className="cs-show-card cs-show-new">
              <span className="cs-show-poster"><PlusIcon size={20} /><span>New show</span></span>
            </Link>
          )}
        </div>
      )}
      {!loading && list.length > STRIP_LIMIT && (
        <button type="button" className="apl-link cs-shows-all" aria-expanded={expanded} onClick={onToggle}>{expanded ? 'Fewer shows' : `All ${list.length} shows`}</button>
      )}
    </section>
  );
}

const STATE_CLASS = { live: 'live', ready: 'ready', review: 'private', drafts: 'private', empty: 'private', pulled: 'pulled', removal: 'removal', declined: 'declined' };

function ShowCard({ sh, extra }) {
  const poster = sh.poster || null;
  return (
    <Link href={sh.href || showHref(sh.id)} className={`cs-show-card${extra ? ' extra' : ''}`}>
      <span className={`cs-show-poster${poster ? '' : ' empty'}`} style={bg(poster)}>
        {!poster && <span className="cs-show-poster-name" aria-hidden="true">{sh.name}</span>}
        {sh.staged && sh.staged.any && <span className="cs-show-clock" role="img" aria-label="A change waits for approval"><ClockIcon size={13} /></span>}
      </span>
      <span className="cs-show-name">{sh.name}</span>
      <span className="cs-show-chips">
        <span className={`cs-chip kind-${sh.kind === 'podcast' ? 'podcast' : 'series'}`}>{sh.kind === 'podcast' ? 'Podcast' : 'Series'}</span>
        {sh.statusLabel && <span className={`cs-chip state-${STATE_CLASS[sh.state] || 'private'}`}>{sh.state === 'live' && <i aria-hidden="true" />}{sh.statusLabel}</span>}
      </span>
      <span className="cs-show-count">{sh.countLine}</span>
    </Link>
  );
}

function Pile({ k, count, empty, href, tone = '', children }) {
  const rows = (Array.isArray(children) ? children.flat() : [children]).filter(Boolean);
  return (
    <section className={`cs-pile ${tone}`}>
      <div className="cs-pile-head"><span className="apl-card-k">{k}</span><span className="cs-count">{count}</span></div>
      {rows.length === 0 ? <p className="cs-empty">{empty}</p> : rows}
      {count > PILE_LIMIT && <Link href={href} className="apl-link">All {count} in Your work</Link>}
    </section>
  );
}

// "NIGHT BUS · S1 E3" over a pile row: a long show name is cut, never the
// episode's code.
function Eyebrow({ name, code }) {
  if (!code) return <span className="cs-row-eyebrow">{name}</span>;
  return (
    <span className="cs-row-eyebrow has-code">
      <span className="cs-row-eyebrow-name">{name}</span>
      <span className="cs-row-eyebrow-code">{` · ${code}`}</span>
    </span>
  );
}

function Row({ s, eyebrow, title, meta, href = '/creator/my-work' }) {
  return (
    <Link href={href} className="cs-row">
      <span className="cs-thumb" style={bg(s.thumbnail || s.poster)} aria-hidden="true" />
      <span className="cs-row-main">
        {eyebrow}
        <span className="cs-row-title">{title}</span>
        <span className="cs-row-meta">{meta}</span>
      </span>
    </Link>
  );
}

function cfLabel(state) {
  return { pendingupload: 'upload not finished', downloading: 'receiving', queued: 'queued', inprogress: 'processing', error: 'failed to process' }[state] || state;
}

function ago(iso) {
  if (!iso) return '';
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}
