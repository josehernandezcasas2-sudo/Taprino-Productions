import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { THEME_COLOR_GROUPS } from '../../lib/themeColors';
import { PLAYER_ICON_GROUPS, GENRES, GENRE_DEFAULT_EMOJI, SITE_ICON_DEFS } from './iconDefs';
import { SITE } from '../../lib/siteConfig';

// Styles & Guides (2026-10-08): the one place for how the site looks.
//   Colors      — the old /admin/theme page (CSS variable overrides)
//   Icons       — site icons + player/nav/creator/admin icons + genre
//                 icons, formerly three separate pages
//   Type        — read-only reference for the three typefaces
//   Components  — read-only reference of the core UI pieces
// Tab is in the URL (?tab=icons) so old pages can redirect here and
// deep-link, and a group anchor (#genres) scrolls to the set.
const TABS = [['colors', 'Colors'], ['icons', 'Icons'], ['type', 'Type'], ['components', 'Components']];

export default function StylesGuides() {
  const router = useRouter();
  const tab = TABS.some(([k]) => k === router.query.tab) ? router.query.tab : 'colors';

  function setTab(next) {
    router.replace({ pathname: router.pathname, query: { ...router.query, tab: next } }, undefined, { shallow: true, scroll: false });
  }

  // Honour a #hash deep link once the icons tab has rendered.
  useEffect(() => {
    if (tab !== 'icons' || typeof window === 'undefined' || !window.location.hash) return;
    const el = document.getElementById(window.location.hash.slice(1));
    if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }, [tab]);

  return (
    <>
      <div className="sg-tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`sg-tab ${tab === k ? 'is-active' : ''}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {tab === 'colors' && <ColorsTab />}
      {tab === 'icons' && <IconsTab />}
      {tab === 'type' && <TypeTab />}
      {tab === 'components' && <ComponentsTab />}
    </>
  );
}

/* ---------------- Colors ---------------- */
function ColorsTab() {
  const [values, setValues] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/admin/theme')
      .then((r) => r.json())
      .then((data) => {
        const initial = {};
        for (const group of THEME_COLOR_GROUPS) {
          for (const v of group.vars) initial[v.key] = (data.overrides && data.overrides[v.key]) || v.default;
        }
        setValues(initial);
      })
      .catch(() => setError('Could not load the theme.'));
  }, []);

  function setColor(key, value) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function saveAll() {
    setSaving(true);
    setError(null);
    try {
      // Only keys that differ from their default are sent; equal-to-default
      // is left out so _document.js falls back to the stylesheet.
      const overrides = {};
      for (const group of THEME_COLOR_GROUPS) {
        for (const v of group.vars) {
          if (values[v.key] && values[v.key].toLowerCase() !== v.default.toLowerCase()) overrides[v.key] = values[v.key];
        }
      }
      const res = await fetch('/api/admin/theme', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ overrides }) });
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

  function resetAll() {
    const reset = {};
    for (const group of THEME_COLOR_GROUPS) for (const v of group.vars) reset[v.key] = v.default;
    setValues(reset);
  }

  if (error && !values) return <p className="rq-error">{error}</p>;
  if (!values) return <p className="adm-empty">Loading…</p>;

  return (
    <>
      <p className="adm-intro">
        Every color variable the stylesheet is built from. Changing one re-themes everywhere it&rsquo;s used, sitewide, on the next page load.
        Nothing is undoable from history, so note a combination you like before trying another.
      </p>
      {error && <p className="rq-error">{error}</p>}
      {THEME_COLOR_GROUPS.map((group) => (
        <div key={group.label}>
          <h3 className="sg-h3">{group.label}</h3>
          <div className="sg-swatches">
            {group.vars.map((v) => {
              const changed = values[v.key].toLowerCase() !== v.default.toLowerCase();
              return (
                <div key={v.key} className="sg-swatch">
                  <div className="sg-swatch-color" style={{ background: values[v.key] }}>
                    <input type="color" value={values[v.key]} onChange={(e) => setColor(v.key, e.target.value)} aria-label={`${v.label} color`} />
                  </div>
                  <div className="sg-swatch-body">
                    <div className="sg-swatch-label">{v.label}</div>
                    <div className="sg-swatch-key">{v.key}</div>
                    <div className="sg-swatch-row">
                      <input type="text" value={values[v.key]} onChange={(e) => setColor(v.key, e.target.value)} aria-label={`${v.label} hex`} />
                      {changed && <button type="button" className="sg-reset" onClick={() => setColor(v.key, v.default)}>Reset</button>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center', marginTop: '1.4rem', borderTop: '1px solid rgba(251,232,211,0.1)', paddingTop: '1.2rem' }}>
        <button type="button" className="account-btn-primary" style={{ width: 'auto' }} onClick={saveAll} disabled={saving}>{saving ? 'Saving…' : 'Save & apply sitewide'}</button>
        <button type="button" className="account-btn-secondary" style={{ width: 'auto' }} onClick={resetAll}>Reset everything to default</button>
        {saved && <span style={{ color: 'var(--ok)' }}>Saved — refresh any tab to see it.</span>}
      </div>
    </>
  );
}

/* ---------------- Icons ---------------- */
function readAsDataUrl(f) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(f);
  });
}

function IconsTab() {
  const [playerIcons, setPlayerIcons] = useState({});
  const [genreIcons, setGenreIcons] = useState({});
  const [siteIcons, setSiteIcons] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/admin/player-icons').then((r) => r.json()).then((d) => setPlayerIcons(Object.fromEntries((d.icons || []).map((i) => [i.icon_key, i.image_url])))).catch(() => {});
    fetch('/api/admin/genre-icons').then((r) => r.json()).then((d) => setGenreIcons(Object.fromEntries((d.icons || []).map((i) => [i.genre, i.image_url])))).catch(() => {});
    fetch('/api/site-settings').then((r) => r.json()).then((d) => setSiteIcons({ favicon: d.faviconUrl || null, appIcon: d.appIconUrl || null })).catch(() => {});
  }, []);

  // One helper for all three stores: they share the same POST/DELETE shape.
  async function change(kind, id, file) {
    const url = { player: '/api/admin/player-icons', genre: '/api/admin/genre-icons', site: '/api/admin/site-icons' }[kind];
    const idField = { player: 'iconKey', genre: 'genre', site: 'target' }[kind];
    const setter = { player: setPlayerIcons, genre: setGenreIcons, site: setSiteIcons }[kind];
    setBusy(`${kind}-${id}`);
    setError(null);
    try {
      const body = { [idField]: id };
      if (file) { body.imageBase64 = await readAsDataUrl(file); body.imageFileName = file.name; }
      const res = await fetch(url, { method: file ? 'POST' : 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save that icon.');
      setter((prev) => ({ ...prev, [id]: file ? data.imageUrl : null }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  function Tile({ kind, id, label, current, Default, defaultLabel = 'Default' }) {
    const key = `${kind}-${id}`;
    return (
      <div className="sg-icon">
        <div className="sg-icon-preview">{current ? <img src={current} alt="" /> : <Default />}</div>
        <div className="sg-icon-name">{label}</div>
        <div className="sg-icon-state">{current ? 'Custom' : defaultLabel}</div>
        <div className="sg-icon-acts">
          <label>
            {busy === key ? 'Uploading…' : current ? 'Replace' : 'Upload'}
            <input type="file" accept="image/*" disabled={busy === key} onChange={(e) => { if (e.target.files[0]) change(kind, id, e.target.files[0]); e.target.value = ''; }} />
          </label>
          {current && <button type="button" onClick={() => change(kind, id, null)} disabled={busy === key}>Reset</button>}
        </div>
      </div>
    );
  }

  const overridden = Object.values(playerIcons).filter(Boolean).length;
  const totalPlayer = PLAYER_ICON_GROUPS.reduce((n, g) => n + g.icons.length, 0);

  return (
    <>
      <p className="adm-intro">
        Every icon on the site, in one place. Upload a square image (transparent PNG or SVG, at least 64×64, bold simple shapes since these render at 18–32px) to replace the default; Reset puts the default back. Nothing changes until you upload something.
      </p>
      {error && <p className="rq-error">{error}</p>}

      <h3 id="site" className="sg-h3">Site <span className="sg-note">favicon and app icon</span></h3>
      <div className="sg-icons">
        {SITE_ICON_DEFS.map((d) => (
          <Tile key={d.target} kind="site" id={d.target} label={d.label} current={siteIcons[d.target]} Default={() => <img src="/icon.svg" alt="" />} defaultLabel="Default /icon.svg" />
        ))}
      </div>

      <h3 id="player" className="sg-h3">Interface <span className="sg-note">{overridden} of {totalPlayer} overridden</span></h3>
      {PLAYER_ICON_GROUPS.map((g) => (
        <div key={g.id} id={`icons-${g.id}`}>
          <div className="adm-eyebrow" style={{ margin: '0.8rem 0 0.5rem' }}>{g.label}</div>
          <div className="sg-icons">
            {g.icons.map(({ key, label, Default }) => (
              <Tile key={key} kind="player" id={key} label={label} current={playerIcons[key]} Default={Default} defaultLabel="Default icon" />
            ))}
          </div>
        </div>
      ))}

      <h3 id="genres" className="sg-h3">Genres <span className="sg-note">emoji until you upload an image</span></h3>
      <div className="sg-icons">
        {GENRES.map((g) => (
          <Tile key={g} kind="genre" id={g} label={g} current={genreIcons[g]} Default={() => <span>{GENRE_DEFAULT_EMOJI[g]}</span>} defaultLabel="Default emoji" />
        ))}
      </div>
    </>
  );
}

/* ---------------- Type ---------------- */
function TypeTab() {
  return (
    <>
      <p className="adm-intro">The three typefaces the site and the app are set in, and what each is for. These are fixed in the stylesheet; this is the reference, not a control.</p>
      <div className="adm-card">
        <div className="sg-type-row">
          <div className="adm-eyebrow">Display · Space Grotesk</div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.7rem', lineHeight: 1.1 }}>Headlines, names, big numbers</div>
        </div>
        <div className="sg-type-row">
          <div className="adm-eyebrow">Body · Fraunces</div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: '1rem', lineHeight: 1.55 }}>Descriptions, bios, long reads and most paragraph text. 16px at line-height 1.55 on the page; 14–15px in cards.</div>
        </div>
        <div className="sg-type-row">
          <div className="adm-eyebrow">Mono · IBM Plex Mono</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.84rem', letterSpacing: '0.04em' }}>LABELS, META ROWS, BUTTONS, STATS, EYEBROWS · 12–14px, often uppercase and letterspaced</div>
        </div>
        <div className="sg-type-row">
          <div className="adm-eyebrow">Mobile app</div>
          <div style={{ fontSize: '0.9rem', color: 'var(--ink-dim)' }}>Still uses the system font. Loading these three faces in Expo is an open item in CLAUDE.md.</div>
        </div>
      </div>
    </>
  );
}

/* ---------------- Components ---------------- */
function ComponentsTab() {
  return (
    <>
      <p className="adm-intro">The building blocks most pages are made of, rendered with the live styles so anyone editing the site (or an AI) can see what&rsquo;s canonical. Change the stylesheet and these update with it.</p>
      <div className="sg-comp-grid">
        <div className="sg-comp">
          <div className="sg-comp-label">Buttons</div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button type="button" className="account-btn-primary" style={{ width: 'auto' }}>Primary</button>
            <button type="button" className="account-btn-secondary" style={{ width: 'auto' }}>Secondary</button>
            <button type="button" className="rq-btn rq-btn-ok">Approve</button>
            <button type="button" className="rq-btn rq-btn-danger">Reject</button>
          </div>
          <div className="sg-comp-note">.account-btn-primary · .account-btn-secondary · .rq-btn</div>
        </div>
        <div className="sg-comp">
          <div className="sg-comp-label">Badges &amp; chips</div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="account-role-badge">Creator</span>
            <span className="account-tier-badge">{SITE.premiumTier} member</span>
            <span className="adm-badge">7</span>
            <span className="rq-chip is-active">Filter</span>
            <span className="profile-genre-tag">Documentary</span>
          </div>
          <div className="sg-comp-note">.account-role-badge · .account-tier-badge · .adm-badge · .rq-chip</div>
        </div>
        <div className="sg-comp">
          <div className="sg-comp-label">Eyebrow + heading</div>
          <div className="account-eyebrow">Eyebrow label</div>
          <h3 style={{ margin: '0.2rem 0 0' }}>Card heading</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--ink-dim)', margin: '0.3rem 0 0' }}>Supporting copy in body face, dimmed.</p>
          <div className="sg-comp-note">.account-eyebrow · h3 · var(--ink-dim)</div>
        </div>
        <div className="sg-comp">
          <div className="sg-comp-label">Inputs</div>
          <input type="text" placeholder="Text field" style={{ marginBottom: '0.5rem' }} />
          <select style={{ marginBottom: 0 }}><option>Select</option></select>
          <div className="sg-comp-note">Global input / select styles</div>
        </div>
        <div className="sg-comp">
          <div className="sg-comp-label">Stat tile</div>
          <div className="adm-stat"><b>142</b><span>Titles live</span></div>
          <div className="sg-comp-note">.adm-stat · display face number, mono label</div>
        </div>
        <div className="sg-comp">
          <div className="sg-comp-label">Surfaces</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
            {['--surface-0', '--surface-1', '--surface-2', '--surface-3'].map((v) => (
              <div key={v} style={{ background: `var(${v})`, border: '1px solid rgba(251,232,211,0.12)', borderRadius: 6, padding: '0.5rem', fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>{v}</div>
            ))}
          </div>
          <div className="sg-comp-note">page · raised · cards · hover</div>
        </div>
      </div>
    </>
  );
}
