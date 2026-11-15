import { useState } from 'react';
import { REMOVAL_WORDS, RESTORE_REASON_MAX } from '../lib/removalRules';

// "Ask to bring it back" on a removed title or show (migration 124;
// lib/removalRules.js): an optional note for the team, then Send. The page
// posts it (POST /api/show/episode/<id>/restore or /api/show/<id>/restore)
// in onConfirm(reason), which throws its error line for the box to show.
export default function RestoreRequestModal({ itemLabel, line = '', onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="restore-request-h" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 id="restore-request-h">{REMOVAL_WORDS.askBack}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)', marginTop: '-0.4rem' }}>
          &ldquo;{itemLabel}&rdquo;{line ? ` — ${line}` : ''} {REMOVAL_WORDS.askBackHelp}
        </p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="restore-request-reason">{REMOVAL_WORDS.askBackReason}</label>
          <textarea id="restore-request-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={RESTORE_REASON_MAX} style={{ width: '100%', boxSizing: 'border-box' }} />
          {error && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }} role="alert">{error}</p>}
          <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.8rem' }}>
            <button className="account-btn-primary" type="submit" disabled={saving} style={{ width: 'auto' }}>
              {saving ? 'Sending…' : REMOVAL_WORDS.askBackSend}
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
