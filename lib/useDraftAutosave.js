import { useEffect, useRef, useState, useCallback } from 'react';

// Shared by the creator episode form, admin episode form, and pitch form.
// Each form owns its own state shape and decides what to pass in/apply
// back — this hook only handles the load-on-mount / debounced-save /
// clear-on-submit mechanics, not the form fields themselves.
export function useDraftAutosave(draftType) {
  const [existingDraft, setExistingDraft] = useState(undefined); // undefined = still loading, null = none found
  const timerRef = useRef(null);
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/drafts/${draftType}`)
      .then((r) => (r.ok ? r.json() : { draft: null }))
      .then((d) => { if (!cancelled) setExistingDraft(d.draft || null); })
      .catch(() => { if (!cancelled) setExistingDraft(null); });
    return () => { cancelled = true; };
  }, [draftType]);

  // Debounced — called on every keystroke from the form, but only actually
  // writes to the server ~1.5s after typing pauses, so filling out a title
  // doesn't fire a network request per character.
  const scheduleSave = useCallback((data) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      fetch(`/api/drafts/${draftType}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data })
      })
        .then((r) => { if (r.ok) setSavedAt(new Date()); })
        .catch(() => {
          // Draft-saving is a convenience, not the actual submission — a
          // failed autosave shouldn't interrupt or alarm someone who's
          // still actively filling out the real form.
        });
    }, 1500);
  }, [draftType]);

  const clearDraft = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    return fetch(`/api/drafts/${draftType}`, { method: 'DELETE' }).catch(() => {});
  }, [draftType]);

  // Dismissing without resuming (declining the "resume?" prompt) should
  // still clear the stored draft — otherwise it would keep reappearing on
  // every future visit even after being explicitly declined once.
  const dismissDraft = useCallback(() => {
    setExistingDraft(null);
    clearDraft();
  }, [clearDraft]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return { existingDraft, scheduleSave, clearDraft, dismissDraft, savedAt };
}
