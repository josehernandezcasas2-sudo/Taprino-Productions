import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { planMove, showNoun } from '../../lib/showRules';
import { callApi } from './EditorBits';
import { trapTab } from './roomBits';
import { CloseIcon, PlusIcon } from '../PlayerIcons';

// "Move to…" (spec Screens, "Move to… picker"; board MoveSheet): where an
// episode or a draft goes — a season of this show (or a new one), a slot
// (the end of the season, a free number, or a number typed with the live
// line "E4 is taken — Swap | Insert here"), or another of the viewer's
// shows of the same kind (the ones it can't go into greyed with the
// reason). Before anything moves the sheet says what will: planMove's
// words ("E3 → S2 E1; S1 E4–E7 keep their numbers") and the server's lines
// for another show ("It leaves the site until Harbor Lights goes public").
// Move posts to /api/show/<id>/move; a refusal is shown and nothing moves.
//
// A bottom sheet on a phone; from 900px a dialog, or a popover beside the
// row when the caller passes the row's rect as `anchorRect`.
//
//   show     { id, name, kind, seasons: [{ number, label }] }
//   episode  { id, kind: 'episode' | 'draft', title, displayTitle, season,
//              seriesOrder, code, status }
//   myShows  the shows it could go to (null while the host reads them): the episode editor's moveTargets
//            ({ id, name, kind, statusLabel, ok, reason, tag, lines }) or
//            GET /api/show summaries ({ …, pickable, pickReason })
//   onMoved(result)  after a move: the route's answer + { toShowId, season, number }
//   onClose()

function rowsFrom(pos, seriesId, { drafts, contentType }) {
  if (!pos || !pos.taken) return [];
  return Object.entries(pos.taken)
    .filter(([, h]) => h && (drafts || h.kind !== 'draft'))
    .map(([n, h]) => ({
      id: h.id,
      title: h.title || null,
      seriesId,
      season: pos.season,
      seriesOrder: Number(n),
      contentType,
      ...(h.kind === 'draft' ? { kind: 'draft' } : { status: h.status || 'approved' })
    }));
}

function targetTag(t, show) {
  const sameKind = !t.kind || !show.kind || t.kind === show.kind;
  // Another kind says which (the board's "(podcast)"); the server's reason
  // is the line a tap shows.
  if (!sameKind) return { ok: false, tag: t.kind === 'vertical' ? '(vertical — studio only)' : `(${t.kind === 'podcast' ? 'podcast' : 'series'} — an episode joins its own kind)`, reason: t.reason || 'It only joins a show of its own kind.' };
  const ok = t.ok !== undefined ? t.ok !== false : t.pickable !== false;
  if (ok) return { ok: true, tag: null, reason: null };
  return { ok: false, tag: t.tag || (t.pickReason ? `(${String(t.pickReason).toLowerCase()})` : '(can’t take it)'), reason: t.reason || t.pickReason || 'It can’t go there.' };
}

export default function MoveSheet({ show, episode, myShows = [], onMoved, onClose, anchorRect = null }) {
  const uid = useId();
  const titleId = `${uid}-title`;
  const isDraft = episode.kind === 'draft' || episode.status === 'draft';
  const fromSeason = Number(episode.season) || 1;
  const fromNumber = Number(episode.seriesOrder) || null;
  const contentType = show.kind === 'podcast' ? 'podcast' : 'series';
  const [targetId, setTargetId] = useState(show.id);
  const [season, setSeason] = useState(fromSeason);
  const [slot, setSlot] = useState('end'); // end | gap | typed
  const [typed, setTyped] = useState('');
  const [mode, setMode] = useState(null); // swap | insert
  const [positions, setPositions] = useState({});
  const asked = useRef(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [answer, setAnswer] = useState(null);
  const panelRef = useRef(null);
  const [placed, setPlaced] = useState(null);

  const targets = useMemo(() => (myShows || [])
    .filter((t) => t && t.id && t.id !== show.id)
    .map((t) => ({ ...t, ...targetTag(t, show) })), [myShows, show]);
  const target = targetId === show.id ? null : targets.find((t) => t.id === targetId) || null;

  const key = (sid, s) => `${sid}|${s}`;
  const load = useCallback(async (sid, s) => {
    const k = key(sid, s);
    if (asked.current.has(k)) return;
    asked.current.add(k);
    setPositions((p) => ({ ...p, [k]: { state: 'loading' } }));
    const r = await callApi('GET', `/api/show/${encodeURIComponent(sid)}/positions?season=${encodeURIComponent(s)}&exclude=${encodeURIComponent(episode.id)}`);
    if (!r.ok) asked.current.delete(k);
    setPositions((p) => ({ ...p, [k]: r.ok ? { state: 'ready', data: r.data } : { state: 'error', error: r.error } }));
  }, [episode.id]);

  useEffect(() => { load(show.id, fromSeason); }, [load, show.id, fromSeason]);
  useEffect(() => { load(targetId, season); }, [load, targetId, season]);

  // Escape closes; the sheet takes the focus once, when it opens, and hands
  // it back to what opened it. The hosts re-render all the time (uploads,
  // polls) with a new onClose each time: read through a ref, so a
  // re-render never pulls the focus out of the number field.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [opener] = useState(() => (typeof document !== 'undefined' ? document.activeElement : null));
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    if (panelRef.current && !panelRef.current.contains(document.activeElement)) panelRef.current.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      if (opener && opener !== document.body && opener.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A popover beside the row on a laptop, kept on the screen — placed again
  // whenever it changes size (the shows and the numbers arrive after it
  // opens, the preview line comes and goes), so its foot (Move · Cancel)
  // never ends up below the window.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!anchorRect || typeof window === 'undefined' || window.innerWidth < 900 || !panel) {
      setPlaced(null);
      return undefined;
    }
    const place = () => {
      const w = panel.offsetWidth;
      const h = panel.offsetHeight;
      const roomLeft = anchorRect.left - 12;
      const left = Math.max(12, roomLeft >= w ? anchorRect.left - w - 12 : Math.min(window.innerWidth - w - 12, anchorRect.right + 12));
      const top = Math.max(12, Math.min(window.innerHeight - h - 12, anchorRect.top - 24));
      setPlaced((p) => (p && p.left === left && p.top === top ? p : { left, top }));
    };
    place();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
    if (ro) ro.observe(panel);
    window.addEventListener('resize', place);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [anchorRect]);

  const sourcePos = positions[key(show.id, fromSeason)];
  const targetPos = positions[key(targetId, season)];
  const tp = targetPos && targetPos.state === 'ready' ? targetPos.data : null;
  const sp = sourcePos && sourcePos.state === 'ready' ? sourcePos.data : null;

  // The target show's seasons: this show's from the caller, another's from
  // its positions answer; plus the next new one.
  const seasonList = useMemo(() => {
    let nums = [];
    const labels = {};
    if (targetId === show.id) {
      nums = (show.seasons || []).map((s) => Number(s.number)).filter(Boolean);
      for (const s of show.seasons || []) labels[Number(s.number)] = s.label;
      nums.push(fromSeason);
    } else {
      // Another show's seasons come with any of its positions answers.
      const found = Object.entries(positions).find(([k, p]) => k.startsWith(`${targetId}|`) && p && p.state === 'ready');
      const data = found ? found[1].data : null;
      if (data && Array.isArray(data.seasons)) {
        for (const s of data.seasons) {
          nums.push(Number(s.number));
          labels[Number(s.number)] = s.label;
        }
      }
    }
    nums.push(season);
    nums = [...new Set(nums.filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
    return { nums, labels, next: Math.max(...nums) + 1 };
  }, [targetId, show, fromSeason, season, positions]);

  const taken = tp ? tp.taken || {} : {};
  const parked = new Set(tp && Array.isArray(tp.parked) ? tp.parked : []);
  const others = Object.keys(taken).map(Number).filter((n) => taken[n] && taken[n].id !== episode.id && !parked.has(n));
  const endNumber = (others.length ? Math.max(...others) : 0) + 1;
  const gap = tp && Array.isArray(tp.gaps) && tp.gaps.length ? tp.gaps[0].from : null;
  const typedN = /^\d{1,4}$/.test(typed.trim()) && Number(typed.trim()) > 0 ? Number(typed.trim()) : null;
  const number = slot === 'gap' ? gap : slot === 'typed' ? typedN : null;
  const holder = number && taken[number] && taken[number].id !== episode.id ? taken[number] : null;
  const crossShow = targetId !== show.id;
  // Moving to another season or show reads the source season too (its
  // rows "keep their numbers"); inside one season the two are the same.
  const needSource = crossShow || season !== fromSeason;

  // What will move, by the same rule the server runs.
  const plan = useMemo(() => {
    if (!tp || (needSource && !sp)) return null;
    if (slot === 'typed' && !typedN) return null;
    const rows = [];
    const seen = new Set();
    const add = (r) => { if (r && !seen.has(r.id)) { seen.add(r.id); rows.push(r); } };
    add({ id: episode.id, title: episode.title || null, seriesId: show.id, season: fromSeason, seriesOrder: fromNumber, contentType, ...(isDraft ? { kind: 'draft' } : { status: episode.status || 'approved' }) });
    for (const r of rowsFrom(sp, show.id, { drafts: isDraft, contentType })) add(r);
    for (const r of rowsFrom(tp, targetId, { drafts: isDraft, contentType })) add(r);
    const spec = { ...(crossShow ? { seriesId: targetId, showName: target ? target.name : null } : {}), season, ...(number ? { number, ...(mode ? { mode } : {}) } : {}) };
    return planMove(rows, episode.id, spec);
  }, [tp, sp, needSource, slot, typedN, episode, show.id, fromSeason, fromNumber, contentType, isDraft, targetId, crossShow, target, season, number, mode]);

  const draftPushesEpisode = Boolean(isDraft && plan && plan.ok && plan.writes && plan.writes.some((w) => w.kind === 'episode'));
  const blockedByTarget = Boolean(target && !target.ok);
  let preview = null;
  if (plan && plan.ok) preview = plan.code === 'same' || !plan.writes.length ? 'Nothing moves.' : `${plan.words}.`;
  const choices = plan && !plan.ok && plan.code === 'taken' ? plan.choices || ['insert'] : null;
  const canMove = Boolean(plan && plan.ok && plan.writes.length && !draftPushesEpisode && !blockedByTarget && !busy);

  function pickSeason(n) {
    setSeason(n);
    setSlot('end');
    setTyped('');
    setMode(null);
    setAnswer(null);
    setError(null);
  }
  function pickTarget(id) {
    setTargetId(id);
    setSeason(id === show.id ? fromSeason : 1);
    setSlot('end');
    setTyped('');
    setMode(null);
    setAnswer(null);
    setError(null);
  }

  async function move(chosenMode = mode) {
    setBusy(true);
    setError(null);
    setAnswer(null);
    const body = {
      [isDraft ? 'draftId' : 'episodeId']: episode.id,
      ...(crossShow ? { toShowId: targetId } : {}),
      toSeason: season,
      ...(number ? { toNumber: number } : {}),
      ...(number && chosenMode ? { mode: chosenMode } : {})
    };
    const r = await callApi('POST', `/api/show/${encodeURIComponent(show.id)}/move`, body);
    setBusy(false);
    if (!r.ok) {
      if (r.status === 409 && r.data && r.data.code === 'taken') setAnswer(r.data);
      setError(r.error);
      return;
    }
    if (onMoved) onMoved({ ...r.data, toShowId: crossShow ? targetId : null, season, number: number || null });
    onClose();
  }

  const noun = showNoun(show.kind);
  const code = episode.code || (fromNumber ? `S${fromSeason} E${fromNumber}` : null);
  const name = episode.title || episode.displayTitle || 'this episode';
  const style = placed ? { position: 'fixed', left: placed.left, top: placed.top, bottom: 'auto', right: 'auto' } : undefined;

  return (
    <div className={`show-sheet ${anchorRect ? 'has-anchor' : ''}`}>
      <button type="button" className="show-sheet-backdrop" aria-label="Close" tabIndex={-1} onClick={onClose} />
      <div className="show-sheet-panel" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={panelRef} style={style} onKeyDown={(e) => trapTab(e, panelRef.current)}>
        <span className="show-sheet-grab" aria-hidden="true" />
        <div className="show-sheet-head">
          <div>
            <span className="show-ed-eyebrow">{[show.name, code ? `now ${code}` : null, isDraft ? 'draft' : null].filter(Boolean).join(' · ')}</span>
            <h2 className="show-sheet-title" id={titleId}>Move {code ? `${code.split(' ').pop()} · ` : ''}{name}</h2>
          </div>
          <button type="button" className="show-ed-close" aria-label="Close" onClick={onClose}><CloseIcon size={16} /></button>
        </div>

        <div className="show-sheet-body">
        <div className="show-sheet-block">
          <span className="show-ed-label" id={`${uid}-season`}>Season{crossShow && target ? ` · ${target.name}` : ''}</span>
          <div className="show-ed-chips" role="radiogroup" aria-labelledby={`${uid}-season`}>
            {seasonList.nums.map((n) => (
              <button key={n} type="button" role="radio" aria-checked={season === n ? 'true' : 'false'} className={`show-ed-chip ${season === n ? 'on' : ''}`} onClick={() => pickSeason(n)}>
                {seasonList.labels[n] || `Season ${n}`}
              </button>
            ))}
            <button type="button" className="show-ed-chip is-new" onClick={() => pickSeason(seasonList.next)}><PlusIcon size={12} /> New season {seasonList.next}</button>
          </div>
        </div>

        <div className="show-sheet-block">
          <span className="show-ed-label" id={`${uid}-slot`}>Number</span>
          <div className="show-ed-chips" role="radiogroup" aria-labelledby={`${uid}-slot`}>
            <button type="button" role="radio" aria-checked={slot === 'end' ? 'true' : 'false'} className={`show-ed-chip ${slot === 'end' ? 'on' : ''}`} onClick={() => { setSlot('end'); setMode(null); setAnswer(null); }}>
              End of season{tp ? ` (E${endNumber})` : ''}
            </button>
            {gap ? (
              <button type="button" role="radio" aria-checked={slot === 'gap' ? 'true' : 'false'} className={`show-ed-chip ${slot === 'gap' ? 'on' : ''}`} onClick={() => { setSlot('gap'); setMode(null); setAnswer(null); }}>
                E{gap} · free
              </button>
            ) : null}
            <label className={`show-ed-chip is-input ${slot === 'typed' ? 'on' : ''}`}>
              <span aria-hidden="true">E</span>
              <input
                type="text"
                inputMode="numeric"
                value={typed}
                placeholder="…"
                aria-label="Episode number"
                maxLength={4}
                onFocus={() => setSlot('typed')}
                onChange={(e) => { setTyped(e.target.value.replace(/[^0-9]/g, '')); setSlot('typed'); setMode(null); setAnswer(null); }}
              />
            </label>
          </div>
          {targetPos && targetPos.state === 'loading' && <p className="show-ed-hint">Reading the numbers…</p>}
          {targetPos && targetPos.state === 'error' && <p className="show-ed-line locked">{targetPos.error}</p>}
          {number && !holder && slot === 'typed' && <p className="show-ed-hint tone-ok">E{number} is free</p>}
          {holder && (isDraft && holder.kind === 'episode' ? (
            <p className="show-ed-conflict">E{number} is {holder.title ? `“${holder.title}”` : 'taken'} — an episode holds that place; pick a free number, or send the draft first.</p>
          ) : (
            <div className="show-ed-conflict">
              <span>E{number} is {holder.title ? `“${holder.title}”` : 'taken'}{holder.kind === 'draft' ? ' (a draft)' : ''} —</span>
              {(choices || (crossShow ? ['insert'] : ['swap', 'insert'])).map((c) => (
                <button key={c} type="button" className={`show-ed-choice ${mode === c ? 'on' : ''}`} onClick={() => setMode(c)}>{c === 'swap' ? 'Swap' : 'Insert here'}</button>
              ))}
            </div>
          ))}
        </div>

        <div className="show-sheet-block">
          <span className="show-ed-label" id={`${uid}-show`}>{crossShow ? 'Show' : `Another ${noun}`}</span>
          <div className="show-sheet-shows" role="radiogroup" aria-labelledby={`${uid}-show`}>
            <button type="button" role="radio" aria-checked={!crossShow ? 'true' : 'false'} className={`show-sheet-show ${!crossShow ? 'on' : ''}`} onClick={() => pickTarget(show.id)}>
              <i aria-hidden="true" />
              <span><strong>{show.name}</strong><small>This {noun}</small></span>
            </button>
            {targets.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={targetId === t.id ? 'true' : 'false'} aria-disabled={t.ok ? undefined : 'true'} className={`show-sheet-show ${targetId === t.id ? 'on' : ''} ${t.ok ? '' : 'is-off'}`} onClick={() => { if (t.ok) pickTarget(t.id); else setError(t.reason); }}>
                <i aria-hidden="true" />
                <span><strong>{t.name}</strong><small>{[t.statusLabel, t.tag].filter(Boolean).join(' ')}</small></span>
              </button>
            ))}
            {myShows === null ? <p className="show-ed-hint">Reading your shows…</p> : targets.length === 0 && <p className="show-ed-hint">No other {noun === 'show' ? 'shows' : 'series'} of yours to move it to.</p>}
          </div>
        </div>
        </div>

        {/* What will move stays in sight above the buttons, however long the list. */}
        <div className="show-sheet-foot">
        {plan && !plan.ok && plan.code !== 'taken' && <p className="show-ed-line locked" role="status">{plan.reason}</p>}
        {draftPushesEpisode && <p className="show-ed-line locked" role="status">An episode holds that place — a draft doesn’t move episodes along. Pick a free number, or send the draft first.</p>}
        {preview && !draftPushesEpisode && (
          <div className="show-sheet-preview" role="status"><span aria-hidden="true">→</span> {preview}</div>
        )}
        {target && target.ok && Array.isArray(target.lines) && target.lines.length > 0 && (
          <ul className="show-sheet-lines">{target.lines.map((l) => <li key={l}>{l}</li>)}</ul>
        )}
        {answer && answer.code === 'taken' && Array.isArray(answer.choices) && (
          <div className="show-ed-conflict">
            {answer.choices.map((c) => <button key={c} type="button" className="show-ed-choice" onClick={() => { setMode(c); move(c); }}>{c === 'swap' ? 'Swap them' : 'Insert it there'}</button>)}
            {answer.nextFree ? <button type="button" className="show-ed-choice" onClick={() => { setSlot('typed'); setTyped(String(answer.nextFree)); setMode(null); setAnswer(null); }}>Use E{answer.nextFree}</button> : null}
          </div>
        )}
        {error && <p className="show-ed-error" role="alert">{error}</p>}
        <div className="show-sheet-actions">
          <button type="button" className="apl-btn" disabled={!canMove} onClick={() => move()}>{busy ? 'Moving…' : 'Move'}</button>
          <button type="button" className="apl-btn-secondary" onClick={onClose}>Cancel</button>
        </div>
        </div>
      </div>
    </div>
  );
}
