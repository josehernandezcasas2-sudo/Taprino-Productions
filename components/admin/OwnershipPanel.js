import { useEffect, useState } from 'react';
import Link from 'next/link';

// Series ownership + the read-only creator roster, moved out of the old
// pages/admin.js hub (2026-10-08). Rendered by pages/admin/ownership.js.
export default function OwnershipPanel() {
  const [seriesOwnership, setSeriesOwnership] = useState(null);
  const [ownershipInputs, setOwnershipInputs] = useState({});
  const [ownershipSaving, setOwnershipSaving] = useState(null);
  const [ownershipError, setOwnershipError] = useState(null);
  const [roster, setRoster] = useState(null);

  async function loadSeriesOwnership() {
    try {
      const res = await fetch('/api/admin/series-ownership');
      const data = await res.json();
      if (res.ok) setSeriesOwnership(data.series);
    } catch (err) {
      setSeriesOwnership([]);
    }
  }

  async function loadRoster() {
    try {
      const res = await fetch('/api/admin/creators');
      const data = await res.json();
      if (res.ok) setRoster(data.creators);
    } catch (err) {
      setRoster([]);
    }
  }

  useEffect(() => { loadSeriesOwnership(); loadRoster(); }, []);

  async function saveOwnership(seriesId) {
    setOwnershipSaving(seriesId);
    setOwnershipError(null);
    try {
      const res = await fetch('/api/admin/series-ownership', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seriesId, ownerEmail: ownershipInputs[seriesId] || '' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not update ownership.');
      await loadSeriesOwnership();
    } catch (err) {
      setOwnershipError(err.message);
    } finally {
      setOwnershipSaving(null);
    }
  }

  return (
    <>
      <div className="account-card">
        <div className="account-eyebrow">Series ownership</div>
        <h3>Who owns each show</h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--ink-dim)', marginBottom: '1rem' }}>
          Connects a show to a specific creator so they can see it in their own &ldquo;Your work&rdquo;
          and &ldquo;Your numbers&rdquo; pages — including shows they didn&rsquo;t personally upload, like one
          you set up or added episodes to on their behalf. Leave blank to unassign.
        </p>
        {!seriesOwnership ? (
          <p>Loading…</p>
        ) : seriesOwnership.length === 0 ? (
          <p className="adm-empty">No shows yet.</p>
        ) : (
          <>
            {ownershipError && <p style={{ color: 'var(--danger)' }}>{ownershipError}</p>}
            {seriesOwnership.map((s) => (
              <div key={s.id} style={{ borderTop: '1px solid rgba(251,232,211,0.1)', padding: '0.8rem 0', display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 200px' }}>
                  <div style={{ fontSize: '0.9rem' }}>{s.name}</div>
                  <div style={{ fontSize: '0.75rem', color: s.ownerEmail ? 'var(--ink-dim)' : 'var(--signal-amber)' }}>
                    {s.ownerEmail ? `Owner: ${s.ownerEmail}` : 'Unassigned'}
                  </div>
                </div>
                <input
                  type="email"
                  placeholder="creator@example.com"
                  defaultValue={s.ownerEmail && s.ownerEmail !== '(account not found)' ? s.ownerEmail : ''}
                  onChange={(e) => setOwnershipInputs((prev) => ({ ...prev, [s.id]: e.target.value }))}
                  style={{ flex: '1 1 200px', margin: 0 }}
                />
                <button className="account-btn-secondary" style={{ width: 'auto' }} disabled={ownershipSaving === s.id} onClick={() => saveOwnership(s.id)}>
                  {ownershipSaving === s.id ? 'Saving…' : 'Save'}
                </button>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="account-card">
        <div className="account-eyebrow">Creator roster</div>
        <h3>Everyone with creator or admin access</h3>
        {!roster ? (
          <p>Loading…</p>
        ) : roster.length === 0 ? (
          <p className="adm-empty">No creators or admins yet.</p>
        ) : (
          roster.map((c) => (
            <div key={c.id} style={{ borderTop: '1px solid rgba(251,232,211,0.1)', padding: '0.7rem 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem' }}>
                <strong style={{ fontSize: '0.9rem' }}>{c.email || '(no email on file)'}</strong>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: c.role === 'admin' ? 'var(--brass)' : 'var(--signal-amber)' }}>
                  {c.role}
                </span>
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--ink-dim)', marginTop: '0.2rem' }}>
                {c.totalSubmissions} submission{c.totalSubmissions === 1 ? '' : 's'} · {c.approved} approved · {c.pending} pending · {c.rejected} rejected
                {c.approvalRate !== null ? ` · ${c.approvalRate}% approval rate` : ''}
              </div>
            </div>
          ))
        )}
        <p style={{ marginTop: '1.2rem', fontSize: '0.85rem' }}>
          To grant or revoke access — including sub-admin roles and permission toggles —
          use <Link href="/admin/team">Team &amp; roles →</Link>.
        </p>
      </div>
    </>
  );
}
