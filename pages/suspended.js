import Head from 'next/head';
import Link from 'next/link';
import { useClerk } from '@clerk/nextjs';
import { getAuth } from '@clerk/nextjs/server';
import { getRoleContext } from '../lib/roles';
import { getSuspensionFor } from '../lib/suspensions';
import { untilLabel } from '../lib/suspensionRules';
import { SITE } from '../lib/siteConfig';

// The bounced card (Jose, 2026-10-24; canvas "Suspension, push and ad
// share", first board). middleware.js sends a signed-in person with a
// whole-account suspension in force here from every page but this one,
// the legal pages and contact. It says why (the admin's public reason),
// until when, what still works, and how to appeal. Sign out is the one
// action. ?preview=1 shows it to an admin who isn't suspended.
export async function getServerSideProps({ req, res, query }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const { userId } = getAuth(req);
  if (!userId) return { redirect: { destination: '/', permanent: false } };
  const [suspended, rc] = await Promise.all([getSuspensionFor(userId), getRoleContext(req).catch(() => ({ email: null, isAdmin: false }))]);
  if (suspended && suspended.scope === 'all') {
    return { props: { reason: suspended.reason, until: suspended.until, cancelMembership: suspended.cancelMembership, email: rc.email || null, preview: false } };
  }
  if (query.preview === '1' && rc.isAdmin) {
    return { props: { reason: 'Repeated abusive notes sent with tips after a warning.', until: new Date(Date.now() + 30 * 86400000).toISOString(), cancelMembership: true, email: rc.email || null, preview: true } };
  }
  return { redirect: { destination: '/account', permanent: false } };
}

export default function Suspended({ reason, until, cancelMembership, email, preview }) {
  const { signOut } = useClerk();
  const untilText = untilLabel(until);
  return (
    <>
      <Head>
        <title>{`Account suspended — ${SITE.name}`}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <div className="welcome">
        <header className="welcome-bar">
          <span className="welcome-brand">{SITE.nameUpper}</span>
          {email && <span className="welcome-pill" style={{ color: 'var(--ink-faint)', borderColor: 'var(--ocean-ink)' }}>{email}</span>}
        </header>

        <main id="main-content" className="welcome-main">
          {preview && <p className="welcome-preview">Preview: your account isn’t suspended. This is what a suspended person sees.</p>}
          <section className="welcome-hero suspended-card">
            <span className="welcome-kicker" style={{ color: 'var(--danger)' }}>Account suspended</span>
            <h1>Your account is suspended</h1>

            <div className="suspended-why">
              <span className="suspended-label">Why</span>
              <span>{reason}</span>
            </div>

            <p>
              <b style={{ color: 'var(--ink)' }}>{until ? `${untilText.charAt(0).toUpperCase()}${untilText.slice(1)}.` : 'Until we hear from you.'}</b>{' '}
              {until ? 'You can sign in again from that day.' : 'Write to us and a person will look at it.'}
              {cancelMembership ? ' Your membership won’t renew while this lasts.' : ''}
            </p>

            <div className="suspended-block">
              <span className="suspended-label">While it lasts</span>
              <span>You can’t watch, tip, back, buy, message or post. Nothing is deleted: your purchases, your lists and your work are all still here when it lifts.</span>
            </div>

            <div className="suspended-block">
              <span className="suspended-label">To appeal</span>
              <span>Write to <a href={`mailto:${SITE.contactEmail}?subject=${encodeURIComponent(`${SITE.name} account suspension`)}`}>{SITE.contactEmail}</a> from the email on your account and tell us what happened. A person reads every one; we answer within a few days.</span>
            </div>

            <div className="welcome-cta" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <a className="welcome-btn" href={`mailto:${SITE.contactEmail}?subject=${encodeURIComponent(`${SITE.name} account suspension`)}`}>Email us</a>
              <button type="button" className="welcome-btn ghost" onClick={() => signOut({ redirectUrl: '/' })}>Sign out</button>
            </div>

            <p className="welcome-note" style={{ textAlign: 'left' }}>
              The rules this is under: <Link href="/terms">Terms, section 10 (Ending things)</Link>. The Terms, Privacy and Contact pages stay open while you’re suspended.
            </p>
          </section>
        </main>

        <footer className="welcome-foot">
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/contact">Contact</Link>
        </footer>
      </div>
    </>
  );
}
