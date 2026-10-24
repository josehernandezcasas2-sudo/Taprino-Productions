import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AdminShell from '../../components/AdminShell';
import { adminPageProps } from '../../lib/adminPage';
import { SCOPES, untilLabel } from '../../lib/suspensionRules';

// People → Accounts (Jose, 2026-10-24; canvas "Suspension, push and ad
// share", Admin board; migration 102, lib/suspensions.js). Find anyone,
// see what the team has flagged about them, suspend (the whole account,
// or tips only) with the line they'll read, lift. Suspension is the
// site's own, not Clerk's: nothing is deleted and they can still sign
// in to read why (/suspended; the app's gate). Full admins only.
// ?user=<id> opens that person (the "Suspend account" link on /admin/tips).
export async function getServerSideProps(ctx) {
  return adminPageProps(ctx);
}

async function call(path, method, body) {
  const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const H = ({ children, aside }) => (
  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', margin: '0 0 0.5rem' }}>
    <h3 style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink-faint)', margin: 0 }}>{children}</h3>
    {aside}
  </div>
);
const statePill = (s) => (s ? <span className={`payouts-pill ${s.scope === 'all' ? 'failed' : 'held'}`}>{s.scope === 'all' ? 'Suspended' : 'Tips blocked'} · {untilLabel(s.until)}</span> : null);

export default function AccountsAdmin({ account, mainGenres, apiPath = '/api/admin/accounts' }) {
  const router = useRouter();
  const [overview, setOverview] = useState(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [card, setCard] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [form, setForm] = useState({ scope: 'all', publicReason: '', note: '', untilAt: '', cancelMembership: true });
  const [liftNote, setLiftNote] = useState('');
  const searchTimer = useRef(null);

  async function loadOverview() {
    try { setOverview(await call(apiPath, 'GET')); setError(null); } catch (err) { setError(err.message); }
  }
  async function open(userId) {
    if (!userId) return;
    setBusy(`open:${userId}`);
    try {
      const out = await call(`${apiPath}?user=${encodeURIComponent(userId)}`, 'GET');
      setCard(out.account);
      setError(null);
      setForm({ scope: 'all', publicReason: '', note: '', untilAt: '', cancelMembership: true });
      setLiftNote('');
      // Keep the person in the URL (shareable; the link from /admin/tips).
      if (router.query.user !== userId) router.replace({ pathname: router.pathname, query: { ...router.query, user: userId } }, undefined, { shallow: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }
  useEffect(() => { loadOverview(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (router.isReady && typeof router.query.user === 'string' && router.query.user && !card) open(router.query.user);
  }, [router.isReady, router.query.user]); // eslint-disable-line react-hooks/exhaustive-deps

  function search(value) {
    setQ(value);
    clearTimeout(searchTimer.current);
    const needle = value.trim();
    if (!needle) { setResults(null); return; }
    searchTimer.current = setTimeout(async () => {
      try { setResults((await call(`${apiPath}?q=${encodeURIComponent(needle)}`, 'GET')).results); } catch (err) { setError(err.message); }
    }, 250);
  }

  async function act(key, body, done) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const out = await call(apiPath, 'POST', body);
      setNotice(typeof done === 'function' ? done(out) : done);
      if (out.account) setCard(out.account);
      await loadOverview();
      return out;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(null);
    }
  }
  async function suspend(e) {
    e.preventDefault();
    if (!card) return;
    const who = card.displayName;
    const what = form.scope === 'all' ? `Suspend ${who}'s whole account` : `Block ${who} from tipping`;
    if (!window.confirm(`${what} ${form.untilAt ? `until ${form.untilAt}` : 'until lifted'}? They get an email now with the line you wrote.`)) return;
    const out = await act('suspend', { action: 'suspend', userId: card.userId, ...form }, (o) => (o.suspension.scope === 'all' ? `${who} is suspended.${o.membership && o.membership.changed ? ' Their membership stops at the end of the period.' : ''}${o.payoutsHeld ? ' Their payouts are on hold.' : ''}` : `${who} can’t tip any more.`));
    if (out) setForm({ scope: 'all', publicReason: '', note: '', untilAt: '', cancelMembership: true });
  }
  const lift = () => {
    if (!card || !window.confirm(`Lift everything in force for ${card.displayName}? They get an email.`)) return;
    act('lift', { action: 'lift', userId: card.userId, note: liftNote }, (o) => `Lifted. ${card.displayName} is back.${o.payoutsReleased ? ' Their payouts are back on.' : ''}`);
  };

  const counts = card ? card.counts : null;
  return (
    <AdminShell title="Accounts" account={account} mainGenres={mainGenres} crumbs={['People']} intro="Find anyone, see what the team has flagged, suspend or lift. Suspension is ours, not Clerk’s: nothing is deleted and they can still sign in to read why.">
      {error && <div className="crew-status error" style={{ marginBottom: '0.8rem' }}>{error}</div>}
      {notice && <div className="crew-status ok" style={{ marginBottom: '0.8rem' }}>{notice}</div>}
      {overview && !overview.available && <div className="crew-panel" style={{ marginBottom: '1rem' }}>Run migration 102 (suspensions and push tokens) in Supabase first.</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: '1.2rem', alignItems: 'start' }} className="accounts-grid">
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div className="crew-panel" style={{ display: 'flex', gap: '0.8rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="search" className="crew-input" value={q} onChange={(e) => search(e.target.value)} placeholder="name, @handle or user_… id" aria-label="Search accounts" style={{ flex: 1, minWidth: 220 }} />
            <span className="crew-mono">Emails live in Clerk: search there for an address, then paste the user id.</span>
          </div>

          {results && (
            <div className="crew-panel" style={{ display: 'grid', gap: '0.3rem' }}>
              <H>{results.length} match{results.length === 1 ? '' : 'es'}</H>
              {results.length === 0 && <div className="crew-mono">Nobody by that name. A user_… id works even without a profile.</div>}
              {results.map((r) => (
                <button key={r.userId} type="button" className="crew-btn ghost" style={{ justifyContent: 'space-between', textAlign: 'left', background: card && card.userId === r.userId ? 'rgba(var(--brass-rgb), 0.12)' : undefined }} disabled={busy !== null} onClick={() => open(r.userId)}>
                  <span><b>{r.displayName}</b> <span className="crew-mono">{r.handle ? `@${r.handle} · ` : ''}{r.joinedAt ? `joined ${fmt(r.joinedAt)}` : r.userId}</span></span>
                </button>
              ))}
            </div>
          )}

          {card && (
            <div className="crew-panel" style={{ display: 'grid', gap: '1rem' }} data-testid="account-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.8rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 700 }}>{card.displayName}</div>
                  <div className="crew-mono">
                    {card.handle ? `@${card.handle} · ` : ''}{card.email ? `${card.email} · ` : ''}{card.userId} · {card.role || 'viewer'}{card.joinedAt ? ` · joined ${fmt(card.joinedAt)}` : ''}{card.payoutsReady ? ' · payouts ready' : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {statePill(card.current)}
                  {card.payoutHold && <span className="payouts-pill held" title={card.payoutHold.reason || ''}>Payouts on hold{card.payoutHold.until ? ` · to ${fmt(card.payoutHold.until)}` : ''}</span>}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '0.5rem' }}>
                <Stat n={counts.tipsSent} label="tips sent" />
                <Stat n={counts.tipsReceived} label="tips received" />
                <Stat n={counts.profileReports} label="profile reports" warn={counts.profileReports > 0} />
                <Stat n={counts.noteReports} label="tip notes reported" warn={counts.noteReports > 0} />
                <Stat n={counts.messageReports} label="message reports" warn={counts.messageReports > 0} />
              </div>
              <div className="crew-mono" style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap' }}>
                <span>Open:</span>
                <Link href={`/profile/${card.handle || card.userId}`}>profile</Link>
                <Link href="/admin/tips">tips</Link>
                <Link href="/admin/messages">message reports</Link>
                <Link href="/admin/audit-log">audit log</Link>
              </div>

              {card.isAdmin ? (
                <div className="crew-status" style={{ margin: 0 }}>A full admin can’t be suspended from here: change their role on Team &amp; roles first.</div>
              ) : (
                <form onSubmit={suspend} style={{ display: 'grid', gap: '0.7rem', borderTop: '1px solid var(--ocean-ink)', paddingTop: '0.9rem' }}>
                  <H>Suspend</H>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.6rem' }}>
                    {Object.entries(SCOPES).map(([key, s]) => (
                      <label key={key} style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', padding: '0.7rem 0.8rem', borderRadius: 10, border: `1px solid ${form.scope === key ? 'var(--brass)' : 'var(--ocean-ink)'}`, background: form.scope === key ? 'rgba(var(--brass-rgb), 0.08)' : 'transparent', cursor: 'pointer' }}>
                        <input type="radio" name="scope" value={key} checked={form.scope === key} onChange={() => setForm((f) => ({ ...f, scope: key }))} style={{ marginTop: 4 }} />
                        <span><b>{s.label}</b><br /><span className="crew-mono">{s.blurb}</span></span>
                      </label>
                    ))}
                  </div>
                  <label className="crew-field"><span>What they’ll see (the card and the email)</span>
                    <textarea className="crew-input" rows={2} required minLength={8} maxLength={400} value={form.publicReason} onChange={(e) => setForm((f) => ({ ...f, publicReason: e.target.value }))} placeholder="Repeated abusive notes sent with tips after a warning." />
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 180px', gap: '0.6rem' }}>
                    <label className="crew-field"><span>Note for the team (never shown)</span>
                      <input className="crew-input" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} maxLength={1000} placeholder="Reports #412 and #418; warned on Oct 12" />
                    </label>
                    <label className="crew-field"><span>Until (blank = until lifted)</span>
                      <input className="crew-input" type="date" value={form.untilAt} onChange={(e) => setForm((f) => ({ ...f, untilAt: e.target.value }))} />
                    </label>
                  </div>
                  {form.scope === 'all' && (
                    <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.92rem' }}>
                      <input type="checkbox" checked={form.cancelMembership} onChange={(e) => setForm((f) => ({ ...f, cancelMembership: e.target.checked }))} />
                      Stop the membership renewing while it lasts <span className="crew-mono">(Stripe: cancel at period end)</span>
                    </label>
                  )}
                  {form.scope === 'all' && (card.role === 'creator' || card.role === 'content_scheduler') && (
                    <span className="crew-mono">A creator&rsquo;s Creator Share payouts go on hold with the suspension (90 days at most) and come back when it lifts.</span>
                  )}
                  <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <button type="submit" className="crew-btn" style={{ background: 'var(--danger)', borderColor: 'var(--danger)', color: '#2a0909', fontWeight: 700 }} disabled={busy !== null || form.publicReason.trim().length < 8}>{busy === 'suspend' ? 'Suspending…' : form.scope === 'all' ? `Suspend ${card.displayName.split(' ')[0]}` : `Block ${card.displayName.split(' ')[0]} from tipping`}</button>
                    <span className="crew-mono">They get an email now and a notification. Logged in the audit log.</span>
                  </div>
                </form>
              )}

              {card.current && (
                <div style={{ display: 'grid', gap: '0.5rem', borderTop: '1px solid var(--ocean-ink)', paddingTop: '0.9rem' }}>
                  <H>In force now</H>
                  {card.history.filter((h) => !h.liftedAt && (!h.untilAt || new Date(h.untilAt) > new Date())).map((h) => (
                    <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.8rem', flexWrap: 'wrap', alignItems: 'center', padding: '0.6rem 0.8rem', borderRadius: 10, background: 'var(--surface-0)' }}>
                      <span style={{ fontSize: '0.92rem' }}>
                        <b>{SCOPES[h.scope] ? SCOPES[h.scope].label : h.scope}</b> · since {fmt(h.createdAt)} · {untilLabel(h.untilAt)} · by {h.createdByEmail || h.createdBy} · “{h.publicReason}”
                        {h.note ? <span className="crew-mono"> · team: {h.note}</span> : null}
                      </span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <input className="crew-input" value={liftNote} onChange={(e) => setLiftNote(e.target.value)} maxLength={500} placeholder="Why (for the record, optional)" style={{ flex: 1, minWidth: 200 }} />
                    <button type="button" className="crew-btn" disabled={busy !== null} onClick={lift}>{busy === 'lift' ? 'Lifting…' : 'Lift'}</button>
                  </div>
                </div>
              )}

              {card.history.length > 0 && (
                <div style={{ display: 'grid', gap: '0.3rem', borderTop: '1px solid var(--ocean-ink)', paddingTop: '0.9rem' }}>
                  <H>History</H>
                  {card.history.map((h) => (
                    <div key={h.id} className="crew-mono">
                      {fmt(h.createdAt)} · {SCOPES[h.scope] ? SCOPES[h.scope].label.toLowerCase() : h.scope} · {untilLabel(h.untilAt)} · by {h.createdByEmail || h.createdBy} · {h.liftedAt ? `lifted ${fmt(h.liftedAt)}${h.liftNote ? ` (“${h.liftNote}”)` : ''}` : h.untilAt && new Date(h.untilAt) <= new Date() ? 'ran out' : 'in force'}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gap: '1rem' }}>
          <div className="crew-panel" style={{ display: 'grid', gap: '0.5rem' }}>
            <H>Suspended now · {overview ? overview.active.length : '…'}</H>
            {overview && overview.active.length === 0 && <div className="crew-mono">Nobody.</div>}
            {overview && overview.active.map((s) => (
              <button key={s.id} type="button" className="crew-btn ghost" style={{ justifyContent: 'space-between', textAlign: 'left' }} disabled={busy !== null} onClick={() => open(s.userId)}>
                <span><b>{s.displayName}</b><br /><span className="crew-mono">{SCOPES[s.scope] ? SCOPES[s.scope].short.toLowerCase() : s.scope} · {untilLabel(s.untilAt)}</span></span>
                <span className={`payouts-pill ${s.scope === 'all' ? 'failed' : 'held'}`}>{SCOPES[s.scope] ? SCOPES[s.scope].short : s.scope}</span>
              </button>
            ))}
          </div>
          <div className="crew-panel" style={{ display: 'grid', gap: '0.4rem' }}>
            <H>How it holds</H>
            <div style={{ fontSize: '0.86rem', lineHeight: 1.5, color: 'var(--ink-dim)' }}>Every page load and every write checks the table (cached a minute). The web bounces to <span className="crew-mono">/suspended</span>, the app shows its gate, API writes answer 403. Tips only: the Tip button disappears for them. A full admin can’t be suspended from here.</div>
          </div>
          {overview && overview.recent.length > 0 && (
            <div className="crew-panel" style={{ display: 'grid', gap: '0.3rem' }}>
              <H>Recent</H>
              {overview.recent.slice(0, 12).map((s) => (
                <div key={s.id} className="crew-mono">{fmt(s.createdAt)} · <button type="button" className="welcome-linkbtn" style={{ color: 'var(--ink)', fontFamily: 'inherit', fontSize: 'inherit' }} onClick={() => open(s.userId)}>{s.displayName}</button> · {s.scope === 'all' ? 'suspended' : 'tips blocked'}{s.liftedAt ? ` · lifted ${fmt(s.liftedAt)}` : ''}</div>
              ))}
            </div>
          )}
        </div>
      </div>
      <style jsx>{`
        @media (max-width: 900px) { .accounts-grid { grid-template-columns: 1fr !important; } }
      `}</style>
    </AdminShell>
  );
}

function Stat({ n, label, warn }) {
  return (
    <div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 700, color: warn ? 'var(--olive)' : 'var(--ink)' }}>{n}</div>
      <div className="crew-mono">{label}</div>
    </div>
  );
}
