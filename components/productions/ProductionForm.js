import { useState } from 'react';
import Link from 'next/link';
import PlaceSearch from '../crew/PlaceSearch';
import { PRODUCTION_KINDS, VISIBILITY, MAX_TITLE_CHARS, MAX_LOGLINE_CHARS, MAX_NOTES_CHARS } from '../../lib/productionRules';

// Start / edit a production. `initial` is the production as the API
// returns it (edit) or null (new). Submits to the given endpoint; the
// parent decides where to go next with the returned production.
export default function ProductionForm({ initial = null, projects = [], onSaved, cancelHref }) {
  const [form, setForm] = useState({
    title: initial ? initial.title : '',
    logline: initial ? initial.logline : '',
    kind: initial ? initial.kind : 'short',
    startsOn: initial ? initial.startsOn || '' : '',
    endsOn: initial ? initial.endsOn || '' : '',
    place: initial && initial.place ? initial.place : null,
    project: initial && initial.projectType ? `${initial.projectType}:${initial.projectId}` : '',
    notes: initial ? initial.notes || '' : '',
    visibility: initial ? initial.visibility : 'public'
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const [type, id] = form.project ? form.project.split(':') : [null, null];
      const body = { ...form, project: type ? { type, id } : null };
      const res = await fetch(initial ? `/api/productions/${initial.id}` : '/api/productions', { method: initial ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save that.');
      onSaved(data);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  // Keep the project the production already has selectable even if the
  // owner's list no longer offers it (it was approved then, say).
  const options = [...projects];
  if (form.project && !options.some((p) => p.value === form.project)) options.unshift({ value: form.project, label: initial && initial.projectTitle ? initial.projectTitle : form.project });

  return (
    <form className="crew-panel cc-postform" onSubmit={submit}>
      <span className="crew-eyebrow">{initial ? 'Edit production' : 'Start a production'}</span>
      <label className="crew-field"><span>Title</span><input type="text" className="crew-input" value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="The Long Night Shift" maxLength={MAX_TITLE_CHARS} required /></label>
      <label className="crew-field"><span>Logline</span><input type="text" className="crew-input" value={form.logline} onChange={(e) => set({ logline: e.target.value })} placeholder="One line on what it is." maxLength={MAX_LOGLINE_CHARS} /></label>
      <div className="crew-row2">
        <label className="crew-field"><span>Kind</span>
          <select className="crew-select" value={form.kind} onChange={(e) => set({ kind: e.target.value })}>{Object.entries(PRODUCTION_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        <label className="crew-field"><span>Who sees it</span>
          <select className="crew-select" value={form.visibility} onChange={(e) => set({ visibility: e.target.value })}>{Object.entries(VISIBILITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
      </div>
      <div className="crew-row2">
        <label className="crew-field"><span>First shoot day</span><input type="date" className="crew-input" value={form.startsOn} onChange={(e) => set({ startsOn: e.target.value })} /></label>
        <label className="crew-field"><span>Last shoot day</span><input type="date" className="crew-input" value={form.endsOn} onChange={(e) => set({ endsOn: e.target.value })} min={form.startsOn || undefined} /></label>
      </div>
      <div className="crew-field"><span>Home base</span>
        <PlaceSearch value={form.place} onChange={(p) => set({ place: p })} placeholder="City (pick from the suggestions)" />
      </div>
      <label className="crew-field"><span>Grew out of (optional)</span>
        <select className="crew-select" value={form.project} onChange={(e) => set({ project: e.target.value })}>
          <option value="">Nothing on Studio Tapa yet</option>
          {options.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </label>
      <label className="crew-field"><span>Notes for the crew</span><textarea className="crew-input" rows={5} value={form.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="How the shoot runs, comms, who to call. The crew sees this; the public doesn’t." maxLength={MAX_NOTES_CHARS} /></label>
      {error && <div className="crew-status error" role="alert">{error}</div>}
      <div className="crew-actions">
        <button type="submit" className="crew-btn primary" disabled={busy}>{busy ? 'Saving…' : initial ? 'Save changes' : 'Start the production'}</button>
        {cancelHref && <Link href={cancelHref} className="crew-btn ghost">Cancel</Link>}
      </div>
    </form>
  );
}
