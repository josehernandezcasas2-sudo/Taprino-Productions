import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { seriesSaleNote } from '../../lib/showRules';
import { callApi } from './EditorBits';
import { RoomSheet } from './AddEpisodesBar';
import { CheckIcon, ClockIcon, LockIcon } from '../PlayerIcons';

// "Who gets paid" (the series revamp, slice 3b:
// mockups/series-slice3b-contract.md §6.2). One control for a show and for
// a title, read from the PayeeBlock the server builds (lib/payees.js
// getPayeeBlock — inside GET /api/show/[id] as `payee`, GET
// /api/show/episode/[id] as `payee`, or GET /api/payees?type=&id=) and
// changed through POST /api/payees (pick · self · default · step_down)
// and POST /api/payees/invites/<id> (cancel). Who may do what is the
// block's `can`; `locked` says why the viewer can't (the not-yet date, a
// removal, "Only Mara … can change who gets paid", migration 118).
//
//   mode 'card'     the show page's side card (#show-payee), creator and
//                   admin rooms alike;
//   mode 'section'  a card at the end of the episode editor's More info;
//   mode 'modal'    the body of PayeeModal (Your work, a title without a
//                   show): the dialog's title is the heading.
//
// After a change: onChanged(nextBlock, words) — the host toasts `words`
// and reads the page again. onChanged(null, null) asks for a fresh read
// only (another account changed it a moment ago).

const SALE_NOTE_START = 'Whole-series sales of ';

// "Night Bus" for a show, "“Pilot”" for a title (the step-down's words).
export function payeeTitleWord(payee) {
  if (!payee) return 'this title';
  if (payee.titleType === 'series') return payee.showName || payee.titleName || 'this show';
  return `“${payee.titleName || 'this title'}”`;
}

// "Runs it Mara Reyes · Paid to Pat Lee", and "Waiting on Pat to accept"
// under it: the show card, the editors' heads, the admin Owner card.
export function PayeeLine({ payee, className = '', showPending = true, showSource = false }) {
  if (!payee || !payee.line) return null;
  const line = payee.line;
  return (
    <div className={`show-payee-head ${className}`.trim()}>
      <p className="show-payee-line">
        <span className="show-payee-pair"><span className="show-payee-k">Runs it</span> <strong>{line.runsIt}</strong></span>
        <span className="show-payee-dot" aria-hidden="true">·</span>
        <span className="show-payee-pair">
          <span className="show-payee-k">Paid to</span> <strong>{line.paidTo}</strong>
          {showSource && payee.sourceWords ? <span className="show-payee-source"> {payee.sourceWords}</span> : null}
        </span>
      </p>
      {showPending && line.pending ? <p className="show-payee-waiting"><ClockIcon size={12} /> <span>{line.pending}</span></p> : null}
    </div>
  );
}

export default function PayeeCard({ payee, mode = 'card', onChanged = null, titleWord = null }) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState(null);
  const [to, setTo] = useState('');
  const [canGrant, setCanGrant] = useState(false);
  const [grant, setGrant] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [behind, setBehind] = useState(null);
  const errorRef = useRef(null);
  const openerRef = useRef(null);
  const firstRef = useRef(null);
  const refocus = useRef(false);

  // The keyboard goes where the eye goes: an error line takes the focus.
  useEffect(() => {
    if (error && errorRef.current) errorRef.current.focus({ preventScroll: false });
  }, [error]);
  // Opening the form puts the keyboard on its first choice; closing it
  // (Escape, Cancel) gives it back to "Change who gets paid" once that is
  // drawn again.
  useEffect(() => {
    if (open && firstRef.current) firstRef.current.focus({ preventScroll: true });
    if (!open && refocus.current) {
      refocus.current = false;
      if (openerRef.current) openerRef.current.focus({ preventScroll: true });
    }
  }, [open]);

  if (!payee) return null;
  const can = payee.can || {};
  const line = payee.line || null;
  const paidTo = payee.paidTo || null;
  const word = titleWord || payeeTitleWord(payee);
  const viewerIsPaid = Boolean(line && line.paidTo === 'You');
  const paidName = paidTo ? (viewerIsPaid ? 'you' : paidTo.name || 'its paid account') : 'no one yet';
  const locked = behind || payee.locked || null;
  const pending = payee.pending || null;
  const inShow = payee.titleType === 'episode' && Boolean(payee.showId);
  const saleNote = (payee.notes || []).find((n) => typeof n === 'string' && n.startsWith(SALE_NOTE_START))
    || (inShow && paidTo && ['show', 'runner'].includes(paidTo.source) ? seriesSaleNote(payee.showName || 'the show', viewerIsPaid ? 'you' : paidTo.name || 'its paid account') : null);
  const notes = (payee.notes || []).filter((n) => !(open && n === saleNote));
  const history = (payee.history || []).slice(1).filter((h) => h && h.toLabel);
  const k = `${uid}-k`;

  const options = [];
  if (can.self) options.push({ key: 'self', label: 'You', sub: 'From now on' });
  if (can.default && payee.defaultChoice) options.push({ key: 'default', label: `${payee.defaultChoice.label} (${payee.defaultChoice.you ? 'you' : payee.defaultChoice.name || 'no one yet'})`, sub: 'Back to its default' });
  options.push({ key: 'other', label: 'Someone else', sub: 'They get an invite and decide' });

  function openForm() {
    setError(null);
    setCanGrant(false);
    setGrant(false);
    setTo('');
    setChoice(options.length === 1 ? options[0].key : null);
    setOpen(true);
  }
  function closeForm() {
    setOpen(false);
    setChoice(null);
    setTo('');
    setCanGrant(false);
    setGrant(false);
    setError(null);
    refocus.current = true;
  }

  // What a failed call means here: a refresh, the Creator Studio tick, the
  // migration line, or the server's own line under the form.
  function failed(r) {
    if (r.status === 503) {
      setBehind(r.error);
      setOpen(false);
      return;
    }
    const code = r.data && r.data.code;
    if (r.status === 409 && code === 'no-creator-role' && r.data.canGrant) setCanGrant(true);
    if (r.status === 409 && ['pending', 'changed', 'answered', 'cancelled', 'locked', 'not-yet'].includes(code)) {
      setOpen(false);
      if (onChanged) onChanged(null, null);
    }
    setError(r.error);
  }

  function done(r) {
    setOpen(false);
    setChoice(null);
    setTo('');
    setCanGrant(false);
    setGrant(false);
    setError(null);
    if (onChanged) onChanged(r.data.payee || null, r.data.words || null);
  }

  async function submit(e) {
    if (e) e.preventDefault();
    if (busy || !choice) return;
    const base = { type: payee.titleType, id: payee.titleId };
    let body;
    if (choice === 'other') {
      const typed = to.trim();
      if (!typed) {
        setError('Pick someone: their @handle or the email on their account.');
        return;
      }
      body = { ...base, action: 'pick', to: typed, ...(canGrant && grant ? { grantCreator: true } : {}) };
    } else {
      const next = choice === 'self' || (choice === 'default' && payee.defaultChoice && payee.defaultChoice.you) ? 'you' : (payee.defaultChoice && payee.defaultChoice.name) || 'its default account';
      const movesAway = paidTo && !viewerIsPaid && !(choice === 'default' && payee.defaultChoice && payee.defaultChoice.name === paidTo.name);
      if (movesAway) {
        const old = paidTo.name || 'its paid account';
        if (!window.confirm(`Its earnings go to ${next} from now on, and ${old} is told. What it earned before stays with ${old}.`)) return;
      }
      body = { ...base, action: choice };
    }
    setBusy('save');
    setError(null);
    const r = await callApi('POST', '/api/payees', body);
    setBusy(null);
    if (!r.ok) return failed(r);
    return done(r);
  }

  async function withdraw() {
    if (!pending || busy) return;
    if (!window.confirm(`Withdraw the invite to ${pending.name || 'them'}? Nothing about its earnings has changed.`)) return;
    setBusy('withdraw');
    setError(null);
    const r = await callApi('POST', `/api/payees/invites/${encodeURIComponent(pending.inviteId)}`, { action: 'cancel' });
    setBusy(null);
    if (!r.ok) return failed(r);
    return done({ data: { payee: r.data.payee, words: r.data.words === 'Withdrawn.' ? `The invite to ${pending.name || 'them'} is withdrawn.` : r.data.words } });
  }

  async function stepDown() {
    if (busy) return;
    const back = (payee.defaultChoice && payee.defaultChoice.name) || 'its default account';
    if (!window.confirm(`Stop getting the earnings of ${word}? They go back to ${back} from now on; what’s already credited to you stays yours.`)) return;
    setBusy('step');
    setError(null);
    const r = await callApi('POST', '/api/payees', { action: 'step_down', type: payee.titleType, id: payee.titleId });
    setBusy(null);
    if (!r.ok) return failed(r);
    return done(r);
  }

  const off = Boolean(busy);
  const body = (
    <>
      {line ? <PayeeLine payee={payee} showPending={false} showSource /> : null}
      {paidTo && paidTo.sinceLabel ? <p className="show-payee-since">since {paidTo.sinceLabel}</p> : null}
      {notes.length > 0 && (
        <ul className="show-payee-notes">
          {notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
      {payee.houseNote ? <p className="show-payee-note">{payee.houseNote}</p> : null}
      {payee.notReady ? <p className="show-payee-note tone-warn">{payee.notReady}</p> : null}

      {locked ? (
        <>
          {line && line.pending ? <p className="show-payee-waiting"><ClockIcon size={12} /> <span>{line.pending}</span></p> : null}
          <p className="show-payee-locked"><LockIcon size={12} /> <span>{locked}</span></p>
        </>
      ) : (
        <>
          {pending && (
            <div className="show-payee-pending" role="status">
              <p className="show-payee-pending-head">
                <ClockIcon size={13} />
                <span>Waiting for {pending.name || 'them'} to accept{pending.sentLabel ? ` · sent ${pending.sentLabel}` : ''}</span>
              </p>
              <p className="show-payee-pending-sub">Until they accept, its earnings keep going to {paidName}.</p>
              {pending.canCancel && (
                <button type="button" className="apl-link show-payee-withdraw" disabled={off} onClick={withdraw}>{busy === 'withdraw' ? 'Withdrawing…' : 'Withdraw invite'}</button>
              )}
            </div>
          )}
          {payee.lastAnswer && !pending ? <p className="show-payee-note">{payee.lastAnswer.name} said no on {payee.lastAnswer.atLabel}.</p> : null}
          {history.length > 0 && (
            <ul className="show-payee-history" aria-label="Before">
              {history.map((h, i) => <li key={`${h.name}-${h.toLabel}-${i}`}><span>Before:</span> {h.name} until {h.toLabel}</li>)}
            </ul>
          )}

          {can.pick && !pending && !open && (
            <button type="button" ref={openerRef} className="apl-btn-secondary show-side-btn show-payee-change" disabled={off} onClick={openForm}>Change who gets paid</button>
          )}

          {open && (
            <form className="show-payee-form" onSubmit={submit} onKeyDown={(e) => { if (e.key === 'Escape' && mode !== 'modal') { e.stopPropagation(); closeForm(); } }}>
              <fieldset className="show-payee-choices" role="radiogroup" aria-describedby={choice === 'other' ? `${uid}-help` : undefined}>
                <legend className="show-ed-label">Who should get its earnings?</legend>
                {options.map((o, i) => (
                  <label key={o.key} className={`show-sheet-show show-payee-choice ${choice === o.key ? 'on' : ''}`}>
                    <input
                      ref={i === 0 ? firstRef : undefined}
                      type="radio"
                      name={`${uid}-who`}
                      value={o.key}
                      checked={choice === o.key}
                      disabled={off}
                      onChange={() => { setChoice(o.key); setError(null); }}
                    />
                    <i aria-hidden="true" />
                    <span><strong>{o.label}</strong><small>{o.sub}</small></span>
                  </label>
                ))}
              </fieldset>
              {choice === 'other' && (
                <div className="show-ed-field show-payee-other">
                  <label className="show-ed-label" htmlFor={`${uid}-to`}>Their @handle or the email on their account</label>
                  <input
                    id={`${uid}-to`}
                    className="show-ed-input"
                    type="text"
                    inputMode="email"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    maxLength={320}
                    placeholder="@handle or name@example.com"
                    value={to}
                    disabled={off}
                    onChange={(e) => { setTo(e.target.value); if (canGrant) { setCanGrant(false); setGrant(false); } }}
                  />
                  <p className="show-ed-hint" id={`${uid}-help`}>They get an invite and decide. Until they accept, its earnings keep going to {paidName}.</p>
                  {saleNote ? <p className="show-ed-hint">{saleNote}</p> : null}
                  {canGrant && (
                    <label className="show-payee-grant">
                      <input type="checkbox" checked={grant} disabled={off} onChange={(e) => setGrant(e.target.checked)} />
                      <span>Give them Creator Studio too</span>
                    </label>
                  )}
                </div>
              )}
              <div className="show-payee-acts">
                <button type="submit" className="apl-btn show-mini show-payee-send" disabled={off || !choice || (choice === 'other' && !to.trim()) || (canGrant && !grant)}>
                  {busy === 'save' ? (choice === 'other' ? 'Sending…' : 'Saving…') : choice === 'other' ? 'Send the invite' : 'Save'}
                </button>
                <button type="button" className="apl-btn-secondary show-mini" disabled={off} onClick={closeForm}>Cancel</button>
              </div>
            </form>
          )}

          {can.stepDown && !open && (
            <button type="button" className="apl-link show-payee-step" disabled={off} onClick={stepDown}>{busy === 'step' ? 'Stopping…' : 'Stop getting its earnings'}</button>
          )}
        </>
      )}

      {error && <p className="admin-error show-payee-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}
      {mode === 'card' && payee.available !== false && (
        <p className="show-payee-foot">Its share of ad money and members’ support, its sales and its tips go to this account. What it already earned stays where it went.</p>
      )}
    </>
  );

  if (mode === 'modal') return <div className="show-payee is-modal">{body}</div>;
  if (mode === 'section') {
    return (
      <section id="ep-payee" className="show-ed-card show-payee is-section" aria-labelledby={k}>
        <h3 className="show-ed-card-k" id={k}>Who gets paid</h3>
        {body}
      </section>
    );
  }
  return (
    <section id="show-payee" className="show-side-card show-payee" aria-labelledby="show-payee-k">
      <h2 className="show-side-k" id="show-payee-k">Who gets paid</h2>
      {body}
    </section>
  );
}

// Your work's "Who gets paid" for a title without a show: the block read
// from GET /api/payees?type=&id= in a sheet (Escape closes it), the
// change's words at the top once it's made.
export function PayeeModal({ type = 'episode', id, title, onClose, onChanged = null }) {
  const [state, setState] = useState({ phase: 'loading' });
  const [notice, setNotice] = useState(null);
  const load = useCallback(async () => {
    const r = await callApi('GET', `/api/payees?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`);
    setState(r.ok && r.data.payee ? { phase: 'ready', payee: r.data.payee } : { phase: 'error', error: r.error || 'That title isn’t there.' });
  }, [type, id]);
  useEffect(() => { load(); }, [load]);
  return (
    <RoomSheet title={`Who gets paid for “${title || 'this title'}”`} onClose={onClose}>
      {notice && <p className="show-payee-done" role="status"><CheckIcon size={14} /> <span>{notice}</span></p>}
      {state.phase === 'loading' && <p className="show-ed-hint" aria-busy="true">Loading…</p>}
      {state.phase === 'error' && <p className="admin-error" role="alert">{state.error}</p>}
      {state.phase === 'ready' && (
        <PayeeCard
          payee={state.payee}
          mode="modal"
          onChanged={(next, words) => {
            if (words) setNotice(words);
            if (next) setState({ phase: 'ready', payee: next });
            else load();
            if (onChanged) onChanged(next, words);
          }}
        />
      )}
    </RoomSheet>
  );
}
