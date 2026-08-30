import { useEffect, useState } from 'react';
import Head from 'next/head';
import { getAccountContext } from '../../lib/accountContext';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import HeaderNav from '../../components/HeaderNav';
import MobileTabBar from '../../components/MobileTabBar';
import Footer from '../../components/Footer';
import { SITE } from '../../lib/siteConfig';

export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  if (!account.isAdmin) {
    return { redirect: { destination: '/', permanent: false } };
  }
  const episodes = await getPublicEpisodes();
  return {
    props: {
      mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator
    }
  };
}

// A handful of common durations, plus a genuinely custom option — covers
// "give this person a week to try it" through "comp this person's whole
// year" without a dropdown of every conceivable number.
const DURATION_PRESETS = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '1 year', days: 365 }
];

function formatDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function PromoCodesAdmin({ mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator }) {
  const [codes, setCodes] = useState(null);
  const [loading, setLoading] = useState(true);
  const [quantity, setQuantity] = useState(1);
  const [durationChoice, setDurationChoice] = useState(30);
  const [customDays, setCustomDays] = useState('');
  const [note, setNote] = useState('');
  const [generating, setGenerating] = useState(false);
  const [formError, setFormError] = useState(null);
  const [justGenerated, setJustGenerated] = useState(null);
  const [copiedCode, setCopiedCode] = useState(null);
  const [filter, setFilter] = useState('all'); // 'all' | 'unused' | 'redeemed'

  function loadCodes() {
    setLoading(true);
    fetch('/api/admin/promo-codes')
      .then((r) => r.json())
      .then((d) => {
        setCodes(d.codes || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }

  useEffect(() => { loadCodes(); }, []);

  async function handleGenerate(e) {
    e.preventDefault();
    setFormError(null);
    const durationDays = durationChoice === 'custom' ? parseInt(customDays, 10) : durationChoice;
    if (!Number.isInteger(durationDays) || durationDays < 1) {
      setFormError('Enter a valid number of days.');
      return;
    }
    setGenerating(true);
    setJustGenerated(null);
    try {
      const res = await fetch('/api/admin/promo-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity, durationDays, note: note.trim() || undefined })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not generate codes.');
      setJustGenerated(data.codes);
      setNote('');
      loadCodes();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  function copyCode(code) {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(code);
      setTimeout(() => setCopiedCode((c) => (c === code ? null : c)), 2000);
    }).catch(() => {});
  }

  const filteredCodes = (codes || []).filter((c) => {
    if (filter === 'unused') return !c.redeemed_by;
    if (filter === 'redeemed') return !!c.redeemed_by;
    return true;
  });

  return (
    <>
      <Head>
        <title>Promo codes — {SITE.name}</title>
        <meta name="robots" content="noindex" />
      </Head>

      <HeaderNav
        activeType="All"
        mainGenres={mainGenres}
        isSignedIn={isSignedIn}
        email={email}
        isAdmin={isAdmin}
        isCreator={isCreator}
        isSubscriber={isSubscriber}
      />

      <main id="main-content" className="stage stage-single">
        <div className="eyebrow">Admin</div>
        <h1>Promo codes</h1>
        <p className="ca-sub">
          Generate codes that give someone temporary {SITE.premiumTier} access — no card, no
          checkout. Each code works once; redeeming a code while an earlier one is still active
          extends the remaining time rather than replacing it.
        </p>

        <div className="account-card" style={{ marginTop: '1.2rem' }}>
          <div className="account-eyebrow">Generate codes</div>
          <form onSubmit={handleGenerate}>
            <label>How many codes?</label>
            <input
              type="number"
              min="1"
              max="100"
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value, 10) || 1)}
            />

            <label>How long does each one grant?</label>
            <select value={durationChoice} onChange={(e) => setDurationChoice(e.target.value === 'custom' ? 'custom' : parseInt(e.target.value, 10))}>
              {DURATION_PRESETS.map((p) => <option key={p.days} value={p.days}>{p.label}</option>)}
              <option value="custom">Custom…</option>
            </select>

            {durationChoice === 'custom' && (
              <>
                <label>Number of days</label>
                <input type="number" min="1" value={customDays} onChange={(e) => setCustomDays(e.target.value)} placeholder="e.g. 45" />
              </>
            )}

            <label>Note <span style={{ fontWeight: 'normal', color: 'var(--ink-dim)' }}>optional, for your own reference</span></label>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Handed out at the festival booth" />

            {formError && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{formError}</p>}

            <button className="account-btn-primary" type="submit" disabled={generating} style={{ marginTop: '0.6rem' }}>
              {generating ? 'Generating…' : `Generate ${quantity > 1 ? `${quantity} codes` : 'code'}`}
            </button>
          </form>

          {justGenerated && (
            <div className="ca-notice" style={{ marginTop: '1rem' }}>
              <p style={{ margin: '0 0 0.6rem', fontWeight: 600 }}>
                {justGenerated.length === 1 ? 'Code generated:' : `${justGenerated.length} codes generated:`}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {justGenerated.map((c) => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.95rem' }}>{c.code}</code>
                    <button
                      onClick={() => copyCode(c.code)}
                      style={{ background: 'none', border: '1px solid rgba(234,231,221,0.25)', borderRadius: '4px', padding: '0.15rem 0.5rem', fontSize: '0.72rem', color: 'var(--ink-dim)', cursor: 'pointer' }}
                    >
                      {copiedCode === c.code ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="eyebrow ca-section">All codes</div>

        <div className="ca-range" role="group" aria-label="Filter">
          {[
            { key: 'all', label: 'All' },
            { key: 'unused', label: 'Unused' },
            { key: 'redeemed', label: 'Redeemed' }
          ].map((f) => (
            <button
              key={f.key}
              className={`ca-range-btn ${filter === f.key ? 'on' : ''}`}
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading && <div className="ca-empty">Loading codes…</div>}

        {!loading && filteredCodes.length === 0 && (
          <div className="ca-empty">
            {filter === 'all' ? 'No codes generated yet.' : `No ${filter} codes.`}
          </div>
        )}

        {!loading && filteredCodes.length > 0 && (
          <div className="ca-table promo-table" role="table" aria-label="Promo codes">
            <div className="ca-tr ca-th" role="row">
              <span role="columnheader">Code</span>
              <span role="columnheader">Grants</span>
              <span role="columnheader">Status</span>
              <span role="columnheader">Note</span>
            </div>
            {filteredCodes.map((c) => (
              <div className="ca-tr" role="row" key={c.id}>
                <span role="cell" className="ca-title">
                  <code style={{ fontFamily: 'var(--font-mono)' }}>{c.code}</code>
                </span>
                <span role="cell">{c.duration_days} day{c.duration_days === 1 ? '' : 's'}</span>
                <span role="cell">
                  {c.redeemed_by ? (
                    <span style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>
                      Used by {c.redeemed_by_email || 'someone'} on {formatDate(c.redeemed_at)}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--ok)', fontSize: '0.85rem' }}>Unused</span>
                  )}
                </span>
                <span role="cell" style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>{c.note || '—'}</span>
              </div>
            ))}
          </div>
        )}
      </main>
      <Footer />
      <MobileTabBar />
    </>
  );
}
