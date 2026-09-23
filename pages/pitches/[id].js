import Head from 'next/head';
import Link from 'next/link';
import Image from 'next/image';
import BackButton from '../../components/BackButton';
import { useState } from 'react';
import { useRouter } from 'next/router';
import { getAuth } from '@clerk/nextjs/server';
import { SignInButton } from '@clerk/nextjs';
import { getAccountContext } from '../../lib/accountContext';
import { usePlayerIconOverrides } from '../../components/PlayerIcons';
import WishlistButton from '../../components/WishlistButton';
import {
  getPitchById, getSimilarPitches, getPitchUpdates, getPitchComments, isPitchSaved
} from '../../lib/pitches';
import { getDonationsForPitch } from '../../lib/pitchDonations';
import { getPublicDisplayNames } from '../../lib/userProfiles';
import { getSiteSettings } from '../../lib/siteSettings';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import HeaderNav from '../../components/HeaderNav';
import InstallButton from '../../components/InstallButton';
import MobileTabBar from '../../components/MobileTabBar';
import Footer from '../../components/Footer';
import { SITE } from '../../lib/siteConfig';

export async function getServerSideProps({ req, res, params }) {
  const account = await getAccountContext(req);
  const siteSettings = await getSiteSettings();
  const bypassingDisabled = !siteSettings.elevatorPitchEnabled && account.isAdmin;

  if (!siteSettings.elevatorPitchEnabled && !account.isAdmin) {
    return { notFound: true };
  }

  const pitch = await getPitchById(params.id);
  if (!pitch || pitch.status !== 'approved') {
    return { notFound: true };
  }

  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const { userId } = getAuth(req);
  const [similar, updates, comments, episodes, saved, donations] = await Promise.all([
    getSimilarPitches(pitch.tag, pitch.id),
    getPitchUpdates(pitch.id),
    getPitchComments(pitch.id),
    getPublicEpisodes(),
    userId ? isPitchSaved(userId, pitch.id) : false,
    pitch.funding_enabled ? getDonationsForPitch(pitch.id) : Promise.resolve([])
  ]);
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];
  const totalRaisedCents = pitch.funding_enabled ? donations.reduce((sum, d) => sum + d.amountCents, 0) : null;
  const backerCount = pitch.funding_enabled ? new Set(donations.map((d) => d.donorUserId)).size : null;

  // Most recent unique backers, most-recent-donation-first — donations
  // already come back ordered newest-first (getDonationsForPitch), so
  // the first time a donor id appears in that order is their latest
  // donation. Capped at 8 so this stays a strip, not another grid.
  const seenDonors = new Set();
  const recentBackerIds = [];
  for (const d of donations) {
    if (seenDonors.has(d.donorUserId)) continue;
    seenDonors.add(d.donorUserId);
    recentBackerIds.push(d.donorUserId);
    if (recentBackerIds.length >= 8) break;
  }
  const backerNames = recentBackerIds.length > 0 ? await getPublicDisplayNames(recentBackerIds) : {};
  const recentBackers = recentBackerIds.map((id) => ({ userId: id, displayName: backerNames[id] }));

  return {
    props: {
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      bypassingDisabled,
      isCreator: account.isCreator,
      userId: userId || null,
      mainGenres,
      pitch,
      similar,
      updates,
      comments,
      initialSaved: saved,
      totalRaisedCents,
      backerCount,
      recentBackers
    }
  };
}

const DONATION_PRESETS = [10, 25, 50];

const REPORT_REASONS = ['Spam', 'Harassment', 'Off-topic', 'Other'];

// Comments today, tomorrow, and yesterday get a short relative-feeling
// label; anything older falls back to a plain date — the same "recent
// stuff reads as recent, old stuff reads as a date" split most comment
// sections use, without pulling in a whole relative-time library for it.
function formatCommentDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function countComments(list) {
  return list.reduce((sum, c) => sum + 1 + (c.replies ? c.replies.length : 0), 0);
}

export default function PitchDetail({ isSignedIn, isSubscriber, email, isAdmin, isCreator, userId, mainGenres, pitch, similar, updates, comments, initialSaved, bypassingDisabled, totalRaisedCents, backerCount, recentBackers }) {
  const iconOverrides = usePlayerIconOverrides();
  const router = useRouter();
  const [saved, setSaved] = useState(initialSaved);
  const [commentList, setCommentList] = useState(comments);
  const [commentText, setCommentText] = useState('');
  const [posting, setPosting] = useState(false);
  const [commentError, setCommentError] = useState(null);
  const [reportedIds, setReportedIds] = useState(new Set());
  const [reportingId, setReportingId] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [postingReply, setPostingReply] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [donationAmount, setDonationAmount] = useState('');
  const [donating, setDonating] = useState(false);
  const [donationError, setDonationError] = useState(null);
  const [donationSuccess, setDonationSuccess] = useState(false);
  const [currentTotalRaisedCents, setCurrentTotalRaisedCents] = useState(totalRaisedCents);

  // funding_enabled pitches are tracked for real via pitch_donations
  // (currentTotalRaisedCents), so the bar/percentage should reflect that
  // live number — pitch.funding_raised is the older self-reported field,
  // only meaningful for the external-link campaigns that never turned
  // funding_enabled on.
  const raisedForPct = pitch.funding_enabled ? (currentTotalRaisedCents || 0) / 100 : (pitch.funding_raised || 0);
  const pct = pitch.funding_goal ? Math.min(100, Math.round((raisedForPct / pitch.funding_goal) * 100)) : null;

  // Same calendar-date-only logic as pages/pitches.js — see that file's
  // comment for why "tomorrow" reads as 1 day left rather than 2, why
  // today floors to 1 instead of 0, and why a passed deadline returns
  // null instead of a negative number.
  const remaining = (() => {
    if (!pitch.funding_deadline) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const deadline = new Date(pitch.funding_deadline + 'T00:00:00');
    const diffDays = Math.round((deadline - today) / 86400000);
    return diffDays < 0 ? null : Math.max(1, diffDays);
  })();

  async function toggleSave() {
    if (!isSignedIn) return;
    setSaved((s) => !s);
    await fetch('/api/pitch-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pitchId: pitch.id })
    }).catch(() => {});
  }

  async function donate(e) {
    e.preventDefault();
    setDonationError(null);
    const amount = Number(donationAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setDonationError('Enter an amount greater than $0.');
      return;
    }
    setDonating(true);
    try {
      const res = await fetch('/api/pitches/donate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pitchId: pitch.id, amountDollars: amount })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not process that donation.');
      setCurrentTotalRaisedCents((prev) => (prev || 0) + data.donation.amountCents);
      setDonationAmount('');
      setDonationSuccess(true);
      setTimeout(() => setDonationSuccess(false), 4000);
    } catch (err) {
      setDonationError(err.message);
    } finally {
      setDonating(false);
    }
  }

  function share() {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    if (navigator.share) {
      navigator.share({ title: pitch.title, url }).catch(() => {});
    } else {
      navigator.clipboard.writeText(url).then(() => {
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 2000);
      });
    }
  }

  async function refreshComments() {
    try {
      const res = await fetch(`/api/pitch-comments?pitchId=${pitch.id}`);
      const data = await res.json();
      if (res.ok) setCommentList(data.comments);
    } catch (err) {
      // Non-fatal — the list just stays as whatever it already was.
    }
  }

  async function postComment(e) {
    e.preventDefault();
    if (!commentText.trim()) return;
    setPosting(true);
    setCommentError(null);
    try {
      const res = await fetch('/api/pitch-comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pitchId: pitch.id, body: commentText })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not post your comment.');
      setCommentText('');
      // Re-fetching rather than splicing a fake entry into local state —
      // the real comment needs its display name resolved server-side
      // (see getPitchComments), which a locally-fabricated placeholder
      // can't do correctly.
      await refreshComments();
    } catch (err) {
      setCommentError(err.message);
    } finally {
      setPosting(false);
    }
  }

  async function postReply(parentCommentId) {
    if (!replyText.trim()) return;
    setPostingReply(true);
    setCommentError(null);
    try {
      const res = await fetch('/api/pitch-comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pitchId: pitch.id, body: replyText, parentCommentId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not post your reply.');
      setReplyText('');
      setReplyingTo(null);
      await refreshComments();
    } catch (err) {
      setCommentError(err.message);
    } finally {
      setPostingReply(false);
    }
  }

  async function reportComment(commentId, reason) {
    setReportingId(null);
    setReportedIds((prev) => new Set(prev).add(commentId));
    await fetch('/api/pitch-comment-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commentId, reason })
    }).catch(() => {});
  }

  function startEdit(c) {
    setEditingId(c.id);
    setEditText(c.body);
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditText('');
    setEditError(null);
  }

  async function saveEdit(commentId) {
    if (!editText.trim()) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await fetch('/api/pitch-comment', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId, body: editText })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save your edit.');
      setEditingId(null);
      setEditText('');
      await refreshComments();
    } catch (err) {
      setEditError(err.message);
    } finally {
      setEditSaving(false);
    }
  }

  async function deleteComment(commentId) {
    if (!window.confirm('Delete this comment? This can’t be undone.')) return;
    setDeletingId(commentId);
    try {
      const res = await fetch('/api/pitch-comment', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId })
      });
      if (!res.ok) throw new Error();
      await refreshComments();
    } catch (err) {
      alert('Could not delete that comment — try again.');
    } finally {
      setDeletingId(null);
    }
  }

  // Shared between top-level comments and their (one-level-deep) replies —
  // avatar/name/badge, edit-in-place, delete, report, and (top-level
  // only) the reply thread beneath it. Recreated each render like any
  // other closure-capturing helper here; the list is small enough that
  // this costs nothing worth avoiding.
  function renderComment(c, { isReply } = {}) {
    const isOwn = Boolean(userId) && c.user_id === userId;
    const isCreatorComment = Boolean(pitch.created_by) && c.user_id === pitch.created_by;
    const isEditing = editingId === c.id;

    return (
      <div key={c.id} className={`pitch-comment-card${isReply ? ' pitch-reply-card' : ''}`}>
        <div className="pitch-comment-meta">
          <div className="pitch-comment-who">
            <Link href={`/profile/${c.user_id}`} className="pitch-comment-avatar">{(c.displayName || '?')[0].toUpperCase()}</Link>
            <Link href={`/profile/${c.user_id}`} className="pitch-comment-name">{c.displayName}</Link>
            {isCreatorComment && <span className="pitch-comment-badge">Creator</span>}
          </div>
          <span className="pitch-comment-date">{formatCommentDate(c.created_at)}{c.updated_at ? ' · edited' : ''}</span>
        </div>

        {isEditing ? (
          <div className="pitch-edit-form">
            {editError && <p style={{ color: 'var(--danger)', fontSize: '0.8rem' }}>{editError}</p>}
            <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={2} maxLength={1000} />
            <div className="pitch-char-count">{editText.length}/1000</div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="account-btn-primary" style={{ width: 'auto' }} disabled={editSaving} onClick={() => saveEdit(c.id)}>
                {editSaving ? 'Saving…' : 'Save'}
              </button>
              <button className="account-btn-secondary" style={{ width: 'auto' }} onClick={cancelEdit}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="pitch-comment-body">{c.body}</div>
        )}

        {!isEditing && (
          <div className="pitch-comment-actions">
            {isSignedIn && !isReply && (
              <button className="pitch-comment-reply-btn" onClick={() => { setReplyingTo(replyingTo === c.id ? null : c.id); setReplyText(''); }}>
                ↩ Reply
              </button>
            )}
            {isOwn && (
              <>
                <button className="pitch-comment-reply-btn" onClick={() => startEdit(c)}>Edit</button>
                <button className="pitch-comment-report" onClick={() => deleteComment(c.id)} disabled={deletingId === c.id}>
                  {deletingId === c.id ? 'Deleting…' : 'Delete'}
                </button>
              </>
            )}
            {isSignedIn && !isOwn && (
              reportedIds.has(c.id) ? (
                <span style={{ fontSize: '0.7rem', color: 'var(--ink-dim)' }}>Reported — thank you.</span>
              ) : reportingId === c.id ? (
                <div className="pitch-report-picker">
                  {REPORT_REASONS.map((r) => (
                    <button key={r} type="button" className="pitch-report-reason-btn" onClick={() => reportComment(c.id, r)}>{r}</button>
                  ))}
                  <button type="button" className="pitch-report-reason-btn" onClick={() => setReportingId(null)}>Cancel</button>
                </div>
              ) : (
                <button className="pitch-comment-report" onClick={() => setReportingId(c.id)}>Report</button>
              )
            )}
          </div>
        )}

        {!isReply && replyingTo === c.id && (
          <div className="pitch-reply-form">
            <textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder={`Reply to ${c.displayName}…`}
              rows={2}
              maxLength={1000}
            />
            <div className="pitch-char-count">{replyText.length}/1000</div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="account-btn-primary" style={{ width: 'auto' }} disabled={postingReply} onClick={() => postReply(c.id)}>
                {postingReply ? 'Posting…' : 'Post reply'}
              </button>
              <button className="account-btn-secondary" style={{ width: 'auto' }} onClick={() => setReplyingTo(null)}>Cancel</button>
            </div>
          </div>
        )}

        {!isReply && c.replies && c.replies.length > 0 && (
          <div className="pitch-reply-list">
            {c.replies.map((r) => renderComment(r, { isReply: true }))}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>{pitch.title} — Pitch Room — {SITE.name}</title>
        <meta name="description" content={pitch.logline} />
      </Head>

      <HeaderNav
        activeType="All"
        mainGenres={mainGenres}
        isSignedIn={isSignedIn}
        email={email}
        isAdmin={isAdmin}
        isCreator={isCreator}
        isSubscriber={isSubscriber}
      />
      <div className="install-row"><InstallButton /></div>
      {bypassingDisabled && (
        <div className="admin-preview-banner">
          ⚠ Pitch Room is turned off for the public right now — you're seeing this because you're an admin.
          <Link href="/admin">Go turn it back on</Link>
        </div>
      )}

      <div className="hero-carousel full-bleed">
        {pitch.hero_image || pitch.thumbnail ? (
          <Image src={pitch.hero_image || pitch.thumbnail} alt="" fill priority sizes="100vw" className="hero-video hero-image" />
        ) : (
          <div className="hero-video" style={{ background: 'linear-gradient(120deg,#3a4a6a,#2a2a3a)' }} />
        )}
        <div className="hero-scrim" />
        <div className="hero-inner">
          <div className="hero-content">
            <div className="hero-eyebrow">{pitch.tag || 'Project'} &middot; Pitch Room</div>
            <h2>{pitch.title}</h2>

            {pct !== null && (
              <div className="pitch-progress-track pitch-progress-track-lg">
                <div className="pitch-progress-fill" style={{ width: `${pct}%` }} />
              </div>
            )}

            <div className="hero-meta">
              {pct !== null && <span className="hero-badge-tier">{pct}% funded</span>}
              {pitch.creator_name && (
                <>
                  <span className="hero-meta-dot">&bull;</span>
                  {pitch.created_by ? (
                    <Link href={`/profile/${pitch.created_by}`} style={{ color: 'inherit' }}>By {pitch.creator_name}</Link>
                  ) : (
                    <span>By {pitch.creator_name}</span>
                  )}
                </>
              )}
              {pitch.funding_enabled ? (
                <>
                  <span className="hero-meta-dot">&bull;</span>
                  <span>${((currentTotalRaisedCents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} raised so far</span>
                  {backerCount > 0 && (
                    <>
                      <span className="hero-meta-dot">&bull;</span>
                      <span>{backerCount} backer{backerCount === 1 ? '' : 's'}</span>
                    </>
                  )}
                </>
              ) : pitch.funding_goal && (
                <>
                  <span className="hero-meta-dot">&bull;</span>
                  <span>${Number(pitch.funding_raised || 0).toLocaleString()} of ${Number(pitch.funding_goal).toLocaleString()} goal</span>
                </>
              )}
              {remaining !== null && (
                <>
                  <span className="hero-meta-dot">&bull;</span>
                  <span style={{ color: 'var(--signal-amber)', fontWeight: 600 }}>{remaining === 1 ? 'Last day' : `${remaining} days left`}</span>
                </>
              )}
            </div>
            <p>{pitch.logline}</p>
            <div className="hero-actions">
              {!pitch.funding_enabled && pitch.project_url && (
                <a href={pitch.project_url} target="_blank" rel="noopener noreferrer" className="fund-btn">&#9670; Fund this project</a>
              )}
              <WishlistButton isActive={saved} onToggle={toggleSave} className="wishlist-btn-large" />
              <div className="pitch-share-wrap">
                <button className="wishlist-btn wishlist-btn-large" onClick={share} aria-label="Share" title="Share">
                  {shareCopied ? '✓' : '⇪'}
                </button>
                {shareCopied && <span className="pitch-share-toast" role="status">Link copied!</span>}
              </div>
            </div>
            {pitch.funding_enabled && (
              <div style={{ marginTop: 14 }}>
                {isSignedIn ? (
                  <form onSubmit={donate}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                      {DONATION_PRESETS.map((amount) => (
                        <button
                          key={amount}
                          type="button"
                          className="pitch-preset-btn"
                          aria-pressed={donationAmount === String(amount)}
                          onClick={() => setDonationAmount(String(amount))}
                          disabled={donating}
                        >
                          ${amount}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ opacity: 0.7 }}>$</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      placeholder="Amount"
                      value={donationAmount}
                      onChange={(e) => setDonationAmount(e.target.value)}
                      style={{ width: '100px' }}
                      disabled={donating}
                    />
                    <button type="submit" className="fund-btn" disabled={donating}>
                      {donating ? 'Sending…' : '\u25C6 Support this project'}
                    </button>
                    {donationSuccess && <span style={{ color: 'var(--ok)', fontSize: 13 }}>Thank you for your support!</span>}
                    </div>
                  </form>
                ) : (
                  <p style={{ fontSize: 13, opacity: 0.75 }}>
                    <SignInButton mode="modal">
                      <span style={{ cursor: 'pointer', textDecoration: 'underline' }}>Sign in</span>
                    </SignInButton>
                    {' '}to support this project.
                  </p>
                )}
                {donationError && <p style={{ color: 'var(--signal-red, #c55)', fontSize: 13, marginTop: 6 }}>{donationError}</p>}
                <p style={{ fontSize: 12, opacity: 0.55, marginTop: 6 }}>
                  Support is recorded now — real payment processing for this project is coming soon.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <main className="library-stage">
        <BackButton fallbackHref="/pitches" />
        {pitch.description && (
          <>
            <div className="pitch-section-label">The project</div>
            <p style={{ maxWidth: '70ch', lineHeight: 1.6 }}>{pitch.description}</p>
          </>
        )}

        {pitch.team && pitch.team.length > 0 && (
          <>
            <div className="pitch-section-label">Created by</div>
            <div className="pitch-team-row">
              {pitch.team.map((member, i) => (
                <div key={i} className="pitch-team-card">
                  <div className="pitch-team-avatar">{member.name ? member.name[0].toUpperCase() : '?'}</div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{member.name}</div>
                    <div style={{ color: 'var(--ink-dim)', fontSize: '0.76rem' }}>{member.role}</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {pitch.photos && pitch.photos.length > 0 && (
          <>
            <div className="pitch-section-label">Photos</div>
            <div className="pitch-photo-row">
              {pitch.photos.map((url, i) => (
                <div key={i} className="pitch-photo-item" style={{ backgroundImage: `url(${url})` }} />
              ))}
            </div>
          </>
        )}

        {updates.length > 0 && (
          <>
            <div className="pitch-section-label">Project updates</div>
            {updates.map((u) => (
              <div key={u.id} className="pitch-update-card">
                <div className="pitch-update-date">{new Date(u.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }).toUpperCase()}</div>
                <div style={{ fontWeight: 700, marginBottom: '0.4rem' }}>{u.title}</div>
                <div style={{ color: 'var(--ink-dim)', fontSize: '0.86rem', lineHeight: 1.5 }}>{u.body}</div>
              </div>
            ))}
          </>
        )}

        {recentBackers.length > 0 && (
          <>
            <div className="pitch-section-label">Backers{backerCount > recentBackers.length ? ` (${backerCount})` : ''}</div>
            <div className="pitch-backer-row">
              {recentBackers.map((b) => (
                <Link key={b.userId} href={`/profile/${b.userId}`} className="pitch-backer">
                  <div className="pitch-backer-avatar">{(b.displayName || '?')[0].toUpperCase()}</div>
                  <span>{b.displayName}</span>
                </Link>
              ))}
            </div>
          </>
        )}

        {similar.length > 0 && (
          <>
            <div className="pitch-section-label">Similar projects</div>
            <div className="pitch-grid" style={{ marginBottom: '1rem' }}>
              {similar.map((p) => (
                <Link key={p.id} href={`/pitches/${p.id}`} className="pitch-card">
                  <div className="pitch-thumb" style={p.thumbnail ? { backgroundImage: `url(${p.thumbnail})` } : {}}>
                    {p.tag && <span className="pitch-tag">{p.tag}</span>}
                  </div>
                  <div className="pitch-info">
                    <h4>{p.title}</h4>
                    {p.creator_name && (
                      p.created_by ? (
                        <span
                          className="creator creator-link"
                          role="link"
                          tabIndex={0}
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(`/profile/${p.created_by}`); }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault(); e.stopPropagation();
                              router.push(`/profile/${p.created_by}`);
                            }
                          }}
                        >
                          {p.creator_name}
                        </span>
                      ) : (
                        <div className="creator">{p.creator_name}</div>
                      )
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}

        <div className="pitch-section-label">Discussion{commentList.length > 0 ? ` (${countComments(commentList)})` : ''}</div>
        {isSignedIn ? (
          <form className="pitch-comment-form" onSubmit={postComment} style={{ marginBottom: '1.2rem' }}>
            {commentError && <p style={{ color: 'var(--danger)' }}>{commentError}</p>}
            <textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Say something about this project…"
              rows={2}
              maxLength={1000}
            />
            <div className="pitch-char-count">{commentText.length}/1000</div>
            <button className="account-btn-primary" type="submit" disabled={posting} style={{ width: 'auto' }}>
              {posting ? 'Posting…' : 'Post comment'}
            </button>
          </form>
        ) : (
          <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem', marginBottom: '1.2rem' }}>Sign in to join the discussion.</p>
        )}

        {commentList.length === 0 ? (
          <div className="pitch-discussion-empty">No comments yet — be the first to say something.</div>
        ) : (
          commentList.map((c) => renderComment(c))
        )}
      </main>
      <Footer />
      <MobileTabBar />
    </>
  );
}
