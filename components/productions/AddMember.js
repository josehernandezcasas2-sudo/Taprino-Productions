import { useEffect, useState } from 'react';
import { Avatar } from '../crew/CrewBits';
import { CREW_ROLES } from '../../lib/crewOptions';
import { MAX_ROLE_CHARS } from '../../lib/productionRules';

// Add someone to a production's crew list by name (Crew Call's directory)
// or @handle, with their role. The production page and its dashboard both
// use it; `api(url, body, method)` is the page's fetch wrapper (the JSON,
// or null after it set the page's error). `startOpen` opens the form at
// once (the dashboard's "+ Add someone").
export default function AddMember({ productionId, busy, api, startOpen = false, onDone = null }) {
  const [open, setOpen] = useState(startOpen);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [picked, setPicked] = useState(null); // { userId, displayName }
  const [people, setPeople] = useState([]);

  useEffect(() => {
    if (!open || picked || q.trim().length < 2 || q.trim().startsWith('@')) { setPeople([]); return undefined; }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/crew/people?q=${encodeURIComponent(q.trim())}`);
        const data = await res.json();
        if (res.ok) setPeople((data.people || []).slice(0, 6));
      } catch (err) { /* nothing */ }
    }, 250);
    return () => clearTimeout(t);
  }, [q, open, picked]);

  async function submit(e) {
    e.preventDefault();
    const body = picked ? { userId: picked.userId, role } : { handle: q.trim(), role };
    const r = await api(`/api/productions/${productionId}/members`, body);
    if (r) { setQ(''); setRole(''); setPicked(null); setPeople([]); if (onDone) onDone(r); }
  }

  if (!open) return <div><button type="button" className="crew-btn sm" onClick={() => setOpen(true)}>+ Add someone</button></div>;
  return (
    <form className="prod-add" onSubmit={submit}>
      <div className="crew-field" style={{ position: 'relative' }}><span>Who</span>
        <input type="text" className="crew-input" value={picked ? picked.displayName : q} onChange={(e) => { setPicked(null); setQ(e.target.value); }} placeholder="Name on Crew Call, or @handle" autoComplete="off" />
        {people.length > 0 && !picked && (
          <div className="prod-suggest" role="listbox">
            {people.map((x) => <button key={x.userId} type="button" onClick={() => { setPicked({ userId: x.userId, displayName: x.displayName }); setPeople([]); }}><Avatar userId={x.userId} name={x.displayName} src={x.avatarUrl} position={x.avatarPosition} zoom={x.avatarZoom} size="sm" /><span>{x.displayName}{x.handle ? <small> @{x.handle}</small> : null}</span><small>{(x.roles || []).slice(0, 3).join(', ')}</small></button>)}
          </div>
        )}
      </div>
      <label className="crew-field"><span>Role</span>
        <input type="text" className="crew-input" list="prod-roles" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Gaffer" maxLength={MAX_ROLE_CHARS} required />
        <datalist id="prod-roles">{CREW_ROLES.map((r) => <option key={r} value={r} />)}</datalist>
      </label>
      <div className="crew-actions">
        <button type="submit" className="crew-btn sm primary" disabled={busy || (!picked && q.trim().length < 2) || role.trim().length < 2}>Add</button>
        <button type="button" className="crew-btn sm ghost" onClick={() => { setOpen(false); setPicked(null); setQ(''); if (onDone) onDone(null); }}>Cancel</button>
        <span className="crew-mono">They get a notification and can take themselves off.</span>
      </div>
    </form>
  );
}
