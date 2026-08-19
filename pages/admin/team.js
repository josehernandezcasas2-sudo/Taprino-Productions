import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { getAccountContext } from '../../lib/accountContext';
import HeaderNav from '../../components/HeaderNav';
import InstallButton from '../../components/InstallButton';
import MobileTabBar from '../../components/MobileTabBar';
import { SITE } from '../../lib/siteConfig';
import { ADMIN_CAPABILITIES } from '../../lib/capabilities';

// Deliberately gated on isAdmin, not canAccessAdmin — granting roles and
// setting a sub-admin's permissions is exactly the kind of action that
// must never be delegable to a sub-admin themselves (see the note in
// lib/capabilities.js). A sub-admin visiting /admin/team gets bounced the
// same as any other non-admin visitor would.
export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  if (!account.isAdmin) {
    return { redirect: { destination: '/', permanent: false } };
  }
  return {
    props: {
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator
    }
  };
}

export default function AdminTeam({ isSignedIn, isSubscriber, email, isAdmin, isCreator }) {
  const [roster, setRoster] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [grantEmail, setGrantEmail] = useState('');
  const [grantRole, setGrantRole] = useState('sub_admin');
  const [pendingPerms, setPendingPerms] = useState({}); // { [userId]: Set(keys) }

  async function loadRoster() {
    setError(null);
    try {
      const res = await fetch('/api/admin/creators');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load team roster.');
      setRoster(data.creators);
      const initial = {};
      data.creators.forEach((c) => {
        if (c.role === 'sub_admin') initial[c.id] = new Set(c.permissions || []);
      });
      setPendingPerms(initial);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    loadRoster();
  }, []);

  function togglePerm(userId, key) {
    setPendingPerms((prev) => {
      const next = { ...prev };
      const set = new Set(next[userId] || []);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      next[userId] = set;
      return next;
    });
  }

  async function savePermissions(person) {
    setBusyId(person.id);
    setError(null);
    try {
      const res = await fetch('/api/admin/set-permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetEmail: person.email,
          permissions: Array.from(pendingPerms[person.id] || [])
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save permissions.');
      await loadRoster();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function grantAccess(e) {
    e.preventDefault();
    if (!grantEmail.trim()) return;
    setBusyId('grant');
    setError(null);
    try {
      const res = await fetch('/api/admin/manage-creators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: grantEmail.trim(), action: 'grant', role: grantRole })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to grant access.');
      setGrantEmail('');
      await loadRoster();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function revokeAccess(person) {
    if (!confirm(`Revoke all access for ${person.email}?`)) return;
    setBusyId(person.id);
    setError(null);
    try {
      const res = await fetch('/api/admin/manage-creators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: person.email, action: 'revoke' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to revoke access.');
      await loadRoster();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <Head>
        <title>Team &amp; Permissions — {SITE.name} Admin</title>
      </Head>
      <HeaderNav isSignedIn={isSignedIn} isSubscriber={isSubscriber} email={email} isAdmin={isAdmin} isCreator={isCreator} />

      <main style={{ maxWidth: 900, margin: '0 auto', padding: '32px 20px 80px' }}>
        <p><Link href="/admin">&larr; Back to admin</Link></p>
        <h1>Team &amp; Permissions</h1>
        <p style={{ opacity: 0.75, maxWidth: 640 }}>
          Grant sub-admin access, then choose exactly what each sub-admin can do below.
          A sub-admin only sees the admin sections you've switched on for them — everything
          else is hidden, not just locked.
        </p>

        {error && (
          <div style={{ background: '#3a1414', border: '1px solid #a33', padding: 12, borderRadius: 8, marginBottom: 16 }}>
            {error}
          </div>
        )}

        <section style={{ marginBottom: 32 }}>
          <h2>Grant access</h2>
          <form onSubmit={grantAccess} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="email"
              placeholder="person@example.com"
              value={grantEmail}
              onChange={(e) => setGrantEmail(e.target.value)}
              required
              style={{ padding: 8, minWidth: 240 }}
            />
            <select value={grantRole} onChange={(e) => setGrantRole(e.target.value)} style={{ padding: 8 }}>
              <option value="sub_admin">Sub-admin (limited)</option>
              <option value="creator">Creator</option>
            </select>
            <button type="submit" disabled={busyId === 'grant'}>
              {busyId === 'grant' ? 'Granting…' : 'Grant access'}
            </button>
          </form>
          <p style={{ fontSize: 13, opacity: 0.65, marginTop: 6 }}>
            The person must already have a Studio Tapa account (they need to have signed up once) before you can grant them a role.
          </p>
        </section>

        <section>
          <h2>Current team</h2>
          {!roster && <p>Loading…</p>}
          {roster && roster.length === 0 && <p>No creators, sub-admins, or admins yet.</p>}
          {roster && roster.filter((p) => p.role !== 'admin').map((person) => (
            <div key={person.id} style={{ border: '1px solid #333', borderRadius: 8, padding: 16, marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <strong>{person.email}</strong>
                  <span style={{ marginLeft: 8, opacity: 0.65, fontSize: 13 }}>
                    {person.role === 'sub_admin' ? 'Sub-admin' : 'Creator'}
                  </span>
                </div>
                <button onClick={() => revokeAccess(person)} disabled={busyId === person.id} style={{ color: '#c55' }}>
                  Revoke all access
                </button>
              </div>

              {person.role === 'sub_admin' && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
                    {ADMIN_CAPABILITIES.map((cap) => {
                      const checked = (pendingPerms[person.id] || new Set()).has(cap.key);
                      return (
                        <label key={cap.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14 }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => togglePerm(person.id, cap.key)}
                          />
                          <span>
                            <strong>{cap.label}</strong>
                            <br />
                            <span style={{ opacity: 0.6, fontSize: 12 }}>{cap.description}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => savePermissions(person)}
                    disabled={busyId === person.id}
                    style={{ marginTop: 12 }}
                  >
                    {busyId === person.id ? 'Saving…' : 'Save permissions'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </section>
      </main>

      <InstallButton />
      <MobileTabBar isSignedIn={isSignedIn} isAdmin={isAdmin} />
    </div>
  );
}
