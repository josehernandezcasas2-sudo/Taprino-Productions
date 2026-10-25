import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';

// Site configuration: header labels and links, feature toggles, recs
// closeness, default ad CPM, the tip numbers, logo, placeholder content,
// newsletter export. Moved out of the old pages/admin.js hub (2026-10-08);
// rendered by pages/admin/settings.js. The search icon upload moved to
// Styles & Guides → Icons (it's the player-icons `search` key).
const dollarsFromCents = (cents) => `$${(Math.round(Number(cents) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export default function SiteSettingsPanel() {
  const [siteSettings, setSiteSettings] = useState(null);
  const [confirmedSiteSettings, setConfirmedSiteSettings] = useState(null);
  const [siteSettingsSaving, setSiteSettingsSaving] = useState(false);
  const [siteSettingsSaved, setSiteSettingsSaved] = useState(false);
  const [siteSettingsError, setSiteSettingsError] = useState(null);
  const [placeholderBusy, setPlaceholderBusy] = useState(false);
  const [placeholderResult, setPlaceholderResult] = useState(null);
  const [placeholderError, setPlaceholderError] = useState(null);
  const [newsletterCount, setNewsletterCount] = useState(null);
  const [newsletterEspConfigured, setNewsletterEspConfigured] = useState(null);

  async function loadSiteSettings() {
    try {
      const res = await fetch('/api/admin/site-settings');
      const data = await res.json();
      setSiteSettings(data);
      setConfirmedSiteSettings(data);
    } catch (err) {
      setSiteSettingsError('Could not load site settings.');
    }
  }

  useEffect(() => {
    loadSiteSettings();
    fetch('/api/admin/newsletter-signups')
      .then((r) => r.json())
      .then((data) => {
        setNewsletterCount(data.count);
        setNewsletterEspConfigured(data.signups.length > 0 ? data.signups.some((s) => s.synced_to_esp) : null);
      })
      .catch(() => setNewsletterCount(null));
  }, []);

  async function saveSiteSettings(overrides = {}) {
    setSiteSettingsSaving(true);
    setSiteSettingsSaved(false);
    setSiteSettingsError(null);
    try {
      const res = await fetch('/api/admin/site-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopEnabled: siteSettings.shopEnabled,
          shopUrl: siteSettings.shopUrl,
          liveTvEnabled: siteSettings.liveTvEnabled,
          verticalEnabled: siteSettings.verticalEnabled,
          podcastsEnabled: siteSettings.podcastsEnabled,
          recommendationCloseness: siteSettings.recommendationCloseness,
          elevatorPitchEnabled: siteSettings.elevatorPitchEnabled,
          adCpmCents: siteSettings.adCpmCents,
          adSectionSizes: siteSettings.adSectionSizes,
          adHourCapSeconds: siteSettings.adHourCapSeconds,
          adBreakRoundSeconds: siteSettings.adBreakRoundSeconds,
          tipPlatformCutPercent: siteSettings.tipPlatformCutPercent,
          tipCutMaxCents: siteSettings.tipCutMaxCents,
          tipMaxCents: siteSettings.tipMaxCents,
          connectLabel: siteSettings.connectLabel,
          streamLabel: siteSettings.streamLabel,
          ...overrides
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save.');
      await loadSiteSettings();
      setSiteSettingsSaved(true);
      setTimeout(() => setSiteSettingsSaved(false), 2500);
    } catch (err) {
      setSiteSettingsError(err.message);
    } finally {
      setSiteSettingsSaving(false);
    }
  }

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read that file.'));
      reader.readAsDataURL(file);
    });
  }

  async function uploadLogo(file) {
    setSiteSettingsSaving(true);
    setSiteSettingsError(null);
    try {
      const logoBase64 = await readAsDataUrl(file);
      const res = await fetch('/api/admin/site-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Only these two fields — the API only ever touches a field it
        // actually receives.
        body: JSON.stringify({ logoBase64, logoFileName: file.name })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not upload that image.');
      await loadSiteSettings();
    } catch (err) {
      setSiteSettingsError(err.message);
    } finally {
      setSiteSettingsSaving(false);
    }
  }

  async function generatePlaceholders() {
    setPlaceholderBusy(true);
    setPlaceholderError(null);
    setPlaceholderResult(null);
    try {
      const res = await fetch('/api/admin/placeholder-content', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not generate placeholder content.');
      setPlaceholderResult(`Created ${data.created.length} items: ${data.created.map((c) => c.contentType).join(', ')}. Check the homepage and browse pages now.`);
    } catch (err) {
      setPlaceholderError(err.message);
    } finally {
      setPlaceholderBusy(false);
    }
  }

  const dirty = (keys) => confirmedSiteSettings && keys.some((k) => siteSettings[k] !== confirmedSiteSettings[k]);
  const rowStyle = { borderTop: '1px solid rgba(251,232,211,0.1)', padding: '0.9rem 0' };
  const unsaved = <div style={{ fontSize: '0.74rem', color: 'var(--signal-amber)', marginTop: '0.4rem' }}>Unsaved changes — click Save below to apply.</div>;

  if (!siteSettings) return <p>Loading…</p>;

  return (
    <>
      <div className="account-card">
        <div className="account-eyebrow">Header &amp; links</div>
        {siteSettingsError && <p style={{ color: 'var(--danger)' }}>{siteSettingsError}</p>}

        <div style={rowStyle}>
          <label style={{ display: 'block', marginBottom: '0.4rem' }}>Connect / Stream kicker</label>
          <p style={{ fontSize: '0.78rem', color: 'var(--ink-dim)', marginBottom: '0.6rem' }}>
            The small label under the logo that tells the two halves of the site apart. Shows
            &ldquo;{siteSettings.connectLabel || 'Connect'}&rdquo; on the community/discovery side and
            &ldquo;{siteSettings.streamLabel || 'Stream'}&rdquo; on the watch library. One change here updates it everywhere.
          </p>
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 160px' }}>
              <label style={{ display: 'block', fontSize: '0.74rem', color: 'var(--ink-dim)', marginBottom: '0.2rem' }}>Connect-side label</label>
              <input type="text" placeholder="Connect" value={siteSettings.connectLabel || ''} onChange={(e) => setSiteSettings((s) => ({ ...s, connectLabel: e.target.value }))} />
            </div>
            <div style={{ flex: '1 1 160px' }}>
              <label style={{ display: 'block', fontSize: '0.74rem', color: 'var(--ink-dim)', marginBottom: '0.2rem' }}>Stream-side label</label>
              <input type="text" placeholder="Stream" value={siteSettings.streamLabel || ''} onChange={(e) => setSiteSettings((s) => ({ ...s, streamLabel: e.target.value }))} />
            </div>
          </div>
          {dirty(['connectLabel', 'streamLabel']) && unsaved}
        </div>

        <div style={rowStyle}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.6rem' }}>
            <input type="checkbox" checked={siteSettings.shopEnabled} onChange={(e) => setSiteSettings((s) => ({ ...s, shopEnabled: e.target.checked }))} />
            Show &ldquo;Shop&rdquo; link in the header (opens in a new tab)
            {confirmedSiteSettings && confirmedSiteSettings.shopEnabled && confirmedSiteSettings.shopUrl && (
              <span style={{ color: 'var(--brass)', fontSize: '0.74rem', fontWeight: 700 }}>✓ Connected</span>
            )}
          </label>
          <p style={{ fontSize: '0.78rem', color: 'var(--ink-dim)', marginBottom: '0.4rem' }}>
            Any full URL works here. Point it at Shopify, Etsy, a Linktree, wherever your storefront actually lives.
          </p>
          <input type="url" placeholder="https://your-store.example.com" value={siteSettings.shopUrl || ''} onChange={(e) => setSiteSettings((s) => ({ ...s, shopUrl: e.target.value }))} style={{ marginBottom: '0.4rem' }} />
          {dirty(['shopUrl', 'shopEnabled']) && unsaved}
        </div>

        {[
          ['liveTvEnabled', 'Show “Live TV” link in the header'],
          ['verticalEnabled', 'Show “Vertical” link in the header'],
          ['podcastsEnabled', 'Show “Podcasts” link in the header'],
          ['elevatorPitchEnabled', 'Show “Pitch Room” link in the header (projects seeking funding — no money changes hands on Studio Tapa itself)']
        ].map(([key, label]) => (
          <div key={key} style={rowStyle}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={Boolean(siteSettings[key])} onChange={(e) => setSiteSettings((s) => ({ ...s, [key]: e.target.checked }))} />
              {label}
            </label>
          </div>
        ))}

        <div style={rowStyle}>
          <label style={{ display: 'block', marginBottom: '0.4rem' }}>My Recs — closeness ({siteSettings.recommendationCloseness}/10)</label>
          <p style={{ fontSize: '0.78rem', color: 'var(--ink-dim)', marginBottom: '0.5rem' }}>
            0 = wide exploration, mostly outside someone&rsquo;s usual pattern. 10 = closely matches their genre/artist history. Applies to everyone&rsquo;s &ldquo;My Recs&rdquo; page.
          </p>
          <input type="range" min="0" max="10" step="1" value={siteSettings.recommendationCloseness} onChange={(e) => setSiteSettings((s) => ({ ...s, recommendationCloseness: Number(e.target.value) }))} style={{ width: '100%' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', color: 'var(--ink-dim)' }}>
            <span>Explore (0)</span><span>Close match (10)</span>
          </div>
        </div>

        <div style={rowStyle}>
          <label style={{ display: 'block', marginBottom: '0.4rem' }}>Ad billing rate — default CPM (dollars per 1,000 impressions)</label>
          <p style={{ fontSize: '0.78rem', color: 'var(--ink-dim)', marginBottom: '0.5rem' }}>
            Only the default an advertiser&rsquo;s ad starts with when you review it — you can still set a different rate per ad. Never affects an ad already approved.
          </p>
          <input type="number" min="0" step="0.01" value={(siteSettings.adCpmCents / 100).toFixed(2)} onChange={(e) => setSiteSettings((s) => ({ ...s, adCpmCents: Math.round(Number(e.target.value) * 100) }))} style={{ maxWidth: '140px' }} />
        </div>

        <div style={rowStyle}>
          <label style={{ display: 'block', marginBottom: '0.4rem' }}>Ad plans — exact section sizes (seconds)</label>
          <p style={{ fontSize: '0.78rem', color: 'var(--ink-dim)', marginBottom: '0.5rem' }}>
            The lengths the Episode Ad Curator offers as exact sections, and the lengths advertisers are steered to. Comma-separated; add longer ones here when you want them.
          </p>
          <input type="text" value={Array.isArray(siteSettings.adSectionSizes) ? siteSettings.adSectionSizes.join(', ') : ''} onChange={(e) => setSiteSettings((s) => ({ ...s, adSectionSizes: e.target.value.split(/[,\s]+/).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0) }))} placeholder="10, 15, 20, 30" style={{ maxWidth: '260px' }} />
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '0.7rem' }}>
            <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.78rem', color: 'var(--ink-dim)' }}>
              Ads per hour on a channel (minutes)
              <input type="number" min="1" max="60" value={Math.round((siteSettings.adHourCapSeconds || 900) / 60)} onChange={(e) => setSiteSettings((s) => ({ ...s, adHourCapSeconds: Math.round(Number(e.target.value) * 60) }))} style={{ maxWidth: '120px' }} />
            </label>
            <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.78rem', color: 'var(--ink-dim)' }}>
              Round each break to
              <select value={siteSettings.adBreakRoundSeconds || 15} onChange={(e) => setSiteSettings((s) => ({ ...s, adBreakRoundSeconds: Number(e.target.value) }))} style={{ maxWidth: '140px' }}>
                {[5, 10, 15, 30, 60].map((r) => <option key={r} value={r}>{r} seconds</option>)}
              </select>
            </label>
          </div>
        </div>

        <div style={rowStyle}>
          <label style={{ display: 'block', marginBottom: '0.4rem' }}>Tips — the studio&rsquo;s cut, the most it keeps from one tip, the biggest tip</label>
          <p style={{ fontSize: '0.78rem', color: 'var(--ink-dim)', marginBottom: '0.5rem' }}>
            The fan covers the card fee on top, so the creator keeps the tip minus the cut; the cut is the percentage but never more than the cap. Changes apply to the next tip (paid tips keep the cut they were priced with) and the Terms print these live. Presets stay $3 / $5 / $10; the biggest tip is what Custom allows.
          </p>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.78rem', color: 'var(--ink-dim)' }}>
              Cut (%)
              <input type="number" min="0" max="30" step="0.5" value={siteSettings.tipPlatformCutPercent ?? 5} onChange={(e) => setSiteSettings((s) => ({ ...s, tipPlatformCutPercent: Number(e.target.value) }))} style={{ maxWidth: '120px' }} />
            </label>
            <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.78rem', color: 'var(--ink-dim)' }}>
              Most kept from one tip (dollars)
              <input type="number" min="1" max="10000" step="1" value={Math.round((siteSettings.tipCutMaxCents ?? 10000) / 100)} onChange={(e) => setSiteSettings((s) => ({ ...s, tipCutMaxCents: Math.round(Number(e.target.value) * 100) }))} style={{ maxWidth: '140px' }} />
            </label>
            <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.78rem', color: 'var(--ink-dim)' }}>
              Biggest tip (dollars)
              <input type="number" min="5" max="10000" step="1" value={Math.round((siteSettings.tipMaxCents || 50000) / 100)} onChange={(e) => setSiteSettings((s) => ({ ...s, tipMaxCents: Math.round(Number(e.target.value) * 100) }))} style={{ maxWidth: '140px' }} />
            </label>
          </div>
          <p style={{ fontSize: '0.74rem', color: 'var(--ink-faint)', marginTop: '0.5rem', marginBottom: 0 }}>
            With these numbers the cap starts to matter at a {dollarsFromCents(Math.round((siteSettings.tipCutMaxCents ?? 10000) * 100 / Math.max(0.1, siteSettings.tipPlatformCutPercent ?? 5)))} tip{(siteSettings.tipCutMaxCents ?? 10000) * 100 / Math.max(0.1, siteSettings.tipPlatformCutPercent ?? 5) > (siteSettings.tipMaxCents || 50000) ? ', above the biggest tip allowed, so it never applies' : ''}. A disputed tip is taken back from the creator, so the biggest tip is also the studio&rsquo;s exposure if that account is empty by then.
          </p>
        </div>

        <div style={rowStyle}>
          <label style={{ display: 'block', marginBottom: '0.4rem' }}>Crew pay — the studio&rsquo;s service fee on secured pay</label>
          <p style={{ fontSize: '0.78rem', color: 'var(--ink-dim)', marginBottom: '0.5rem' }}>
            On a paid crew call with &ldquo;pay secured&rdquo;, the poster funds each booked person at the posted rate; the fee and the card processing are added on top, so the crew member gets the full rate. Held by the studio until the poster confirms they worked. Changes apply to the next payment.
          </p>
          <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.78rem', color: 'var(--ink-dim)' }}>
            Fee (%)
            <input type="number" min="0" max="30" step="0.5" value={siteSettings.crewPayCutPercent ?? 8} onChange={(e) => setSiteSettings((s) => ({ ...s, crewPayCutPercent: Number(e.target.value) }))} style={{ maxWidth: '120px' }} />
          </label>
          <p style={{ fontSize: '0.74rem', color: 'var(--ink-faint)', marginTop: '0.5rem', marginBottom: 0 }}>
            A $350 job costs the poster {dollarsFromCents(Math.round(35000 * (1 + (siteSettings.crewPayCutPercent ?? 8) / 100)))} plus card processing; the crew member receives $350. Refunds (no-show, cancelled) go back to the poster from the held money; the studio eats Stripe&rsquo;s processing fee on a full refund.
          </p>
        </div>

        <button className="account-btn-primary" style={{ width: 'auto', marginTop: '0.4rem' }} onClick={() => saveSiteSettings()} disabled={siteSettingsSaving}>
          {siteSettingsSaving ? 'Saving…' : 'Save'}
        </button>
        {siteSettingsSaved && <span style={{ marginLeft: '0.8rem', color: 'var(--brass)' }}>Saved.</span>}
      </div>

      <div className="account-card">
        <div className="account-eyebrow">Site logo</div>
        <p style={{ fontSize: '0.78rem', color: 'var(--ink-dim)', marginBottom: '0.6rem' }}>
          Replace the plain &ldquo;ST&rdquo; text badge in the header with your actual logo. Square or wide images both work — it renders at a fixed height in the nav bar either way.
          The favicon, app icon and every other icon live in <Link href="/admin/styles?tab=icons">Styles &amp; Guides</Link>.
        </p>
        {siteSettings.logoUrl && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '0.6rem' }}>
            <Image src={siteSettings.logoUrl} alt="" width={120} height={32} style={{ height: 32, width: 'auto', maxWidth: 120 }} />
            <button className="account-btn-secondary" style={{ width: 'auto' }} onClick={() => saveSiteSettings({ clearLogo: true })} disabled={siteSettingsSaving}>
              Reset to &ldquo;ST&rdquo; text
            </button>
          </div>
        )}
        <input type="file" accept="image/*" onChange={(e) => e.target.files[0] && uploadLogo(e.target.files[0])} disabled={siteSettingsSaving} />
      </div>

      <div className="account-card">
        <div className="account-eyebrow">Placeholder content</div>
        <p style={{ fontSize: '0.78rem', color: 'var(--ink-dim)', marginBottom: '0.6rem' }}>
          Generate one sample item for each content type so you can see how every type looks across the site without hand-creating test content.
          None have a real video behind them, so playback won&rsquo;t work. Every title is marked &ldquo;[Placeholder]&rdquo; and visible to real visitors while it exists, so remove it when you&rsquo;re done (Content &rarr; Test content).
        </p>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
          <button className="account-btn-secondary" style={{ width: 'auto' }} onClick={generatePlaceholders} disabled={placeholderBusy}>
            {placeholderBusy ? 'Working…' : 'Generate placeholder content'}
          </button>
          <a className="account-btn-secondary" style={{ width: 'auto', textDecoration: 'none' }} href="/admin/test-content">Remove them in Test content</a>
        </div>
        {placeholderResult && <p style={{ fontSize: '0.82rem', color: 'var(--brass)' }}>{placeholderResult}</p>}
        {placeholderError && <p style={{ fontSize: '0.82rem', color: 'var(--danger)' }}>{placeholderError}</p>}
      </div>

      <div className="account-card">
        <div className="account-eyebrow">Newsletter signups</div>
        <p style={{ fontSize: '0.78rem', color: 'var(--ink-dim)', marginBottom: '0.6rem' }}>
          {newsletterCount === null ? 'Loading…' : `${newsletterCount} signup${newsletterCount === 1 ? '' : 's'} collected via the footer form.`}
          {' '}Stored here regardless of whether an email-sending provider is connected yet.
          {newsletterEspConfigured === false && ' None have synced to an ESP yet — set BREVO_API_KEY in Vercel once you’ve created a Brevo account to start auto-syncing new signups.'}
        </p>
        <a href="/api/admin/newsletter-signups?format=csv" className="account-btn-secondary" style={{ width: 'auto', display: 'inline-block', textDecoration: 'none' }}>
          Download CSV
        </a>
      </div>

      <ProtectionCard />

      <div className="account-card">
        <div className="account-eyebrow">Quick links</div>
        <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)', marginBottom: '1rem' }}>
          Toggle-able pages stay open to admins even when their toggle above is off, so you can check how a disabled page looks before turning it on for everyone.
        </p>
        <div className="admin-quicklinks-grid">
          <Link href="/stream" className="account-quicklink">Home</Link>
          <Link href="/type/series" className="account-quicklink">Series</Link>
          <Link href="/type/movie" className="account-quicklink">Films</Link>
          <Link href="/type/vertical" className="account-quicklink">Vertical</Link>
          <Link href="/podcasts" className="account-quicklink">Podcasts</Link>
          <Link href="/pitches" className="account-quicklink">Pitch Room{!siteSettings.elevatorPitchEnabled ? ' (off)' : ''}</Link>
          <Link href="/pitches/discover" className="account-quicklink">Pitch Discover</Link>
          <Link href="/vertical/discover" className="account-quicklink">Vertical Discover</Link>
          <Link href="/live" className="account-quicklink">Live TV{!siteSettings.liveTvEnabled ? ' (off)' : ''}</Link>
          <Link href="/university" className="account-quicklink">Film University</Link>
          <Link href="/admin/university" className="account-quicklink">Edit Film University</Link>
          <Link href="/apply" className="account-quicklink">Apply (creator)</Link>
          <Link href="/creator" className="account-quicklink">Creator Studio</Link>
          <Link href="/creator/my-work" className="account-quicklink">Your work</Link>
        </div>
      </div>
    </>
  );
}

// Keeping creators' work off the open web (Jose, 2026-10-25). What new
// uploads do by themselves, applied once to what was uploaded before:
// every Cloudflare Stream video demands a signed URL whatever its tier
// (lib/streamProtection.js), caption tracks live in the private bucket
// and play through /api/captions/<id> (lib/captionUpload.js), and Film
// University files open through one-hour signed links from a private
// bucket (lib/universityDocs.js). Each button is safe to press again.
function ProtectionCard() {
  const dim = { fontSize: '0.8rem', color: 'var(--ink-dim)' };
  return (
    <div className="account-card" data-testid="protection-card">
      <div className="account-eyebrow">Protection</div>
      <p style={{ ...dim, marginBottom: '0.75rem' }}>
        Creators&rsquo; work stays off permanent public URLs: videos play through short-lived signed links, captions through a gated route, course files through one-hour links. New uploads are handled as they land; these buttons bring what was uploaded before in line, and can be pressed again any time.
      </p>
      <ProtectionAction
        label="Protect every video"
        busyLabel="Protecting…"
        url="/api/admin/sync-stream-protection"
        blurb="Turns signed URLs on for every Cloudflare Stream video, free titles included. Press again if Cloudflare was unreachable during an approval."
        render={(result) => (
          <>
            <p style={{ margin: 0 }}>Protected {result.videos} video{result.videos === 1 ? '' : 's'} across {result.protected} title{result.protected === 1 ? '' : 's'}; {result.skipped} without a Cloudflare video; {result.failures.length} failed.</p>
            {result.failures.length > 0 && <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem' }}>{result.failures.map((f) => <li key={f.id}>{f.title}: {f.error}</li>)}</ul>}
            {result.university && (
              <p style={{ margin: '0.4rem 0 0' }}>Film University: {result.university.videos} video{result.university.videos === 1 ? '' : 's'} protected, {result.university.framesReplaced} Cloudflare frame{result.university.framesReplaced === 1 ? '' : 's'} stored as real thumbnails{result.university.failures.length ? `, ${result.university.failures.length} failed: ${result.university.failures.map((f) => `${f.title} (${f.error})`).join('; ')}` : ''}.</p>
            )}
            {result.cloudflarePosters.length > 0 && (
              <p style={{ margin: '0.5rem 0 0', color: 'var(--warn)' }}>
                {result.cloudflarePosters.length} title{result.cloudflarePosters.length === 1 ? ' uses' : 's use'} Cloudflare&rsquo;s frame grab as a poster and need{result.cloudflarePosters.length === 1 ? 's' : ''} a real one uploaded: {result.cloudflarePosters.map((p) => p.title).join(', ')}.
              </p>
            )}
          </>
        )}
      />
      <ProtectionAction
        label="Move captions to private storage"
        busyLabel="Moving…"
        url="/api/admin/protect-media"
        body={{ what: 'captions' }}
        blurb="A caption track is the title's dialogue as text. New tracks go straight to the private bucket; this moves the ones uploaded before and removes their public copies."
        render={(result) => (
          <>
            <p style={{ margin: 0 }}>Moved {result.moved}; {result.alreadyPrivate} already private; {result.skipped.length} hosted elsewhere; {result.failures.length} failed.</p>
            {result.failures.length > 0 && <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem' }}>{result.failures.map((f) => <li key={f.id}>{f.title}: {f.error}</li>)}</ul>}
          </>
        )}
      />
      <ProtectionAction
        label="Lock University files"
        busyLabel="Locking…"
        url="/api/admin/protect-media"
        body={{ what: 'university' }}
        blurb="Makes the Film University bucket private. Readings and course files keep working: pages open them through one-hour signed links."
        render={(result) => (
          <p style={{ margin: 0 }}>{result.wasPublic ? 'The bucket was public and is now private.' : result.existed ? 'The bucket was already private.' : 'Created the bucket private.'}</p>
        )}
      />
    </div>
  );
}

function ProtectionAction({ label, busyLabel, url, body, blurb, render }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(url, { method: 'POST', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not finish.');
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ borderTop: '1px solid var(--line)', paddingTop: '0.75rem', marginTop: '0.75rem' }}>
      <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)', margin: '0 0 0.5rem' }}>{blurb}</p>
      <button type="button" className="account-btn-secondary" style={{ width: 'auto' }} onClick={run} disabled={busy}>
        {busy ? busyLabel : label}
      </button>
      {error && <p style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: '0.6rem' }}>{error}</p>}
      {result && <div style={{ fontSize: '0.8rem', color: 'var(--ink-dim)', marginTop: '0.6rem' }}>{render(result)}</div>}
    </div>
  );
}
