import { useState } from 'react';

const CHARACTERS = ['Willa', 'Sir Mallory', 'Fintan', 'Clover', 'Olaga', 'Still deciding'];

export default function SignalPanel({ isSignedIn }) {
  const [email, setEmail] = useState('');
  const [character, setCharacter] = useState(CHARACTERS[0]);
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
        body: JSON.stringify({ email, character })
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
    <div className="postcard">
      <div className="postcard-inner">
        <button className="postcard-optout" onClick={handleOptOut} type="button">
          Opt out ✕
        </button>

        {status === 'success' && (
          <div className="confirm-msg">Signal received. Welcome to the frequency.</div>
        )}
        {status === 'error' && <div className="error-msg">{errorMsg}</div>}

        <div className="postcard-eyebrow">Stay on frequency</div>
        <h3>Join the circle around the signal</h3>
        <p>
          No algorithm decides when you hear from us. Drop your frequency and we&rsquo;ll send new
          episodes, behind-the-frame process notes, and cipher clues straight through — nothing else.
        </p>

        <form onSubmit={handleSubmit}>
          <label className="field-label" htmlFor="fan-email">Your frequency</label>
          <input
            id="fan-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@somewhere.com"
          />

          <label className="field-label" htmlFor="fan-fav">Which signal do you follow?</label>
          <select id="fan-fav" value={character} onChange={(e) => setCharacter(e.target.value)}>
            {CHARACTERS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <button type="submit" className="submit" disabled={status === 'loading'}>
            {status === 'loading' ? 'Sending…' : 'Tune in'}
          </button>
        </form>

        <div className="fineprint">
          One email per week, at most. Manage this any time from Account settings.
        </div>
      </div>
    </div>
  );
}
