import { useState } from 'react';
import { TIER_CHOICES } from '../../../lib/showAdminRules';
import { AdmCard, ErrorLine, NeedLine, dayWords, onEscape, plural, useOpener } from './adminBits';

// Decisions (the admin show page, slice 3a §5.3): approve or send back
// every episode in review together (one notice per uploader, one audit
// line; a show with more than 100 in review goes in steps), hold or take
// the show down and restore it (handle_flags), and tell the people who
// saved it about its newest episodes (full admins, a public show).
// Approving never makes the show public (decision 2).
export default function DecisionsCard({ admin, onAction, onDone, onProblems, say }) {
  const [tier, setTier] = useState('keep');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [holding, setHolding] = useState(false);
  const [hold, setHold] = useState({ reason: '', note: '', email: false });
  const [takingDown, setTakingDown] = useState(false);
  const [why, setWhy] = useState('');
  const show = admin.show || {};
  const can = admin.can || {};
  const needs = admin.needs || {};
  const review = admin.review || { count: 0, batch: { ok: false } };
  const count = Number(review.count) || 0;
  const owner = admin.ownerName || null;
  const name = show.name || 'the show';
  const reasons = admin.flagReasons && typeof admin.flagReasons === 'object' ? Object.entries(admin.flagReasons) : [];
  const [rejectRef, focusReject] = useOpener();
  const [holdRef, focusHold] = useOpener();
  const [downRef, focusDown] = useOpener();
  const closeReject = () => { setRejecting(false); setReason(''); focusReject(); };
  const closeHold = () => { setHolding(false); focusHold(); };
  const closeDown = () => { setTakingDown(false); focusDown(); };

  async function approveAll() {
    setBusy('approve');
    setError(null);
    onProblems(null);
    let approved = 0;
    let lastWords = null;
    let showPublic = false;
    // A show with more than one request's worth goes in steps.
    // What the page showed for each episode in review (its file): one
    // replaced since, or one that came in since, refuses the request.
    const seen = Object.fromEntries(Object.entries(review.rows || {}).filter(([, row]) => row && row.seen).map(([id, row]) => [id, row.seen]));
    for (let step = 0; step < 20; step += 1) {
      const r = await onAction('approve', { episodeIds: 'all', tierOverride: tier, seen });
      if (!r.ok) {
        if (approved === 0 || r.data.code !== 'nothing') {
          setError(r.error);
          if (Array.isArray(r.data.problems)) onProblems(r.data.problems);
        }
        break;
      }
      approved += (r.data.approved || []).length;
      lastWords = r.data.words || null;
      showPublic = Boolean(r.data.showPublic);
      if (!(Number(r.data.remaining) > 0) || (r.data.approved || []).length === 0) break;
    }
    setBusy(null);
    if (approved > 0) {
      say({
        tone: 'ok',
        title: approved > 1 ? `${approved} approved` : lastWords || '1 approved',
        lines: [showPublic ? 'They’re live now.' : `They stay private until ${owner || 'its owner'} makes the show public.`, `${owner || 'The uploader'} was told.`]
      }, 7000);
    }
    onDone();
  }

  async function rejectAll() {
    setBusy('reject');
    setError(null);
    const r = await onAction('reject', { episodeIds: 'all', reason: reason.trim() });
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      onDone();
      return;
    }
    setRejecting(false);
    setReason('');
    const n = (r.data.rejected || []).length;
    say({ tone: 'ok', title: n ? `${plural(n, 'episode', 'episodes')} sent back` : 'Nothing was sent back', lines: n ? ['Each uploader was told why.'] : [] }, 6000);
    onDone();
  }

  async function pull() {
    setBusy('hold');
    setError(null);
    const r = await onAction('hold', { reason: hold.reason, note: hold.note.trim(), emailOwner: hold.email });
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      onDone();
      return;
    }
    setHolding(false);
    setHold({ reason: '', note: '', email: false });
    // A private show was never on the site: it stays private instead.
    const where = show.isPublic ? 'It’s off the site while the team looks.' : 'It stays private and can’t be made public until it’s restored.';
    say({ tone: 'ok', title: `${name} is pulled`, lines: [`${where} ${owner || 'Its owner'} was told.`] }, 7000);
    onDone();
  }

  async function takeDown() {
    if (!window.confirm(show.isPublic ? `Take ${name} down? It comes off the site and ${owner || 'its owner'} sees your reason.` : `Take ${name} down? It can’t be made public, and ${owner || 'its owner'} sees your reason.`)) return;
    setBusy('down');
    setError(null);
    const r = await onAction('take_down', { note: why.trim() });
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      onDone();
      return;
    }
    setTakingDown(false);
    setWhy('');
    say({ tone: 'ok', title: `${name} is taken down`, lines: [`${owner || 'Its owner'} sees your reason.`] }, 7000);
    onDone();
  }

  async function restore() {
    setBusy('restore');
    setError(null);
    const r = await onAction('restore', {});
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      onDone();
      return;
    }
    say({ tone: 'ok', title: `${name} is restored`, lines: [r.data.status === 'pending' ? `It’s private until ${owner || 'its owner'} makes it public.` : 'It’s back on the site.'] }, 7000);
    onDone();
  }

  async function tellSavers() {
    setBusy('tell');
    setError(null);
    const r = await onAction('tell_savers', {});
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      onDone();
      return;
    }
    const sent = Number(r.data.sent ?? r.data.matched) || 0;
    const checked = Number(r.data.checked) || 0;
    say({ tone: 'ok', title: `Told ${plural(sent, 'person', 'people')} (${checked.toLocaleString('en-US')} checked).`, lines: r.data.finished === false ? ['The daily run finishes the rest.'] : [] }, 7000);
    onDone();
  }

  const approveOff = !can.approve ? needs.approve : count === 0 ? null : !review.batch || !review.batch.ok ? review.batch && review.batch.line : null;
  const held = Boolean(show.held);
  return (
    <AdmCard id="show-adm-decisions" k="Decisions">
      <div className="show-adm-block">
        <p className="show-adm-line"><strong>{count ? `${count} in review` : 'Nothing in review.'}</strong></p>
        {count > 0 && (
          <>
            <label className="show-adm-select">
              <span>Who can watch</span>
              <select value={tier} disabled={!can.approve || Boolean(busy)} onChange={(e) => setTier(e.target.value)}>
                {TIER_CHOICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <button type="button" className="apl-btn show-adm-wide" disabled={!can.approve || !review.batch || !review.batch.ok || Boolean(busy)} onClick={approveAll}>
              {busy === 'approve' ? 'Approving…' : `Approve all in review (${count})`}
            </button>
            {can.approve && review.batch && !review.batch.ok && review.batch.line ? <p className="show-adm-line tone-warn">{review.batch.line}</p> : null}
            {!rejecting ? (
              <button type="button" ref={rejectRef} className="apl-btn-secondary show-adm-wide" disabled={!can.approve || Boolean(busy)} onClick={() => { setRejecting(true); setReason(''); }}>Reject all in review…</button>
            ) : (
              <div className="show-adm-form" onKeyDown={onEscape(closeReject)}>
                <label className="show-ed-label" htmlFor="show-adm-reject-all">What needs fixing ({owner || 'they'} read{owner ? 's' : ''} this)</label>
                <textarea id="show-adm-reject-all" className="show-ed-textarea is-short" rows={3} maxLength={1000} value={reason} autoFocus onChange={(e) => setReason(e.target.value)} />
                <div className="show-adm-inline">
                  <button type="button" className="show-danger-btn show-mini" disabled={Boolean(busy)} onClick={rejectAll}>{busy === 'reject' ? 'Sending…' : 'Send them back'}</button>
                  <button type="button" className="apl-link" onClick={closeReject}>Cancel</button>
                </div>
              </div>
            )}
            {!can.approve && <NeedLine line={approveOff} />}
          </>
        )}
      </div>

      <div className="show-adm-block">
        <p className="show-adm-sub">Moderation</p>
        {held ? (
          <>
            <p className="show-adm-line tone-danger">{show.takenDown ? `Taken down: ${show.decisionNote || 'no reason given'}` : `Pulled: ${show.holdReason || 'the team is looking at it'}`}</p>
            <button type="button" className="apl-btn-secondary show-adm-wide" disabled={!can.flags || Boolean(busy)} onClick={restore}>{busy === 'restore' ? 'Restoring…' : 'Restore'}</button>
          </>
        ) : (
          <>
            {!holding ? (
              <button type="button" ref={holdRef} className="apl-btn-secondary show-adm-wide" disabled={!can.flags || Boolean(busy)} onClick={() => { setHolding(true); setTakingDown(false); }}>Hold…</button>
            ) : (
              <div className="show-adm-form" onKeyDown={onEscape(closeHold)}>
                <label className="show-ed-label" htmlFor="show-adm-hold-reason">Reason</label>
                <select id="show-adm-hold-reason" className="show-ed-select" value={hold.reason} autoFocus onChange={(e) => setHold((h) => ({ ...h, reason: e.target.value }))}>
                  <option value="">Pick a reason</option>
                  {reasons.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <label className="show-ed-label" htmlFor="show-adm-hold-note">A line for {owner || 'the owner'} (optional)</label>
                <textarea id="show-adm-hold-note" className="show-ed-textarea is-short" rows={2} maxLength={1000} value={hold.note} onChange={(e) => setHold((h) => ({ ...h, note: e.target.value }))} />
                <label className="show-adm-tick">
                  <input type="checkbox" checked={hold.email} onChange={(e) => setHold((h) => ({ ...h, email: e.target.checked }))} />
                  <span>Email {owner || 'the owner'} too</span>
                </label>
                <div className="show-adm-inline">
                  <button type="button" className="show-danger-btn show-mini" disabled={!hold.reason || Boolean(busy)} onClick={pull}>{busy === 'hold' ? 'Pulling…' : 'Pull it'}</button>
                  <button type="button" className="apl-link" onClick={closeHold}>Cancel</button>
                </div>
              </div>
            )}
            {!takingDown ? (
              <button type="button" ref={downRef} className="apl-btn-secondary show-adm-wide is-danger" disabled={!can.flags || Boolean(busy)} onClick={() => { setTakingDown(true); setHolding(false); }}>Take down…</button>
            ) : (
              <div className="show-adm-form" onKeyDown={onEscape(closeDown)}>
                <label className="show-ed-label" htmlFor="show-adm-down-why">Why ({owner || 'the owner'} reads this)</label>
                <textarea id="show-adm-down-why" className="show-ed-textarea is-short" rows={3} maxLength={1000} value={why} autoFocus onChange={(e) => setWhy(e.target.value)} />
                <div className="show-adm-inline">
                  <button type="button" className="show-danger-btn show-mini" disabled={!why.trim() || Boolean(busy)} onClick={takeDown}>{busy === 'down' ? 'Taking it down…' : 'Take it down'}</button>
                  <button type="button" className="apl-link" onClick={closeDown}>Cancel</button>
                </div>
              </div>
            )}
          </>
        )}
        <NeedLine line={can.flags ? null : needs.flags} />
      </div>

      {can.fullAdmin && show.isPublic && (
        <div className="show-adm-block">
          <p className="show-adm-sub">Savers</p>
          <p className="show-adm-line">{admin.savers && admin.savers.lastToldAt ? `Last told ${dayWords(admin.savers.lastToldAt)}` : 'Not told yet'}</p>
          <button type="button" className="apl-btn-secondary show-adm-wide" disabled={!can.tellSavers || Boolean(busy)} onClick={tellSavers}>{busy === 'tell' ? 'Telling them…' : 'Tell savers'}</button>
          <p className="show-adm-note">People who saved it get one email about its newest episodes. The daily run does this by itself.</p>
        </div>
      )}
      <ErrorLine text={error} />
    </AdmCard>
  );
}
