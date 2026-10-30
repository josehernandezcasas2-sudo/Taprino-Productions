import { useState } from 'react';
import { useClerk } from '@clerk/nextjs';
import { SITE } from '../../lib/siteConfig';

// /account/security (option B, 2026-10-29): sign-in (email & password,
// two-step, signed-in devices — all through Clerk's own profile modal),
// log out of this device, and the delete-account request. The two-step
// note for the team (lib/adminTwoFactor.js) sits at the top when it
// applies. The handlers are the ones the old one-page /account had.
export default function SecuritySection({ email, teamTwoStep = null, twoFactorEnabled = false }) {
  const { signOut, openUserProfile } = useClerk();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteRequesting, setDeleteRequesting] = useState(false);
  const [deleteRequested, setDeleteRequested] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  async function handleRequestDeletion() {
    if (deleteConfirmText.trim().toUpperCase() !== 'DELETE') return;
    setDeleteRequesting(true);
    setDeleteError(null);
    try {
      const res = await fetch('/api/account/request-deletion', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not send that request.');
      setDeleteRequested(true);
      setDeleteConfirmOpen(false);
      setDeleteConfirmText('');
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setDeleteRequesting(false);
    }
  }

  const twoStepOn = teamTwoStep ? teamTwoStep.on : twoFactorEnabled;

  return (
    <>
      <div className="account-card">
        <div className="account-subheading">Sign-in</div>
        {teamTwoStep && !teamTwoStep.on && (
          <div className="account-twostep" role="note">
            <b>{teamTwoStep.required ? 'Admin tools are locked until two-step verification is on.' : 'Turn on two-step verification.'}</b>{' '}
            Your account can reach people&rsquo;s money and private data. Press Manage, open Security, and add an authenticator app; the admin pages open again as soon as it&rsquo;s set.
          </div>
        )}
        <div className="account-row">
          <div>
            <div className="account-row-label">Email &amp; password</div>
            <div className="account-row-detail">{email || 'Change your email or reset your password.'}</div>
          </div>
          <button className="account-btn-secondary" onClick={() => openUserProfile()}>Manage</button>
        </div>
        <div className="account-row">
          <div>
            <div className="account-row-label">Two-step verification</div>
            <div className="account-row-detail">{twoStepOn ? 'On — an authenticator app confirms new sign-ins.' : 'Off — add an authenticator app for new sign-ins.'}</div>
          </div>
          {twoStepOn ? (
            <span className="acct-chip ok">On</span>
          ) : (
            <button className="account-btn-secondary" onClick={() => openUserProfile()}>Turn on</button>
          )}
        </div>
        <div className="account-row">
          <div>
            <div className="account-row-label">Signed-in devices</div>
            <div className="account-row-detail">See where you&rsquo;re signed in and sign a device out.</div>
          </div>
          <button className="account-btn-secondary" onClick={() => openUserProfile()}>Manage</button>
        </div>
        <p className="account-fineprint" style={{ marginTop: '0.6rem' }}>Manage opens your sign-in settings, where the email, password, two-step and devices live.</p>
      </div>

      <div className="account-card">
        <div className="account-subheading">This device</div>
        <div className="account-row">
          <div>
            <div className="account-row-label">Log out</div>
            <div className="account-row-detail">Sign out of {SITE.name} here.</div>
          </div>
          <button className="account-btn-secondary" onClick={() => signOut({ redirectUrl: '/' })}>Log out</button>
        </div>
      </div>

      <div className="account-card account-card-danger" id="delete">
        <div className="account-subheading">Delete account</div>
        <div className="account-row">
          <div>
            <div className="account-row-label danger">Delete account</div>
            <div className="account-row-detail">Permanently removes your profile, wishlist, and viewing history. This can&rsquo;t be undone.</div>
          </div>
          {!deleteConfirmOpen && !deleteRequested && (
            <button className="account-btn-danger" onClick={() => setDeleteConfirmOpen(true)}>Delete account…</button>
          )}
        </div>
        {deleteConfirmOpen && (
          <div style={{ background: 'rgba(var(--danger-rgb),0.08)', border: '1px solid var(--danger-deep)', borderRadius: 6, padding: '0.9rem 1rem', marginTop: '0.4rem' }}>
            <p style={{ margin: '0 0 0.7rem', fontSize: '0.82rem', color: 'var(--ink)' }}>
              This sends a deletion request to our team, who will action it and confirm by email — it
              doesn&rsquo;t delete anything instantly. Type <strong>DELETE</strong> to confirm.
            </p>
            {deleteError && <p style={{ color: 'var(--danger)', fontSize: '0.82rem', marginBottom: '0.6rem' }}>{deleteError}</p>}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="DELETE"
                aria-label="Type DELETE to confirm"
                style={{ flex: 1, marginBottom: 0 }}
              />
              <button
                className="account-btn-danger"
                disabled={deleteRequesting || deleteConfirmText.trim().toUpperCase() !== 'DELETE'}
                onClick={handleRequestDeletion}
              >
                {deleteRequesting ? 'Sending…' : 'Confirm request'}
              </button>
              <button className="account-btn-secondary" style={{ width: 'auto', marginBottom: 0 }} onClick={() => { setDeleteConfirmOpen(false); setDeleteConfirmText(''); setDeleteError(null); }}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {deleteRequested && (
          <p style={{ color: 'var(--ok)', fontSize: '0.85rem', marginTop: '0.6rem' }}>
            Request sent — our team will follow up by email to confirm.
          </p>
        )}
      </div>
    </>
  );
}
