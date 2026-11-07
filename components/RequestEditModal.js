import { useState } from 'react';

// A standalone title's title/description edit request (Your work): it
// goes to an admin for approval and doesn't apply at once. A show's
// details are edited on its show page since the series revamp (the
// series half and its route, request-series-edit, retired in slice 6).
export default function RequestEditModal({ type = 'episode', currentValues, onClose, onSubmitted }) {
  const isEpisode = type === 'episode';
  const [nameValue, setNameValue] = useState(isEpisode ? currentValues.title : currentValues.name);
  const [description, setDescription] = useState(currentValues.description || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (!isEpisode) throw new Error('Edit a show on its show page.');
      const res = await fetch('/api/creator/request-episode-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeId: currentValues.id, title: nameValue, description })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not submit your request.');
      setDone(true);
      if (onSubmitted) onSubmitted();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h3>Request an edit — {isEpisode ? 'episode' : 'show'}</h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--ink-dim)', marginBottom: '1rem' }}>
          This goes to Studio Tapa for approval before it changes anything visitors see — the current
          {isEpisode ? ' title/description stay live' : ' name/description stay live'} until then.
        </p>

        {done ? (
          <>
            <p style={{ color: 'var(--ok)' }}>Sent for review.</p>
            <button className="account-btn-primary" style={{ width: 'auto' }} onClick={onClose}>Close</button>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
            <label>{isEpisode ? 'Title' : 'Show name'}</label>
            <input type="text" value={nameValue} onChange={(e) => setNameValue(e.target.value)} required />
            <label>Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} style={{ width: '100%', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.8rem' }}>
              <button className="account-btn-primary" type="submit" disabled={saving} style={{ width: 'auto' }}>
                {saving ? 'Sending…' : 'Send for approval'}
              </button>
              <button type="button" className="account-btn-secondary" style={{ width: 'auto' }} onClick={onClose}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
