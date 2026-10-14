import Link from 'next/link';
import { useState } from 'react';
import { Avatar } from '../crew/CrewBits';
import { HostedChip, fmtRange, hoursLabel } from './LocationBits';
import { dollars, MAX_ENDORSEMENT_CHARS } from '../../lib/locationRules';

// Request cards and the action rows both sides use (Your places, Your
// requests, and the request page itself). `onChange(request)` gets the
// updated request after any action.

export async function requestAction(id, body) {
  const res = await fetch(`/api/locations/requests/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

export function hoursLeft(iso) {
  if (!iso) return null;
  const h = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 3600000));
  return h;
}

export function StatusChip({ r }) {
  const cls = { requested: 'olive', countered: 'olive', accepted: 'ok', paid: 'ok', done: 'ok', declined: 'mute', expired: 'mute', cancelled: 'mute', refunded: 'warn' }[r.status] || '';
  const left = ['requested', 'countered'].includes(r.status) ? hoursLeft(r.respondsBy) : null;
  return <span className={`crew-chip ${cls}`}>{r.statusLabel}{left != null ? ` · ${left} h left` : ''}{r.outcome && r.outcome !== 'as_agreed' ? ` · ${r.outcome.replace('_', ' ')}` : ''}</span>;
}

// The money line for whoever is looking.
export function MoneyLine({ r, side }) {
  if (side === 'host') return <>You receive <b>{dollars(r.hostPayoutCents)}</b> of {dollars(r.bookingCents)} after the {r.cutPercent}% cut{r.cleaningCents ? ` (incl. ${dollars(r.cleaningCents)} cleaning)` : ''}</>;
  return <>{dollars(r.bookingCents)} for the place{r.cleaningCents ? ` incl. ${dollars(r.cleaningCents)} cleaning` : ''}, <b>{dollars(r.totalChargedCents)}</b> with the card fee</>;
}

// Host's answer buttons: accept / counter / decline.
export function HostAnswer({ r, onChange, compact = false }) {
  const [mode, setMode] = useState(null); // 'counter' | 'decline'
  const [counter, setCounter] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (body) => {
    setBusy(true);
    setError(null);
    try { onChange((await requestAction(r.id, body)).request); setMode(null); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  if (!['requested', 'countered'].includes(r.status)) return null;
  return (
    <div className="loc-answer">
      {!mode && (
        <div className="crew-actions">
          {r.status === 'requested' && <button type="button" className="crew-btn sm primary" disabled={busy} onClick={() => run({ action: 'accept' })}>Accept {dollars(r.bookingCents)}</button>}
          {r.status === 'countered' && <span className="crew-mono">You countered {dollars(r.counterCents)} · waiting on {r.producer.displayName.split(' ')[0]}</span>}
          {r.status === 'requested' && <button type="button" className="crew-btn sm" disabled={busy} onClick={() => setMode('counter')}>Counter</button>}
          <button type="button" className="crew-btn sm" style={{ color: 'var(--danger)' }} disabled={busy} onClick={() => setMode('decline')}>Decline</button>
          {!compact && r.threadId && <Link href={`/messages/${r.threadId}`} className="crew-btn sm ghost">Message</Link>}
        </div>
      )}
      {mode === 'counter' && (
        <div className="loc-answer-form">
          <label className="crew-field"><span>Counter with ($ for the whole booking, before cleaning)</span><input type="number" className="crew-input" min="25" step="1" value={counter} onChange={(e) => setCounter(e.target.value)} placeholder={String(Math.round(r.subtotalCents / 100))} /></label>
          <label className="crew-field"><span>A note (optional)</span><input type="text" className="crew-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Happy to do the night exterior; the rate covers my being here late." /></label>
          <div className="crew-actions">
            <button type="button" className="crew-btn sm primary" disabled={busy || !(Number(counter) > 0)} onClick={() => run({ action: 'counter', counter, note })}>Send counter · {counter ? dollars(Math.round(Number(counter) * 100)) : '…'}</button>
            <button type="button" className="crew-btn sm ghost" onClick={() => setMode(null)}>Back</button>
          </div>
        </div>
      )}
      {mode === 'decline' && (
        <div className="loc-answer-form">
          <label className="crew-field"><span>Why (optional, shown to them)</span><input type="text" className="crew-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Those dates are taken / the crew is too big for the street." /></label>
          <div className="crew-actions">
            <button type="button" className="crew-btn sm" style={{ color: 'var(--danger)' }} disabled={busy} onClick={() => run({ action: 'decline', reason: note })}>Decline the request</button>
            <button type="button" className="crew-btn sm ghost" onClick={() => setMode(null)}>Back</button>
          </div>
        </div>
      )}
      {error && <div className="crew-status error" role="alert">{error}</div>}
    </div>
  );
}

// Producer's buttons: take a counter, pay, cancel.
export function ProducerActions({ r, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (body) => {
    setBusy(true);
    setError(null);
    try {
      const data = await requestAction(r.id, body);
      if (data.url) { window.location.href = data.url; return; }
      onChange(data.request);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const cancel = () => {
    const msg = r.status === 'paid' && r.refundPreview
      ? `Cancel this booking? ${r.refundPreview.cents > 0 ? `${dollars(r.refundPreview.cents)} (${r.refundPreview.percent}%) goes back to your card under the host’s cancellation policy.` : 'No refund inside the cancellation window.'}`
      : 'Cancel this request?';
    if (window.confirm(msg)) run({ action: 'cancel' });
  };
  return (
    <div className="loc-answer">
      <div className="crew-actions">
        {r.status === 'countered' && <button type="button" className="crew-btn sm primary" disabled={busy} onClick={() => run({ action: 'accept_counter' })}>Accept {dollars(r.counterCents)}{r.cleaningCents ? ` + ${dollars(r.cleaningCents)} cleaning` : ''}</button>}
        {r.status === 'accepted' && <button type="button" className="crew-btn sm primary" disabled={busy} onClick={() => run({ action: 'pay' })}>{busy ? 'Opening Stripe…' : `Pay ${dollars(r.totalChargedCents)} to confirm`}</button>}
        {['requested', 'countered', 'accepted', 'paid'].includes(r.status) && <button type="button" className="crew-btn sm ghost" disabled={busy} onClick={cancel}>{r.status === 'paid' ? 'Cancel booking' : 'Withdraw'}</button>}
        {r.threadId && <Link href={`/messages/${r.threadId}`} className="crew-btn sm ghost">Message</Link>}
      </div>
      {error && <div className="crew-status error" role="alert">{error}</div>}
    </div>
  );
}

// Host, after the last day: did it go OK?
export function OutcomeForm({ r, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [issue, setIssue] = useState(null);
  const [note, setNote] = useState('');
  if (r.status !== 'paid' || r.outcome || !r.pastEnd) return null;
  const run = async (outcome) => {
    setBusy(true);
    setError(null);
    try { onChange((await requestAction(r.id, { action: 'outcome', outcome, note })).request); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <div className="loc-answer">
      <span className="crew-mono">Did the shoot go as agreed? This is what builds your record and their credit.</span>
      {!issue ? (
        <div className="crew-actions">
          <button type="button" className="crew-btn sm primary" disabled={busy} onClick={() => run('as_agreed')}>Yes, as agreed</button>
          <button type="button" className="crew-btn sm" disabled={busy} onClick={() => setIssue('damage')}>There was damage</button>
          <button type="button" className="crew-btn sm" disabled={busy} onClick={() => setIssue('no_show')}>They didn’t show</button>
        </div>
      ) : (
        <div className="loc-answer-form">
          <label className="crew-field"><span>What happened (an admin reads this)</span><textarea className="crew-input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></label>
          <div className="crew-actions">
            <button type="button" className="crew-btn sm" disabled={busy || note.trim().length < 5} onClick={() => run(issue)}>Report {issue === 'damage' ? 'damage' : 'a no-show'}</button>
            <button type="button" className="crew-btn sm ghost" onClick={() => setIssue(null)}>Back</button>
          </div>
        </div>
      )}
      {error && <div className="crew-status error" role="alert">{error}</div>}
    </div>
  );
}

// One line each way after a shoot that went as agreed.
export function EndorseForm({ r, viewerId, onChange }) {
  const [line, setLine] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (r.outcome !== 'as_agreed' || r.viewerEndorsed) return null;
  const other = viewerId === r.hostId ? r.producer : r.host;
  const run = async () => {
    setBusy(true);
    setError(null);
    try { onChange((await requestAction(r.id, { action: 'endorse', line, wouldAgain: true })).request); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <div className="loc-answer">
      <div className="cl-endorse">
        <input type="text" className="crew-input" value={line} onChange={(e) => setLine(e.target.value)} maxLength={MAX_ENDORSEMENT_CHARS} placeholder={`One line about ${other.displayName.split(' ')[0]} — it shows on their profile`} />
        <button type="button" className="crew-btn sm primary" disabled={busy || !line.trim()} onClick={run}>Post it</button>
      </div>
      {error && <div className="crew-status error" role="alert">{error}</div>}
    </div>
  );
}

// A request card for a list, from one side's point of view.
export function RequestCard({ r, side, onChange, viewerId }) {
  const other = side === 'host' ? r.producer : r.host;
  const hot = ['requested', 'countered'].includes(r.status) && (side === 'host' ? r.status === 'requested' : r.status === 'countered');
  const title = r.projectTitle || r.shooting;
  return (
    <div className={`loc-reqcard${hot ? ' hot' : ''}`}>
      <div className="loc-reqcard-head">
        <div style={{ minWidth: 0 }}>
          <Link href={`/locations/requests/${r.id}`} className="loc-reqcard-t">{title} · {fmtRange(r.startsOn, r.endsOn)}{r.hoursFrom && r.hoursTo ? `, ${hoursLabel(r.hoursFrom, r.hoursTo)}` : ''}</Link>
          <span className="crew-mono">{r.listing ? <Link href={`/locations/${r.listing.id}`}>{r.listing.title}</Link> : 'a place'}{r.crewSize ? ` · crew ${r.crewSize}` : ''}{r.vehicles ? ` · ${r.vehicles} vehicles` : ''}{r.projectTitle && r.shooting ? ` · ${r.shooting}` : ''}</span>
        </div>
        <StatusChip r={r} />
      </div>
      <div className="loc-reqcard-who">
        <Avatar userId={other.userId} name={other.displayName} src={other.avatarUrl} position={other.avatarPosition} zoom={other.avatarZoom} size="sm" />
        <Link href={other.profilePath}>{other.displayName}</Link>{side === 'producer' && <HostedChip host={other} />}
        <span className="crew-mono">· <MoneyLine r={r} side={side} /></span>
      </div>
      {r.message && hot && <p className="loc-reqcard-msg">{r.pricing === 'offer' && r.status === 'requested' ? <>Offer: <b style={{ color: 'var(--olive)' }}>{dollars(r.subtotalCents)}</b> for the dates. </> : null}{r.message}</p>}
      {r.status === 'countered' && side === 'producer' && <p className="loc-reqcard-msg">{other.displayName.split(' ')[0]} countered with <b style={{ color: 'var(--olive)' }}>{dollars(r.counterCents)}</b>{r.counterNote ? ` — “${r.counterNote}”` : ''}</p>}
      {side === 'host' ? <HostAnswer r={r} onChange={onChange} /> : <ProducerActions r={r} onChange={onChange} />}
      {side === 'host' && <OutcomeForm r={r} onChange={onChange} />}
      <EndorseForm r={r} viewerId={viewerId} onChange={onChange} />
      {['paid', 'done'].includes(r.status) && (
        <div className="crew-actions"><Link href={`/locations/requests/${r.id}`} className="crew-btn sm">Open the booking</Link>{r.threadId && <Link href={`/messages/${r.threadId}`} className="crew-btn sm ghost">Message</Link>}</div>
      )}
    </div>
  );
}
