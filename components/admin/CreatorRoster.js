import { useEffect, useState } from 'react';
import Link from 'next/link';

// Admin → Shows → Creators (full admins; the series revamp, slice 3a):
// everyone with creator or admin access and how their submissions went —
// the roster half of the old Series ownership page (OwnershipPanel, now
// caller-less). Who runs a show is changed on that show's page.
export default function CreatorRoster() {
  const [roster, setRoster] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/admin/creators', { credentials: 'same-origin' })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!alive) return;
        if (ok) setRoster(d.creators || []);
        else {
          setError(d.error || 'Couldn’t load the roster.');
          setRoster([]);
        }
      })
      .catch(() => {
        if (!alive) return;
        setError('Couldn’t reach the site — check the connection and try again.');
        setRoster([]);
      });
    return () => { alive = false; };
  }, []);

  return (
    <div className="adm-card adm-roster">
      <div className="adm-card-head">
        <span className="adm-eyebrow">Creator roster</span>
      </div>
      <p className="adm-roster-intro">Everyone with creator or admin access. To hand a show to someone, open the show and use Who runs it.</p>
      {error && <p className="rq-error" role="alert">{error}</p>}
      {!roster ? (
        <p className="adm-empty">Loading…</p>
      ) : roster.length === 0 ? (
        <p className="adm-empty">No creators or admins yet.</p>
      ) : (
        <ul className="adm-roster-list">
          {roster.map((c) => (
            <li key={c.id}>
              <div className="adm-roster-top">
                <strong>{c.email || '(no email on file)'}</strong>
                <span className={`adm-roster-role ${c.role === 'admin' ? 'is-admin' : ''}`}>{c.role}</span>
              </div>
              <div className="adm-roster-sub">
                {c.totalSubmissions} submission{c.totalSubmissions === 1 ? '' : 's'} · {c.approved} approved · {c.pending} in review · {c.rejected} sent back
                {c.approvalRate !== null && c.approvalRate !== undefined ? ` · ${c.approvalRate}% approved` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="adm-roster-foot">To give or take away access — sub-admin roles and their permissions too — use <Link href="/admin/team">Team &amp; roles →</Link></p>
    </div>
  );
}
