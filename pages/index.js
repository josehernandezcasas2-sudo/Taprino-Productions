import { useState } from 'react';
import Link from 'next/link';
import Stripe from 'stripe';
import { episodes } from '../lib/episodes';
import { verifyCookie, readCookieFromHeader } from '../lib/cookie-auth';
import { getServerSession } from '../lib/get-session';
import { authClient } from '../lib/auth-client';
import VideoPlayer from '../components/VideoPlayer';
import EpisodeShelf from '../components/EpisodeShelf';
import SignalPanel from '../components/SignalPanel';

async function hasActiveSubscription(stripe, customerId) {
  if (!customerId) return false;
  try {
    const subs = await stripe.subscriptions.list({
      customer: customerId,
      status: 'active',
      limit: 1,
    });
    return subs.data.length > 0;
  } catch (err) {
    return false;
  }
}

export async function getServerSideProps({ req }) {
  let isSubscriber = false;

  const session = await getServerSession(req);
  const user = session?.user
    ? { name: session.user.name, email: session.user.email }
    : null;

  if (process.env.STRIPE_SECRET_KEY) {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    // Prefer the Stripe customer linked to the signed-in account, so membership
    // follows the login across devices.
    if (session?.user?.stripeCustomerId) {
      isSubscriber = await hasActiveSubscription(stripe, session.user.stripeCustomerId);
    }

    // Fall back to the legacy signed cookie (anonymous / pre-account members).
    if (!isSubscriber) {
      const customerId = verifyCookie(readCookieFromHeader(req.headers.cookie));
      isSubscriber = await hasActiveSubscription(stripe, customerId);
    }
  }

  return { props: { isSubscriber, user } };
}

export default function Home({ isSubscriber, user }) {
  const [current, setCurrent] = useState(episodes[0]);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const locked = current.tier === 'premium' && !isSubscriber;

  async function startCheckout() {
    setCheckoutLoading(true);
    try {
      const res = await fetch('/api/create-checkout-session', { method: 'POST' });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || 'Checkout is not configured yet — add your Stripe keys to .env.local.');
        setCheckoutLoading(false);
      }
    } catch (err) {
      alert('Could not start checkout.');
      setCheckoutLoading(false);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await authClient.signOut();
      window.location.reload();
    } catch (err) {
      setSigningOut(false);
    }
  }

  return (
    <>
      <header className="channel-bar">
        <div className="channel-mark">
          <span className="dot" aria-hidden="true" />
          <span>ON AIR</span>
        </div>
        <div className="channel-title">
          TAPRINO TRANSMISSION
          <span className="sub">a Studio Taprino screening room</span>
        </div>
        <div className="channel-account">
          <span className="channel-status" style={{ fontFamily: 'var(--font-mono)' }}>
            {isSubscriber ? 'Cipher Circle member' : 'Free signal'}
          </span>
          {user ? (
            <>
              <span className="account-name" title={user.email}>
                {user.name || user.email}
              </span>
              <button
                type="button"
                className="account-btn"
                onClick={handleSignOut}
                disabled={signingOut}
              >
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </>
          ) : (
            <Link href="/sign-in" className="account-btn">
              Sign in
            </Link>
          )}
        </div>
      </header>

      <main className="stage">
        <div>
          <div className="player-card">
            <div className="now-heading">
              <div className="eyebrow">
                {current.tier === 'premium' ? 'Now screening — Cipher Circle exclusive' : 'Now screening — free signal'}
              </div>
              <h1>{current.title}</h1>
              <p>{current.desc}</p>
            </div>

            {locked ? (
              <div className="lock-panel">
                <div className="glyph">◈</div>
                <h3>Encrypted for Cipher Circle members</h3>
                <p>
                  This one only screens for people who&rsquo;ve joined the circle. Members get early
                  drops, deleted scenes, and the cipher clues before anyone else.
                </p>
                <button className="unlock-btn" onClick={startCheckout} disabled={checkoutLoading}>
                  {checkoutLoading ? 'Opening checkout…' : 'Join the Cipher Circle'}
                </button>
                {!user && (
                  <p className="lock-hint">
                    Already a member? <Link href="/sign-in">Sign in</Link> to unlock on this device.
                  </p>
                )}
              </div>
            ) : (
              <VideoPlayer episode={current} adsEnabled={current.tier === 'free'} />
            )}

            <div className="player-meta">
              <span>{current.runtime}</span>
              <span>{current.tier === 'free' ? 'Free tier · ad-supported' : 'Cipher Circle · ad-free'}</span>
            </div>
          </div>

          <div className="shelf-heading">On the shelf</div>
          <EpisodeShelf episodes={episodes} currentId={current.id} onSelect={setCurrent} />

          <div className="plumbing">
            <strong>What&rsquo;s real here:</strong> Stripe Checkout + webhook (test mode, $0 until someone
            actually pays), a signed cookie that checks your live Stripe status on every load — no database
            to keep in sync — and the real Google IMA SDK serving Google&rsquo;s public sample ad tag on
            free episodes.<br />
            <strong>What to swap before launch:</strong> the placeholder video files for your own
            (Cloudflare Stream or Mux, both pay-per-minute), and <code>NEXT_PUBLIC_AD_TAG_URL</code> for
            your own Google Ad Manager tag once you&rsquo;re approved to run paid ads.
          </div>
        </div>

        <aside>
          <SignalPanel />
        </aside>
      </main>
    </>
  );
}
