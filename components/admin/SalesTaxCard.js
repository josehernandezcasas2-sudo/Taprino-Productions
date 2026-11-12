import { useEffect, useState } from 'react';
import {
  BOOKING_TAX_CODE_CANDIDATES, MEMBERSHIP_TAX_CODE, MIGRATION_122_LINE, STRIPE_TAX_CODES_URL, TAX_SWITCHES, registrationsLine, stripeTaxLine
} from '../../lib/salesTaxRules';

// Admin → Settings → Sales tax (migration 122; lib/salesTax.js): the three
// switches (memberships, Pitch Room backing, location bookings), the
// booking's tax code, and for memberships what Stripe has on the products
// and prices now, with the one button that puts them on tax-on-top. Its
// own Save: the four fields go to /api/admin/site-settings alone, so the
// card above keeps saving on a database without 122.
const money = (cents) => `$${(Math.round(Number(cents) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pick = (s) => ({ taxMemberships: Boolean(s.taxMemberships), taxBackings: Boolean(s.taxBackings), taxBookings: Boolean(s.taxBookings), taxBookingCode: s.taxBookingCode || '' });
// The lane each switch's skipped-checkout count is kept under.
const LANE_OF = { taxMemberships: 'membership', taxBackings: 'backing', taxBookings: 'booking' };
const rowStyle = { borderTop: '1px solid rgba(251,232,211,0.1)', padding: '0.9rem 0' };
const dim = { fontSize: '0.78rem', color: 'var(--ink-dim)', margin: '0.3rem 0 0' };
const faint = { fontSize: '0.74rem', color: 'var(--ink-faint)', margin: '0.3rem 0 0' };

export default function SalesTaxCard({ settings, onSaved }) {
  const ready = Boolean(settings.taxReady);
  const [form, setForm] = useState(() => pick(settings));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [fixing, setFixing] = useState(false);
  const [fixNote, setFixNote] = useState(null);
  const [fixError, setFixError] = useState(null);

  // A fresh read of the saved settings (after any save on the page) resets
  // the form; the parent hands over the saved copy, not edits in progress.
  useEffect(() => { setForm(pick(settings)); }, [settings.taxMemberships, settings.taxBackings, settings.taxBookings, settings.taxBookingCode]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadStatus() {
    setStatusError(null);
    try {
      const res = await fetch('/api/admin/sales-tax');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Couldn’t read the sales tax status.');
      setStatus(data);
    } catch (err) {
      setStatusError(err.message);
    }
  }
  useEffect(() => { loadStatus(); }, []);

  const confirmed = pick(settings);
  const dirty = Object.keys(form).some((k) => form[k] !== confirmed[k]);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const body = {};
      for (const k of Object.keys(form)) if (form[k] !== confirmed[k]) body[k] = k === 'taxBookingCode' ? form[k].trim() : form[k];
      const res = await fetch('/api/admin/site-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save.');
      await onSaved();
      await loadStatus();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function fixProducts() {
    if (!window.confirm(`Set ${MEMBERSHIP_TAX_CODE} on every membership product and tax-on-top on every price without a tax behaviour? Stripe lets a price’s tax behaviour be set only once.`)) return;
    setFixing(true);
    setFixNote(null);
    setFixError(null);
    try {
      const res = await fetch('/api/admin/sales-tax', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set_membership_products' }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Stripe refused.');
      setFixNote(data.changed ? `Done: ${data.changed} change${data.changed === 1 ? '' : 's'} in Stripe.` : 'Nothing needed changing.');
      await loadStatus();
    } catch (err) {
      setFixError(err.message);
      await loadStatus();
    } finally {
      setFixing(false);
    }
  }

  const stripe = status && status.stripe;
  const plan = stripe && stripe.plan;
  const taxLine = stripe ? stripeTaxLine(stripe.tax) : null;

  return (
    <div className="account-card" data-testid="sales-tax-card">
      <div className="account-eyebrow">Sales tax</div>
      <p style={{ fontSize: '0.85rem', color: 'var(--ink)', margin: 0 }}>{registrationsLine(stripe && stripe.tax)}</p>
      {taxLine && <p style={dim}>{taxLine}</p>}
      {!ready && <p style={{ ...dim, color: 'var(--warn)' }} role="status">{MIGRATION_122_LINE} Until it runs, nothing is taxed and every payment works as it always has.</p>}

      {TAX_SWITCHES.map((s) => (
        <div key={s.key} style={rowStyle}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: ready ? 1 : 0.55 }}>
            <input type="checkbox" checked={form[s.key]} disabled={!ready || saving} onChange={(e) => setForm((f) => ({ ...f, [s.key]: e.target.checked }))} />
            Tax on {s.label.toLowerCase()}
          </label>
          <p style={dim}>{s.line}</p>
          {status && status.skipped && status.skipped[LANE_OF[s.key]] && status.skipped[LANE_OF[s.key]].line && (
            <p style={{ ...faint, color: 'var(--warn)' }} data-testid={`tax-skipped-${LANE_OF[s.key]}`}>{status.skipped[LANE_OF[s.key]].line}</p>
          )}
          {s.key === 'taxBookings' && (
            <div style={{ marginTop: '0.6rem' }}>
              <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.78rem', color: 'var(--ink-dim)' }}>
                Booking tax code
                <input type="text" inputMode="text" autoComplete="off" spellCheck={false} placeholder="txcd_20030000" value={form.taxBookingCode} disabled={!ready || saving} onChange={(e) => setForm((f) => ({ ...f, taxBookingCode: e.target.value }))} style={{ maxWidth: 220, fontFamily: 'var(--font-mono)' }} />
              </label>
              <p style={faint}>
                Stripe has no code for renting a place for a shoot, so the studio chooses (an accountant can say which). The usual candidates:{' '}
                {BOOKING_TAX_CODE_CANDIDATES.map((c, i) => (
                  <span key={c.code}>
                    {i > 0 && ' or '}
                    <button type="button" className="acct-linkbtn" disabled={!ready || saving} onClick={() => setForm((f) => ({ ...f, taxBookingCode: c.code }))}>{c.label} ({c.code})</button>
                  </span>
                ))}
                . <a href={STRIPE_TAX_CODES_URL} target="_blank" rel="noopener noreferrer">Stripe’s list of tax codes</a>.
              </p>
              {form.taxBookings && !form.taxBookingCode.trim() && <p style={{ ...faint, color: 'var(--warn)' }}>Bookings can’t be taxed without a code.</p>}
            </div>
          )}
          {s.key === 'taxMemberships' && (
            <div style={{ marginTop: '0.6rem' }} data-testid="membership-tax-status">
              {statusError && <p style={{ ...faint, color: 'var(--danger)' }}>{statusError}</p>}
              {!status && !statusError && <p style={faint}>Reading Stripe…</p>}
              {stripe && !stripe.configured && <p style={faint}>Stripe isn’t set up on this site.</p>}
              {stripe && stripe.error && <p style={{ ...faint, color: 'var(--danger)' }}>{stripe.error}</p>}
              {plan && plan.products.length === 0 && <p style={faint}>No membership products in Stripe yet.</p>}
              {plan && plan.products.length > 0 && (
                <ul style={{ listStyle: 'none', padding: 0, margin: '0.2rem 0 0', display: 'grid', gap: '0.5rem' }}>
                  {plan.products.map((p) => (
                    <li key={p.productId} style={{ fontSize: '0.84rem', overflowWrap: 'anywhere' }}>
                      <span style={{ color: p.ok ? 'var(--ok)' : 'var(--ink-faint)', fontFamily: 'var(--font-mono)', marginRight: 6 }}>{p.ok ? '✓' : '·'}</span>
                      {p.name}
                      <span style={{ display: 'block', ...faint, marginTop: 2 }}>Tax code {p.taxCode || 'none'}{p.ok ? '' : ` → ${MEMBERSHIP_TAX_CODE} when you press the button`}</span>
                      {plan.prices.filter((x) => x.productId === p.productId).map((x) => (
                        <span key={x.priceId} style={{ display: 'block', ...faint, marginTop: 2 }}>{money(x.amountCents)} / {x.interval} · {x.taxBehavior}: {x.note}</span>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
              {plan && plan.products.length > 0 && (
                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                  <button type="button" className="account-btn-secondary" style={{ width: 'auto', marginBottom: 0 }} disabled={fixing || plan.changes === 0} onClick={fixProducts}>
                    {fixing ? 'Asking Stripe…' : plan.changes === 0 ? 'The membership products are set' : 'Set the membership products to tax-on-top'}
                  </button>
                  {fixNote && <span style={{ color: 'var(--brass)', fontSize: '0.8rem' }}>{fixNote}</span>}
                </div>
              )}
              {fixError && <p style={{ ...faint, color: 'var(--danger)' }}>{fixError}</p>}
              {plan && plan.inclusive > 0 && <p style={faint}>A price with tax included stays that way; members on it pay the same and the tax comes out of it.</p>}
              <p style={faint}>The switch decides new memberships: one joined while it’s on keeps Stripe Tax on every renewal, and members who joined before keep paying without it.</p>
            </div>
          )}
        </div>
      ))}

      {error && <p style={{ color: 'var(--danger)', fontSize: '0.82rem' }}>{error}</p>}
      <button className="account-btn-primary" style={{ width: 'auto', marginTop: '0.4rem' }} onClick={save} disabled={!ready || saving || !dirty}>
        {saving ? 'Saving…' : 'Save sales tax'}
      </button>
      {saved && <span style={{ marginLeft: '0.8rem', color: 'var(--brass)' }}>Saved.</span>}
      {dirty && !saving && <div style={{ fontSize: '0.74rem', color: 'var(--signal-amber)', marginTop: '0.4rem' }}>Unsaved changes — click Save sales tax to apply.</div>}
    </div>
  );
}
