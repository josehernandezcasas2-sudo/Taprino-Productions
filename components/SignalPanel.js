import { useState } from 'react';
import { SITE } from '../lib/siteConfig';

// Replaces the old fictional-character-following segmentation ("Willa,
// Sir Mallory, Fintan…") with a real preference — what someone actually
// wants email about. That old dropdown was placeholder/in-joke data from
// early on that never got wired to anything meaningful.
const INTERESTS = [
  { value: 'New episodes', label: 'New episodes only' },
  { value: 'New episodes + creator updates', label: 'New episodes + creator updates' },
  { value: 'Everything', label: 'Everything — episodes, creator news, the occasional announcement' }
];

export default function SignalPanel({ isSignedIn }) {
  const [email, setEmail] = useState('');
  const [interest, setInterest] = useState(INTERESTS[0].value);
  const [status, setStatus] = useState('idle'); // idle | loading | success | error
  const [errorMsg, setErrorMsg] = useState('');
  const [dismissed, setDismissed] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email.includes('@')) return;
    setStatus('loading');
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, interest })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');
      setStatus('success');
      setEmail('');
    } catch (err) {
      setErrorMsg(err.message);
      setStatus('error');
    }
  }

  async function handleOptOut() {
    if (isSignedIn) {
      try {
        await fetch('/api/newsletter-preference', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'optOut' })
        });
      } catch (e) {
        // Even if this fails, still dismiss locally — worst case it asks again next visit.
      }
    } else {
      // Not signed in — just remember the choice on this browser.
      document.cookie = 'taprino_nl_dismiss=1; path=/; max-age=' + 60 * 60 * 24 * 365;
    }
    setDismissed(true);
  }

  if (dismissed) return null;

  return (
    <div className="postcard signal-panel-v2">
      <div className="postcard-inner">
        <button className="postcard-optout" onClick={handleOptOut} type="button">
          Opt out ✕
        </button>

        {status === 'success' && (
          <div className="confirm-msg">You&rsquo;re on the list — first email lands next time we publish.</div>
        )}
        {status === 'error' && <div className="error-msg">{errorMsg}</div>}

        <div className="postcard-eyebrow">Stay in the loop</div>
        <h3>Get new episodes in your inbox</h3>
        <p>
          No algorithm decides when you hear from {SITE.studio}. We&rsquo;ll email you when something
          new drops — nothing else, and never more than once a week.
        </p>

        <form onSubmit={handleSubmit}>
          <label className="field-label" htmlFor="fan-email">Your email</label>
          <input
            id="fan-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@somewhere.com"
          />

          <label className="field-label" htmlFor="fan-interest">What do you want to hear about?</label>
          <select id="fan-interest" value={interest} onChange={(e) => setInterest(e.target.value)}>
            {INTERESTS.map((i) => (
              <option key={i.value} value={i.value}>{i.label}</option>
            ))}
          </select>

          <button type="submit" className="submit" disabled={status === 'loading'}>
            {status === 'loading' ? 'Signing up…' : 'Sign me up'}
          </button>
        </form>

        <div className="fineprint">
          One email per week, at most. Manage this any time from Account settings.
        </div>
      </div>
    </div>
  );
}
