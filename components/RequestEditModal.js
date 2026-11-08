import { useState } from 'react';
import PageNotesField from './PageNotesField';
import { savePageNotes } from '../lib/pageNotesSave';

// A standalone title's title/description edit request (Your work): it
// goes to an admin for approval and doesn't apply at once. A show's
// details are edited on its show page since the series revamp (the
// series half and its route, request-series-edit, retired in slice 6).
//
// A film or a short also has its notes for its own page here (2026-11-08,
// `currentValues.notesShown`; components/PageNotesField.js). They go up as
// soon as this is sent, the rule the show editor keeps for every
// episode's notes (lib/showRules.js FIELD_POLICY pageNotes: live →
// direct): there is no column for notes waiting on approval (a
// pending_page_notes would need a migration), so they are saved through
// the show editor's route (lib/pageNotesSave.js), and the box says so.
export default function RequestEditModal({ type = 'episode', currentValues, onClose, onSubmitted }) {
  const isEpisode = type === 'episode';
  const [nameValue, setNameValue] = useState(isEpisode ? currentValues.title : currentValues.name);
  const [description, setDescription] = useState(currentValues.description || '');
  const notesShown = isEpisode && currentValues.notesShown === true;
  const startNotes = currentValues.pageNotes || '';
  const [notes, setNotes] = useState(startNotes);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (!isEpisode) throw new Error('Edit a show on its show page.');
      const textChanged = (nameValue || '').trim() !== (currentValues.title || '').trim()
        || description.trim() !== (currentValues.description || '').trim();
      const notesChanged = notesShown && notes.trim() !== startNotes.trim();
      // Only the notes changed: nothing goes to review (the request route
      // would answer "Nothing actually changed" for the title and
      // description).
      if (textChanged || !notesChanged) {
        const res = await fetch('/api/creator/request-episode-edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ episodeId: currentValues.id, title: nameValue, description })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not submit your request.');
      }
      if (notesChanged) {
        const saved = await savePageNotes(currentValues.id, notes);
        if (!saved.ok) throw new Error(textChanged ? `The title and description went to us for review, but the notes didn’t save: ${saved.error}` : saved.error);
      }
      setDone(notesChanged && textChanged ? 'both' : notesChanged ? 'notes' : 'review');
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
          {notesShown ? ' The notes for its page are the exception: they go up as soon as you send this.' : ''}
        </p>

        {done ? (
          <>
            <p style={{ color: 'var(--ok)' }}>
              {done === 'notes' ? 'Your notes are saved.' : done === 'both' ? 'Your notes are saved. The title and description are with us for review.' : 'Sent for review.'}
            </p>
            <button className="account-btn-primary" style={{ width: 'auto' }} onClick={onClose}>Close</button>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
            <label>{isEpisode ? 'Title' : 'Show name'}</label>
            <input type="text" value={nameValue} onChange={(e) => setNameValue(e.target.value)} required />
            <label>Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} style={{ width: '100%', boxSizing: 'border-box' }} />
            {notesShown && <PageNotesField id="request-edit-notes" value={notes} onChange={setNotes} note="Saved at once, no review." />}
            <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.8rem' }}>
              <button className="account-btn-primary" type="submit" disabled={saving} style={{ width: 'auto' }}>
                {saving ? 'Sending…' : notesShown ? 'Send' : 'Send for approval'}
              </button>
              <button type="button" className="account-btn-secondary" style={{ width: 'auto' }} onClick={onClose}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
