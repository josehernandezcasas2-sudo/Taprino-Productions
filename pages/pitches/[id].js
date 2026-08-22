import Head from 'next/head';
import Link from 'next/link';
import { useState } from 'react';
import { getAuth } from '@clerk/nextjs/server';
import { getAccountContext } from '../../lib/accountContext';
import {
  getPitchById, getSimilarPitches, getPitchUpdates, getPitchComments, isPitchSaved
} from '../../lib/pitches';
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
  const [similar, updates, comments, episodes, saved] = await Promise.all([
    getSimilarPitches(pitch.tag, pitch.id),
    getPitchUpdates(pitch.id),
    getPitchComments(pitch.id),
    getPublicEpisodes(),
    userId ? isPitchSaved(userId, pitch.id) : false
  ]);
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];

  return {
    props: {
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      bypassingDisabled,
      isCreator: account.isCreator,
      mainGenres,
      pitch,
      similar,
      updates,
      comments,
      initialSaved: saved
    }
  };
}

export default function PitchDetail({ isSignedIn, isSubscriber, email, isAdmin, isCreator, mainGenres, pitch, similar, updates, comments, initialSaved, bypassingDisabled }) {
  const [saved, setSaved] = useState(initialSaved);
  const [commentList, setCommentList] = useState(comments);
  const [commentText, setCommentText] = useState('');
  const [posting, setPosting] = useState(false);
  const [commentError, setCommentError] = useState(null);
  const [reportedIds, setReportedIds] = useState(new Set());
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [postingReply, setPostingReply] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  const pct = pitch.funding_goal ? Math.min(100, Math.round(((pitch.funding_raised || 0) / pitch.funding_goal) * 100)) : null;

  async function toggleSave() {
    if (!isSignedIn) return;
    setSaved((s) => !s);
    await fetch('/api/pitch-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pitchId: pitch.id })
    }).catch(() => {});
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

  async function reportComment(commentId) {
    setReportedIds((prev) => new Set(prev).add(commentId));
    await fetch('/api/pitch-comment-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commentId })
    }).catch(() => {});
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
          <img src={pitch.hero_image || pitch.thumbnail} alt="" className="hero-video hero-image" />
        ) : (
          <div className="hero-video" style={{ background: 'linear-gradient(120deg,#3a4a6a,#2a2a3a)' }} />
        )}
        <div className="hero-scrim" />
        <div className="hero-inner">
          <div className="hero-content">
            <div className="hero-eyebrow">{pitch.tag || 'Project'} &middot; Pitch Room</div>
            <h2>{pitch.title}</h2>
            <div className="hero-meta">
              {pct !== null && <span className="hero-badge-tier">{pct}% funded</span>}
              {pitch.creator_name && (
                <>
                  <span className="hero-meta-dot">&bull;</span>
                  <span>By {pitch.creator_name}</span>
                </>
              )}
              {pitch.funding_goal && (
                <>
                  <span className="hero-meta-dot">&bull;</span>
                  <span>${Number(pitch.funding_raised || 0).toLocaleString()} of ${Number(pitch.funding_goal).toLocaleString()} goal</span>
                </>
              )}
            </div>
            <p>{pitch.logline}</p>
            <div className="hero-actions">
              {pitch.project_url && (
                <a href={pitch.project_url} target="_blank" rel="noopener noreferrer" className="fund-btn">&#9670; Fund this project</a>
              )}
              <button className="wishlist-btn-large" onClick={toggleSave} aria-label={saved ? 'Unsave' : 'Save'}>
                {saved ? '♥' : '♡'}
              </button>
              <button className="wishlist-btn-large" onClick={share} aria-label="Share" title="Share">
                {shareCopied ? '✓' : '⇪'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <main className="library-stage">
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
                    {p.creator_name && <div className="creator">{p.creator_name}</div>}
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}

        <div className="pitch-section-label">Discussion</div>
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
          commentList.map((c) => (
            <div key={c.id} className="pitch-comment-card">
              <div className="pitch-comment-meta">
                <span>{c.displayName}</span>
                <span>{new Date(c.created_at).toLocaleDateString()}</span>
              </div>
              <div className="pitch-comment-body">{c.body}</div>
              <div className="pitch-comment-actions">
                {isSignedIn && (
                  <button className="pitch-comment-reply-btn" onClick={() => { setReplyingTo(replyingTo === c.id ? null : c.id); setReplyText(''); }}>
                    ↩ Reply
                  </button>
                )}
                {isSignedIn && (
                  reportedIds.has(c.id) ? (
                    <span style={{ fontSize: '0.7rem', color: 'var(--ink-dim)' }}>Reported — thank you.</span>
                  ) : (
                    <button className="pitch-comment-report" onClick={() => reportComment(c.id)}>Report</button>
                  )
                )}
              </div>

              {replyingTo === c.id && (
                <div className="pitch-reply-form">
                  <textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder={`Reply to ${c.displayName}…`}
                    rows={2}
                    maxLength={1000}
                  />
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="account-btn-primary" style={{ width: 'auto' }} disabled={postingReply} onClick={() => postReply(c.id)}>
                      {postingReply ? 'Posting…' : 'Post reply'}
                    </button>
                    <button className="account-btn-secondary" style={{ width: 'auto' }} onClick={() => setReplyingTo(null)}>Cancel</button>
                  </div>
                </div>
              )}

              {c.replies && c.replies.length > 0 && (
                <div className="pitch-reply-list">
                  {c.replies.map((r) => (
                    <div key={r.id} className="pitch-comment-card pitch-reply-card">
                      <div className="pitch-comment-meta">
                        <span>{r.displayName}</span>
                        <span>{new Date(r.created_at).toLocaleDateString()}</span>
                      </div>
                      <div className="pitch-comment-body">{r.body}</div>
                      {isSignedIn && !reportedIds.has(r.id) && (
                        <button className="pitch-comment-report" onClick={() => reportComment(r.id)}>Report</button>
                      )}
                      {reportedIds.has(r.id) && <span style={{ fontSize: '0.7rem', color: 'var(--ink-dim)' }}>Reported — thank you.</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </main>
      <Footer />
      <MobileTabBar />
    </>
  );
}
