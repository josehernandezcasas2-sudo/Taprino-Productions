import { useState } from 'react';
import { SITE } from '../../lib/siteConfig';

// /account/preferences (option B, 2026-10-29): the newsletter and
// "Start in Stream" as switches, and a note that push lives in the app.
// The same two handlers the old one-page /account had.
export function Switch({ on, onToggle, label, busy = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`seal-switch acct-switch ${on ? 'on' : ''}`}
      onClick={onToggle}
      disabled={busy}
    />
  );
}

export default function PreferencesSection({ newsletterStatus = 'undecided', profile, setProfile }) {
  const [newsletter, setNewsletter] = useState(newsletterStatus);
  const [newsletterLoading, setNewsletterLoading] = useState(false);

  async function toggleNewsletter() {
    const action = newsletter === 'subscribed' ? 'optOut' : 'optIn';
    setNewsletterLoading(true);
    try {
      const res = await fetch('/api/newsletter-preference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      const data = await res.json();
      if (res.ok) setNewsletter(data.newsletter);
    } catch (err) {
      // The switch just stays as it is if this fails.
    }
    setNewsletterLoading(false);
  }

  async function toggleStayInStream() {
    const next = !(profile && profile.stayInStream);
    setProfile((p) => ({ ...p, stayInStream: next }));
    try {
      const res = await fetch('/api/account/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stayInStream: next })
      });
      if (!res.ok) throw new Error();
    } catch (err) {
      setProfile((p) => ({ ...p, stayInStream: !next }));
    }
  }

  return (
    <>
      <div className="account-card">
        <div className="account-subheading">Email</div>
        <div className="account-row">
          <div>
            <div className="account-row-label">Newsletter</div>
            <div className="account-row-detail">
              {newsletter === 'subscribed' && 'New episodes, creator updates and the occasional announcement.'}
              {newsletter === 'opted_out' && 'Off — you won’t be asked again unless you switch it back on.'}
              {newsletter === 'undecided' && 'Not chosen yet — the signup panel keeps showing until you decide.'}
            </div>
          </div>
          <Switch on={newsletter === 'subscribed'} onToggle={toggleNewsletter} label="Newsletter" busy={newsletterLoading} />
        </div>
      </div>

      <div className="account-card">
        <div className="account-subheading">Browsing</div>
        <div className="account-row">
          <div>
            <div className="account-row-label">Start in Stream</div>
            <div className="account-row-detail">
              {profile && profile.stayInStream
                ? 'On — the logo opens Stream, skipping the Connect home.'
                : `Off — the logo opens the ${SITE.name} home.`}
            </div>
          </div>
          <Switch on={Boolean(profile && profile.stayInStream)} onToggle={toggleStayInStream} label="Start in Stream" busy={!profile} />
        </div>
      </div>

      <div className="account-card">
        <div className="account-subheading">The app</div>
        <div className="account-row">
          <div>
            <div className="account-row-label">Push notifications</div>
            <div className="account-row-detail">Messages, calls and payouts on your phone. Switched on and off in the {SITE.name} app, under Account.</div>
          </div>
        </div>
      </div>
    </>
  );
}
