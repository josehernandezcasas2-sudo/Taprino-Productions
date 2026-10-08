import { useEffect, useState } from 'react';
import Link from 'next/link';
import AdminShell from '../components/AdminShell';
import ReviewQueue from '../components/admin/ReviewQueue';
import { adminPageProps } from '../lib/adminPage';
import { siteConfigIncomplete, missingSiteConfigFields } from '../lib/siteConfig';
import { getSiteSettings } from '../lib/siteSettings';

// The admin dashboard (2026-10-08 redesign). The old 2,000-line hub's
// sections now live on their own pages — see lib/adminNav.js. This page
// is just: the numbers, the merged review queue, open flags, and the
// latest audit entries.
//
// SECURITY: adminPageProps redirects anyone who isn't an admin or a
// sub-admin server-side, before any admin data is fetched or rendered.
export async function getServerSideProps(ctx) {
  return adminPageProps(ctx, {
    caps: ['review_submissions', 'manage_artwork', 'manage_deletions', 'handle_flags', 'view_all_content', 'manage_applications', 'manage_house_ads', 'manage_live', 'manage_schedule', 'manage_content_lifecycle', 'manage_genre_icons', 'manage_comped_access', 'manage_episodes'],
    extra: async () => {
      const settings = await getSiteSettings();
      return { defaultCpmCents: settings.adCpmCents || null };
    }
  });
}

export default function AdminDashboard({ account, mainGenres, defaultCpmCents }) {
  const [stats, setStats] = useState(null);
  const [counts, setCounts] = useState(null);
  const [flags, setFlags] = useState(null);
  const [auditLog, setAuditLog] = useState(null);

  async function loadAll() {
    const get = (url) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const [s, c, m, a] = await Promise.all([
      account.isAdmin ? get('/api/admin/stats') : null,
      get('/api/admin/queue-counts'),
      get('/api/admin/content'),
      account.isAdmin ? get('/api/admin/audit-log') : null
    ]);
    setStats(s);
    setCounts(c || {});
    setFlags(m ? flaggedRows(m) : []);
    setAuditLog(a ? a.entries.slice(0, 8) : []);
  }

  useEffect(() => {
    loadAll();
    const onChange = () => loadAll();
    window.addEventListener('taprino:admin-queue-changed', onChange);
    return () => window.removeEventListener('taprino:admin-queue-changed', onChange);
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const name = account.email ? account.email.split('@')[0] : null;

  return (
    <AdminShell account={account} mainGenres={mainGenres} title={name ? `${greeting}, ${name}` : greeting}>
      {siteConfigIncomplete() && (
        <div className="admin-config-warning">
          <strong>Legal pages aren&rsquo;t finished.</strong> These are still placeholders in{' '}
          <code>lib/siteConfig.js</code>: {missingSiteConfigFields().join(', ')}. They show up
          literally on your public Terms, Privacy, and Cookie pages until they&rsquo;re filled in.
        </div>
      )}

      <div className="adm-stats">
        <div className="adm-stat"><b>{counts ? counts.review ?? 0 : '…'}</b><span>To review</span></div>
        <div className="adm-stat"><b>{stats ? stats.approvedCount : '…'}</b><span>Titles live</span></div>
        <div className="adm-stat"><b>{stats ? stats.creatorCount : '…'}</b><span>Creators</span></div>
        <div className="adm-stat"><b>{counts ? counts.flags ?? 0 : '…'}</b><span>Open flags</span></div>
        <div className="adm-stat"><b>{stats ? (stats.approvalRate === null ? '—' : `${stats.approvalRate}%`) : '…'}</b><span>Approval rate</span></div>
        <div className="adm-stat"><b>{stats ? stats.totalViews : '…'}</b><span>Total views</span></div>
      </div>

      <div className="adm-two">
        <div className="adm-card">
          <div className="adm-card-head">
            <div className="adm-eyebrow">Needs your review</div>
            <Link href="/admin/review" className="adm-link-btn">Open the queue →</Link>
          </div>
          <ReviewQueue limit={6} compact defaultCpmCents={defaultCpmCents} />
        </div>

        <div>
          <div className="adm-card">
            <div className="adm-card-head">
              <div className="adm-eyebrow">Flags &amp; reports</div>
              <Link href="/admin/content" className="adm-link-btn">All content →</Link>
            </div>
            {!flags ? <p className="adm-empty">Loading…</p> : flags.length === 0 ? <p className="adm-empty">Nothing flagged or reported.</p> : (
              flags.slice(0, 5).map((f) => (
                <div key={f.key} className="rq-row" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}>
                  <div>
                    <div className="rq-title">{f.title}</div>
                    <div className="rq-sub">{f.detail}</div>
                  </div>
                  <Link href={`/admin/content#${f.key}`} className="rq-btn" style={{ textDecoration: 'none' }}>Review</Link>
                </div>
              ))
            )}
          </div>

          {account.isAdmin && (
            <div className="adm-card">
              <div className="adm-card-head">
                <div className="adm-eyebrow">Recent activity</div>
                <Link href="/admin/audit-log" className="adm-link-btn">Audit log →</Link>
              </div>
              {!auditLog ? <p className="adm-empty">Loading…</p> : auditLog.length === 0 ? <p className="adm-empty">Nothing logged yet.</p> : (
                <div className="adm-log">
                  {auditLog.map((e) => (
                    <div key={e.id}>
                      <b>{(e.adminEmail || 'unknown').split('@')[0]}</b> {e.action.replace(/_/g, ' ')}{e.details ? ` — ${e.details}` : ''} · {timeAgo(e.createdAt)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </AdminShell>
  );
}

// Rows from /api/admin/content that have an open flag or counted reports.
function flaggedRows(m) {
  const mod = m.moderation || {};
  const byKey = {};
  for (const r of m.rows || []) byKey[`${r.type}:${r.id}`] = r;
  const out = [];
  for (const f of mod.flags || []) {
    const key = `${f.target_type}:${f.target_id}`;
    const row = byKey[key];
    out.push({ key, title: row ? (row.title || row.name) : key, detail: `Flagged · ${f.reasonLabel || f.reason}` });
  }
  for (const [key, t] of Object.entries(mod.reportsByTarget || {})) {
    if (!t.counted || t.ignored) continue;
    const row = byKey[key];
    out.push({ key, title: row ? (row.title || row.name) : key, detail: `${t.counted} report${t.counted === 1 ? '' : 's'} · ${t.topReason || ''}` });
  }
  return out;
}

function timeAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3600000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d}d`;
}
