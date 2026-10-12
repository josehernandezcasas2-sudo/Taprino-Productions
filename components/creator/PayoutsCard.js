import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { SITE } from '../../lib/siteConfig';

// The creator's payout setup and money, on /account (between Preferences
// and Security) and at the top of /creator/pitch/dashboard. Four setup
// states (lib/creatorPayouts.js payoutState): none → incomplete → review
// → ready; once ready it shows Stripe's numbers for the connected
// account (/api/creator/payouts `summary`). Everything that changes
// money — bank details, tax forms, full history — stays on Stripe's
// hosted pages; this card only sends people there and reports back.
// `returnTo` is where Stripe brings them back to afterwards.
const REQUIREMENT_LABELS = {
  external_account: 'a bank account',
  'tos_acceptance.date': 'Stripe’s terms',
  'tos_acceptance.ip': 'Stripe’s terms',
  'individual.verification.document': 'a photo ID',
  'individual.verification.additional_document': 'proof of address',
  'individual.id_number': 'your SSN or tax ID',
  'individual.dob.day': 'your date of birth',
  'individual.dob.month': 'your date of birth',
  'individual.dob.year': 'your date of birth',
  'individual.address.line1': 'your address',
  'individual.address.city': 'your address',
  'individual.address.postal_code': 'your address',
  'individual.address.state': 'your address',
  'individual.phone': 'a phone number',
  'individual.email': 'an email address',
  'individual.first_name': 'your name',
  'individual.last_name': 'your name',
  'business_profile.url': 'a website or profile link',
  'business_profile.mcc': 'a business category',
  'company.tax_id': 'your company’s tax ID',
  'company.verification.document': 'company documents'
};

function describeRequirements(keys) {
  const labels = [...new Set((keys || []).map((k) => REQUIREMENT_LABELS[k] || k.replace(/[._]/g, ' ')))];
  if (labels.length === 0) return null;
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

export function formatMoney(cents, currency) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: (currency || 'usd').toUpperCase() }).format((cents || 0) / 100);
}

// "Oct 14" from a YYYY-MM-DD, without the timezone shifting the day.
export function formatPayoutDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

const PAYOUT_STATUS = {
  paid: ['Paid', 'paid'],
  in_transit: ['In transit', 'transit'],
  failed: ['Failed', 'failed'],
  canceled: ['Cancelled', 'failed']
};

const SCHEDULE_WORDS = { daily: 'paying out daily', weekly: 'paying out weekly', monthly: 'paying out monthly', manual: 'manual payouts' };

export default function PayoutsCard({ returnTo = '/creator/pitch/dashboard' }) {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const returned = router.query.payouts === 'return' || router.query.payouts === 'refresh';

  useEffect(() => {
    if (!router.isReady) return;
    let cancelled = false;
    fetch(`/api/creator/payouts${returned ? '?sync=1' : ''}`)
      .then((r) => r.json())
      .then((d) => { if (cancelled) return; if (d.error) setError(d.error); else setData(d); })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [router.isReady, returned]);

  async function go(action) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/creator/payouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, returnTo })
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not open Stripe.');
      window.location.href = d.url;
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const state = data ? (data.configured ? data.state : 'off') : 'loading';
  const needs = data && data.account ? describeRequirements(data.account.requirementsDue) : null;
  const summary = data && data.summary;

  const status = {
    loading: ['off', 'Checking…'],
    off: ['off', 'Not available yet'],
    none: ['off', 'Not set up'],
    incomplete: ['wait', 'Needs details'],
    review: ['wait', needs ? 'Needs details' : 'Being verified'],
    ready: ['on', summary ? `Payments on · ${SCHEDULE_WORDS[summary.schedule.interval] || 'paying out'}` : 'Payments on']
  }[state];

  const primary = (label) => (
    <button type="button" className="account-btn-primary" style={{ width: 'auto', marginBottom: 0 }} disabled={busy} onClick={() => go('onboard')}>
      {busy ? 'Opening Stripe…' : label}
    </button>
  );

  return (
    <div className={`account-card payouts payouts-${state}`} style={{ maxWidth: 'none' }}>
      <div className="account-card-head">
        <div className="account-subheading" style={{ marginBottom: 0 }}>Payouts</div>
        <span className={`payouts-status ${status[0]}`}>{status[1]}</span>
      </div>

      {state === 'off' && (
        <p className="payouts-copy">Once payments are switched on for this site, this is where you’ll connect a bank account to take backing.</p>
      )}
      {state === 'none' && (
        <>
          <p className="payouts-copy">
            Connect a bank account so your projects can take backing. Money goes to your own Stripe account, minus {SITE.name}’s cut, and pays out to your bank.
            {' '}<strong>About five minutes</strong>: have your ID and bank details ready.
          </p>
          {primary('Set up payouts with Stripe →')}
        </>
      )}
      {state === 'incomplete' && (
        <>
          <p className="payouts-copy">Stripe still needs <strong>{needs || 'a few details'}</strong> before your projects can take backing.</p>
          {primary('Finish setting up →')}
        </>
      )}
      {state === 'review' && (
        <>
          <p className="payouts-copy">
            {needs
              ? <>Stripe needs a little more from you: <strong>{needs}</strong>. Backing opens on your approved projects as soon as that’s in and verified.</>
              : 'Stripe is checking your details. This usually takes a day or two. Backing opens on your approved projects as soon as it clears.'}
          </p>
          {needs ? primary('Add what’s missing →') : (
            <button type="button" className="account-btn-secondary" style={{ width: 'auto', marginBottom: 0 }} disabled={busy} onClick={() => go('onboard')}>
              Review my details →
            </button>
          )}
        </>
      )}

      {state === 'ready' && summary && (
        <>
          <div className="payouts-money">
            <div className="payouts-tile">
              <div className="payouts-tile-label">On the way</div>
              <div className="payouts-tile-amount">{formatMoney(summary.pendingCents, summary.currency)}</div>
              <div className="payouts-tile-detail">
                {summary.pendingCents > 0
                  ? `Recent backings still clearing${summary.schedule.delayDays ? `, usually about ${summary.schedule.delayDays} business days each` : ''}.`
                  : 'Nothing clearing right now.'}
              </div>
            </div>
            <div className="payouts-tile">
              <div className="payouts-tile-label">Available</div>
              <div className="payouts-tile-amount">{formatMoney(summary.availableCents, summary.currency)}</div>
              <div className="payouts-tile-detail">{summary.availableCents > 0 ? 'Cleared and waiting for the next payout.' : 'Cleared money shows here before it pays out.'}</div>
            </div>
            <div className="payouts-tile next">
              <div className="payouts-tile-label">Next payout{summary.nextPayout && summary.nextPayout.estimate ? ' · estimate' : ''}</div>
              <div className="payouts-tile-amount">{summary.nextPayout ? formatMoney(summary.nextPayout.amountCents, summary.currency) : '—'}</div>
              <div className="payouts-tile-detail">
                {!summary.payoutsEnabled
                  ? 'Bank payouts start once Stripe finishes verifying your bank account.'
                  : summary.nextPayout
                    ? <>Lands around <strong>{formatPayoutDate(summary.nextPayout.arrivalDate)}</strong>{summary.bank ? ` in ${summary.bank.name} ••${summary.bank.last4}` : ''}.</>
                    : summary.schedule.interval === 'manual'
                      ? 'You request payouts yourself in Stripe.'
                      : 'Nothing to pay out yet.'}
              </div>
            </div>
          </div>

          {summary.recentPayouts.length > 0 && (
            <>
              <div className="payouts-list-head">Recent payouts</div>
              {summary.recentPayouts.map((p) => {
                const [label, cls] = PAYOUT_STATUS[p.status] || [p.status, 'transit'];
                return (
                  <div className="payouts-row" key={p.id}>
                    <div className="payouts-row-date">
                      {formatPayoutDate(p.arrivalDate)}
                      <small>{p.status === 'failed' && p.failureMessage ? p.failureMessage : summary.bank ? `${summary.bank.name} ••${summary.bank.last4}` : ''}</small>
                    </div>
                    <div className="payouts-row-amt">{formatMoney(p.amountCents, summary.currency)}</div>
                    <span className={`payouts-pill ${cls}`}>{label}</span>
                  </div>
                );
              })}
              {summary.recentPayouts.some((p) => p.status === 'failed') && (
                <p className="payouts-copy" style={{ marginTop: '0.6rem', color: 'var(--danger)' }}>A payout didn’t reach your bank. Check your bank details in Stripe.</p>
              )}
            </>
          )}
        </>
      )}
      {state === 'ready' && !summary && (
        <p className="payouts-copy">
          {data.summaryError || 'Backing to your approved projects lands in your Stripe account and pays out to your bank on Stripe’s schedule.'}
        </p>
      )}

      {error && <p className="payouts-copy" style={{ color: 'var(--danger)', marginTop: '0.6rem' }}>{error}</p>}

      {state === 'ready' && (
        <div className="payouts-foot">
          <div className="payouts-fineprint">
            Estimates from Stripe. A backing usually clears in a couple of business days, then pays out on your schedule. Bank details, tax forms and full history are in Stripe.
          </div>
          <div className="payouts-actions">
            {returnTo !== '/creator/pitch/dashboard' && <Link href="/creator/pitch/dashboard" className="payouts-link">Your earnings →</Link>}
            <button type="button" className="account-btn-secondary" style={{ width: 'auto', marginBottom: 0 }} disabled={busy} onClick={() => go('dashboard')}>
              {busy ? 'Opening Stripe…' : 'Open Stripe dashboard →'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
