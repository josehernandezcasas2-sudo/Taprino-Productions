import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);
  const dropdownRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    // The dropdown is portaled out to document.body (see below), so a
    // plain DOM .contains() check against the trigger's own wrapper
    // would miss it entirely and treat every click inside the dropdown
    // as an "outside" click, closing the menu before its own button's
    // onClick ever got to fire. React still bubbles synthetic events
    // through the portal's REACT parent regardless of where it's
    // physically mounted, but this listener is a native DOM one, so it
    // needs its own explicit check against the portaled node.
    function handleOutside(e) {
      const insideTrigger = wrapRef.current && wrapRef.current.contains(e.target);
      const insideDropdown = dropdownRef.current && dropdownRef.current.contains(e.target);
      if (!insideTrigger && !insideDropdown) {
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

  // Positions the portaled dropdown in real fixed-pixel coordinates from
  // the trigger's own on-screen position — a plain CSS-anchored dropdown
  // (position:absolute, top/right relative to the trigger) got silently
  // clipped invisible on the profile grid, where each post tile is a
  // small overflow:hidden square (needed to crop its own background-image
  // to a clean 1:1 tile); the dropdown was a descendant of that same
  // clipped box, same as .reel-post-menu's own comment describes for a
  // different wrapper. Recomputed on every open, and again whenever the
  // menu's own content changes height (e.g. switching into edit mode's
  // textarea), since a grid tile's position obviously isn't fixed and
  // neither is the dropdown's own height. useLayoutEffect (not useEffect)
  // so this is set before the browser paints — no visible jump.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return undefined;
    function place() {
      const t = triggerRef.current.getBoundingClientRect();
      const dd = dropdownRef.current;
      const dropdownWidth = dd ? dd.offsetWidth : 180;
      const dropdownHeight = dd ? dd.offsetHeight : 0;
      const margin = 8;
      let left = t.right - dropdownWidth;
      left = Math.max(margin, Math.min(left, window.innerWidth - dropdownWidth - margin));
      const spaceBelow = window.innerHeight - t.bottom;
      const openUpward = dropdownHeight > 0 && spaceBelow < dropdownHeight + margin && t.top > dropdownHeight + margin;
      const top = openUpward ? t.top - dropdownHeight - 6 : t.bottom + 6;
      setPosition({ top, left });
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, mode]);

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
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        aria-label="Post options"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <HamburgerMenuIcon size={15} />
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          className="post-menu-dropdown"
          role="menu"
          ref={dropdownRef}
          style={{ top: position.top, left: position.left }}
        >
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
        </div>,
        document.body
      )}
    </div>
  );
}
