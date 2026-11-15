import { useState } from 'react';
import { useRouter } from 'next/router';
import { AdmCard, ErrorLine, NeedLine, dayWords, onEscape, useOpener } from './adminBits';
import { REMOVAL_WORDS } from '../../../lib/removalRules';

function same(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase() && String(a || '').trim() !== '';
}

// Remove this show (the admin show page, slice 3a §5.3, #removal): the
// owner's request with what goes and what is kept for its buyers
// (lib/showDelete.js deleteShowCascade), the show's name typed back to
// remove it, or Keep it (deny the request). Without a request a full admin
// may remove it with a reason the owner reads. Afterwards the Shows list
// says what went.
export default function RemovalCard({ admin, onAction, onDone, say }) {
  const router = useRouter();
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const [denyOpen, setDenyOpen] = useState(false);
  // "Delete now…" (a full admin, migration 124): deleted for good at once.
  const [now, setNow] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const show = admin.show || {};
  const removal = admin.removal || {};
  const can = admin.can || {};
  const needs = admin.needs || {};
  const owner = admin.ownerName || null;
  const name = show.name || '';
  const requested = Boolean(removal.requested);
  const plan = removal.plan || null;
  // Removed already, kept for the people who bought from it: nothing more
  // to decide here.
  const withdrawnAt = removal.withdrawnAt || show.withdrawnAt || null;
  const [denyRef, focusDeny] = useOpener();
  const [openRef, focusOpen] = useOpener();
  const closeDeny = () => { setDenyOpen(false); focusDeny(); };
  const closeOpen = () => { setOpen(false); setTyped(''); setReason(''); focusOpen(); };

  async function remove() {
    setBusy('remove');
    setError(null);
    const r = await onAction('remove', now
      ? { confirmName: typed.trim(), reason: reason.trim(), now: true }
      : { confirmName: typed.trim(), reason: requested ? undefined : reason.trim() });
    if (!r.ok) {
      setBusy(null);
      setError(r.error);
      // The request may have changed underneath (taken back, or removed by
      // someone else): the card redraws from the server's state.
      onDone();
      return;
    }
    const words = r.data.plan && r.data.plan.words ? r.data.plan.words : plan && plan.words ? plan.words : '';
    try {
      window.sessionStorage.setItem('showAdmRemoved', JSON.stringify({ name, words }));
    } catch {
      // A private window: the list says the name only.
    }
    router.replace(`/admin/shows?removed=${encodeURIComponent(name || 'The show')}`);
  }

  async function deny() {
    setBusy('deny');
    setError(null);
    const r = await onAction('deny_removal', { note: note.trim() || undefined });
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      onDone();
      return;
    }
    setDenyOpen(false);
    setNote('');
    say({ tone: 'ok', title: `${name || 'The show'} stays up`, lines: [`${owner || 'Its owner'} was told.`] }, 6000);
    onDone();
  }

  const canRemove = now ? Boolean(can.fullAdmin) : requested ? Boolean(can.deletions) : Boolean(can.removeUnrequested);
  const off = requested ? (can.deletions ? null : needs.deletions) : can.removeUnrequested ? null : needs.fullAdmin || 'A full admin does this.';
  const matches = same(typed, name);
  // What confirming does (migration 124): "Remove · keep 30 days", "…kept
  // for buyers", "…kept for later"; before 124, deleted at once.
  const removeLabel = now ? 'Delete it for good' : removal.holdReady && removal.confirmLabel ? removal.confirmLabel : 'Remove the show';
  const removed = removal.removed || null;

  const confirmBlock = (
    <div className="show-adm-form">
      {plan && plan.adminWords ? <p className="show-adm-plan">{plan.adminWords}</p> : removal.buyersUnknown ? <p className="show-adm-line tone-warn">We couldn’t check who bought from it just now, so it can’t be removed yet. Reload in a minute.</p> : null}
      {removal.holdReady && !now ? <p className="show-adm-line">{removal.keepAfterRemoval ? 'Its owner asked us to keep the files: it comes off the site and nothing is deleted until they ask for it back.' : 'It comes off the site at once; what nobody bought is kept 30 days in case its owner asks for it back, then deleted for good.'}</p> : null}
      {now ? (
        <>
          <p className="show-adm-line tone-warn">{REMOVAL_WORDS.deleteNowHelp}</p>
          {requested || withdrawnAt ? (
            <>
              <label className="show-ed-label" htmlFor="show-adm-now-why">{REMOVAL_WORDS.deleteNowReason}</label>
              <textarea id="show-adm-now-why" className="show-ed-textarea is-short" rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
            </>
          ) : null}
        </>
      ) : null}
      <label className="show-ed-label" htmlFor="show-adm-remove-name">Type the show’s name to remove it</label>
      <input id="show-adm-remove-name" className="show-ed-input" type="text" autoComplete="off" value={typed} placeholder={name} disabled={!canRemove} onChange={(e) => setTyped(e.target.value)} />
      <button type="button" className="show-danger-btn show-adm-wide" disabled={!canRemove || !matches || ((now || !requested) && !reason.trim()) || Boolean(busy)} onClick={remove}>{busy === 'remove' ? 'Removing…' : removeLabel}</button>
      {removal.canDeleteNow && !withdrawnAt ? (
        <label className="removal-keep">
          <input type="checkbox" checked={now} onChange={(e) => setNow(e.target.checked)} />
          <span>Delete now instead (a full admin; for abuse or a legal reason)</span>
        </label>
      ) : null}
    </div>
  );

  return (
    <AdmCard id="removal" k="Remove this show" className="show-adm-removal">
      {withdrawnAt ? (
        <>
          <p className="show-adm-line">
            {removed && removed.key !== 'buyers'
              ? `${removed.label}${dayWords(withdrawnAt) ? ` (removed ${dayWords(withdrawnAt)})` : ''}. ${removal.restoreRequestedAt ? 'Its owner asked to bring it back: decide it in Review → Bring back.' : 'It comes back only if its owner asks and someone on the team approves it.'}`
              : `Removed${dayWords(withdrawnAt) ? ` on ${dayWords(withdrawnAt)}` : ''} — kept for the people who bought from it. It’s off the site, and nothing more needs deciding here.`}
          </p>
          {removed && removed.key !== 'buyers' && can.fullAdmin ? (
            !now ? (
              <button type="button" className="show-remove-open" onClick={() => { setNow(true); setTyped(''); setReason(''); }}>{REMOVAL_WORDS.deleteNow}</button>
            ) : (
              <div onKeyDown={onEscape(() => setNow(false))}>
                {confirmBlock}
                <button type="button" className="apl-link" onClick={() => { setNow(false); setTyped(''); setReason(''); }}>Cancel</button>
              </div>
            )
          ) : null}
        </>
      ) : requested ? (
        <>
          <p className="show-adm-line">
            {owner || 'Its owner'} asked to remove it{removal.at ? ` on ${dayWords(removal.at)}` : ''}{removal.reason ? <>: “{removal.reason}”</> : ''}.
          </p>
          {confirmBlock}
          {!denyOpen ? (
            <button type="button" ref={denyRef} className="apl-btn-secondary show-adm-wide" disabled={!can.deletions || Boolean(busy)} onClick={() => setDenyOpen(true)}>Keep it — deny the request</button>
          ) : (
            <div className="show-adm-form" onKeyDown={onEscape(closeDeny)}>
              <label className="show-ed-label" htmlFor="show-adm-deny-note">A note for {owner || 'them'} (optional)</label>
              <textarea id="show-adm-deny-note" className="show-ed-textarea is-short" rows={2} maxLength={500} value={note} autoFocus onChange={(e) => setNote(e.target.value)} />
              <div className="show-adm-inline">
                <button type="button" className="apl-btn show-mini" disabled={Boolean(busy)} onClick={deny}>{busy === 'deny' ? 'Keeping it…' : 'Keep it'}</button>
                <button type="button" className="apl-link" onClick={closeDeny}>Cancel</button>
              </div>
            </div>
          )}
          <NeedLine line={off} />
        </>
      ) : !can.removeUnrequested ? (
        <>
          <p className="show-adm-line">No removal is requested.</p>
          <NeedLine line={off} />
        </>
      ) : !open ? (
        <button type="button" ref={openRef} className="show-remove-open" onClick={() => setOpen(true)}>Remove this show…</button>
      ) : (
        <div onKeyDown={onEscape(closeOpen)}>
          <p className="show-adm-line">No one asked for this: {owner || 'its owner'} reads your reason.</p>
          <label className="show-ed-label" htmlFor="show-adm-remove-why">Why ({owner || 'the owner'} reads this)</label>
          <textarea id="show-adm-remove-why" className="show-ed-textarea is-short" rows={3} maxLength={1000} value={reason} autoFocus onChange={(e) => setReason(e.target.value)} />
          {confirmBlock}
          <button type="button" className="apl-link" onClick={closeOpen}>Cancel</button>
        </div>
      )}
      <ErrorLine text={error} />
    </AdmCard>
  );
}
