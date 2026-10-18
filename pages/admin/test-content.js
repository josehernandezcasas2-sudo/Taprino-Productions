import { useEffect, useMemo, useState } from 'react';
import AdminShell from '../../components/AdminShell';
import { adminPageProps } from '../../lib/adminPage';

// Content → Test content (lib/testContent.js, mockup
// mockups/test-content-v1.html). Full admins only.
export async function getServerSideProps(ctx) {
  return adminPageProps(ctx);
}

const GROUPS = [
  { key: 'placeholders', title: 'Placeholders', note: 'generated from Settings' },
  { key: 'titles', title: 'Titles', note: 'name says test, or deletion requested' },
  { key: 'series', title: 'Series & shows', note: 'their episodes go with them' },
  { key: 'other', title: 'Pitches · Locations · Crew calls', note: '' }
];

const REASON = {
  placeholder: { label: 'Placeholder', cls: 'sky' },
  deletion_requested: { label: 'Deletion requested', cls: 'warn' },
  name_test: { label: 'Name says test', cls: 'gold' },
  added: { label: 'Added by you', cls: 'accent' }
};

function Row({ row, checked, onToggle }) {
  return (
    <label className={`tc-row${row.blocked ? ' is-blocked' : ''}`}>
      <input type="checkbox" checked={checked} disabled={Boolean(row.blocked)} onChange={() => onToggle(row)} />
      <span className="tc-row-main">
        <span className="tc-row-title">{row.title}</span>
        <span className="tc-meta">{row.blocked || row.meta}</span>
      </span>
      <span className="tc-chips">
        {row.reasons.map((r) => REASON[r] && <span key={r} className={`tc-chip ${REASON[r].cls}`}>{REASON[r].label}</span>)}
        {row.rowCount > 1 && <span className="tc-chip">{row.rowCount} rows</span>}
        {row.blocked && <span className="tc-chip warn">Blocked</span>}
      </span>
    </label>
  );
}

export default function AdminTestContent({ account, mainGenres }) {
  const [rows, setRows] = useState(null);
  const [extra, setExtra] = useState([]);
  const [selected, setSelected] = useState({});
  const [loadError, setLoadError] = useState(null);
  const [query, setQuery] = useState('');
  const [searchRows, setSearchRows] = useState(null);
  const [searching, setSearching] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    setLoadError(null);
    try {
      const res = await fetch('/api/admin/test-content');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load.');
      setRows(data.rows);
      setExtra([]);
      const pre = {};
      for (const r of data.rows) if (r.preselect) pre[r.key] = r;
      setSelected(pre);
    } catch (err) {
      setLoadError(err.message);
      setRows([]);
    }
  }
  useEffect(() => { load(); }, []);

  async function search(e) {
    e.preventDefault();
    if (query.trim().length < 2) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/admin/test-content?q=${encodeURIComponent(query.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Search failed.');
      setSearchRows(data.rows);
    } catch (err) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  }

  function toggle(row) {
    setSelected((s) => {
      const next = { ...s };
      if (next[row.key]) delete next[row.key]; else next[row.key] = row;
      return next;
    });
  }
  function addFromSearch(row) {
    if (!(rows || []).some((r) => r.key === row.key) && !extra.some((r) => r.key === row.key)) setExtra((x) => [...x, row]);
    if (!row.blocked) setSelected((s) => ({ ...s, [row.key]: row }));
  }
  function toggleGroup(list) {
    const open = list.filter((r) => !r.blocked);
    const allOn = open.length > 0 && open.every((r) => selected[r.key]);
    setSelected((s) => {
      const next = { ...s };
      for (const r of open) { if (allOn) delete next[r.key]; else next[r.key] = r; }
      return next;
    });
  }

  const picked = Object.values(selected);
  const rowTotal = picked.reduce((n, r) => n + r.rowCount, 0);
  const mediaTotal = picked.reduce((n, r) => n + r.media, 0);
  const counts = useMemo(() => {
    const all = rows || [];
    return {
      found: all.reduce((n, r) => n + r.rowCount, 0),
      placeholders: all.filter((r) => r.group === 'placeholders').reduce((n, r) => n + r.rowCount, 0),
      named: all.filter((r) => r.reasons.includes('name_test')).length,
      blocked: all.filter((r) => r.blocked).length
    };
  }, [rows]);

  async function doDelete() {
    setBusy(true);
    setError(null);
    try {
      const items = picked.flatMap((r) => r.items);
      const res = await fetch('/api/admin/test-content', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items, confirm: typed.trim() }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not delete.');
      setResult(data);
      setConfirming(false);
      setTyped('');
      setSearchRows(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const byGroup = (key) => (rows || []).filter((r) => r.group === key);

  return (
    <AdminShell account={account} mainGenres={mainGenres} title="Test content" crumbs={['Content']}
      intro="Everything that looks like a test: placeholders the site generated, anything whose name says “test”, titles whose creator asked for deletion, and anything you add by name. Tick what goes, then delete. Deleting is for good; the videos and images go to Orphaned media (Library & queues) so they can be cleared from Cloudflare and Storage.">

      {result && (
        <div className="tc-done">
          <b>Deleted {result.total}.</b>{' '}
          {result.media > 0 ? `${result.media} video${result.media === 1 ? '' : 's'} and image${result.media === 1 ? '' : 's'} are waiting in Orphaned media (Library & queues): clear them there to stop paying for the storage.` : 'No media to clean up.'}
          {result.skipped.length > 0 && <span className="tc-meta">Skipped: {result.skipped.map((s) => `${s.title} (${s.reason})`).join('; ')}</span>}
        </div>
      )}

      <div className="adm-stats tc-stats">
        <div className="adm-stat"><b>{rows ? counts.found : '…'}</b><span>Found</span></div>
        <div className="adm-stat"><b>{rows ? counts.placeholders : '…'}</b><span>Placeholders</span></div>
        <div className="adm-stat"><b>{rows ? counts.named : '…'}</b><span>Name says “test”</span></div>
        <div className="adm-stat"><b>{rows ? counts.blocked : '…'}</b><span>Blocked (money attached)</span></div>
      </div>

      <form className="tc-find" onSubmit={search}>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Add something else by name: titles, series, pitches, places, calls…" aria-label="Find content by name" />
        <button type="submit" className="account-btn-secondary" disabled={searching || query.trim().length < 2}>{searching ? 'Searching…' : 'Search'}</button>
      </form>

      {searchRows && (
        <div className="tc-group">
          <div className="tc-group-head"><h3>Search: “{query.trim()}”</h3><span className="tc-meta">{searchRows.length} found</span><span className="tc-spacer" /><button type="button" className="adm-link-btn" onClick={() => setSearchRows(null)}>Close</button></div>
          {searchRows.length === 0 ? <p className="adm-empty tc-pad">Nothing by that name.</p> : searchRows.map((r) => (
            <div key={r.key} className={`tc-row${r.blocked ? ' is-blocked' : ''}`}>
              <span />
              <span className="tc-row-main"><span className="tc-row-title">{r.title}</span><span className="tc-meta">{r.blocked || r.meta}</span></span>
              <span className="tc-chips">{selected[r.key] ? <span className="tc-chip ok">Added</span> : <button type="button" className="account-btn-secondary tc-add" disabled={Boolean(r.blocked)} onClick={() => addFromSearch(r)}>Add</button>}</span>
            </div>
          ))}
        </div>
      )}

      {loadError && <p className="tc-error">{loadError}</p>}
      {!rows ? <p className="adm-empty">Looking…</p> : (
        <>
          {extra.length > 0 && (
            <div className="tc-group">
              <div className="tc-group-head"><h3>Added by you</h3><span className="tc-meta">{extra.length}</span></div>
              {extra.map((r) => <Row key={r.key} row={r} checked={Boolean(selected[r.key])} onToggle={toggle} />)}
            </div>
          )}
          {GROUPS.map((g) => {
            const list = byGroup(g.key);
            if (!list.length) return null;
            const open = list.filter((r) => !r.blocked);
            const allOn = open.length > 0 && open.every((r) => selected[r.key]);
            return (
              <div key={g.key} className="tc-group">
                <div className="tc-group-head">
                  <input type="checkbox" checked={allOn} onChange={() => toggleGroup(list)} aria-label={`Select all ${g.title}`} disabled={!open.length} />
                  <h3>{g.title}</h3>
                  <span className="tc-meta">{list.reduce((n, r) => n + r.rowCount, 0)}{g.note ? ` · ${g.note}` : ''}</span>
                </div>
                {list.map((r) => <Row key={r.key} row={r} checked={Boolean(selected[r.key])} onToggle={toggle} />)}
              </div>
            );
          })}
          {rows.length === 0 && extra.length === 0 && <p className="adm-empty">No test content left. Search above if something else needs to go.</p>}
        </>
      )}

      <div className="tc-bar">
        <span className="tc-sum"><b>{rowTotal} selected</b>{mediaTotal > 0 ? ` · ${mediaTotal} media file${mediaTotal === 1 ? '' : 's'} to clean up` : ''}</span>
        <button type="button" className="account-btn-secondary" onClick={() => setSelected({})} disabled={!picked.length}>Clear selection</button>
        <button type="button" className="account-btn-danger tc-go" onClick={() => { setConfirming(true); setError(null); }} disabled={!picked.length}>Delete {rowTotal}…</button>
      </div>
      {error && !confirming && <p className="tc-error">{error}</p>}

      {confirming && (
        <div className="tc-modal-wrap" role="dialog" aria-modal="true" aria-labelledby="tc-modal-title" onClick={(e) => { if (e.target === e.currentTarget && !busy) setConfirming(false); }}>
          <div className="tc-modal">
            <span className="adm-eyebrow tc-warn-text">Can’t be undone</span>
            <h3 id="tc-modal-title">Delete {rowTotal} item{rowTotal === 1 ? '' : 's'} for good?</h3>
            <ul>
              {picked.slice(0, 8).map((r) => <li key={r.key}><b>{r.title}</b>{r.rowCount > 1 ? ` (${r.rowCount} rows)` : ''}</li>)}
              {picked.length > 8 && <li>…and {picked.length - 8} more</li>}
              <li>Their schedule slots, curated-row spots, ad plans, likes, saves and comments go too</li>
              {mediaTotal > 0 && <li>{mediaTotal} video{mediaTotal === 1 ? '' : 's'} and image{mediaTotal === 1 ? '' : 's'} are listed in Orphaned media for cleanup</li>}
              <li>The delete is written to the Audit log</li>
            </ul>
            <label className="tc-meta" htmlFor="tc-typed">Type DELETE to confirm</label>
            <input id="tc-typed" className="tc-typed" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoFocus />
            {error && <p className="tc-error">{error}</p>}
            <div className="tc-actions">
              <button type="button" className="account-btn-secondary" onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
              <button type="button" className="account-btn-danger tc-go" onClick={doDelete} disabled={busy || typed.trim() !== 'DELETE'}>{busy ? 'Deleting…' : 'Delete for good'}</button>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
