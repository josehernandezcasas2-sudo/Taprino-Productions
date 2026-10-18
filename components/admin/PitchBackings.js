import { useEffect, useState } from 'react';
import { dollars } from '../../lib/donationMath';

// The backings on one in-platform-funded pitch, with the admin-only
// refund (final, see lib/pitchDonations.js refundDonation). Opens under
// the funding row of a pitch on /admin/pitch-room.
export default function PitchBackings({ pitchId, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  async function load() {
    try {
      const res = await fetch(`/api/admin/pitch-donations?pitchId=${encodeURIComponent(pitchId)}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not load backings.');
      setData(d);
    } catch (err) {
      setError(err.message);
    }
  }
  useEffect(() => { load(); }, [pitchId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function refund(b) {
    const who = b.backerName || b.donorEmail || 'this backer';
    const reason = window.prompt(
      `Refund ${dollars(b.totalChargedCents || b.amountCents)} to ${who}?\n\n` +
      'The backer gets the whole amount back, the creator’s share is pulled back out of their Stripe balance, and Studio Tapa returns its cut. Stripe keeps its processing fee, so Studio Tapa absorbs it. This can’t be undone.\n\n' +
      'Reason (optional):'
    );
    if (reason === null) return;
    setBusyId(b.id);
    setError(null);
    try {
      const res = await fetch('/api/admin/pitch-donations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ donationId: b.id, reason })
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Refund failed.');
      await load();
      if (onChanged) onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  if (error) return <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>{error}</p>;
  if (!data) return <p className="adm-empty">Loading backings…</p>;

  const paid = data.backings.filter((b) => b.status === 'completed');
  const raised = paid.reduce((s, b) => s + b.amountCents, 0);
  const cut = paid.reduce((s, b) => s + b.platformCutCents, 0);
  const backers = new Set(paid.map((b) => b.donorUserId)).size;
  const refunded = data.backings.filter((b) => b.status === 'refunded');
  const disputed = data.backings.filter((b) => b.status === 'disputed');
  const statusText = (b) => {
    if (b.status === 'refunded') return `Refunded${b.refundReason ? ` · ${b.refundReason}` : ''}`;
    if (b.status === 'disputed') return `Disputed · ${b.disputeStatus === 'lost' ? 'lost' : 'waiting on the bank'}${b.clawbackCents ? ` · ${dollars(b.clawbackCents)} taken back from the creator` : ''}`;
    if (b.disputeStatus === 'won') return `Paid · dispute won${b.returnedCents ? ` · ${dollars(b.returnedCents)} paid back` : ''}`;
    return 'Paid';
  };

  return (
    <div className="bk">
      <div className="bk-summary">
        <span><b>{dollars(raised)}</b> raised from {backers} backer{backers === 1 ? '' : 's'}</span>
        <span>{dollars(cut)} platform cut</span>
        {refunded.length > 0 && <span>{refunded.length} refunded</span>}
        {disputed.length > 0 && <span>{disputed.length} disputed (answer in the Stripe Dashboard)</span>}
        {data.pendingCount > 0 && <span>{data.pendingCount} checkout{data.pendingCount === 1 ? '' : 's'} still open</span>}
        {data.failedCount > 0 && <span>{data.failedCount} expired or failed</span>}
      </div>
      {data.backings.length === 0 ? (
        <p className="adm-empty">No backings yet.</p>
      ) : (
        <table className="bk-table">
          <thead>
            <tr><th>When</th><th>Backer</th><th>Pledge</th><th>Charged</th><th>Creator</th><th>Cut</th><th>Status</th><th aria-label="Actions" /></tr>
          </thead>
          <tbody>
            {data.backings.map((b) => (
              <tr key={b.id} className={b.status}>
                <td>{new Date(b.completedAt || b.createdAt).toLocaleDateString()}</td>
                <td>
                  {b.backerName || '—'}
                  {b.donorEmail && <span className="bk-email">{b.donorEmail}</span>}
                </td>
                <td>{dollars(b.amountCents)}</td>
                <td>{dollars(b.totalChargedCents || b.amountCents)}</td>
                <td>{dollars(b.creatorPayoutCents)}</td>
                <td>{dollars(b.platformCutCents)}</td>
                <td>{statusText(b)}</td>
                <td>
                  {b.status === 'completed' && (
                    <button type="button" className="account-btn-secondary" style={{ width: 'auto', fontSize: 12 }} disabled={busyId === b.id} onClick={() => refund(b)}>
                      {busyId === b.id ? 'Refunding…' : 'Refund'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
