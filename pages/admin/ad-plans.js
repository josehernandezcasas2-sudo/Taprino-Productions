import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import AdminShell from '../../components/AdminShell';
import { adminPageProps } from '../../lib/adminPage';
import { fmtClock, STATUS_LABELS } from '../../lib/adPlanRules';

// The way into the Episode Ad Curator: every approved episode, its plan
// state (default / draft / ready for air), air length and breaks, and a
// button to open the curator. Content schedulers reach the curator from
// the scheduler's titles instead (they can't open /admin).
export async function getServerSideProps(ctx) {
  return adminPageProps(ctx, { caps: ['manage_schedule', 'manage_episodes'] });
}

const TABS = [['all', 'All'], ['ready', 'Ready for air'], ['draft', 'Drafts'], ['none', 'Default']];

export default function AdminAdPlans({ account, mainGenres, apiPath = '/api/admin/ad-plans' }) {
  const [episodes, setEpisodes] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');

  useEffect(() => {
    fetch(apiPath)
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Could not load.'); return d; })
      .then((d) => setEpisodes(d.episodes))
      .catch((err) => setError(err.message));
  }, [apiPath]);

  const counts = useMemo(() => {
    const c = { all: 0, ready: 0, draft: 0, none: 0 };
    for (const e of episodes || []) { c.all += 1; c[e.status] = (c[e.status] || 0) + 1; }
    return c;
  }, [episodes]);
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (episodes || []).filter((e) => (tab === 'all' || e.status === tab) && (!term || `${e.seriesName || ''} ${e.title}`.toLowerCase().includes(term)));
  }, [episodes, tab, q]);

  return (
    <AdminShell account={account} mainGenres={mainGenres} title="Episode ad plans" crumbs={['Ads']}
      intro="Every approved episode and the state of its ad plan. Open the curator to compose the breaks; only a plan saved “ready for air” changes what the channel and the player do.">
      {error && <div className="crew-status error" style={{ marginBottom: '0.8rem' }}>{error}</div>}
      {!episodes && !error && <div className="crew-mono">Loading…</div>}
      {episodes && (
        <div style={{ display: 'grid', gap: '0.8rem' }}>
          <div className="crew-subnav" role="tablist">
            {TABS.map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label} · {counts[k] || 0}</button>
            ))}
          </div>
          <input type="search" className="sch-search" placeholder="Search by title or series…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search episodes" style={{ maxWidth: 360 }} />
          {shown.length === 0 && <div className="crew-panel crew-empty">{episodes.length === 0 ? 'No approved episodes yet.' : 'Nothing matches.'}</div>}
          <div className="crew-results">
            {shown.map((e) => (
              <div key={e.id} className="crew-panel crew-rhead">
                <span style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', minWidth: 0 }}>
                  <span className="loc-row-thumb" style={{ width: 56, flex: 'none', ...(e.thumbnail ? { backgroundImage: `url(${e.thumbnail})` } : {}) }} />
                  <span style={{ minWidth: 0 }}>
                    <b style={{ fontFamily: 'var(--font-display)' }}>{e.seriesName ? `${e.seriesName} · ` : ''}{e.label ? `${e.label} ` : ''}{e.title}</b>
                    <span className="crew-mono" style={{ display: 'block' }}>
                      {e.runtime || fmtClock(e.runtimeSeconds)} runtime · creator breaks {e.creatorBreaks.map(fmtClock).join(', ')}{!e.adsEnabled ? ' · ads off' : ''}
                      {' · '}
                      <span className={`adc-status ${e.status}`} style={{ marginLeft: 0 }}>{STATUS_LABELS[e.status]}</span>
                      {e.status !== 'none' && e.airSeconds ? ` · air ${fmtClock(e.airSeconds)} · ${fmtClock(e.adsSeconds)} of ads in ${e.breakCount} break${e.breakCount === 1 ? '' : 's'}` : ''}
                    </span>
                  </span>
                </span>
                <span className="crew-actions">
                  <Link href={`/ad-plan/${e.id}`} className={`crew-btn sm ${e.status === 'none' ? 'primary' : ''}`}>{e.status === 'none' ? 'Open curator' : 'Edit plan'}</Link>
                </span>
              </div>
            ))}
          </div>
          <p className="crew-muted" style={{ maxWidth: '70ch' }}>
            Default means the episode plays as it always has: on the live channel it runs straight through, and on demand each creator break plays one random ad. The section sizes, the ads-per-hour cap and the rounding are on <Link href="/admin/settings">Settings</Link>.
          </p>
        </div>
      )}
    </AdminShell>
  );
}
