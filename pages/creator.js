import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { getAccountContext } from '../lib/accountContext';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import { listDrafts } from '../lib/creatorDrafts';
import { SUBMIT_TYPES } from '../lib/submitRules';
import { bytesLabel } from '../lib/creatorRights';
import HeaderNav from '../components/HeaderNav';
import Footer from '../components/Footer';
import { SITE } from '../lib/siteConfig';

// Creator Studio, the hub (2026-10-31, from the creator-path canvas): one
// Submit a title button, the types as pills under it, the drafts in
// flight, and three piles that answer "where are my things" without
// opening Your work — In review, Needs you, Live. The six-button modal
// page it replaces is gone; submitting is /creator/submit.
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
  return {
    props: {
      mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
      drafts,
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator
    }
  };
}

const PILE_LIMIT = 4;

function needsYou(s) {
  if (s.status === 'rejected') return s.rejectionReason ? `Not this time: ${s.rejectionReason}` : 'Not this time';
  if (s.deletionRequested) return null;
  if (s.held && s.status === 'approved') return 'Pulled while an admin looks at it';
  if (s.missingArtwork) return 'Missing a poster or a still';
  if (s.status === 'approved' && s.contentType !== 'podcast' && !s.captionsUrl) return 'No captions yet';
  if (s.cloudflareState === 'error') return 'The video failed to process';
  if (s.cloudflareState === 'pendingupload') return 'The upload never finished';
  return null;
}

export default function CreatorStudio({ mainGenres, drafts: initialDrafts, isSignedIn, isSubscriber, email, isAdmin, isCreator }) {
  const router = useRouter();
  const [subs, setSubs] = useState(null);
  const [drafts, setDrafts] = useState(initialDrafts || []);
  const [error, setError] = useState(null);
  const submitted = typeof router.query.submitted === 'string' ? router.query.submitted : null;

  useEffect(() => {
    let alive = true;
    fetch('/api/creator/my-submissions').then((r) => r.json()).then((d) => {
      if (!alive) return;
      if (d && Array.isArray(d.submissions)) setSubs(d.submissions);
      else setError((d && d.error) || 'Could not load your titles.');
    }).catch(() => { if (alive) setError('Could not load your titles.'); });
    return () => { alive = false; };
  }, []);

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

  const list = subs || [];
  const inReview = list.filter((s) => s.status === 'pending');
  const needs = list.map((s) => ({ s, why: needsYou(s) })).filter((x) => x.why);
  const live = list.filter((s) => s.status === 'approved' && !s.held).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

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

        {drafts.length > 0 && (
          <section className="cs-pile cs-drafts">
            <div className="cs-pile-head"><span className="apl-card-k">Drafts</span><span className="cs-count">{drafts.length}</span></div>
            {drafts.map((d) => (
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
            {inReview.slice(0, PILE_LIMIT).map((s) => <Row key={s.id} s={s} meta={`${s.seriesName ? `${s.seriesName} · ` : ''}sent ${ago(s.createdAt)}${s.cloudflareState && s.cloudflareState !== 'ready' ? ` · ${cfLabel(s.cloudflareState)}` : ''}`} />)}
          </Pile>
          <Pile k="Needs you" count={needs.length} empty={subs ? 'Nothing to fix.' : 'Loading…'} href="/creator/my-work?attention=1" tone="warn">
            {needs.slice(0, PILE_LIMIT).map(({ s, why }) => <Row key={s.id} s={s} meta={why} href="/creator/my-work" />)}
          </Pile>
          <Pile k="Live" count={live.length} empty={subs ? 'Nothing live yet. The first one is the hardest.' : 'Loading…'} href="/creator/my-work?status=approved" tone="ok">
            {live.slice(0, PILE_LIMIT).map((s) => <Row key={s.id} s={s} meta={`${s.seriesName ? `${s.seriesName} · ` : ''}${s.viewCount} view${s.viewCount === 1 ? '' : 's'}`} href={`/episode/${s.id}`} />)}
          </Pile>
        </div>

        <nav className="cs-links" aria-label="Creator Studio">
          <Link href="/creator/my-work">Your work</Link>
          <Link href="/creator/series">Series management</Link>
          <Link href="/creator/analytics">Your numbers</Link>
          <Link href="/creator/money">Money</Link>
          <Link href="/creator/pitch/dashboard">Pitch Room</Link>
        </nav>
      </main>
      <Footer />
    </>
  );
}

function Pile({ k, count, empty, href, tone = '', children }) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <section className={`cs-pile ${tone}`}>
      <div className="cs-pile-head"><span className="apl-card-k">{k}</span><span className="cs-count">{count}</span></div>
      {rows.length === 0 ? <p className="cs-empty">{empty}</p> : rows}
      {count > PILE_LIMIT && <Link href={href} className="apl-link">All {count} in Your work</Link>}
    </section>
  );
}

function Row({ s, meta, href = '/creator/my-work' }) {
  return (
    <Link href={href} className="cs-row">
      <span className="cs-thumb" style={s.thumbnail || s.poster ? { backgroundImage: `url(${s.thumbnail || s.poster})` } : undefined} aria-hidden="true" />
      <span className="cs-row-main">
        <span className="cs-row-title">{s.title}</span>
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
