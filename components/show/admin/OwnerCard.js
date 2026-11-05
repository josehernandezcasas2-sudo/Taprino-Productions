import { useId, useState } from 'react';
import Link from 'next/link';
import { utcDayLabel } from '../../../lib/showRules';
import { AdmCard, ErrorLine } from './adminBits';
import { ClockIcon } from '../../PlayerIcons';

// Who runs it (full admins only; the slice 3a contract §5.3): the owner,
// Give them Creator Studio when they can't open the show page, hand the
// show to another account, or clear the owner.
//
// Slice 3b (mockups/series-slice3b-contract.md §6.6): the show's paid
// account under the owner ("Paid to …", from the room's `view.payee`, the
// show's Who gets paid block) with a link down to the Who gets paid card,
// and a hand-over that asks who gets the show's earnings after it — keep
// them where they are (the default), or the new owner from now on (only
// once the rule is live). POST /api/admin/show/[id] { action: 'owner',
// email, earnings: 'keep' | 'move' }.
export default function OwnerCard({ admin, view, onAction, onDone, say }) {
  const uid = useId();
  const [email, setEmail] = useState('');
  const [earnings, setEarnings] = useState('keep');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  if (!admin.can || !admin.can.owner) return null;
  const owner = admin.owner;
  const showName = (admin.show && admin.show.name) || 'this show';
  const payee = view && view.payee ? view.payee : null;
  const paid = payee && payee.available !== false && payee.paidTo ? payee.paidTo : null;
  const paidName = paid ? paid.name || 'its paid account' : null;
  const moveOpen = Boolean(payee && payee.ruleLive);
  // A show nobody runs pays each episode's uploader: keep leaves them so.
  const eachUploader = !paid && !owner;

  async function handOver(next) {
    const clearing = next === null;
    if (clearing && !window.confirm(`Nobody will run ${showName} until you pick someone.${paidName ? ` Its earnings stay with ${paidName}.` : ''} Clear it?`)) return;
    setBusy(clearing ? 'clear' : 'hand');
    setError(null);
    const r = await onAction('owner', { email: clearing ? null : next.trim(), earnings: clearing ? 'keep' : earnings });
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      onDone();
      return;
    }
    setEmail('');
    setEarnings('keep');
    const who = r.data.owner ? r.data.owner.name || r.data.owner.email || 'They' : null;
    const paidAfter = r.data.paidTo && r.data.paidTo.name ? r.data.paidTo.name : null;
    const moneyLine = r.data.keptEach ? 'Each episode keeps paying whoever uploaded it.'
      : !paid && !paidAfter ? null
        : r.data.earnings === 'move' ? `Its earnings go to ${paidAfter || who || 'the new owner'} from now on.`
          : `Its earnings stay with ${paidAfter || paidName || 'the account they went to'}.`;
    say({
      tone: 'ok',
      title: who ? `${who} runs ${showName} now.` : `Nobody runs ${showName} now.`,
      lines: [owner ? (who ? 'Both of you were told.' : `${owner.name || 'The previous owner'} was told.`) : who ? 'They were told.' : null, moneyLine].filter(Boolean)
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

  // "Who gets paid ↓": the card further down this page.
  function toPayeeCard(e) {
    const el = typeof document !== 'undefined' ? document.getElementById('show-payee') : null;
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const btn = el.querySelector('button:not([disabled]), a[href]');
    if (btn) btn.focus({ preventScroll: true });
  }

  const trimmed = email.trim();
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
  // The earnings question, once a new owner is typed (and 118's payee
  // tables are in: before them the hand-over works as it did in 3a) —
  // whether the show pays one account or, nobody running it, each
  // episode's uploader.
  const ask = valid && Boolean(payee && payee.available !== false && (paid || eachUploader));
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
      {paid && (
        <div className="show-adm-paid">
          <p className="show-adm-paid-line">
            <span className="show-payee-k">Paid to</span> <strong>{paidName}</strong>
            {paid.sinceLabel ? <span className="show-adm-paid-since"> · since {paid.sinceLabel}</span> : null}
          </p>
          {payee.line && payee.line.pending ? <p className="show-payee-waiting"><ClockIcon size={12} /> <span>{payee.line.pending}</span></p> : null}
          <a href="#show-payee" className="apl-link" onClick={toPayeeCard}>Who gets paid ↓</a>
        </div>
      )}
      <form className="show-adm-owner-form" onSubmit={(e) => { e.preventDefault(); if (valid && !busy) handOver(trimmed); }}>
        <label className="show-ed-label" htmlFor="show-adm-owner-email">Hand it to (their email)</label>
        <div className="show-adm-inline">
          <input id="show-adm-owner-email" className="show-ed-input" type="email" inputMode="email" autoComplete="off" value={email} maxLength={200} placeholder="creator@example.com" onChange={(e) => setEmail(e.target.value)} />
          <button type="submit" className="apl-btn-secondary show-mini" disabled={!valid || Boolean(busy)}>{busy === 'hand' ? 'Handing it over…' : 'Hand it over'}</button>
        </div>
        {ask && (
          <fieldset className="show-payee-choices show-adm-earnings" role="radiogroup">
            <legend className="show-ed-label">Who gets the show’s earnings after the hand-over?</legend>
            <label className={`show-sheet-show show-payee-choice ${earnings === 'keep' ? 'on' : ''}`}>
              <input type="radio" name={`${uid}-earnings`} value="keep" checked={earnings === 'keep'} disabled={Boolean(busy)} onChange={() => setEarnings('keep')} />
              <i aria-hidden="true" />
              {eachUploader ? (
                <span>
                  <strong>Keep them where they are</strong>
                  <small>Each episode keeps paying whoever uploaded it. Episodes the new owner adds pay the new owner.</small>
                </span>
              ) : (
                <span>
                  <strong>Keep them with {paidName}</strong>
                  <small>Every episode without its own paid account keeps paying {paidName}, including new ones the new owner adds, until the new owner picks someone else.</small>
                </span>
              )}
            </label>
            <label className={`show-sheet-show show-payee-choice ${earnings === 'move' ? 'on' : ''} ${moveOpen ? '' : 'is-off'}`}>
              <input type="radio" name={`${uid}-earnings`} value="move" checked={earnings === 'move'} disabled={Boolean(busy) || !moveOpen} onChange={() => setEarnings('move')} />
              <i aria-hidden="true" />
              <span>
                <strong>{trimmed} gets them from now on</strong>
                <small>{moveOpen ? `From the hand-over on. What the show earned before stays where it went. ${eachUploader ? 'Everyone whose episodes pay someone else from then on is told.' : `${paidName} is told.`}` : `Opens on ${utcDayLabel(payee.ruleFrom)}.`}</small>
              </span>
            </label>
            <p className="show-adm-note">Episodes with their own paid account keep it either way. Invites waiting on this show are withdrawn.</p>
          </fieldset>
        )}
      </form>
      {owner && <button type="button" className="apl-link show-adm-quiet-link" disabled={Boolean(busy)} onClick={() => handOver(null)}>{busy === 'clear' ? 'Clearing…' : 'Clear the owner'}</button>}
      <p className="show-adm-note">They get its page in Creator Studio. Who uploaded each episode stays the same.</p>
      <ErrorLine text={error} />
    </AdmCard>
  );
}
