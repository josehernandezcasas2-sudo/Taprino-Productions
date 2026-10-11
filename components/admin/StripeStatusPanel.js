import { useCallback, useEffect, useState } from 'react';

// "Payments" card at the top of /admin/pitch-room: asks Stripe directly
// what's set up (lib/stripeStatus.js) and lists what's still missing
// before Pitch Room donations can be real.
export default function StripeStatusPanel() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/stripe-status');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not reach Stripe.');
      setStatus(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const missingEvents = status ? (status.checks.find((c) => c.key === 'webhook') || {}).missing || [] : [];

  return (
    <div className="account-card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <div className="account-eyebrow" style={{ marginBottom: 0 }}>
          Payments · Stripe
          {status && status.mode && <span className={`stripe-mode stripe-mode-${status.mode}`}>{status.mode} mode</span>}
        </div>
        <button type="button" className="account-btn-secondary" style={{ width: 'auto', fontSize: 12 }} onClick={load} disabled={loading}>
          {loading ? 'Checking…' : 'Re-check'}
        </button>
      </div>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {!status && !error && <p className="adm-empty">Asking Stripe…</p>}
      {status && (
        <>
          <p style={{ fontSize: 13, marginTop: 6 }}>
            {status.ready
              ? 'Everything Pitch Room donations need is in place.'
              : 'Donations stay off until every line below is green.'}
          </p>
          <ul className="stripe-checks">
            {status.checks.map((c) => (
              <li key={c.key} className={c.ok ? 'ok' : 'bad'}>
                <span className="stripe-check-mark" aria-hidden="true">{c.ok ? '✓' : '✕'}</span>
                <span>
                  <strong>{c.label}</strong>
                  <span className="stripe-check-detail">{c.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          {missingEvents.length > 0 && (
            <div className="stripe-events">
              <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>Events to add to the endpoint (Developers → Webhooks → the endpoint → Add events):</div>
              <code>{missingEvents.join('\n')}</code>
            </div>
          )}
          {status.mode === 'live' && (
            <p style={{ fontSize: 12, opacity: 0.75, marginTop: 8 }}>
              Live keys: a donation here charges a real card. Test the full flow with test keys on a preview deploy first.
            </p>
          )}
        </>
      )}
    </div>
  );
}
