import { useEffect, useState } from 'react';
import AdminShell from '../../components/AdminShell';
import { adminPageProps } from '../../lib/adminPage';

export async function getServerSideProps(ctx) {
  return adminPageProps(ctx);
}

// The audit log (full admins). Since the series revamp's slice 3a the
// creators' own changes on their show pages are left out unless the
// switch is on (?owners=1): they are each show's History on Admin → Shows.
// Lines written as JSON carry their own words (`words`).
export default function AdminAuditLog({ account, mainGenres }) {
  const [entries, setEntries] = useState(null);
  const [owners, setOwners] = useState(false);

  useEffect(() => {
    let alive = true;
    setEntries(null);
    fetch(`/api/admin/audit-log${owners ? '?owners=1' : ''}`)
      .then((r) => r.json())
      .then((d) => { if (alive) setEntries(d.entries || []); })
      .catch(() => { if (alive) setEntries([]); });
    return () => { alive = false; };
  }, [owners]);

  return (
    <AdminShell account={account} mainGenres={mainGenres} title="Audit log" crumbs={['Site']}
      intro="Read-only history of admin actions: approvals, rejections, deletions, artwork decisions, cleanup, flags and access changes. Most recent first, last 200.">
      <div className="adm-audit-switch">
        <span id="adm-audit-owners">Show creators’ own changes</span>
        <button type="button" role="switch" aria-checked={owners ? 'true' : 'false'} aria-labelledby="adm-audit-owners" className={`seal-switch show-ed-switch ${owners ? 'on' : ''}`} onClick={() => setOwners((v) => !v)} />
      </div>
      <div className="adm-card">
        {!entries ? <p className="adm-empty">Loading…</p> : entries.length === 0 ? <p className="adm-empty">Nothing logged yet.</p> : (
          entries.map((entry) => {
            const words = typeof entry.words === 'string' && entry.words ? entry.words : typeof entry.details === 'string' ? entry.details : '';
            return (
              <div key={entry.id} style={{ borderTop: '1px solid rgba(251,232,211,0.1)', padding: '0.6rem 0', fontSize: '0.84rem' }}>
                <span style={{ color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>{new Date(entry.createdAt).toLocaleString()}</span>
                {' — '}<strong>{entry.adminEmail || 'unknown admin'}</strong>{entry.actor === 'owner' ? ' (owner)' : ''}{' '}{entry.action.replace(/_/g, ' ')}{words ? ` — ${words}` : ''}
              </div>
            );
          })
        )}
      </div>
    </AdminShell>
  );
}
