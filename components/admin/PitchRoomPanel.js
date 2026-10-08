import { useEffect, useState } from 'react';

// Pitch Room admin: reported comments, add a pitch by hand, approve /
// reject / delete, and in-platform funding toggles. Moved out of the old
// pages/admin.js hub (2026-10-08) unchanged in behaviour; rendered by
// pages/admin/pitch-room.js inside AdminShell.
export default function PitchRoomPanel() {
  const [pitches, setPitches] = useState(null);
  const [pitchForm, setPitchForm] = useState({ title: '', logline: '', description: '', projectUrl: '', creatorName: '', creatorEmail: '' });
  const [pitchSaving, setPitchSaving] = useState(false);
  const [pitchError, setPitchError] = useState(null);
  const [reportedComments, setReportedComments] = useState(null);
  const [cutPercentInputs, setCutPercentInputs] = useState({});
  const [fundingBusyId, setFundingBusyId] = useState(null);

  async function loadReportedComments() {
    try {
      const res = await fetch('/api/admin/pitch-comments');
      const data = await res.json();
      setReportedComments(data.comments || []);
    } catch (err) {
      // Non-fatal — the moderation queue just stays empty if this fails.
    }
  }

  async function moderateComment(commentId, action) {
    try {
      await fetch('/api/admin/pitch-comments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId, action })
      });
      await loadReportedComments();
    } catch (err) {
      setPitchError('Could not update that comment.');
    }
  }

  async function loadPitches() {
    try {
      const res = await fetch('/api/admin/pitches');
      const data = await res.json();
      setPitches(data.pitches || []);
    } catch (err) {
      setPitchError('Could not load pitches.');
    }
  }

  useEffect(() => { loadPitches(); loadReportedComments(); }, []);

  async function addPitch(e) {
    e.preventDefault();
    setPitchSaving(true);
    setPitchError(null);
    try {
      const res = await fetch('/api/admin/pitches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pitchForm)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not add pitch.');
      setPitchForm({ title: '', logline: '', description: '', projectUrl: '', creatorName: '', creatorEmail: '' });
      await loadPitches();
    } catch (err) {
      setPitchError(err.message);
    } finally {
      setPitchSaving(false);
    }
  }

  async function setPitchStatus(pitchId, status) {
    try {
      await fetch('/api/admin/pitches', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pitchId, status })
      });
      await loadPitches();
    } catch (err) {
      setPitchError('Could not update that pitch.');
    }
  }

  async function deletePitch(pitchId) {
    if (!confirm('Delete this pitch permanently?')) return;
    try {
      await fetch('/api/admin/pitches', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pitchId })
      });
      await loadPitches();
    } catch (err) {
      setPitchError('Could not delete that pitch.');
    }
  }

  async function enablePitchFunding(pitchId) {
    const cutPercent = cutPercentInputs[pitchId];
    if (cutPercent == null || cutPercent === '' || Number(cutPercent) < 0 || Number(cutPercent) > 100) {
      setPitchError('Enter a cut percentage between 0 and 100.');
      return;
    }
    setFundingBusyId(pitchId);
    try {
      const res = await fetch('/api/admin/pitches', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pitchId, cutPercent })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not enable funding.');
      await loadPitches();
    } catch (err) {
      setPitchError(err.message);
    } finally {
      setFundingBusyId(null);
    }
  }

  async function disablePitchFunding(pitchId) {
    setFundingBusyId(pitchId);
    try {
      await fetch('/api/admin/pitches', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pitchId, disableFunding: true })
      });
      await loadPitches();
    } catch (err) {
      setPitchError('Could not disable funding.');
    } finally {
      setFundingBusyId(null);
    }
  }

  return (
    <>
      {pitchError && <p style={{ color: 'var(--danger)' }}>{pitchError}</p>}

      {reportedComments && reportedComments.length > 0 && (
        <div className="adm-card" style={{ marginBottom: '1rem' }}>
          <div className="adm-eyebrow" style={{ color: 'var(--danger)', marginBottom: '0.5rem' }}>Reported comments ({reportedComments.length})</div>
          {reportedComments.map((c) => (
            <div key={c.id} style={{ borderTop: '1px solid rgba(251,232,211,0.1)', padding: '0.7rem 0' }}>
              <div style={{ fontSize: 12, opacity: 0.65, marginBottom: 4 }}>
                On &ldquo;{c.pitches ? c.pitches.title : 'a pitch'}&rdquo; — {c.displayName || 'A viewer'}
                {c.report_reason && ` — reason: ${c.report_reason}`}
              </div>
              <div style={{ fontSize: 13, marginBottom: 8 }}>{c.body}</div>
              <button className="account-btn-secondary" style={{ width: 'auto', marginRight: 6 }} onClick={() => moderateComment(c.id, 'keep')}>Keep</button>
              <button className="account-btn-secondary" style={{ width: 'auto', color: 'var(--danger)' }} onClick={() => moderateComment(c.id, 'delete')}>Delete</button>
            </div>
          ))}
        </div>
      )}

      <div className="account-card">
        <div className="account-eyebrow">Add a pitch</div>
        <p style={{ fontSize: '0.85rem', color: 'var(--ink-dim)', marginBottom: '1rem' }}>
          Adding one here approves it immediately — there&rsquo;s no public submission form yet, so for now
          this is how pitches get onto the page. Turn the &ldquo;Pitch Room&rdquo; header link on in Settings once you&rsquo;ve got
          at least one up.
        </p>
        <form onSubmit={addPitch}>
          <label>Title</label>
          <input type="text" value={pitchForm.title} onChange={(e) => setPitchForm((f) => ({ ...f, title: e.target.value }))} required />
          <label>Logline <span style={{ fontWeight: 'normal', opacity: 0.65 }}>one sentence</span></label>
          <input type="text" value={pitchForm.logline} onChange={(e) => setPitchForm((f) => ({ ...f, logline: e.target.value }))} required />
          <label>Description <span style={{ fontWeight: 'normal', opacity: 0.65 }}>optional</span></label>
          <textarea value={pitchForm.description} onChange={(e) => setPitchForm((f) => ({ ...f, description: e.target.value }))} rows={2} style={{ width: '100%', boxSizing: 'border-box' }} />
          <label>Project URL <span style={{ fontWeight: 'normal', opacity: 0.65 }}>optional — where &ldquo;Fund this project&rdquo; sends people</span></label>
          <input type="url" value={pitchForm.projectUrl} onChange={(e) => setPitchForm((f) => ({ ...f, projectUrl: e.target.value }))} placeholder="https://kickstarter.com/..." />
          <div className="admin-field-row">
            <div className="admin-field">
              <label>Creator name <span style={{ fontWeight: 'normal', opacity: 0.65 }}>optional</span></label>
              <input type="text" value={pitchForm.creatorName} onChange={(e) => setPitchForm((f) => ({ ...f, creatorName: e.target.value }))} />
            </div>
            <div className="admin-field">
              <label>Creator email <span style={{ fontWeight: 'normal', opacity: 0.65 }}>optional</span></label>
              <input type="email" value={pitchForm.creatorEmail} onChange={(e) => setPitchForm((f) => ({ ...f, creatorEmail: e.target.value }))} />
            </div>
          </div>
          <button className="account-btn-primary" type="submit" disabled={pitchSaving} style={{ width: 'auto', marginTop: '0.6rem' }}>
            {pitchSaving ? 'Adding…' : 'Add pitch'}
          </button>
        </form>
      </div>

      <div className="account-card">
        <div className="account-eyebrow">All pitches</div>
        {!pitches ? (
          <p>Loading…</p>
        ) : pitches.length === 0 ? (
          <p className="adm-empty">No pitches yet.</p>
        ) : (
          pitches.map((p) => (
            <div key={p.id} style={{ borderTop: '1px solid rgba(251,232,211,0.1)', padding: '0.8rem 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <strong>{p.title}</strong>
                  <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.65, textTransform: 'uppercase' }}>{p.status}</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {p.status !== 'approved' && (
                    <button className="account-btn-secondary" style={{ width: 'auto' }} onClick={() => setPitchStatus(p.id, 'approved')}>Approve</button>
                  )}
                  {p.status !== 'rejected' && (
                    <button className="account-btn-secondary" style={{ width: 'auto' }} onClick={() => setPitchStatus(p.id, 'rejected')}>Reject</button>
                  )}
                  <button className="account-btn-secondary" style={{ width: 'auto', color: 'var(--danger)' }} onClick={() => deletePitch(p.id)}>Delete</button>
                </div>
              </div>
              <div style={{ fontSize: 13, opacity: 0.75, marginTop: 4 }}>{p.logline}</div>
              {p.status === 'approved' && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(251,232,211,0.1)' }}>
                  {p.funding_enabled ? (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                      <span style={{ fontSize: 12, color: 'var(--ok)' }}>
                        In-platform funding on — {p.platform_cut_percent}% platform cut
                        {p.total_raised_cents != null && ` · $${(p.total_raised_cents / 100).toFixed(2)} raised`}
                        {!p.creator_stripe_account_id && ' (no Stripe account connected yet — donations can’t actually be charged)'}
                      </span>
                      <button className="account-btn-secondary" style={{ width: 'auto', fontSize: 12 }} onClick={() => disablePitchFunding(p.id)} disabled={fundingBusyId === p.id}>
                        Disable funding
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, opacity: 0.65 }}>In-platform funding off</span>
                      <input
                        type="number" min="0" max="100" step="0.5" placeholder="Cut %"
                        value={cutPercentInputs[p.id] || ''}
                        onChange={(e) => setCutPercentInputs((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        style={{ width: '70px', fontSize: 12 }}
                      />
                      <button className="account-btn-secondary" style={{ width: 'auto', fontSize: 12 }} onClick={() => enablePitchFunding(p.id)} disabled={fundingBusyId === p.id}>
                        {fundingBusyId === p.id ? 'Enabling…' : 'Enable funding'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </>
  );
}
