import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { getAccountContext } from '../../lib/accountContext';
import { THEME_COLOR_GROUPS } from '../../lib/themeColors';

export async function getServerSideProps({ req, res }) {
  const account = await getAccountContext(req);
  if (!account.isAdmin) {
    res.statusCode = 404;
    return { props: { notFound: true } };
  }
  return { props: {} };
}

export default function ThemeAdmin() {
  const [values, setValues] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/admin/theme')
      .then((r) => r.json())
      .then((data) => {
        // Seed the form with current overrides where present, otherwise
        // the stylesheet's own documented default — so every picker
        // always shows the color that's actually in effect right now,
        // never a blank swatch.
        const initial = {};
        for (const group of THEME_COLOR_GROUPS) {
          for (const v of group.vars) {
            initial[v.key] = (data.overrides && data.overrides[v.key]) || v.default;
          }
        }
        setValues(initial);
      });
  }, []);

  function setColor(key, value) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  function resetOne(key, defaultValue) {
    setColor(key, defaultValue);
  }

  async function saveAll() {
    setSaving(true);
    setError(null);
    try {
      // Only send keys that actually differ from default — anything equal
      // to its default is left out entirely, which is what tells the
      // server (and therefore _document.js) to fall back to the
      // stylesheet's own value rather than injecting a redundant override.
      const overrides = {};
      for (const group of THEME_COLOR_GROUPS) {
        for (const v of group.vars) {
          if (values[v.key] && values[v.key].toLowerCase() !== v.default.toLowerCase()) {
            overrides[v.key] = values[v.key];
          }
        }
      }
      const res = await fetch('/api/admin/theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save.');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function resetAllToDefault() {
    const reset = {};
    for (const group of THEME_COLOR_GROUPS) {
      for (const v of group.vars) reset[v.key] = v.default;
    }
    setValues(reset);
  }

  return (
    <>
      <Head><title>Theme colors — Admin</title></Head>
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '2rem 1.5rem 4rem', fontFamily: 'var(--font-body)', color: 'var(--ink)' }}>
        <Link href="/admin" style={{ color: 'var(--ink-dim)', fontSize: '0.85rem', textDecoration: 'none' }}>← Back to admin</Link>
        <h1 style={{ fontFamily: 'var(--font-display)', marginTop: '0.6rem' }}>Theme colors</h1>
        <p style={{ color: 'var(--ink-dim)', fontSize: '0.88rem', marginBottom: '1.8rem' }}>
          Every real color variable the site's stylesheet is built from — changing one here re-themes
          every place that variable is used, sitewide, without touching code or redeploying. Takes effect
          on the next page load for every visitor. Changes here are for play-testing; nothing is undoable
          from history, so note down a combination you like before trying another.
        </p>

        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

        {!values ? (
          <p>Loading…</p>
        ) : (
          <>
            {THEME_COLOR_GROUPS.map((group) => (
              <div key={group.label} style={{ marginBottom: '2rem' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--brass)', marginBottom: '0.8rem' }}>
                  {group.label}
                </div>
                {group.vars.map((v) => (
                  <div key={v.key} style={{ display: 'flex', alignItems: 'center', gap: '0.9rem', marginBottom: '0.7rem' }}>
                    <input
                      type="color"
                      value={values[v.key]}
                      onChange={(e) => setColor(v.key, e.target.value)}
                      style={{ width: 44, height: 34, border: 'none', borderRadius: 6, cursor: 'pointer', background: 'none', padding: 0 }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{v.label}</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--ink-dim)' }}>{v.key}</div>
                    </div>
                    <input
                      type="text"
                      value={values[v.key]}
                      onChange={(e) => setColor(v.key, e.target.value)}
                      style={{ width: 90, fontFamily: 'var(--font-mono)', fontSize: '0.8rem', background: 'var(--surface-2)', border: '1px solid rgba(234,231,221,0.15)', borderRadius: 5, padding: '0.3rem 0.5rem', color: 'var(--ink)' }}
                    />
                    {values[v.key].toLowerCase() !== v.default.toLowerCase() && (
                      <button
                        onClick={() => resetOne(v.key, v.default)}
                        style={{ background: 'none', border: 'none', color: 'var(--ink-dim)', fontSize: '0.72rem', textDecoration: 'underline', cursor: 'pointer' }}
                      >
                        Reset
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ))}

            <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center', marginTop: '1rem', borderTop: '1px solid rgba(234,231,221,0.1)', paddingTop: '1.2rem' }}>
              <button
                onClick={saveAll}
                disabled={saving}
                style={{ background: 'var(--brass)', color: '#241a05', border: 'none', borderRadius: 6, padding: '0.6rem 1.2rem', fontWeight: 700, cursor: 'pointer', fontSize: '0.88rem' }}
              >
                {saving ? 'Saving…' : 'Save & apply sitewide'}
              </button>
              <button
                onClick={resetAllToDefault}
                style={{ background: 'none', border: '1px solid rgba(234,231,221,0.2)', color: 'var(--ink)', borderRadius: 6, padding: '0.6rem 1.1rem', cursor: 'pointer', fontSize: '0.85rem' }}
              >
                Reset everything to default
              </button>
              {saved && <span style={{ color: 'var(--ok)' }}>Saved — refresh any tab to see it.</span>}
            </div>
          </>
        )}
      </main>
    </>
  );
}
