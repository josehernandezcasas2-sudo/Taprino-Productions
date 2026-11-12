import { useRef, useState } from 'react';
import { AdmCard, ErrorLine, NeedLine, SignedClip, fileStateWords, onEscape } from './adminBits';

// Waiting for approval (the admin show page, slice 3a §5.3): every change
// a creator made to something live — the show's own and each episode's
// (title, words, art, the title image or its removal, a trailer, a new
// file) — with what is live now beside what is proposed, Approve or Deny
// (with a note) each, and Approve all for everything this account may
// decide. A show's season art (migration 122) comes as one item per
// season (field 'seasonArt:<n>'). Items come from lib/stagedChanges.js listStaged; a decision is
// POST /api/admin/show/[id] { action: 'staged', items, decision, note }.
function groupsOf(items) {
  const groups = [];
  const at = new Map();
  for (const it of items || []) {
    const key = `${it.target}:${it.id}`;
    if (!at.has(key)) {
      at.set(key, groups.length);
      groups.push({ key, target: it.target, title: it.target === 'series' ? `${it.titleName || 'The show'} (the show)` : [it.code, it.titleName].filter(Boolean).join(' · '), items: [] });
    }
    groups[at.get(key)].items.push(it);
  }
  return groups;
}

function Pair({ item }) {
  if (item.kind === 'text') {
    return (
      <div className="show-adm-text-pair">
        <p><span className="show-adm-pair-k">Now:</span> {item.current ? item.current : <em>nothing</em>}</p>
        <p><span className="show-adm-pair-k is-proposed">Proposed:</span> {item.clears ? <em>clear the notes</em> : item.proposed ? item.proposed : <em>nothing</em>}</p>
      </div>
    );
  }
  if (item.kind === 'image' || item.kind === 'removal') {
    // A season's art (migration 122) says its own frame and what its
    // removal leaves (item.shape, item.removalWords).
    const shape = item.shape || (item.field === 'poster' ? 'poster' : item.field === 'titleImage' || item.field === 'titleImageRemoval' ? 'title' : item.field === 'heroImage' ? 'hero' : 'still');
    const removalWords = item.removalWords || 'the name as text';
    return (
      <div className="show-ed-art-pair show-adm-art-pair">
        <figure>
          <div className={`show-ed-art-img kind-${shape}`}>{item.current ? <img src={item.current} alt="" /> : <span>None</span>}</div>
          <figcaption className="tone-ok">Live now</figcaption>
        </figure>
        <span className="show-ed-art-arrow" aria-hidden="true">→</span>
        <figure>
          <div className={`show-ed-art-img kind-${shape}`}>{item.kind === 'removal' ? <span>{removalWords}</span> : item.proposed ? <img src={item.proposed} alt="" /> : <span>None</span>}</div>
          <figcaption className="tone-review">{item.kind === 'removal' ? `Proposed: ${removalWords}` : 'Proposed'}</figcaption>
        </figure>
      </div>
    );
  }
  // A trailer or a new file: two players, and Cloudflare's word on the new one.
  const label = item.field === 'trailer' ? 'trailer' : 'file';
  return (
    <div className="show-adm-clips">
      <figure>
        <SignedClip media={item.current} label={`The live ${label}`} />
        <figcaption className="tone-ok">Live now</figcaption>
      </figure>
      <figure>
        <SignedClip media={item.proposed} label={`The proposed ${label}`} />
        <figcaption className="tone-review">Proposed · {fileStateWords(item.state)}</figcaption>
      </figure>
    </div>
  );
}

export default function StagedChangesCard({ admin, onAction, onDone, say }) {
  const [busy, setBusy] = useState(null);
  const [denying, setDenying] = useState(null);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const items = Array.isArray(admin.staged) ? admin.staged : [];
  const groups = groupsOf(items);
  const decidable = items.filter((it) => it.can && !it.line);
  // Deny… opens a note under its item; closing it gives the focus back.
  const denyButtons = useRef({});
  const closeDeny = (key) => {
    setDenying(null);
    setNote('');
    setTimeout(() => { const el = denyButtons.current[key]; if (el && typeof el.focus === 'function') el.focus(); }, 0);
  };

  async function decide(list, decision, withNote = '') {
    const key = list.length === 1 ? list[0].key : 'all';
    setBusy(`${decision}:${key}`);
    setError(null);
    // `seen`: what the card showed for each change, so one replaced since
    // is refused rather than put live unseen.
    const r = await onAction('staged', { items: list.map((it) => ({ target: it.target, id: it.id, field: it.field, ...(it.seen ? { seen: it.seen } : {}) })), decision, note: withNote.trim() || undefined });
    setBusy(null);
    const results = r.data && Array.isArray(r.data.results) ? r.data.results : [];
    if (!r.ok && !results.length) {
      setError(r.error);
      onDone();
      return;
    }
    const failed = results.filter((x) => !x.ok);
    setErrors(Object.fromEntries(failed.map((x) => [x.key, x.error || 'Not decided.'])));
    const done = results.length - failed.length;
    setDenying(null);
    setNote('');
    if (done > 0) {
      say({ tone: failed.length ? 'warn' : 'ok', title: `${done} ${decision === 'approve' ? 'approved' : 'denied'}`, lines: failed.length ? [`${failed.length} not decided — see the card.`] : ['They were told.'] }, 6000);
    } else if (failed.length) {
      say({ tone: 'warn', title: 'Nothing was decided', lines: [failed[0].error].filter(Boolean) }, 6000);
    }
    onDone();
  }

  return (
    <AdmCard id="show-adm-staged" k="Waiting for approval">
      {items.length === 0 ? (
        <p className="show-adm-line">Nothing waiting.</p>
      ) : (
        <>
          {groups.map((g) => (
            <div key={g.key} className="show-adm-group">
              <h3 className="show-adm-group-h">{g.title}</h3>
              <ul className="show-adm-items">
                {g.items.map((it) => {
                  const off = !it.can ? it.needs : it.line;
                  const thisBusy = busy && busy.endsWith(`:${it.key}`);
                  return (
                    <li key={it.key} className="show-adm-item">
                      <p className="show-adm-item-k">{it.label}</p>
                      <Pair item={it} />
                      {denying === it.key ? (
                        <div className="show-adm-form" onKeyDown={onEscape(() => closeDeny(it.key))}>
                          <label className="show-ed-label" htmlFor={`show-adm-deny-${it.key}`}>A note for them (optional)</label>
                          <textarea id={`show-adm-deny-${it.key}`} className="show-ed-textarea is-short" rows={2} maxLength={500} value={note} autoFocus onChange={(e) => setNote(e.target.value)} />
                          <div className="show-adm-inline">
                            <button type="button" className="show-danger-btn show-mini" disabled={Boolean(busy)} onClick={() => decide([it], 'deny', note)}>{thisBusy ? 'Denying…' : 'Deny it'}</button>
                            <button type="button" className="apl-link" onClick={() => closeDeny(it.key)}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="show-adm-inline">
                          <button type="button" className="apl-btn show-mini" disabled={Boolean(off) || Boolean(busy)} onClick={() => decide([it], 'approve')}>{busy === `approve:${it.key}` ? 'Approving…' : 'Approve'}</button>
                          <button type="button" ref={(el) => { denyButtons.current[it.key] = el; }} className="apl-btn-secondary show-mini" disabled={!it.can || Boolean(busy)} onClick={() => { setDenying(it.key); setNote(''); }}>Deny…</button>
                        </div>
                      )}
                      <NeedLine line={off} />
                      <ErrorLine text={errors[it.key]} />
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {decidable.length > 1 && (
            <button type="button" className="apl-btn-secondary show-adm-wide" disabled={Boolean(busy)} onClick={() => decide(decidable, 'approve')}>{busy === 'approve:all' ? 'Approving…' : `Approve all (${decidable.length})`}</button>
          )}
        </>
      )}
      <ErrorLine text={error} />
    </AdmCard>
  );
}
