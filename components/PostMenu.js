import { useEffect, useRef, useState } from 'react';
import { HamburgerMenuIcon } from './PlayerIcons';

const REPORT_REASONS = ['Spam', 'Harassment', 'Off-topic', 'Other'];
const MAX_CAPTION_LENGTH = 2200;

// Shared options menu for a post/video (lib/posts.js) — the owner gets
// Edit/Delete, anyone else signed in gets Report, matching the same
// pattern pages/pitches/[id].js already uses for comments. Fully
// self-contained (owns its own open/report/edit state) so it drops into
// both the vertical discover feed and the profile grid without either
// caller needing to track menu state itself.
export default function PostMenu({ isOwner, isSignedIn, caption, onDelete, onReport, onSaveCaption }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('menu'); // 'menu' | 'report' | 'edit' | 'reported'
  const [editText, setEditText] = useState(caption || '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editError, setEditError] = useState(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function handleOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setMode('menu');
      }
    }
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [open]);

  if (!isSignedIn) return null;

  async function handleDelete() {
    if (!window.confirm('Delete this post? This can’t be undone.')) return;
    setDeleting(true);
    try {
      await onDelete();
    } catch (err) {
      alert('Could not delete that post — try again.');
      setDeleting(false);
    }
  }

  async function handleSaveCaption() {
    setSaving(true);
    setEditError(null);
    try {
      await onSaveCaption(editText.trim());
      setOpen(false);
      setMode('menu');
    } catch (err) {
      setEditError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleReport(reason) {
    setMode('reported');
    await onReport(reason).catch(() => {});
  }

  return (
    <div className="post-menu" ref={wrapRef} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="post-menu-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-label="Post options"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <HamburgerMenuIcon size={15} />
      </button>

      {open && (
        <div className="post-menu-dropdown" role="menu">
          {mode === 'menu' && isOwner && (
            <>
              <button type="button" className="post-menu-item" onClick={() => setMode('edit')}>Edit</button>
              <button type="button" className="post-menu-item post-menu-item-danger" onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </>
          )}

          {mode === 'menu' && !isOwner && (
            <button type="button" className="post-menu-item" onClick={() => setMode('report')}>Report</button>
          )}

          {mode === 'report' && (
            <>
              {REPORT_REASONS.map((r) => (
                <button key={r} type="button" className="post-menu-item" onClick={() => handleReport(r)}>{r}</button>
              ))}
              <button type="button" className="post-menu-item" onClick={() => setMode('menu')}>Cancel</button>
            </>
          )}

          {mode === 'reported' && (
            <div className="post-menu-note">Reported — thank you.</div>
          )}

          {mode === 'edit' && (
            <div className="post-menu-edit">
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value.slice(0, MAX_CAPTION_LENGTH))}
                rows={3}
                placeholder="Caption"
                autoFocus
              />
              {editError && <p className="post-menu-edit-error">{editError}</p>}
              <div className="post-menu-edit-actions">
                <button type="button" className="post-menu-item" onClick={handleSaveCaption} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" className="post-menu-item" onClick={() => { setMode('menu'); setEditText(caption || ''); setEditError(null); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
