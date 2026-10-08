import { useEffect, useState } from 'react';
import AdminShell from '../../components/AdminShell';
import { adminPageProps } from '../../lib/adminPage';

export async function getServerSideProps(ctx) {
  return adminPageProps(ctx);
}

export default function AdminAuditLog({ account, mainGenres }) {
  const [entries, setEntries] = useState(null);

  useEffect(() => {
    fetch('/api/admin/audit-log')
      .then((r) => r.json())
      .then((d) => setEntries(d.entries || []))
      .catch(() => setEntries([]));
  }, []);

  return (
    <AdminShell account={account} mainGenres={mainGenres} title="Audit log" crumbs={['Site']}
      intro="Read-only history of admin actions: approvals, rejections, deletions, artwork decisions, cleanup, flags and access changes. Most recent first, last 200.">
      <div className="adm-card">
        {!entries ? <p className="adm-empty">Loading…</p> : entries.length === 0 ? <p className="adm-empty">Nothing logged yet.</p> : (
          entries.map((entry) => (
            <div key={entry.id} style={{ borderTop: '1px solid rgba(251,232,211,0.1)', padding: '0.6rem 0', fontSize: '0.84rem' }}>
              <span style={{ color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>{new Date(entry.createdAt).toLocaleString()}</span>
              {' — '}<strong>{entry.adminEmail || 'unknown admin'}</strong>{' '}{entry.action.replace(/_/g, ' ')}{entry.details ? ` — ${entry.details}` : ''}
            </div>
          ))
        )}
      </div>
    </AdminShell>
  );
}
