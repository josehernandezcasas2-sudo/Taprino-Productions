import { useState } from 'react';

// Site-wide "get updates from us" signup, distinct from the homepage-only
// SignalPanel (components/SignalPanel.js) which asks about content
// preference. This one is deliberately simple — just an email address —
// since it's meant to appear everywhere via the footer, not as a
// dedicated homepage feature.
export default function NewsletterSignup() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('idle'); // idle | loading | success | error
  const [errorMsg, setErrorMsg] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email.includes('@')) return;
    setStatus('loading');
    setErrorMsg('');
    try {
      const res = await fetch('/api/newsletter-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not sign up right now.');
      setStatus('success');
    } catch (err) {
      setStatus('error');
      setErrorMsg(err.message);
    }
  }

  if (status === 'success') {
    return (
      <div className="newsletter-signup">
        <h4>Stay in the loop</h4>
        <p className="newsletter-success">You&rsquo;re on the list — thanks for signing up.</p>
      </div>
    );
  }

  return (
    <div className="newsletter-signup">
      <h4>Stay in the loop</h4>
      <p className="newsletter-blurb">New episodes, creator news, and the occasional announcement.</p>
      <form onSubmit={handleSubmit} className="newsletter-form">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
          disabled={status === 'loading'}
        />
        <button type="submit" disabled={status === 'loading'}>
          {status === 'loading' ? 'Joining…' : 'Sign up'}
        </button>
      </form>
      {status === 'error' && <p className="newsletter-error">{errorMsg}</p>}
    </div>
  );
}
