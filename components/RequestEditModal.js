import { useState, useEffect, useRef } from 'react';
import { keepScrollInside } from '../lib/menuScroll';
import PageNotesField from './PageNotesField';
import FlashingLightsField from './FlashingLightsField';
import DownloadsAllowedField from './DownloadsAllowedField';
import { fieldPolicy, fieldPolicyLine, flashingLightsPolicy, saveSummary } from '../lib/showRules';
import { downloadableKind } from '../lib/downloadRules';
import { MIGRATION_123_MSG } from '../lib/downloadSiteRules';

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
// "Contains flashing lights" (Jose, 2026-11-13) rides on the same save:
// ticking it applies at once, a live title included; once a live title has
// it, the box is ticked and greyed with "Only the team can remove this
// warning from a live title." (lib/showRules.js flashingLightsPolicy; the
// server refuses the same).
//
// "Allow downloads in the app" (2026-11-14) rides on it too, for every
// title that can be downloaded (not a podcast): it applies at once, a live
// title included (lib/downloadSiteRules.js downloadsAllowedPolicy; the
// server decides the same), and before migration 123 the box is greyed
// with "Downloads need a database update (migration 123)."
//
// currentValues = { id, title, description, pageNotes, notesShown, status,
// held, deletionRequested, withdrawnAt, pendingTitle, pendingDescription,
// pendingPageNotes, pageNotesWaitReady, hasFlashingLights, contentType,
// downloadsAllowed, downloadsAllowedReady }.

const NOTES_122_LINE = 'Notes need a database update (migration 122).';
const WAITING_WORDS = { title: 'the new title', description: 'the new description', pageNotes: 'the new notes' };
const FIELD_WORDS = { title: 'the title', description: 'the description', pageNotes: 'the notes', hasFlashingLights: 'the flashing-lights warning', downloadsAllowed: 'the downloads switch' };

export default function RequestEditModal({ type = 'episode', currentValues, onClose, onSubmitted }) {
  // The box scrolls its own fields; a wheel or a finger that has nothing
  // left to scroll in it never moves the page behind (lib/menuScroll.js).
  const backdropRef = useRef(null);
  useEffect(() => keepScrollInside(backdropRef.current), []);
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
  const startFlashing = cv.hasFlashingLights === true;
  const [flashing, setFlashing] = useState(startFlashing);
  const downloadsShown = isEpisode && downloadableKind(cv.contentType);
  const downloadsReady = cv.downloadsAllowedReady !== false;
  const startDownloads = cv.downloadsAllowed !== false;
  const [downloads, setDownloads] = useState(startDownloads);
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
  const flashingPolicy = isEpisode ? flashingLightsPolicy(ctx, startFlashing) : { mode: 'locked', line: null };

  const changes = [];
  if (nameValue.trim() !== start.title.trim()) changes.push({ field: 'title', mode: modeOf('title') });
  if (description.trim() !== start.description.trim()) changes.push({ field: 'description', mode: modeOf('description') });
  if (notesShown && notes.trim() !== start.pageNotes.trim()) changes.push({ field: 'pageNotes', mode: modeOf('pageNotes') });
  if (isEpisode && flashing !== startFlashing) changes.push({ field: 'hasFlashingLights', mode: 'direct' });
  if (downloadsShown && downloadsReady && downloads !== startDownloads) changes.push({ field: 'downloadsAllowed', mode: 'direct' });
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
        if (c.field === 'hasFlashingLights') body.hasFlashingLights = flashing;
        if (c.field === 'downloadsAllowed') body.downloadsAllowed = downloads;
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
    const named = list.map((f) => FIELD_WORDS[f]).filter(Boolean);
    return named.length <= 1 ? named.join('') : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
  };

  // Drawn in the show editor's look (.ebx in globals.css; Jose,
  // 2026-11-14), like Your work's other box, components/EditSubmissionModal.js.
  const heading = notesShown ? 'Title, description & notes' : 'Title & description';
  return (
    <div className="modal-backdrop" ref={backdropRef} onClick={onClose}>
      <div className="modal-card ebx" role="dialog" aria-modal="true" aria-labelledby="ebx-request-title" onClick={(e) => e.stopPropagation()}>
        <div className="ebx-head">
          <div className="ebx-head-main">
            <span className="ebx-kicker">Your work · {liveRules ? 'Live' : 'Not live yet'}</span>
            <h3 className="ebx-title" id="ebx-request-title">{heading}</h3>
          </div>
          <button type="button" className="ebx-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {done ? (
          <div className="ebx-done">
            <div className="ebx-body">
            <p className="ebx-done-line" role="status">
              {done.staged.length > 0 ? `Sent for review: ${words(done.staged)}. Visitors see what’s live until we approve it.` : null}
              {done.staged.length > 0 && done.applied.length > 0 ? ' ' : null}
              {done.applied.length > 0 ? `Saved: ${words(done.applied)}.` : null}
              {done.staged.length === 0 && done.applied.length === 0 ? (done.notices[0] || 'Saved.') : null}
            </p>
            {done.notices.length > 0 && (done.staged.length > 0 || done.applied.length > 0) && <p className="req-edit-line">{done.notices.join(' ')}</p>}
            </div>
            <div className="ebx-actions">
              {/* "Done", not a second "Close": the round button in the heading is the box's Close. */}
              <button type="button" className="account-btn-primary" onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="ebx-form">
            <div className="ebx-body">
            <p className="ebx-lede">
              {liveRules
                ? 'It’s live, so these go to Studio Tapa for approval before visitors see them — what’s there now stays until then.'
                : 'It isn’t live yet, so these apply as soon as you save.'}
            </p>
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
            {error && <p className="ebx-error" role="alert">{error}</p>}
            <div className="ebx-field">
              <label htmlFor="req-edit-title">{isEpisode ? 'Title' : 'Show name'}</label>
              <input id="req-edit-title" type="text" className="is-title" value={nameValue} onChange={(e) => setNameValue(e.target.value)} required disabled={!open('title')} maxLength={200} />
              {!open('title') && <p className="req-edit-line">{lineOf('title')}</p>}
            </div>
            <div className="ebx-field">
              <label htmlFor="req-edit-description">Description</label>
              <textarea id="req-edit-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={4000} disabled={!open('description')} />
              {!open('description') && <p className="req-edit-line">{lineOf('description')}</p>}
            </div>
            {notesShown && (
              <PageNotesField
                id="request-edit-notes"
                value={notes}
                onChange={setNotes}
                disabled={!open('pageNotes')}
                wrapClassName="ebx-field"
                note={!open('pageNotes') ? lineOf('pageNotes') : modeOf('pageNotes') === 'staged' ? 'Waits for approval like the description.' : 'Saved at once: it isn’t live yet.'}
              />
            )}
            {(isEpisode || downloadsShown) && (
              <div className="ebx-switches">
                {isEpisode && (
                  <FlashingLightsField
                    id="req-edit-flashing"
                    checked={flashing}
                    onChange={setFlashing}
                    locked={flashingPolicy.mode === 'locked' ? flashingPolicy.line : null}
                  />
                )}
                {downloadsShown && (
                  <DownloadsAllowedField
                    id="req-edit-downloads"
                    checked={downloads}
                    onChange={setDownloads}
                    locked={downloadsReady ? null : MIGRATION_123_MSG}
                  />
                )}
              </div>
            )}
            {summary.note && <p className="req-edit-line">{summary.note}.</p>}
            </div>
            <div className="ebx-actions">
              <button className="account-btn-primary" type="submit" disabled={saving || changes.length === 0}>
                {saving ? 'Sending…' : summary.label}
              </button>
              <button type="button" className="account-btn-secondary" onClick={onClose}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
