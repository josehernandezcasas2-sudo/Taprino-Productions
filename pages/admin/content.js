import { useEffect, useMemo, useRef, useState } from 'react';
import AdminShell from '../../components/AdminShell';
import { adminPageProps } from '../../lib/adminPage';
import Link from 'next/link';
import { FLAG_REASONS } from '../../lib/reportReasons';
import { queueTileCounts, reviewQueueKeys } from '../../lib/moderationRules';
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

// Places, crew calls, productions and profiles (`connect` from the API,
// lib/contentAdmin.js listReportedConnectContent) are decided through the
// same decide() as titles (lib/moderation.js); the words say what each
// choice really does to that kind of thing. A tip note's reports stay on
// /admin/tips.
const CONNECT_WORDS = {
  location: { hidden: 'hidden from Locations', takeDown: 'Take the place down…', confirm: 'Take it down', why: 'Why it’s coming down (the host sees this)' },
  call: { hidden: 'hidden from the board', takeDown: 'Remove the call…', confirm: 'Remove it', why: 'Why it’s coming off the board (the poster sees this)' },
  production: { hidden: 'hidden from Productions', takeDown: 'Remove the production…', confirm: 'Remove it', why: 'Why it’s being removed (the owner sees this)' },
  profile: { hidden: 'the profile stays up', takeDown: 'Uphold the reports…', confirm: 'Uphold the reports', why: 'What they’re told (the profile stays up; nothing else changes)' }
};
// Already removed (or a place not approved): Restore wouldn't bring it
// back, so the reports are upheld or ignored.
const GONE_WORDS = { takeDown: 'Uphold the reports…', confirm: 'Uphold the reports', why: 'Why (the owner is told; it stays down)' };

function decisionWords(row) {
  if (!row.connect) return { restore: row.held ? 'Restore' : 'Looks fine, clear', takeDown: 'Take down…', confirm: 'Take it down', why: 'Why it’s coming down (the owner sees this)' };
  const words = row.gone ? GONE_WORDS : CONNECT_WORDS[row.type] || GONE_WORDS;
  return { ...words, restore: row.gone ? null : row.type === 'profile' ? 'Looks fine, dismiss reports' : row.held ? 'Restore' : 'Looks fine, clear' };
}

function connectState(row) {
  if (row.gone) return `${row.statusLabel} · not public`;
  if (row.type === 'profile') return CONNECT_WORDS.profile.hidden;
  if (row.held) return CONNECT_WORDS[row.type].hidden;
  // Only a listed place is public: a paused one or one in review isn't up.
  return row.type === 'location' && row.status !== 'listed' ? `${row.statusLabel} · not public` : `${row.statusLabel} · still up`;
}

const shortDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');

// What a deleted item was, for the queue's "Gone" rows.
const GONE_TYPE = { episode: 'Title', series: 'Series', channel_media: 'Channel upload', location: 'Place', call: 'Crew call', production: 'Production', profile: 'Profile' };

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
  const rowByKey = useMemo(() => Object.fromEntries((data ? [...data.rows, ...(data.connect || [])] : []).map((r) => [`${r.type}:${r.id}`, r])), [data]);

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

  // The same items the nav's badge counts (lib/moderationRules.js): one
  // per item, tip notes and items deleted since left out.
  const queue = useMemo(() => {
    if (!mod) return [];
    return reviewQueueKeys(mod).map((key) => {
      const rep = mod.reportsByTarget[key];
      const flags = flagsByKey[key] || [];
      const level = rep && rep.tier === 'red' ? 'red' : flags.length ? 'flag' : rep ? rep.tier : 'minor';
      return { key, row: rowByKey[key], rep, flags, level };
    }).filter((x) => x.row).sort((a, b) => RANK[a.level] - RANK[b.level] || ((b.rep ? b.rep.counted : 0) - (a.rep ? a.rep.counted : 0)));
  }, [mod, flagsByKey, rowByKey]);

  // Tip notes are decided on /admin/tips, so they're left out of the
  // tiles and the queue here and only counted for the pointer; items
  // deleted since they were reported count nowhere and are listed apart.
  const counts = useMemo(() => queueTileCounts(mod), [mod]);
  const missing = mod && Array.isArray(mod.missing) ? mod.missing : [];

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
            <p className="ca-sub">Every title from every user, including drafts, rejected work and channel uploads. Click an owner to see just their library. Reports on places, crew calls, productions and profiles come into the review queue below too.</p>
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
            {data.connect === null && <div className="house-ad-error" role="alert">Reports on places, crew calls, productions and profiles couldn&rsquo;t be loaded. Reload to try again.</div>}
            {counts.tipNotes > 0 && (
              <p className="ca-sub ac-tipline">
                {counts.tipNotes} reported tip {counts.tipNotes === 1 ? 'note' : 'notes'} → {account && account.isAdmin ? <Link href="/admin/tips">Admin → Tips</Link> : 'Admin → Tips (full admins)'}
              </p>
            )}
            {queue.length === 0 && missing.length === 0 && <div className="ca-empty">Nothing to review.</div>}
            <div className="ac-queue">
              {queue.map(({ key, row, rep, flags, level }) => {
                const words = decisionWords(row);
                return (
                  <div key={key} className={`ac-qitem l-${level}${row.connect ? ' connect' : ''}`} data-target={key}>
                    <div style={{ minWidth: 0 }}>
                      <div className="ac-qmeta">
                        {row.connect ? `${row.ownerRole}: ${row.owner}` : `${row.owner} · ${row.kind}`}
                        {rep ? ` · ${rep.counted} ${rep.counted === 1 ? 'person' : 'people'} reported${rep.topReason ? `, mostly "${rep.topReason}"` : ''}` : ''}
                        {` · ${row.connect ? connectState(row) : row.held ? 'pulled everywhere' : 'still up'}`}
                      </div>
                      <h3>
                        {row.connect && <span className="sch-chip ac-type">{row.typeLabel}</span>}
                        {row.title} {level === 'flag' ? <span className="sch-chip bad">Admin flag</span> : <span className={`ac-rep ${level}`}>{TIER_LABEL[level]}</span>}
                        {row.connect && row.gone && <span className="sch-chip bad">{row.statusLabel}</span>}
                      </h3>
                      {row.connect && row.sub && <p className="ac-qsub">{row.sub}</p>}
                      {row.connect && row.recentReports.length > 0 && (
                        <p className="ac-qreasons">
                          {rep && rep.total > row.recentReports.length ? `Newest ${row.recentReports.length} of ${rep.total}: ` : 'Reports: '}
                          {row.recentReports.map((r, i) => <span key={i}>{i > 0 ? ' · ' : ''}{r.reason} <small>({shortDate(r.at)})</small></span>)}
                        </p>
                      )}
                      {flags.map((f) => <p key={f.id}><b>{f.reasonLabel}</b>{f.note ? ` · ${f.note}` : ''} <small>({new Date(f.created_at).toLocaleDateString()})</small></p>)}
                      {takingDown === key && (
                        <div className="ac-takedown">
                          <label className="sch-field"><span>{words.why}</span>
                            <textarea id={`ac-td-${row.id}`} rows={2} value={takeDownNote} onChange={(e) => setTakeDownNote(e.target.value)} />
                          </label>
                          <div className="ac-acts">
                            <button type="button" className="sch-btn danger" disabled={busy || !takeDownNote.trim()} onClick={() => act({ op: 'decide', targetType: row.type, targetId: row.id, action: 'take_down', note: takeDownNote }, () => { setTakingDown(null); setTakeDownNote(''); })}>{words.confirm}</button>
                            <button type="button" className="sch-btn" onClick={() => setTakingDown(null)}>Cancel</button>
                          </div>
                        </div>
                      )}
                    </div>
                    {takingDown !== key && (canAct || (row.connect && row.publicHref)) && (
                      <div className="ac-acts">
                        {row.connect && row.publicHref && <Link href={row.publicHref} className="sch-btn" target="_blank" rel="noreferrer">Open page</Link>}
                        {canAct && words.restore && <button type="button" className="sch-btn" disabled={busy} onClick={() => act({ op: 'decide', targetType: row.type, targetId: row.id, action: 'restore' })}>{words.restore}</button>}
                        {canAct && rep && !flags.length && <button type="button" className="sch-btn" disabled={busy} title="For spam reporting: keep it running and stop counting reports" onClick={() => act({ op: 'decide', targetType: row.type, targetId: row.id, action: 'ignore_reports' })}>Ignore reports</button>}
                        {canAct && <button type="button" className="sch-btn danger" disabled={busy} onClick={() => { setTakingDown(key); setTakeDownNote(''); }}>{words.takeDown}</button>}
                      </div>
                    )}
                  </div>
                );
              })}
              {missing.map((m) => (
                <div key={`gone-${m.key}`} className="ac-qitem l-done" data-target={m.key}>
                  <div style={{ minWidth: 0 }}>
                    <div className="ac-qmeta">
                      {m.reports > 0 ? `${m.reports} open report${m.reports === 1 ? '' : 's'}${m.topReason ? `, mostly "${m.topReason}"` : ''}` : 'No open reports'}
                      {m.flags > 0 ? ` · ${m.flags} open flag${m.flags === 1 ? '' : 's'}` : ''}
                    </div>
                    <h3><span className="sch-chip ac-type">{GONE_TYPE[m.targetType] || m.targetType}</span><span className="ac-mono">{m.targetId}</span> <span className="sch-chip">Gone</span></h3>
                    <p>It was deleted after it was reported, so there&rsquo;s nothing left to decide. Closing marks its reports upheld and its flags resolved; nobody is told. Not counted anywhere until then.</p>
                  </div>
                  {canAct && <div className="ac-acts"><button type="button" className="sch-btn" disabled={busy} onClick={() => act({ op: 'decide', targetType: m.targetType, targetId: m.targetId, action: 'close_missing' })}>The item is gone — close its reports</button></div>}
                </div>
              ))}
              {Object.entries(mod.reportsByTarget).filter(([, e]) => e.ignored).map(([key, e]) => {
                const row = rowByKey[key];
                if (!row) return null;
                return (
                  <div key={`ign-${key}`} className="ac-qitem l-ignored" data-target={key}>
                    <div>
                      <div className="ac-qmeta">{row.connect ? `${row.ownerRole}: ${row.owner}` : row.owner} · {e.total} reports, not counted</div>
                      <h3>{row.connect && <span className="sch-chip ac-type">{row.typeLabel}</span>}{row.title} <span className="sch-chip">Reports ignored</span></h3>
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
