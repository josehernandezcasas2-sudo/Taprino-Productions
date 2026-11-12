import { useState } from 'react';
import PageNotesField from './PageNotesField';
import { fieldPolicy, fieldPolicyLine, saveSummary } from '../lib/showRules';

// A standalone title's title, description and (a film's or a short's)
// notes for its own page, from Your work. A show's details are edited on
// its show page since the series revamp (the series half and its route,
// request-series-edit, retired in slice 6).
//
// Since 2026-11-12 (Jose: "make sure descriptions and notes wait for
// review") this is the show editor's own save, PATCH /api/show/episode/<id>
// (lib/showPage.js updateEpisode), which decides each field through
// lib/showRules.js fieldPolicy: on a live title the title, the description
// and the notes wait for approval (pending_title, pending_description,
// pending_page_notes — migration 122) and visitors see the live ones until
// then; on a title that has never been live (in review, "Not this time")
// they apply at once — the old request route staged a description even on
// a title still in review. Only what was changed is sent, so a waiting
// change the creator didn't touch stays waiting. A change already waiting
// is shown with its Cancel (DELETE …/staged?field=). Before migration 122
// a live title's notes have nowhere to wait: the box is greyed with the
// reason (the save would answer 503 migration-122).
//
// currentValues = { id, title, description, pageNotes, notesShown, status,
// held, deletionRequested, withdrawnAt, pendingTitle, pendingDescription,
// pendingPageNotes, pageNotesWaitReady }.

const NOTES_122_LINE = 'Notes need a database update (migration 122).';
const WAITING_WORDS = { title: 'the new title', description: 'the new description', pageNotes: 'the new notes' };

export default function RequestEditModal({ type = 'episode', currentValues, onClose, onSubmitted }) {
  const cv = currentValues || {};
  const isEpisode = type === 'episode';
  const waiting = {
    title: typeof cv.pendingTitle === 'string' && cv.pendingTitle.trim() ? cv.pendingTitle : null,
    description: typeof cv.pendingDescription === 'string' && cv.pendingDescription.trim() ? cv.pendingDescription : null,
    pageNotes: typeof cv.pendingPageNotes === 'string' ? cv.pendingPageNotes : null
  };
  // The fields start from what waits (the creator's last ask), else what's live.
  const start = {
    title: waiting.title !== null ? waiting.title : cv.title || '',
    description: waiting.description !== null ? waiting.description : cv.description || '',
    pageNotes: waiting.pageNotes !== null ? waiting.pageNotes : cv.pageNotes || ''
  };
  const [nameValue, setNameValue] = useState(start.title);
  const [description, setDescription] = useState(start.description);
  const notesShown = isEpisode && cv.notesShown === true;
  const [notes, setNotes] = useState(start.pageNotes);
  const [stillWaiting, setStillWaiting] = useState(waiting);
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(null);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  // What each field does for this creator now (a standalone title's
  // uploader runs it too).
  const ctx = { isUploader: true, isRunner: true, status: cv.status || 'approved', held: cv.held === true, deletionRequested: cv.deletionRequested === true, withdrawn: Boolean(cv.withdrawnAt) };
  const modeOf = (field) => {
    const mode = fieldPolicy(field, ctx);
    if (field === 'pageNotes' && mode === 'staged' && cv.pageNotesWaitReady === false) return 'locked';
    return mode;
  };
  const lineOf = (field) => {
    if (field === 'pageNotes' && fieldPolicy(field, ctx) === 'staged' && cv.pageNotesWaitReady === false) return NOTES_122_LINE;
    return fieldPolicyLine(field, ctx);
  };
  const open = (field) => ['direct', 'staged'].includes(modeOf(field));

  const changes = [];
  if (nameValue.trim() !== start.title.trim()) changes.push({ field: 'title', mode: modeOf('title') });
  if (description.trim() !== start.description.trim()) changes.push({ field: 'description', mode: modeOf('description') });
  if (notesShown && notes.trim() !== start.pageNotes.trim()) changes.push({ field: 'pageNotes', mode: modeOf('pageNotes') });
  const summary = saveSummary(changes);
  const anyWaiting = Object.values(stillWaiting).some((v) => v !== null);
  const liveRules = ['title', 'description', 'pageNotes'].some((f) => modeOf(f) === 'staged');

  async function cancelWaiting(field) {
    setCancelling(field);
    setError(null);
    try {
      const res = await fetch(`/api/show/episode/${encodeURIComponent(String(cv.id))}/staged?field=${encodeURIComponent(field)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not take that back.');
      setStillWaiting((w) => ({ ...w, [field]: null }));
      if (onSubmitted) onSubmitted();
    } catch (err) {
      setError(err.message);
    } finally {
      setCancelling(null);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isEpisode) {
      setError('Edit a show on its show page.');
      return;
    }
    if (changes.length === 0) {
      setError('Nothing changed yet.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = {};
      for (const c of changes) {
        if (c.field === 'title') body.title = nameValue.trim();
        if (c.field === 'description') body.description = description.trim();
        if (c.field === 'pageNotes') body.pageNotes = notes.trim();
      }
      const res = await fetch(`/api/show/episode/${encodeURIComponent(String(cv.id))}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save your changes.');
      const notSaved = Array.isArray(data.notSaved) ? data.notSaved : [];
      if (notSaved.length) throw new Error(notSaved.map((n) => n.reason).filter(Boolean).join(' ') || 'Some of it didn’t save.');
      setDone({ staged: data.staged || [], applied: data.applied || [], notices: data.notices || [] });
      if (onSubmitted) onSubmitted();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const words = (list) => {
    const named = list.map((f) => ({ title: 'the title', description: 'the description', pageNotes: 'the notes' }[f])).filter(Boolean);
    return named.length <= 1 ? named.join('') : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h3>{notesShown ? 'Title, description & notes' : 'Title & description'}</h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--ink-dim)', marginBottom: '1rem' }}>
          {liveRules
            ? 'It’s live, so these go to Studio Tapa for approval before visitors see them — what’s there now stays until then.'
            : 'It isn’t live yet, so these apply as soon as you save.'}
        </p>

        {done ? (
          <>
            <p style={{ color: 'var(--ok)' }}>
              {done.staged.length > 0 ? `Sent for review: ${words(done.staged)}. Visitors see what’s live until we approve it.` : null}
              {done.staged.length > 0 && done.applied.length > 0 ? ' ' : null}
              {done.applied.length > 0 ? `Saved: ${words(done.applied)}.` : null}
              {done.staged.length === 0 && done.applied.length === 0 ? (done.notices[0] || 'Saved.') : null}
            </p>
            {done.notices.length > 0 && (done.staged.length > 0 || done.applied.length > 0) && <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)' }}>{done.notices.join(' ')}</p>}
            <button className="account-btn-primary" style={{ width: 'auto' }} onClick={onClose}>Close</button>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            {anyWaiting && (
              <div className="req-edit-waiting" role="status">
                <strong>Waiting for approval</strong>
                <ul>
                  {['title', 'description', 'pageNotes'].filter((f) => stillWaiting[f] !== null).map((f) => (
                    <li key={f}>
                      <span>{f === 'pageNotes' && stillWaiting.pageNotes === '' ? 'clearing the notes' : WAITING_WORDS[f]}</span>
                      <button type="button" className="show-ed-cancel" disabled={cancelling === f || saving} onClick={() => cancelWaiting(f)}>{cancelling === f ? '…' : 'Cancel'}</button>
                    </li>
                  ))}
                </ul>
                <p>Visitors see what’s live until we approve it. The boxes below start from what waits.</p>
              </div>
            )}
            {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
            <label htmlFor="req-edit-title">{isEpisode ? 'Title' : 'Show name'}</label>
            <input id="req-edit-title" type="text" value={nameValue} onChange={(e) => setNameValue(e.target.value)} required disabled={!open('title')} maxLength={200} />
            {!open('title') && <p className="req-edit-line">{lineOf('title')}</p>}
            <label htmlFor="req-edit-description">Description</label>
            <textarea id="req-edit-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={4000} disabled={!open('description')} style={{ width: '100%', boxSizing: 'border-box' }} />
            {!open('description') && <p className="req-edit-line">{lineOf('description')}</p>}
            {notesShown && (
              <PageNotesField
                id="request-edit-notes"
                value={notes}
                onChange={setNotes}
                disabled={!open('pageNotes')}
                note={!open('pageNotes') ? lineOf('pageNotes') : modeOf('pageNotes') === 'staged' ? 'Waits for approval like the description.' : 'Saved at once: it isn’t live yet.'}
              />
            )}
            {summary.note && <p className="req-edit-line">{summary.note}.</p>}
            <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.8rem' }}>
              <button className="account-btn-primary" type="submit" disabled={saving || changes.length === 0} style={{ width: 'auto' }}>
                {saving ? 'Sending…' : summary.label}
              </button>
              <button type="button" className="account-btn-secondary" style={{ width: 'auto' }} onClick={onClose}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
