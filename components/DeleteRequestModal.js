import { useState } from 'react';
import { REMOVAL_WORDS } from '../lib/removalRules';

// Generic on purpose — same modal serves both "delete this episode" and
// "delete this series" by passing a different itemLabel and onConfirm.
//
// Since migration 124 (removals held a month; lib/removalRules.js) it says
// what happens once we confirm, and offers the one checkbox, off by
// default: "Keep the files so I can bring it back later". `keepChoice`
// shows it (false before 124); `bought` says instead that the title's
// buyers keep it. onConfirm(reason, { keep }).
export default function DeleteRequestModal({ itemLabel, onClose, onConfirm, keepChoice = false, bought = false }) {
  const [reason, setReason] = useState('');
  const [keep, setKeep] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!reason.trim()) {
      setError('A reason is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onConfirm(reason.trim(), { keep: keepChoice && !bought && keep });
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Request deletion</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)', marginTop: '-0.4rem' }}>
          &ldquo;{itemLabel}&rdquo; will be hidden from the site right away. An admin still has to confirm the actual
          removal — you can cancel this request any time before then.
        </p>
        {keepChoice && (
          <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)' }}>{bought ? REMOVAL_WORDS.boughtNote : REMOVAL_WORDS.holdNote}</p>
        )}

        <form onSubmit={handleSubmit}>
          <label>Reason — required</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} required style={{ width: '100%', boxSizing: 'border-box' }} />

          {keepChoice && !bought && (
            <label className="removal-keep">
              <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
              <span>{REMOVAL_WORDS.keepLabel}</span>
            </label>
          )}

          {error && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</p>}

          <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.8rem' }}>
            <button className="account-btn-primary" type="submit" disabled={saving} style={{ width: 'auto' }}>
              {saving ? 'Submitting…' : 'Request deletion'}
            </button>
            <button className="account-btn-secondary" type="button" onClick={onClose} disabled={saving} style={{ width: 'auto' }}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
