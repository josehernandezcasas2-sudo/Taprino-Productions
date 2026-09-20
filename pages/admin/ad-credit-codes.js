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
    return { redirect: { destination: '/stream', permanent: false } };
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

// A handful of common amounts, plus a genuinely custom option — same
// reasoning as promo-codes' duration presets.
const AMOUNT_PRESETS = [
  { label: '$10', dollars: 10 },
  { label: '$25', dollars: 25 },
  { label: '$50', dollars: 50 },
  { label: '$100', dollars: 100 }
];

function formatDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function AdCreditCodesAdmin({ mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator }) {
  const [codes, setCodes] = useState(null);
  const [loading, setLoading] = useState(true);
  const [quantity, setQuantity] = useState(1);
  const [amountChoice, setAmountChoice] = useState(25);
  const [customAmount, setCustomAmount] = useState('');
  const [note, setNote] = useState('');
  const [generating, setGenerating] = useState(false);
  const [formError, setFormError] = useState(null);
  const [justGenerated, setJustGenerated] = useState(null);
  const [copiedCode, setCopiedCode] = useState(null);
  const [filter, setFilter] = useState('all'); // 'all' | 'unused' | 'redeemed'

  function loadCodes() {
    setLoading(true);
    fetch('/api/admin/ad-credit-codes')
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
    const amountDollars = amountChoice === 'custom' ? parseFloat(customAmount) : amountChoice;
    if (!Number.isFinite(amountDollars) || amountDollars <= 0) {
      setFormError('Enter a valid dollar amount.');
      return;
    }
    setGenerating(true);
    setJustGenerated(null);
    try {
      const res = await fetch('/api/admin/ad-credit-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity, amountDollars, note: note.trim() || undefined })
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

  function toggleNoted(id, currentValue) {
    // Optimistic, same as promo-codes — flips immediately, reverts on
    // failure so the checkbox never lies about what's actually saved.
    setCodes((prev) => prev.map((c) => (c.id === id ? { ...c, noted: !currentValue } : c)));
    fetch('/api/admin/ad-credit-codes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, noted: !currentValue })
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setCodes((prev) => prev.map((c) => (c.id === id ? { ...c, noted: currentValue } : c)));
        }
      })
      .catch(() => {
        setCodes((prev) => prev.map((c) => (c.id === id ? { ...c, noted: currentValue } : c)));
      });
  }

  const filteredCodes = (codes || []).filter((c) => {
    if (filter === 'unused') return !c.redeemed_by_account_id;
    if (filter === 'redeemed') return !!c.redeemed_by_account_id;
    return true;
  });

  return (
    <>
      <Head>
        <title>Ad credit codes — {SITE.name}</title>
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
        <h1>Ad credit codes</h1>
        <p className="ca-sub">
          Generate codes that credit an advertiser&rsquo;s Ad Manager account — no card, no
          checkout. Each code works once, redeemable by any signed-in advertiser with an ad
          account, and adds straight to their shared credit balance the same as a real purchase
          would.
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

            <label>How much does each one credit?</label>
            <select value={amountChoice} onChange={(e) => setAmountChoice(e.target.value === 'custom' ? 'custom' : parseFloat(e.target.value))}>
              {AMOUNT_PRESETS.map((p) => <option key={p.dollars} value={p.dollars}>{p.label}</option>)}
              <option value="custom">Custom…</option>
            </select>

            {amountChoice === 'custom' && (
              <>
                <label>Amount in dollars</label>
                <input type="number" min="0.01" step="0.01" value={customAmount} onChange={(e) => setCustomAmount(e.target.value)} placeholder="e.g. 75.00" />
              </>
            )}

            <label>Note <span style={{ fontWeight: 'normal', color: 'var(--ink-dim)' }}>optional, for your own reference</span></label>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Given to a launch-week sponsor" />

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
                      style={{ background: 'none', border: '1px solid rgba(251,232,211,0.25)', borderRadius: '4px', padding: '0.15rem 0.5rem', fontSize: '0.72rem', color: 'var(--ink-dim)', cursor: 'pointer' }}
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
          <div className="ca-table promo-table" role="table" aria-label="Ad credit codes">
            <div className="ca-tr ca-th" role="row">
              <span role="columnheader">Code</span>
              <span role="columnheader">Grants</span>
              <span role="columnheader">Status</span>
              <span role="columnheader">Note</span>
              <span role="columnheader" style={{ textAlign: 'center' }}>Noted</span>
            </div>
            {filteredCodes.map((c) => (
              <div className="ca-tr" role="row" key={c.id}>
                <span role="cell" className="ca-title">
                  <code style={{ fontFamily: 'var(--font-mono)' }}>{c.code}</code>
                </span>
                <span role="cell">${(c.amount_cents / 100).toFixed(2)}</span>
                <span role="cell">
                  {c.redeemed_by_account_id ? (
                    <span style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>
                      Used by {c.redeemed_by_email || 'someone'} on {formatDate(c.redeemed_at)}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--ok)', fontSize: '0.85rem' }}>Unused</span>
                  )}
                </span>
                <span role="cell" style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>{c.note || '—'}</span>
                <span role="cell" style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={!!c.noted}
                    onChange={() => toggleNoted(c.id, !!c.noted)}
                    title="Written down / handed out"
                    aria-label={`Mark ${c.code} as noted`}
                    style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                </span>
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
