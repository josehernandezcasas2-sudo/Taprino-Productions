import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { SignInButton, SignUp, useUser } from '@clerk/nextjs';
import { getAuth } from '@clerk/nextjs/server';
import { privateBetaOn, safeNext, REQUEST_KINDS } from '../lib/privateBetaRules';
import { SITE } from '../lib/siteConfig';

// The private beta door (Jose, 2026-10-21; mockup: the "Private beta gate"
// canvas, plain variant). While PRIVATE_BETA is on, middleware.js sends
// every signed-out visitor here. Three things on it: Sign in (Clerk's
// modal; an invited person's account already exists once they followed
// the invitation link), Request an invite (writes beta_requests, shown on
// /admin/invites), and the way to /apply for creators. An invitation link
// lands here with ?__clerk_ticket=…, and the SignUp box below turns the
// ticket into an account — the only way one can be made while Clerk's
// sign-up mode is Restricted.
//
// With the switch off the page redirects home, except ?preview=1 so the
// page can be looked at before flipping it.
export async function getServerSideProps({ req, res, query }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const on = privateBetaOn();
  const preview = !on && query.preview === '1';
  if (!on && !preview) return { redirect: { destination: '/', permanent: false } };
  const hasTicket = typeof query.__clerk_ticket === 'string' && query.__clerk_ticket.length > 0;
  const next = safeNext(query.next);
  const { userId } = getAuth(req);
  if (userId && !hasTicket && !preview) return { redirect: { destination: next, permanent: false } };
  return { props: { next, hasTicket, preview } };
}

export default function Welcome({ next, hasTicket, preview }) {
  const router = useRouter();
  const { isSignedIn } = useUser();
  // Signed in through the modal (no reload): go where they were headed.
  useEffect(() => {
    if (isSignedIn && !hasTicket && !preview) router.replace(next);
  }, [isSignedIn, hasTicket, preview, next, router]);

  return (
    <>
      <Head>
        <title>{`Private beta — ${SITE.name}`}</title>
        <meta name="robots" content="noindex, nofollow" />
        <meta name="description" content={`${SITE.name} is opening to invited people first.`} />
      </Head>
      <div className="welcome">
        <header className="welcome-bar">
          <span className="welcome-brand">{SITE.nameUpper}</span>
          <span className="welcome-pill">Private beta</span>
        </header>

        <main id="main-content" className="welcome-main">
          {preview && <p className="welcome-preview">Preview: the switch is off, so this page only shows with <code>?preview=1</code> and the form won’t send.</p>}

          {hasTicket ? (
            <section className="welcome-hero">
              <Mark />
              <span className="welcome-kicker">You’re invited</span>
              <h1>Make your account.</h1>
              <p>Your invitation is attached to this page. Pick a password and you’re in.</p>
              <div className="welcome-signup">
                <SignUp routing="hash" forceRedirectUrl={next} signInUrl="/welcome" />
              </div>
              <p className="welcome-note">Already made it? <SignInButton mode="modal" forceRedirectUrl={next}><button type="button" className="welcome-linkbtn">Sign in instead</button></SignInButton></p>
            </section>
          ) : (
            <>
              <section className="welcome-hero">
                <Mark />
                <span className="welcome-kicker">Private screening</span>
                <h1>{SITE.name} is opening to invited people first.</h1>
                <p>Independent films, series and podcasts, and creators paid by the people who watch them. Invited creators and friends are in; everyone else, soon.</p>
                <div className="welcome-cta">
                  <SignInButton mode="modal" forceRedirectUrl={next}>
                    <button type="button" className="welcome-btn">Sign in</button>
                  </SignInButton>
                  <span className="welcome-note">Invited? The link in your email creates your account.</span>
                </div>
              </section>

              <RequestForm preview={preview} />

              <section className="welcome-makers">
                <b>Make films?</b>
                <span>Creators keep their rights, get paid from memberships and sales, and can fund the next one in the Pitch Room. <Link href="/apply">Read how it works and apply</Link>.</span>
              </section>
            </>
          )}
        </main>

        <footer className="welcome-foot">
          <Link href="/about">About</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/contact">Contact</Link>
        </footer>
      </div>
    </>
  );
}

function Mark() {
  return (
    <svg className="welcome-mark" width="56" height="56" viewBox="0 0 56 56" role="img" aria-label={`${SITE.studio} mark`}>
      <circle cx="28" cy="28" r="22" fill="none" stroke="rgba(var(--olive-rgb), 0.28)" strokeWidth="3" />
      <circle cx="28" cy="28" r="22" fill="none" stroke="var(--olive)" strokeWidth="3" strokeDasharray="104 138" strokeLinecap="round" transform="rotate(-90 28 28)" />
      <text x="28" y="34" textAnchor="middle" fontFamily="var(--font-display)" fontWeight="700" fontSize="17" fill="var(--ink)">ST</text>
    </svg>
  );
}

function RequestForm({ preview }) {
  const [email, setEmail] = useState('');
  const [kind, setKind] = useState('viewer');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (preview) { setError('Preview: sending is off.'); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/beta/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, kind }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');
      setDone(data.repeat ? 'You’re already on the list. We’ll write when a spot opens.' : 'Got it. We’ll write when a spot opens.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="welcome-request">
      <b>Request an invite</b>
      <span>Leave your email and we’ll write when a spot opens. Creators with finished work go first.</span>
      {done ? (
        <p className="welcome-ok">{done}</p>
      ) : (
        <form onSubmit={submit} className="welcome-form">
          <label className="crew-field"><span>Email</span>
            <input className="crew-input" type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="crew-field"><span>I am a</span>
            <select className="crew-select" value={kind} onChange={(e) => setKind(e.target.value)}>
              {REQUEST_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </label>
          {error && <p className="welcome-err">{error}</p>}
          <button type="submit" className="welcome-btn ghost" disabled={busy}>{busy ? 'Sending…' : 'Request an invite'}</button>
        </form>
      )}
    </section>
  );
}
