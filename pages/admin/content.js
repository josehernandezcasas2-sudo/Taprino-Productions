import { useEffect, useMemo, useRef, useState } from 'react';
import AdminShell from '../../components/AdminShell';
import { adminPageProps } from '../../lib/adminPage';
import Link from 'next/link';
import { FLAG_REASONS } from '../../lib/reportReasons';
import { SITE } from '../../lib/siteConfig';

// Every title from every user, plus flags, viewer reports and reporters.
// Admins, and sub-admins with "See everyone's content" (read) or "Flag
// content & handle reports" (read + act).
export async function getServerSideProps(ctx) {
  return adminPageProps(ctx, { caps: ['view_all_content', 'handle_flags'] });
}

const STATUS_LABEL = { approved: 'Published', pending: 'In review', rejected: 'Rejected', deletion_requested: 'Deletion requested' };
const TIER_LABEL = { red: 'Red', yellow: 'Yellow', minor: 'Minor' };
const RANK = { red: 0, flag: 1, yellow: 2, minor: 3 };

export default function AdminContent({ account, mainGenres }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [owner, setOwner] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [reports, setReports] = useState('');
  const [flagging, setFlagging] = useState(null);
  const [takingDown, setTakingDown] = useState(null);
  const [takeDownNote, setTakeDownNote] = useState('');
  const flagDialog = useRef(null);

  async function load() {
    try {
      const res = await fetch('/api/admin/content');
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not load content.');
      setData(d);
    } catch (err) {
      setError(err.message);
    }
  }
  useEffect(() => { load(); }, []);

  async function act(body, after) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/content', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Something went wrong.');
      await load();
      if (after) after();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const mod = data ? data.moderation : null;
  const flagsByKey = useMemo(() => {
    const m = {};
    if (mod) for (const f of mod.flags) (m[`${f.target_type}:${f.target_id}`] = m[`${f.target_type}:${f.target_id}`] || []).push(f);
    return m;
  }, [mod]);
  const rowByKey = useMemo(() => Object.fromEntries((data ? data.rows : []).map((r) => [`${r.type}:${r.id}`, r])), [data]);

  const owners = useMemo(() => {
    const m = new Map();
    for (const r of data ? data.rows : []) m.set(r.ownerId || '', r.owner);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  const rows = useMemo(() => {
    if (!data) return [];
    const query = q.trim().toLowerCase();
    return data.rows.filter((r) => {
      const key = `${r.type}:${r.id}`;
      const rep = mod.reportsByTarget[key];
      if (query && !(`${r.title} ${r.sub || ''} ${r.owner} ${r.id}`.toLowerCase().includes(query))) return false;
      if (owner !== '' && (r.ownerId || '') !== owner) return false;
      if (type && r.type !== type) return false;
      if (status === 'pulled' ? !r.held : status && r.status !== status) return false;
      if (reports === 'ignored' ? !(rep && rep.ignored) : reports && !(rep && rep.tier === reports)) return false;
      return true;
    });
  }, [data, mod, q, owner, status, type, reports]);

  const queue = useMemo(() => {
    if (!mod) return [];
    const keys = new Set([...Object.keys(flagsByKey), ...Object.keys(mod.reportsByTarget).filter((k) => mod.reportsByTarget[k].tier)]);
    return [...keys].map((key) => {
      const rep = mod.reportsByTarget[key];
      const flags = flagsByKey[key] || [];
      const level = rep && rep.tier === 'red' ? 'red' : flags.length ? 'flag' : rep ? rep.tier : 'minor';
      return { key, row: rowByKey[key], rep, flags, level };
    }).filter((x) => x.row).sort((a, b) => RANK[a.level] - RANK[b.level] || ((b.rep ? b.rep.counted : 0) - (a.rep ? a.rep.counted : 0)));
  }, [mod, flagsByKey, rowByKey]);

  const counts = useMemo(() => {
    const c = { red: 0, yellow: 0, minor: 0, flag: mod ? new Set(mod.flags.map((f) => `${f.target_type}:${f.target_id}`)).size : 0 };
    if (mod) for (const e of Object.values(mod.reportsByTarget)) if (e.tier) c[e.tier] += 1;
    return c;
  }, [mod]);

  function openFlag(row) {
    setFlagging({ row, reason: 'copyright', note: '', emailOwner: true });
    setTimeout(() => flagDialog.current && flagDialog.current.showModal(), 0);
  }

  const canAct = data && data.canAct;

  return (
    <>
      <AdminShell account={account} mainGenres={mainGenres} title="All content &amp; flags" crumbs={['Content']} wide>
        <div className="ca-head">
          <div>
            <div className="eyebrow">Admin</div>
            <h1>All content</h1>
            <p className="ca-sub">Every title from every user, including drafts, rejected work and channel uploads. Click an owner to see just their library.</p>
          </div>
          <Link href="/admin" className="library-back">← Back to admin</Link>
        </div>

        {error && <div className="house-ad-error" role="alert" style={{ marginTop: '1rem' }}>{error}</div>}
        {!data && !error && <div className="ca-empty" style={{ marginTop: '1rem' }}>Loading…</div>}

        {data && (
          <>
            <div className="ac-tiers">
              <div className="ac-tier" style={{ '--tc': 'var(--brass)' }}><span>Red · 50+ people</span><b>{counts.red}</b><small>Pulled automatically everywhere until reviewed.</small></div>
              <div className="ac-tier" style={{ '--tc': 'var(--olive)' }}><span>Yellow · 20–49</span><b>{counts.yellow}</b><small>Stays up. Top of the queue.</small></div>
              <div className="ac-tier" style={{ '--tc': 'var(--ink-faint)' }}><span>Minor · 1–19</span><b>{counts.minor}</b><small>Stays up. Bottom of the queue.</small></div>
              <div className="ac-tier" style={{ '--tc': 'var(--danger)' }}><span>Admin flags</span><b>{counts.flag}</b><small>Pulled everywhere until reviewed.</small></div>
            </div>

            <div className="ac-filters">
              <label className="sch-field"><span>Search</span><input id="ac-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title, owner, ID…" /></label>
              <label className="sch-field"><span>Owner</span>
                <select id="ac-owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
                  <option value="">Everyone</option>
                  {owners.map(([id, label]) => <option key={id || 'studio'} value={id}>{label}</option>)}
                </select>
              </label>
              <label className="sch-field"><span>Type</span>
                <select id="ac-type" value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="">Everything</option><option value="episode">Titles &amp; episodes</option><option value="series">Series</option><option value="channel_media">Channel uploads</option>
                </select>
              </label>
              <label className="sch-field"><span>Status</span>
                <select id="ac-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">Any status</option><option value="approved">Published</option><option value="pending">In review</option><option value="rejected">Rejected</option><option value="pulled">Pulled</option>
                </select>
              </label>
              <label className="sch-field"><span>Reports</span>
                <select id="ac-reports" value={reports} onChange={(e) => setReports(e.target.value)}>
                  <option value="">Any</option><option value="red">Red</option><option value="yellow">Yellow</option><option value="minor">Minor</option><option value="ignored">Reports ignored</option>
                </select>
              </label>
            </div>

            <div className="ac-tablewrap">
              <table className="ac-table">
                <thead><tr><th>Title</th><th>Owner</th><th>Type</th><th>Tier</th><th>Status</th><th>Reports</th><th>Channels</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={8} className="ac-none">Nothing matches.</td></tr>}
                  {rows.map((r) => {
                    const key = `${r.type}:${r.id}`;
                    const rep = mod.reportsByTarget[key];
                    const flagged = !!flagsByKey[key];
                    return (
                      <tr key={key} className={r.held ? 'held' : rep && rep.tier === 'yellow' ? 'warn' : ''}>
                        <td>
                          <div className="ac-title">
                            <span className="ac-thumb" style={r.thumbnail ? { backgroundImage: `url(${r.thumbnail})` } : undefined} />
                            <span><b>{r.title}</b>{r.sub && <small>{r.sub}</small>}</span>
                          </div>
                        </td>
                        <td><button type="button" className="ac-owner" onClick={() => setOwner(r.ownerId || '')}>{r.owner}</button></td>
                        <td>{r.kind}</td>
                        <td>{r.tier === 'premium' ? <span className="sch-chip prem">{SITE.premiumTier}</span> : r.tier === 'free' ? <span className="sch-chip ok">Free</span> : '—'}</td>
                        <td>
                          {r.held
                            ? <span className="sch-chip bad">Pulled{flagged ? ' · admin flag' : rep && rep.tier === 'red' ? ' · 50+ reports' : ''}</span>
                            : <span className="sch-chip">{STATUS_LABEL[r.status] || r.status}</span>}
                        </td>
                        <td>
                          {rep && rep.ignored ? <span className="sch-chip">{rep.total} · ignored</span>
                            : rep && rep.tier ? <span className={`ac-rep ${rep.tier}`}>{TIER_LABEL[rep.tier]} · {rep.counted}</span>
                            : <span className="ac-muted">0</span>}
                        </td>
                        <td className="ac-chan">{r.channels.length ? r.channels.join(', ') : <span className="ac-muted">—</span>}{r.type !== 'channel_media' && !r.optIn && <small> not opted in</small>}</td>
                        <td className="ac-acts">
                          {r.publicHref && <Link href={r.publicHref} className="sch-btn" target="_blank" rel="noreferrer">Open</Link>}
                          {canAct && !flagged && r.status !== 'rejected' && <button type="button" className="sch-btn danger" onClick={() => openFlag(r)}>Flag</button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="ac-sectionhead"><h2>Review queue</h2><span>red → admin flags → yellow → minor</span></div>
            {queue.length === 0 && <div className="ca-empty">Nothing to review.</div>}
            <div className="ac-queue">
              {queue.map(({ key, row, rep, flags, level }) => (
                <div key={key} className={`ac-qitem l-${level}`}>
                  <div style={{ minWidth: 0 }}>
                    <div className="ac-qmeta">
                      {row.owner} · {row.kind}
                      {rep ? ` · ${rep.counted} ${rep.counted === 1 ? 'person' : 'people'} reported${rep.topReason ? `, mostly "${rep.topReason}"` : ''}` : ''}
                      {` · ${row.held ? 'pulled everywhere' : 'still up'}`}
                    </div>
                    <h3>{row.title} {level === 'flag' ? <span className="sch-chip bad">Admin flag</span> : <span className={`ac-rep ${level}`}>{TIER_LABEL[level]}</span>}</h3>
                    {flags.map((f) => <p key={f.id}><b>{f.reasonLabel}</b>{f.note ? ` · ${f.note}` : ''} <small>({new Date(f.created_at).toLocaleDateString()})</small></p>)}
                    {takingDown === key && (
                      <div className="ac-takedown">
                        <label className="sch-field"><span>Why it&rsquo;s coming down (the owner sees this)</span>
                          <textarea id={`ac-td-${row.id}`} rows={2} value={takeDownNote} onChange={(e) => setTakeDownNote(e.target.value)} />
                        </label>
                        <div className="ac-acts">
                          <button type="button" className="sch-btn danger" disabled={busy || !takeDownNote.trim()} onClick={() => act({ op: 'decide', targetType: row.type, targetId: row.id, action: 'take_down', note: takeDownNote }, () => { setTakingDown(null); setTakeDownNote(''); })}>Take it down</button>
                          <button type="button" className="sch-btn" onClick={() => setTakingDown(null)}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                  {canAct && takingDown !== key && (
                    <div className="ac-acts">
                      <button type="button" className="sch-btn" disabled={busy} onClick={() => act({ op: 'decide', targetType: row.type, targetId: row.id, action: 'restore' })}>{row.held ? 'Restore' : 'Looks fine, clear'}</button>
                      {rep && !flags.length && <button type="button" className="sch-btn" disabled={busy} title="For spam reporting: keep it running and stop counting reports" onClick={() => act({ op: 'decide', targetType: row.type, targetId: row.id, action: 'ignore_reports' })}>Ignore reports</button>}
                      <button type="button" className="sch-btn danger" disabled={busy} onClick={() => { setTakingDown(key); setTakeDownNote(''); }}>Take down…</button>
                    </div>
                  )}
                </div>
              ))}
              {Object.entries(mod.reportsByTarget).filter(([, e]) => e.ignored).map(([key, e]) => {
                const row = rowByKey[key];
                if (!row) return null;
                return (
                  <div key={`ign-${key}`} className="ac-qitem l-ignored">
                    <div>
                      <div className="ac-qmeta">{row.owner} · {e.total} reports, not counted</div>
                      <h3>{row.title} <span className="sch-chip">Reports ignored</span></h3>
                      <p>Keeps running no matter how many reports come in.</p>
                    </div>
                    {canAct && <div className="ac-acts"><button type="button" className="sch-btn" disabled={busy} onClick={() => act({ op: 'decide', targetType: row.type, targetId: row.id, action: 'count_reports' })}>Count reports again</button></div>}
                  </div>
                );
              })}
            </div>

            <div className="ac-sectionhead"><h2>Reporters to review</h2><span>over 50 reports in a month</span></div>
            <p className="ca-sub" style={{ marginTop: 0 }}>Each account can report a title once and send up to 50 reports a month. Going over flags the account here, and its reports stop counting until you decide. &ldquo;Dismissed&rdquo; counts reports you cleared as fine.</p>
            {mod.reporters.length === 0 ? <div className="ca-empty">Nobody to review.</div> : (
              <div className="ac-tablewrap">
                <table className="ac-table">
                  <thead><tr><th>Account</th><th>Status</th><th>This month</th><th>Dismissed</th><th>Upheld</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
                  <tbody>
                    {mod.reporters.map((r) => (
                      <tr key={r.user_id}>
                        <td className="ac-mono">{r.user_id}</td>
                        <td>{r.status === 'flagged' ? <span className="sch-chip wait">{r.reason || 'Flagged'}</span> : <span className="sch-chip">{{ cleared: 'Cleared', muted: 'Reports not counted', banned: 'Banned from reporting' }[r.status]}</span>}</td>
                        <td className="ac-mono">{r.stats.thisMonth}</td>
                        <td className="ac-mono" style={{ color: 'var(--danger)' }}>{r.stats.dismissed}</td>
                        <td className="ac-mono" style={{ color: 'var(--ok)' }}>{r.stats.upheld}</td>
                        <td className="ac-acts">
                          {canAct && r.status !== 'cleared' && <button type="button" className="sch-btn" disabled={busy} onClick={() => act({ op: 'reporter', userId: r.user_id, status: 'cleared' })}>Reports are fine</button>}
                          {canAct && r.status !== 'muted' && <button type="button" className="sch-btn" disabled={busy} onClick={() => act({ op: 'reporter', userId: r.user_id, status: 'muted' })}>Stop counting their reports</button>}
                          {canAct && r.status !== 'banned' && <button type="button" className="sch-btn danger" disabled={busy} onClick={() => act({ op: 'reporter', userId: r.user_id, status: 'banned' })}>Ban from reporting</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {mod.recentResolved.length > 0 && (
              <>
                <div className="ac-sectionhead"><h2>Recently resolved flags</h2></div>
                <div className="ac-queue">
                  {mod.recentResolved.map((f, i) => {
                    const row = rowByKey[`${f.target_type}:${f.target_id}`];
                    return (
                      <div key={i} className="ac-qitem l-done">
                        <div><div className="ac-qmeta">{new Date(f.resolved_at).toLocaleDateString()} · {f.resolution === 'restored' ? 'Restored' : 'Taken down'}</div><h3>{row ? row.title : f.target_id} <span className="sch-chip">{f.reasonLabel}</span></h3></div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

        <dialog ref={flagDialog} className="report-dialog" aria-label="Flag content">
          {flagging && (
            <form className="report-body" onSubmit={(e) => {
              e.preventDefault();
              act({ op: 'flag', targetType: flagging.row.type, targetId: flagging.row.id, reason: flagging.reason, note: flagging.note, emailOwner: flagging.emailOwner }, () => flagDialog.current.close());
            }}>
              <div className="tv-info-eyebrow">Flag · pulls it everywhere until reviewed</div>
              <h3>{flagging.row.title} <small className="ac-muted">· {flagging.row.owner}</small></h3>
              <fieldset className="report-reasons ac-reasons">
                <legend>Reason</legend>
                {Object.entries(FLAG_REASONS).map(([k, label]) => (
                  <label key={k}><input type="radio" name="flag-reason" checked={flagging.reason === k} onChange={() => setFlagging((f) => ({ ...f, reason: k }))} />{label}</label>
                ))}
              </fieldset>
              <label className="sch-field"><span>Note to the owner</span>
                <textarea id="ac-flag-note" rows={2} value={flagging.note} onChange={(e) => setFlagging((f) => ({ ...f, note: e.target.value }))} placeholder="What needs to change, if anything." />
              </label>
              <label className="ac-check"><input type="checkbox" checked={flagging.emailOwner} onChange={(e) => setFlagging((f) => ({ ...f, emailOwner: e.target.checked }))} /> Email the owner too (they always get an in-app notice)</label>
              <div className="report-acts">
                <button type="button" className="sch-btn" onClick={() => flagDialog.current.close()}>Cancel</button>
                <button type="submit" className="sch-btn primary" disabled={busy}>Flag &amp; pull</button>
              </div>
            </form>
          )}
        </dialog>
      </AdminShell>
    </>
  );
}
