import { useState } from 'react';
import Link from 'next/link';
import { AdmCard, ErrorLine } from './adminBits';

// Who runs it (full admins only; the slice 3a contract §5.3): the owner,
// Give them Creator Studio when they can't open the show page, hand the
// show to another account, or clear the owner. Who gets paid is slice 3b:
// nothing here moves earnings, and the note says so.
export default function OwnerCard({ admin, onAction, onDone, say }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  if (!admin.can || !admin.can.owner) return null;
  const owner = admin.owner;
  const showName = (admin.show && admin.show.name) || 'this show';

  async function handOver(next) {
    const clearing = next === null;
    if (clearing && !window.confirm(`Nobody will run ${showName} until you pick someone. Clear it?`)) return;
    setBusy(clearing ? 'clear' : 'hand');
    setError(null);
    const r = await onAction('owner', { email: clearing ? null : next.trim() });
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      onDone();
      return;
    }
    setEmail('');
    const who = r.data.owner ? r.data.owner.name || r.data.owner.email || 'They' : null;
    say({
      tone: 'ok',
      title: who ? `${who} runs ${showName} now.` : `Nobody runs ${showName} now.`,
      lines: [owner ? (who ? 'Both of you were told.' : `${owner.name || 'The previous owner'} was told.`) : who ? 'They were told.' : null].filter(Boolean)
    }, 7000);
    onDone();
  }

  async function grant() {
    setBusy('grant');
    setError(null);
    const r = await onAction('grant_creator', {});
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      onDone();
      return;
    }
    say({ tone: 'ok', title: `${(owner && owner.name) || 'They'} can open Creator Studio now.` }, 6000);
    onDone();
  }

  const trimmed = email.trim();
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
  return (
    <AdmCard id="show-adm-owner" k="Who runs it">
      {owner ? (
        <div className="show-adm-owner">
          <p className="show-adm-owner-name"><strong>{owner.name || 'An account with no name yet'}</strong>{owner.email ? <span>{owner.email}</span> : null}</p>
          {owner.accountHref && <Link href={owner.accountHref} className="apl-link">Open their account →</Link>}
          {!owner.hasCreatorRole && (
            <div className="show-adm-owner-role">
              <p>They don’t have Creator Studio, so they can’t open the show page.</p>
              <button type="button" className="apl-btn-secondary show-mini" disabled={Boolean(busy)} onClick={grant}>{busy === 'grant' ? 'Giving it…' : 'Give them Creator Studio'}</button>
            </div>
          )}
        </div>
      ) : (
        <p className="show-adm-line tone-warn">No one runs it yet.</p>
      )}
      <form className="show-adm-owner-form" onSubmit={(e) => { e.preventDefault(); if (valid && !busy) handOver(trimmed); }}>
        <label className="show-ed-label" htmlFor="show-adm-owner-email">Hand it to (their email)</label>
        <div className="show-adm-inline">
          <input id="show-adm-owner-email" className="show-ed-input" type="email" inputMode="email" autoComplete="off" value={email} maxLength={200} placeholder="creator@example.com" onChange={(e) => setEmail(e.target.value)} />
          <button type="submit" className="apl-btn-secondary show-mini" disabled={!valid || Boolean(busy)}>{busy === 'hand' ? 'Handing it over…' : 'Hand it over'}</button>
        </div>
      </form>
      {owner && <button type="button" className="apl-link show-adm-quiet-link" disabled={Boolean(busy)} onClick={() => handOver(null)}>{busy === 'clear' ? 'Clearing…' : 'Clear the owner'}</button>}
      <p className="show-adm-note">They get its page in Creator Studio. Episodes keep the person who uploaded them, and nothing about earnings changes: whole-series sales keep paying whoever they paid before.</p>
      <ErrorLine text={error} />
    </AdmCard>
  );
}
