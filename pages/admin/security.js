import { useState } from 'react';
import Link from 'next/link';
import AdminShell from '../../components/AdminShell';
import { adminPageProps } from '../../lib/adminPage';
import { CHECKLIST_ITEMS } from '../../lib/securityRules';
import { Card, Chip, Tile, SwitchRow, useSwitches, shortDay } from '../../components/admin/SecurityBits';

// Admin → Security (Jose, 2026-11-05; signed off on the canvas
// https://claude.ai/artifact/QaHCfmHVD764ti3WNy7ajC): who can get into
// the site and the admin, and the keys behind it. The switches are
// site_settings columns (migration 119) read by lib/securitySwitches.js;
// the rules are lib/securityRules.js. Full admins only.
export async function getServerSideProps(ctx) {
  return adminPageProps(ctx, {
    extra: async (account) => {
      const { getSecurityPage } = await import('../../lib/securityPage');
      return { data: await getSecurityPage({ userId: account.userId, twoFactorEnabled: account.twoFactorEnabled }) };
    }
  });
}

export default function AdminSecurity({ account, mainGenres, data }) {
  const { switches, busy, errors, flip } = useSwitches(data.switches);
  const team = data.team;
  const withTwoStep = team ? team.filter((t) => t.twoFactor).length : 0;
  const keysSet = data.keys.filter((k) => k.set).length;
  // Every key the site needs is set (an optional one may be left out).
  const keysOk = data.keys.every((k) => k.set || (k.optional && !k.invalid));
  const youHaveTwoStep = data.you.twoFactorEnabled;
  const missingTwoStep = team ? team.filter((t) => !t.twoFactor) : [];

  const door = switches.privateBeta;
  const search = switches.hideFromSearch;
  const twoStep = switches.adminRequire2fa;

  return (
    <AdminShell account={account} mainGenres={mainGenres} title="Security" crumbs={['Security']}
      intro="Who can get into the site and the admin, and the keys behind it. Every switch saves the moment you flip it and goes in the audit log.">
      {!switches.ready119 && (
        <p className="sec-banner" role="note">The switches on this page need a database update first: run migration 119 in the Supabase SQL Editor. Until then they read as they start: the door follows PRIVATE_BETA in Vercel, two-step follows ADMIN_REQUIRE_2FA, AI answer engines are blocked, and search engines are already kept out.</p>
      )}
      <div className="sec-tiles">
        <Tile label="The site" value={door.on ? 'Invited only' : 'Open to everyone'} tone={door.on ? 'ok' : 'warn'} />
        <Tile label="Search engines" value={search.inForce ? 'Kept out' : 'Allowed'} tone={search.inForce ? 'ok' : 'plain'} />
        <Tile label="Team two-step" value={team ? `${withTwoStep} of ${team.length} on` : '—'} tone={team && withTwoStep === team.length ? 'ok' : 'warn'} />
        <Tile label="Keys in Vercel" value={`${keysSet} of ${data.keys.length} set`} tone={keysOk ? 'ok' : 'plain'} />
      </div>

      <div className="sec-grid">
        <Card eyebrow="Site access" title="Who can see the site" id="sec-access">
          <p className="sec-p">The switches that decide whether a link to the site works for someone who isn&rsquo;t signed in.</p>
          <SwitchRow
            field="privateBeta" title="Private beta door" state={door} busy={busy} error={errors.privateBeta} onFlip={flip}
            lock={door.forced ? 'PRIVATE_BETA=on is set in Vercel, which keeps the door shut whatever this says. Remove the variable there to hand it to this switch.' : null}
          >
            <p className="sec-p">On: a visitor who isn&rsquo;t signed in lands on the welcome page from any link (a title, a profile, a pitch); only About, Contact, the legal pages, Apply and screeners stay open. Signed-in people see everything. Pages pick the change up within about half a minute.</p>
            <p className="sec-p"><a href="/welcome?preview=1" target="_blank" rel="noreferrer">Preview the door ↗</a> · <Link href="/admin/invites">Invites →</Link></p>
            <div className="sec-callout">
              <p className="sec-p small">Also set Clerk → Restrictions → Sign-up mode to <b>Restricted</b> while the door is shut, or anyone can still make an account from the sign-in box and walk in.</p>
            </div>
          </SwitchRow>
          <SwitchRow
            field="hideFromSearch" title="Keep out of search engines" state={search} toneOff="muted" busy={busy} error={errors.hideFromSearch} onFlip={flip}
          >
            <p className="sec-p">On: anyone with a link can still open the site, but every page tells Google, Bing and the rest not to list it, so what they listed drops out and nothing new goes in; the sitemap is withdrawn. Turn it off on launch day.</p>
            {door.on && !search.on && <p className="sec-note">The door is shut, so search engines are kept out anyway.</p>}
          </SwitchRow>
        </Card>

        <Card eyebrow="Admin access" title="Team two-step" id="sec-team">
          <p className="sec-p">Everyone who can open this admin, and whether their sign-in asks for a code from an authenticator app.</p>
          {team ? (
            <ul className="sec-team">
              {team.map((t) => (
                <li key={t.id}>
                  <span className="sec-avatar" aria-hidden="true">{(t.name || '?').slice(0, 1).toUpperCase()}</span>
                  <span className="sec-team-text">
                    <span className="sec-row-title"><span>{t.name}</span></span>
                    <span className="sec-p small">{t.role === 'admin' ? 'Admin' : `Sub-admin${t.permissions.length ? ` · ${t.permissions.length} permission${t.permissions.length === 1 ? '' : 's'}` : ''}`}{t.you ? ' · you' : ''}</span>
                  </span>
                  <Chip tone={t.twoFactor ? 'ok' : 'warn'}>{t.twoFactor ? 'Two-step on' : 'Two-step off'}</Chip>
                </li>
              ))}
            </ul>
          ) : (
            <p className="sec-error">Couldn&rsquo;t read the team from Clerk just now.</p>
          )}
          <SwitchRow
            field="adminRequire2fa" title="Require two-step for the team" state={twoStep} busy={busy} error={errors.adminRequire2fa} onFlip={flip}
            lock={twoStep.forced ? 'ADMIN_REQUIRE_2FA=on is set in Vercel, which keeps it on whatever this says.' : !twoStep.on && !youHaveTwoStep ? 'Turn two-step on for your own account first, so this can’t lock you out.' : null}
          >
            <p className="sec-p">On: a team account without two-step keeps its creator and member access but loses the admin until it turns two-step on (Account → Security). It can only be switched on from an account that has two-step itself.</p>
            {!twoStep.on && youHaveTwoStep && missingTwoStep.length > 0 && (
              <p className="sec-note">Turning it on takes the admin away from {missingTwoStep.map((t) => t.name).join(', ')} until they turn two-step on.</p>
            )}
            <p className="sec-p">
              {!youHaveTwoStep && <><Link href="/account/security?twostep=1">Turn two-step on for your account →</Link> · </>}
              <Link href="/admin/team">Team &amp; roles →</Link>
            </p>
          </SwitchRow>
        </Card>

        <Card eyebrow="Alerts" title="Security alerts" id="sec-alerts">
          <p className="sec-p">An email goes out when someone&rsquo;s role or permissions change, when the door, search engines or two-step switch here changes, and when a payment notice arrives that Stripe didn&rsquo;t sign (at most once an hour).</p>
          <div className="sec-kv">
            <div>
              <p className="sec-row-title"><span>Sent to</span></p>
              <p className="sec-p small">{data.alerts.to}{data.alerts.set ? '' : ' (the contact address; set SECURITY_ALERT_EMAIL in Vercel to send them elsewhere)'}</p>
            </div>
            <Chip tone={data.alerts.set ? 'ok' : 'muted'}>{data.alerts.set ? 'Set' : 'Default'}</Chip>
          </div>
          <p className="sec-label">Latest</p>
          {data.alerts.events.length ? (
            <ul className="sec-events">
              {data.alerts.events.map((e, i) => <li key={i}><span className="sec-when">{shortDay(e.at)}</span> {e.line}</li>)}
            </ul>
          ) : <p className="sec-p small">Nothing yet.</p>}
          <p className="sec-p"><Link href="/admin/audit-log">Audit log →</Link></p>
        </Card>

        <Card eyebrow="Keys" title="Keys and secrets in Vercel" id="sec-keys">
          <p className="sec-p">Whether each one is set. Names only: no value ever leaves Vercel.</p>
          {data.keys.map((k) => (
            <div className="sec-kv" key={k.id}>
              <div>
                <p className="sec-mono">{k.label}</p>
                <p className="sec-p small">{k.what}</p>
              </div>
              <Chip tone={k.set ? 'ok' : k.optional && !k.partly && !k.invalid ? 'muted' : 'warn'}>{k.set ? 'Set' : k.invalid ? 'Not a valid tag' : k.partly ? 'Half set' : 'Not set'}</Chip>
            </div>
          ))}
        </Card>

        <Card eyebrow="Browser" title="What every page tells the browser" id="sec-browser">
          <div className="sec-kv"><p className="sec-p small"><b>HTTPS only.</b> Browsers remember it for two years.</p><Chip tone="ok">On</Chip></div>
          <div className="sec-kv"><p className="sec-p small"><b>No framing.</b> Other sites can&rsquo;t put these pages inside theirs.</p><Chip tone="ok">On</Chip></div>
          <div className="sec-kv"><p className="sec-p small"><b>Cross-site writes refused.</b> Another site can&rsquo;t act as a signed-in person.</p><Chip tone="ok">On</Chip></div>
          <div className="sec-kv"><p className="sec-p small"><b>Full content policy.</b> Watching only: what it would block shows in Vercel&rsquo;s logs as &ldquo;CSP report-only&rdquo;. Switch it to enforcing once a couple of weeks show nothing new.</p><Chip tone="warn">Watching</Chip></div>
        </Card>

        <ChecklistCard initial={data.checklist} ready={data.checklistReady} />
      </div>
    </AdminShell>
  );
}

function ChecklistCard({ initial, ready }) {
  const [ticks, setTicks] = useState(initial || {});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  async function tick(key, value) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch('/api/admin/security', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ checklist: key, value }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Couldn’t save that.');
      setTicks(data.checklist || {});
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }
  const done = CHECKLIST_ITEMS.filter((i) => ticks[i.key]).length;
  return (
    <Card eyebrow="Outside this site" title="Done in other dashboards" id="sec-outside">
      <p className="sec-p">This page can&rsquo;t see these. Tick them as you go; the ticks are a note to yourself. {done} of {CHECKLIST_ITEMS.length} ticked.</p>
      {!ready && <p className="sec-note">Ticks are kept once migration 119 is in.</p>}
      <ul className="sec-checklist">
        {CHECKLIST_ITEMS.map((item) => (
          <li key={item.key}>
            <label>
              <input type="checkbox" checked={Boolean(ticks[item.key])} disabled={!ready || busy === item.key} onChange={(e) => tick(item.key, e.target.checked)} />
              <span className="sec-p small"><b>{item.title}:</b> {item.text}{item.href && <> <a href={item.href} target="_blank" rel="noreferrer">Open ↗</a></>}</span>
            </label>
          </li>
        ))}
      </ul>
      {error && <p className="sec-error" role="alert">{error}</p>}
    </Card>
  );
}
