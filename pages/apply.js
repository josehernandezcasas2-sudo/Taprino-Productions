import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { SignInButton, useUser } from '@clerk/nextjs';
import { getAccountContext } from '../lib/accountContext';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import { getOwnApplication } from '../lib/creatorApplications';
import {
  ONBOARDING, APPLICATION_TYPES, APPLICATION_RATINGS, APPLICATION_STATUSES, APPLICATION_GENRES, rightsVerdict
} from '../lib/creatorRights';
import HeaderNav from '../components/HeaderNav';
import MobileTabBar from '../components/MobileTabBar';
import Footer from '../components/Footer';
import RightsCheck from '../components/RightsCheck';
import { SITE } from '../lib/siteConfig';

// Creator onboarding — the approved one-page handbook (mockup option A,
// with option B's gate: nothing sends until all five rights questions are
// answered). Replaces the bare application form that used to live here,
// at the same URL so every "Become a creator" link still lands.
//
// Four parts: what we take, the rights check, the application itself,
// and what happens next. The first two are public; the form needs a
// signed-in account so Accept can grant Creator Studio and the applicant
// can come back here to see where it stands.
export async function getServerSideProps({ req, res }) {
  const hasSession = Boolean(req.headers.cookie && /__session|__clerk/.test(req.headers.cookie));
  if (hasSession) {
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  } else {
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  }

  const account = await getAccountContext(req);
  const [episodes, application] = await Promise.all([
    getPublicEpisodes(),
    account.isSignedIn ? getOwnApplication(account.userId) : Promise.resolve(null)
  ]);
  return {
    props: {
      mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      application
    }
  };
}

const EMPTY = {
  name: '', portfolioUrl: '',
  title: '', logline: '', description: '',
  contentType: 'short', mainGenre: APPLICATION_GENRES[0], runtime: '', rating: APPLICATION_RATINGS[0], completionStatus: 'finished',
  mediaLink: '', mediaNotes: ''
};

const ATTEST = [
  { key: 'rights', text: 'I made this, or I hold the rights to distribute it, and everything in it (footage, music, fonts, people, locations) is mine or licensed.' },
  { key: 'check', text: 'I’ve done the rights check above and I’ll send licences for anything it flagged.' },
  { key: 'terms', text: null } // rendered inline: links to the terms
];

const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export default function Apply({ mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator, application }) {
  const { isSignedIn: clerkSignedIn, user } = useUser();
  // The server knew at render time; Clerk's modal sign-in updates the
  // client without a reload, so trust either.
  const signedIn = isSignedIn || Boolean(clerkSignedIn);
  const shownEmail = email || (user && user.primaryEmailAddress ? user.primaryEmailAddress.emailAddress : null);

  const [app, setApp] = useState(application);
  const [creator, setCreator] = useState(isCreator);
  const [reapply, setReapply] = useState(false);
  const [answers, setAnswers] = useState({});
  const [attest, setAttest] = useState({ rights: false, check: false, terms: false });
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Signed in through the modal after the page loaded: find out whether
  // this account already has an application or Creator Studio.
  useEffect(() => {
    if (isSignedIn || !clerkSignedIn) return;
    let cancelled = false;
    fetch('/api/apply').then((r) => r.json()).then((data) => {
      if (cancelled || !data) return;
      if (data.application) setApp(data.application);
      if (data.isCreator) setCreator(true);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [isSignedIn, clerkSignedIn]);

  const verdict = rightsVerdict(answers);
  const attested = attest.rights && attest.check && attest.terms;
  const showForm = !creator && (!app || (app.status === 'declined' && reapply));

  // Why "Send" is off, in the order the applicant should fix things.
  let blocker = null;
  if (!verdict.complete) blocker = `Answer all five rights questions above (${verdict.answered} of 5 so far).`;
  else if (verdict.result === 'blocked') blocker = 'Only the rights holder can apply.';
  else if (!signedIn) blocker = 'Sign in (free) so we can attach this to your account.';
  else if (!attested) blocker = 'Tick the three rights statements.';

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function submit(e) {
    e.preventDefault();
    if (blocker) { setError(blocker); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, rightsAnswers: answers, rightsAttested: true })
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.application) setApp(data.application);
        if (data.code === 'already_creator') setCreator(true);
        throw new Error(data.error || 'Could not send your application.');
      }
      setApp(data.application);
      setReapply(false);
      setForm(EMPTY);
      if (typeof window !== 'undefined') window.location.hash = 'apply';
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Head>
        <title>Become a creator — {SITE.name}</title>
        <meta name="description" content={`How to get your film or short on ${SITE.name}: what we take, a rights check, and the application.`} />
      </Head>

      <HeaderNav activeType="All" mainGenres={mainGenres} isSignedIn={signedIn} email={shownEmail} isAdmin={isAdmin} isCreator={creator} isSubscriber={isSubscriber} />

      <main id="main-content" className="onboard">

        <section className="onboard-hero">
          <div className="onboard-hero-text">
            <div className="account-eyebrow">For creators</div>
            <h1 className="onboard-h1">Put your film in front of an audience that funds what it loves.</h1>
            <p className="onboard-lede">
              {SITE.name} is a small, curated platform. We don&rsquo;t run open uploads: read how it works below,
              check your rights, then apply. If it&rsquo;s a fit, you get a Creator Studio account and we handle
              encoding, captions and publishing.
            </p>
            <div className="onboard-cta-row">
              {creator ? (
                <Link href="/creator" className="onboard-btn">Open Creator Studio →</Link>
              ) : (
                <a href="#apply" className="onboard-btn">{app ? 'See your application' : 'Start your application'}</a>
              )}
              <a href="#guidelines" className="onboard-btn-secondary">Read the guidelines first</a>
            </div>
          </div>
          <div className="onboard-perks">
            <div className="onboard-perk"><h4>You keep your copyright</h4><p>Non-exclusive licence. Put the same work anywhere else.</p></div>
            <div className="onboard-perk"><h4>Audience funding</h4><p>Pitch Room lets viewers back your next project.</p></div>
            <div className="onboard-perk"><h4>We do the heavy lifting</h4><p>Encoding, captions, artwork sizing, publishing.</p></div>
            <div className="onboard-perk"><h4>Reach beyond on-demand</h4><p>Opt in and TapaTV can air your work live, with ads.</p></div>
          </div>
        </section>

        <nav className="onboard-steps" aria-label="On this page">
          <a href="#guidelines"><span>01</span>What we&rsquo;re looking for</a>
          <a href="#rights"><span>02</span>Rights check</a>
          <a href="#apply"><span>03</span>Apply</a>
          <a href="#next"><span>04</span>What happens next</a>
        </nav>

        <section id="guidelines" className="onboard-section">
          <div className="account-eyebrow">01 — What we&rsquo;re looking for</div>
          <h2 className="onboard-h2">Finished films and shorts, made by you.</h2>
          <p className="onboard-p">
            We&rsquo;re a home for independent work that&rsquo;s done and ready to watch. Series, podcasts and
            vertical Snippets are welcome too, but this page is about films and shorts.
          </p>
          <div className="onboard-guide-grid">
            <div className="onboard-card">
              <h3>Shorts</h3>
              <p>Under {ONBOARDING.shortMaxMinutes} minutes. Any genre. Student and first films welcome if they&rsquo;re finished.</p>
            </div>
            <div className="onboard-card">
              <h3>Films</h3>
              <p>{ONBOARDING.shortMaxMinutes} minutes and up. Narrative or documentary. Festival runs are fine as long as you still hold streaming rights.</p>
            </div>
            <div className="onboard-card">
              <h3>What we pass on</h3>
              <p>Trailers, works in progress, re-uploads of other people&rsquo;s work, compilations, and anything you can&rsquo;t clear in the rights check below.</p>
            </div>
          </div>
          <div className="onboard-card onboard-specs">
            <div><span className="onboard-label">Master file</span><p>Highest quality you have. MP4 or MOV, {ONBOARDING.minResolution} minimum, 4K welcome. We encode for streaming.</p></div>
            <div><span className="onboard-label">Picture &amp; sound</span><p>16:9 for films and shorts (9:16 is for Snippets). Stereo mix, no burnt-in subtitles.</p></div>
            <div><span className="onboard-label">Captions &amp; rating</span><p>An SRT if you have one; we caption what we can. Tell us the rating and any flashing-light warnings.</p></div>
            <div><span className="onboard-label">Artwork</span><p>A 2:3 poster and a 16:9 still, no text baked in. We can make these if you don&rsquo;t have them.</p></div>
          </div>
        </section>

        <section id="rights" className="onboard-section">
          <div className="account-eyebrow">02 — Rights check</div>
          <h2 className="onboard-h2">Five questions, so you know before you apply.</h2>
          <p className="onboard-p">
            Every submission is reviewed before it goes live. Most things that hold a film in review are rights
            problems, and unlicensed music is the most common one. Answer honestly and this tells you where
            you&rsquo;d stand.
          </p>
          <RightsCheck answers={answers} onAnswer={(id, v) => setAnswers((a) => ({ ...a, [id]: v }))} />
          <p className="onboard-fine">
            The full version of what you&rsquo;re promising us is in <Link href="/terms#submit-work">Terms, section 5</Link>:
            you keep your copyright, we get a non-exclusive licence to stream and promote, and you&rsquo;re responsible
            for anything you upload without the rights to it.
          </p>
        </section>

        <section id="apply" className="onboard-section">
          <div className="account-eyebrow">03 — Apply</div>

          {creator && (
            <div className="app-status level-ok">
              <span className="rights-tag">Creator Studio</span>
              <div className="app-status-title">You already have Creator Studio.</div>
              <p>No need to apply. Submit films, shorts and everything else there, and track their review.</p>
              <Link href="/creator" className="onboard-btn">Open Creator Studio →</Link>
            </div>
          )}

          {!creator && app && (
            <ApplicationStatus app={app} onReapply={() => setReapply(true)} reapplying={reapply} />
          )}

          {showForm && (
            <>
              {!app && (
                <>
                  <h2 className="onboard-h2">Tell us about the work.</h2>
                  <p className="onboard-p">
                    No upload here. Link to wherever the files already live. You&rsquo;ll need a free {SITE.name} account
                    so we can attach the application to you and show you its status.
                  </p>
                </>
              )}
              <form onSubmit={submit} className="account-card onboard-form" noValidate>
                <div className={`onboard-signin-strip ${signedIn ? 'on' : ''}`}>
                  {signedIn ? (
                    <span>Signed in as <strong>{shownEmail}</strong></span>
                  ) : (
                    <>
                      <span>You&rsquo;ll need a free account to send this.</span>
                      <SignInButton mode="modal"><button type="button" className="onboard-btn-secondary small">Sign in or create one</button></SignInButton>
                    </>
                  )}
                </div>

                <div className="account-eyebrow">About you</div>
                <div className="onboard-grid">
                  <div className="onboard-field">
                    <label htmlFor="ap-name">Your name</label>
                    <input id="ap-name" type="text" value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="As you want it credited" required />
                  </div>
                  <div className="onboard-field">
                    <label htmlFor="ap-portfolio">Portfolio or reel <em>optional</em></label>
                    <input id="ap-portfolio" type="url" value={form.portfolioUrl} onChange={(e) => update('portfolioUrl', e.target.value)} placeholder="https://" />
                  </div>
                </div>

                <div className="account-eyebrow">The work</div>
                <div className="onboard-grid">
                  <div className="onboard-field">
                    <label htmlFor="ap-title">Title</label>
                    <input id="ap-title" type="text" value={form.title} onChange={(e) => update('title', e.target.value)} required />
                  </div>
                  <div className="onboard-field">
                    <label htmlFor="ap-type">Type</label>
                    <select id="ap-type" value={form.contentType} onChange={(e) => update('contentType', e.target.value)}>
                      {APPLICATION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  <div className="onboard-field wide">
                    <label htmlFor="ap-logline">Logline, one sentence</label>
                    <input id="ap-logline" type="text" value={form.logline} onChange={(e) => update('logline', e.target.value)} maxLength={200} required />
                  </div>
                  <div className="onboard-field">
                    <label htmlFor="ap-genre">Genre</label>
                    <select id="ap-genre" value={form.mainGenre} onChange={(e) => update('mainGenre', e.target.value)}>
                      {APPLICATION_GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </div>
                  <div className="onboard-field">
                    <label htmlFor="ap-runtime">Runtime</label>
                    <input id="ap-runtime" type="text" value={form.runtime} onChange={(e) => update('runtime', e.target.value)} placeholder="e.g. 12 min, or 6 × 20 min" />
                  </div>
                  <div className="onboard-field">
                    <label htmlFor="ap-rating">Rating you&rsquo;d give it</label>
                    <select id="ap-rating" value={form.rating} onChange={(e) => update('rating', e.target.value)}>
                      {APPLICATION_RATINGS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div className="onboard-field">
                    <label htmlFor="ap-status">Where it stands</label>
                    <select id="ap-status" value={form.completionStatus} onChange={(e) => update('completionStatus', e.target.value)}>
                      {APPLICATION_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </div>
                  <div className="onboard-field wide">
                    <label htmlFor="ap-link">Link to the files</label>
                    <input id="ap-link" type="url" value={form.mediaLink} onChange={(e) => update('mediaLink', e.target.value)} placeholder="Google Drive, Dropbox, WeTransfer, Frame.io…" />
                  </div>
                  <div className="onboard-field wide">
                    <label htmlFor="ap-notes">Anything we should know <em>optional</em></label>
                    <textarea id="ap-notes" rows={3} value={form.mediaNotes} onChange={(e) => update('mediaNotes', e.target.value)} placeholder="Where it's screened, who made it, link password, whether captions exist." />
                  </div>
                </div>

                <div className="account-eyebrow">Rights</div>
                <div className="onboard-checks">
                  <label><input type="checkbox" checked={attest.rights} onChange={(e) => setAttest((a) => ({ ...a, rights: e.target.checked }))} /><span>{ATTEST[0].text}</span></label>
                  <label><input type="checkbox" checked={attest.check} onChange={(e) => setAttest((a) => ({ ...a, check: e.target.checked }))} /><span>{ATTEST[1].text}</span></label>
                  <label><input type="checkbox" checked={attest.terms} onChange={(e) => setAttest((a) => ({ ...a, terms: e.target.checked }))} /><span>I&rsquo;ve read <Link href="/terms#submit-work" target="_blank">Terms, section 5</Link>: I keep my copyright and grant a non-exclusive licence to stream and promote.</span></label>
                </div>

                {error && <p className="admin-error" role="alert">{error}</p>}

                <div className="onboard-send-row">
                  <button type="submit" className="onboard-btn" disabled={busy || Boolean(blocker)}>
                    {busy ? 'Sending…' : 'Send application'}
                  </button>
                  <span className="onboard-why">{blocker || `We read everything. Expect a reply within ${ONBOARDING.replyWindow}.`}</span>
                </div>
              </form>
            </>
          )}
        </section>

        <section id="next" className="onboard-section">
          <div className="account-eyebrow">04 — What happens next</div>
          <h2 className="onboard-h2">From application to live, in four steps.</h2>
          <div className="onboard-next">
            <div className="onboard-card"><span className="onboard-label">Step 1</span><h3>We read it</h3><p>Within {ONBOARDING.replyWindow}. Come back here any time to see your status: <span className="rights-tag inline">Under review</span></p></div>
            <div className="onboard-card"><span className="onboard-label">Step 2</span><h3>You&rsquo;re in</h3><p>Accepted applicants get Creator Studio on their account the same moment, plus an email.</p></div>
            <div className="onboard-card"><span className="onboard-label">Step 3</span><h3>You submit the film</h3><p>Upload the master in Creator Studio with artwork, rating and captions. It lands in our review queue.</p></div>
            <div className="onboard-card"><span className="onboard-label">Step 4</span><h3>Review, then live</h3><p>We check picture, sound and rights. Approved titles go live; anything held gets a reason you can fix.</p></div>
          </div>
        </section>

      </main>
      <Footer />
      <MobileTabBar />
    </>
  );
}

// Where the signed-in applicant's latest application stands.
function ApplicationStatus({ app, onReapply, reapplying }) {
  if (app.isOpen) {
    return (
      <div className="app-status level-warn">
        <span className="rights-tag">Under review</span>
        <div className="app-status-title">{app.title}</div>
        <p>Sent {fmtDate(app.createdAt)}. We aim to reply within {ONBOARDING.replyWindow}, and we&rsquo;ll email you when there&rsquo;s news.</p>
        {app.holds.length > 0 && (
          <>
            <div className="rights-result-label">Still to send us</div>
            <ul>{app.holds.map((h) => <li key={h}>{h}</li>)}</ul>
            <p>Reply to your confirmation email with these, or email {SITE.contactEmail}.</p>
          </>
        )}
      </div>
    );
  }
  if (app.status === 'accepted') {
    return (
      <div className="app-status level-ok">
        <span className="rights-tag">You&rsquo;re in</span>
        <div className="app-status-title">{app.title}</div>
        <p>Accepted {app.reviewedAt ? fmtDate(app.reviewedAt) : ''}. Creator Studio is on your account: upload the master, artwork, rating and captions there and it goes into our review queue.</p>
        {app.decisionNote && <p><strong>A note from us:</strong> {app.decisionNote}</p>}
        <Link href="/creator" className="onboard-btn">Open Creator Studio →</Link>
      </div>
    );
  }
  return (
    <div className="app-status level-neutral">
      <span className="rights-tag">Not this time</span>
      <div className="app-status-title">{app.title}</div>
      <p>Not a fit for {SITE.name} right now{app.reviewedAt ? ` (${fmtDate(app.reviewedAt)})` : ''}.</p>
      {app.decisionNote && <p><strong>A note from us:</strong> {app.decisionNote}</p>}
      {!reapplying && <button type="button" className="onboard-btn-secondary" onClick={onReapply}>Apply again with new work</button>}
    </div>
  );
}
