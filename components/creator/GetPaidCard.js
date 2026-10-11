import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { SITE } from '../../lib/siteConfig';

// The creator's payout setup, on /creator/pitch/dashboard. One card, four
// states (lib/creatorPayouts.js payoutState): none → incomplete → review
// → ready. Everything money-related happens on Stripe's hosted pages;
// this card only sends people there and reports back.
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

export default function GetPaidCard() {
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
        body: JSON.stringify({ action })
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

  return (
    <div className={`account-card getpaid getpaid-${state}`} style={{ maxWidth: 'none', marginBottom: '1rem' }}>
      <div className="getpaid-row">
        <div>
          <div className="account-eyebrow">Get paid</div>
          {state === 'loading' && <h3>Checking your payout setup…</h3>}
          {state === 'off' && (
            <>
              <h3>Payments aren’t switched on for this site yet</h3>
              <p>Once they are, this is where you’ll connect a bank account to take donations.</p>
            </>
          )}
          {state === 'none' && (
            <>
              <h3>Connect a bank account to take donations</h3>
              <p>
                Backers pay through Stripe. Each donation goes to your own Stripe account, minus {SITE.name}’s cut, and pays out to your bank on Stripe’s schedule.
                Takes about five minutes — have your ID and bank details ready.
              </p>
            </>
          )}
          {state === 'incomplete' && (
            <>
              <h3>You started setting up payouts</h3>
              <p>Stripe still needs {needs || 'a few details'} before your projects can take donations.</p>
            </>
          )}
          {state === 'review' && (
            <>
              <h3>{needs ? 'Stripe needs a little more from you' : 'Stripe is checking your details'}</h3>
              <p>
                {needs
                  ? `Still needed: ${needs}. Donations switch on as soon as that’s in and verified.`
                  : 'This usually takes a day or two. Donations switch on for your approved projects as soon as it clears.'}
              </p>
            </>
          )}
          {state === 'ready' && (
            <>
              <h3><span className="getpaid-dot" /> Payments on</h3>
              <p>
                Donations to your approved projects land in your Stripe account
                {data.account.payoutsEnabled ? ' and pay out to your bank automatically.' : '. Bank payouts start once Stripe finishes verifying your bank account.'}
              </p>
            </>
          )}
          {error && <p style={{ color: 'var(--danger)', marginTop: '0.4rem' }}>{error}</p>}
        </div>
        <div className="getpaid-actions">
          {state === 'none' && (
            <button type="button" className="account-btn-primary" style={{ width: 'auto' }} disabled={busy} onClick={() => go('onboard')}>
              {busy ? 'Opening Stripe…' : 'Set up payouts with Stripe →'}
            </button>
          )}
          {(state === 'incomplete' || (state === 'review' && needs)) && (
            <button type="button" className="account-btn-primary" style={{ width: 'auto' }} disabled={busy} onClick={() => go('onboard')}>
              {busy ? 'Opening Stripe…' : state === 'incomplete' ? 'Finish setting up →' : 'Add what’s missing →'}
            </button>
          )}
          {state === 'review' && !needs && (
            <button type="button" className="account-btn-secondary" style={{ width: 'auto' }} disabled={busy} onClick={() => go('onboard')}>
              Review my details →
            </button>
          )}
          {state === 'ready' && (
            <button type="button" className="account-btn-secondary" style={{ width: 'auto' }} disabled={busy} onClick={() => go('dashboard')}>
              {busy ? 'Opening Stripe…' : 'Open Stripe dashboard →'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
