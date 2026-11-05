import { useState } from 'react';
import { useRouter } from 'next/router';
import { AdmCard, ErrorLine, NeedLine, dayWords, onEscape, useOpener } from './adminBits';

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
    const r = await onAction('remove', { confirmName: typed.trim(), reason: requested ? undefined : reason.trim() });
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

  const canRemove = requested ? Boolean(can.deletions) : Boolean(can.removeUnrequested);
  const off = requested ? (can.deletions ? null : needs.deletions) : can.removeUnrequested ? null : needs.fullAdmin || 'A full admin does this.';
  const matches = same(typed, name);

  const confirmBlock = (
    <div className="show-adm-form">
      {plan && plan.adminWords ? <p className="show-adm-plan">{plan.adminWords}</p> : removal.buyersUnknown ? <p className="show-adm-line tone-warn">We couldn’t check who bought from it just now, so it can’t be removed yet. Reload in a minute.</p> : null}
      <label className="show-ed-label" htmlFor="show-adm-remove-name">Type the show’s name to remove it</label>
      <input id="show-adm-remove-name" className="show-ed-input" type="text" autoComplete="off" value={typed} placeholder={name} disabled={!canRemove} onChange={(e) => setTyped(e.target.value)} />
      <button type="button" className="show-danger-btn show-adm-wide" disabled={!canRemove || !matches || (!requested && !reason.trim()) || Boolean(busy)} onClick={remove}>{busy === 'remove' ? 'Removing…' : 'Remove the show'}</button>
    </div>
  );

  return (
    <AdmCard id="removal" k="Remove this show" className="show-adm-removal">
      {withdrawnAt ? (
        <p className="show-adm-line">Removed{dayWords(withdrawnAt) ? ` on ${dayWords(withdrawnAt)}` : ''} — kept for the people who bought from it. It’s off the site, and nothing more needs deciding here.</p>
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
