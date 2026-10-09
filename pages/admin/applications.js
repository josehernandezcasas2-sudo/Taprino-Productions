import { useEffect, useState } from 'react';
import AdminShell from '../../components/AdminShell';
import { adminPageProps } from '../../lib/adminPage';
import Link from 'next/link';
import { SITE } from '../../lib/siteConfig';

export async function getServerSideProps(ctx) {
  return adminPageProps(ctx, { caps: ['manage_applications'] });
}

const STATUS_LABEL = { new: 'New', reviewing: 'Reviewing', accepted: 'Accepted', declined: 'Declined' };
const RIGHTS_LABEL = { clear: 'Rights clear', held: 'Needs paperwork', blocked: 'Not rights holder' };
const RIGHTS_CLASS = { clear: 'ok', held: 'warn', blocked: 'bad' };
const TYPE_LABEL = { short: 'Short', film: 'Film', series: 'Series', podcast: 'Podcast', vertical: 'Vertical', other: 'Other' };
const STAND_LABEL = { finished: 'Finished', festival: 'Festival run ongoing', in_post: 'In post', in_progress: 'In progress', concept: 'Concept' };

export default function ApplicationsAdmin({ account, mainGenres }) {
  const [apps, setApps] = useState(null);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [notes, setNotes] = useState({});
  const [flash, setFlash] = useState({});

  async function load() {
    try {
      const res = await fetch('/api/admin/applications');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setApps(data.applications);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function setStatus(app, status) {
    setBusyId(app.id);
    setError(null);
    try {
      const body = { id: app.id, status };
      // The note goes out with a decision, in the email and on /apply.
      if (status === 'accepted' || status === 'declined') body.decisionNote = notes[app.id] !== undefined ? notes[app.id] : (app.decision_note || '');
      const res = await fetch('/api/admin/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setApps((prev) => prev.map((a) => (a.id === app.id ? data.application : a)));
      let msg = null;
      if (data.roleGranted) msg = `Creator Studio granted to ${data.application.email}. They've been emailed.`;
      else if (data.needsManualGrant) msg = 'Accepted, but this application has no account linked (it predates sign-in). Grant Creator Studio by email under People.';
      else if (status === 'accepted') msg = 'Accepted. They already had a team role, so nothing to grant. They’ve been emailed.';
      else if (status === 'declined') msg = 'Declined. They’ve been emailed.';
      setFlash((f) => ({ ...f, [app.id]: msg }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  const shown = apps ? (filter === 'all' ? apps : apps.filter((a) => a.status === filter)) : [];
  const counts = apps
    ? apps.reduce((acc, a) => ({ ...acc, [a.status]: (acc[a.status] || 0) + 1 }), {})
    : {};

  return (
    <>
      <AdminShell account={account} mainGenres={mainGenres} title="Applications" crumbs={['People']}>
        <div className="ca-head">
          <div>
            <div className="eyebrow">Admin</div>
            <h1>Applications</h1>
            <p className="ca-sub">
              Creators applying via <Link href="/apply">/apply</Link>. Each one did the rights check first, so the
              paperwork it would need is listed here. <strong>Accept</strong> grants Creator Studio to their account
              and emails them; they upload the master there and it lands in <Link href="/admin/review">Review</Link>.
            </p>
          </div>
          <Link href="/admin" className="library-back">← Back to admin</Link>
        </div>

        {error && <div className="house-ad-error" style={{ marginTop: '1rem' }}>{error}</div>}

        {apps && (
          <div className="ca-stats" style={{ marginTop: '1.2rem' }}>
            <div className="ca-stat"><b>{counts.new || 0}</b><small>New</small></div>
            <div className="ca-stat"><b>{counts.reviewing || 0}</b><small>Reviewing</small></div>
            <div className="ca-stat"><b>{counts.accepted || 0}</b><small>Accepted</small></div>
            <div className="ca-stat"><b>{apps.length}</b><small>All time</small></div>
          </div>
        )}

        <div className="ca-range" style={{ marginTop: '1.2rem' }}>
          {['all', 'new', 'reviewing', 'accepted', 'declined'].map((f) => (
            <button key={f} className={`ca-range-btn ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : STATUS_LABEL[f]}
            </button>
          ))}
        </div>

        {!apps && !error && <div className="ca-empty">Loading…</div>}
        {apps && shown.length === 0 && (
          <div className="ca-empty">
            <b>Nothing here</b>
            {filter === 'all' ? 'No applications yet — share the /apply link to start collecting them.' : `No applications with status "${STATUS_LABEL[filter]}".`}
          </div>
        )}

        <div className="house-ad-list">
          {shown.map((app) => {
            const rights = app.rights_result || null;
            const holds = app.rights_holds || [];
            return (
              <div key={app.id} className="house-ad-card app-card">
                <div className="house-ad-info">
                  <div className="house-ad-title">{app.title}</div>
                  <div className="house-ad-meta">
                    {app.name} · {app.email} · {new Date(app.created_at).toLocaleDateString()}
                    {app.user_id ? '' : ' · no account linked'}
                  </div>
                  <div className="house-ad-meta">
                    {[TYPE_LABEL[app.content_type] || app.content_type, app.main_genre, app.runtime, app.rating, STAND_LABEL[app.completion_status] || app.completion_status].filter(Boolean).join(' · ')}
                  </div>
                  <p className="app-logline">{app.logline}</p>

                  {rights && (
                    <div className="house-ad-meta" style={{ marginTop: '0.2rem' }}>
                      <span className={`b ${RIGHTS_CLASS[rights] || 'warn'}`}>{RIGHTS_LABEL[rights] || rights}</span>
                      {holds.length > 0 && <span style={{ marginLeft: '0.5rem' }}>Needs: {holds.join('; ')}</span>}
                    </div>
                  )}
                  {!rights && <div className="house-ad-meta" style={{ marginTop: '0.2rem' }}>No rights check (applied before it existed).</div>}

                  {openId === app.id && (
                    <div className="app-detail">
                      {app.description && <p>{app.description}</p>}
                      {app.portfolio_url && (
                        <p><strong>Portfolio:</strong> <a href={app.portfolio_url} target="_blank" rel="noopener noreferrer">{app.portfolio_url}</a></p>
                      )}
                      {app.media_link && (
                        <p><strong>Files:</strong> <a href={app.media_link} target="_blank" rel="noopener noreferrer">{app.media_link}</a></p>
                      )}
                      {app.media_notes && <p><strong>Notes from them:</strong> {app.media_notes}</p>}
                      {app.user_id && <p><strong>Account:</strong> <Link href={`/profile/${app.user_id}`}>{app.user_id}</Link>{app.role_granted_at ? ' · Creator Studio granted' : ''}</p>}
                      {app.decision_note && <p><strong>Note sent to them:</strong> {app.decision_note}</p>}
                      <p>
                        <a href={`mailto:${app.email}?subject=${encodeURIComponent(`Your submission to ${SITE.name} — ${app.title}`)}`}>
                          Email {app.name} →
                        </a>
                      </p>
                      {app.status !== 'accepted' && (
                        <div className="admin-field" style={{ marginTop: '0.6rem' }}>
                          <label>Note to the applicant <span className="admin-optional">optional, goes in the decision email and on /apply</span></label>
                          <textarea
                            rows={2}
                            value={notes[app.id] !== undefined ? notes[app.id] : (app.decision_note || '')}
                            onChange={(e) => setNotes((n) => ({ ...n, [app.id]: e.target.value }))}
                            placeholder="Why, or what would make it a fit next time."
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {flash[app.id] && <p className="app-logline" style={{ color: 'var(--ok)' }}>{flash[app.id]}</p>}

                  <button className="a11y-link" onClick={() => setOpenId(openId === app.id ? null : app.id)}>
                    {openId === app.id ? 'Hide details' : 'Show details'}
                  </button>
                </div>

                <div className="house-ad-actions">
                  <span className={`b ${app.status === 'accepted' ? 'ok' : app.status === 'declined' ? 'bad' : 'warn'}`}>
                    {STATUS_LABEL[app.status]}
                  </span>
                  {app.status !== 'reviewing' && app.status !== 'accepted' && <button onClick={() => setStatus(app, 'reviewing')} disabled={busyId === app.id}>Reviewing</button>}
                  {app.status !== 'accepted' && account.isAdmin && (
                    <button onClick={() => setStatus(app, 'accepted')} disabled={busyId === app.id} title="Grants Creator Studio to their account and emails them">
                      Accept · grant Creator Studio
                    </button>
                  )}
                  {app.status !== 'declined' && app.status !== 'accepted' && <button onClick={() => setStatus(app, 'declined')} disabled={busyId === app.id} className="house-ad-remove">Decline</button>}
                </div>
              </div>
            );
          })}
        </div>
      </AdminShell>
    </>
  );
}
