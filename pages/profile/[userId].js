import Head from 'next/head';
import Link from 'next/link';
import { useState } from 'react';
import { SignInButton } from '@clerk/nextjs';
import BackButton from '../../components/BackButton';
import { ShareIcon, CheckIcon, VideoCameraIcon, ImageIcon, usePlayerIconOverrides } from '../../components/PlayerIcons';
import PostMenu from '../../components/PostMenu';
import PostViewerModal from '../../components/PostViewerModal';
import { getProfileHubData } from '../../lib/profileHub';
import { formatRuntime } from '../../lib/videoMetadata';
import HeaderNav from '../../components/HeaderNav';
import MobileTabBar from '../../components/MobileTabBar';
import Footer from '../../components/Footer';
import { SITE } from '../../lib/siteConfig';
import { bannerStyle } from '../../lib/profileBanner';
import ReportButton from '../../components/ReportButton';

export async function getServerSideProps({ req, res, params }) {
  // Signed-in requests skip the shared cache entirely — same rule as
  // about.js/channel.js/stream.js/etc. Without this, a creator who just
  // posted and immediately checks their own profile can be served an
  // edge-cached copy from before their post existed, for up to five
  // minutes (longer under stale-while-revalidate).
  const hasSession = Boolean(req.headers.cookie && /__session|__clerk/.test(req.headers.cookie));
  if (hasSession) {
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  } else {
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  }

  const data = await getProfileHubData(params.userId, req);
  if (!data) return { notFound: true };

  return { props: data };
}

function hostnameFor(url) {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return 'Link';
  }
}

function workTypeLabel(item) {
  if (item.contentType === 'series' || item.type === 'series') return 'Series';
  if (item.contentType === 'movie') return 'Film';
  if (item.contentType === 'podcast') return 'Podcast';
  return 'Short';
}

function workHref(item) {
  return item.type === 'series' ? `/series/${item.id}` : `/episode/${item.id}`;
}

function formatViews(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(n % 1000000 >= 100000 ? 1 : 0)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0)}K`;
  return String(n);
}

export default function PublicProfile({ profile, canonicalPath, creditedWork, pitches, backedPitches, posts: initialPosts, savedSnippets: initialSavedSnippets, totalViews, knownForGenres, followerCount: initialFollowerCount, followingCount, viewerFollows: initialViewerFollows, roleBadge, mainGenres, isSignedIn, viewerId, isSubscriber, email, isAdmin, isCreator }) {
  const iconOverrides = usePlayerIconOverrides();
  const [shareCopied, setShareCopied] = useState(false);
  const [following, setFollowing] = useState(Boolean(initialViewerFollows));
  const [followerCount, setFollowerCount] = useState(initialFollowerCount || 0);
  const [followBusy, setFollowBusy] = useState(false);
  const [followError, setFollowError] = useState(null);
  const [posts, setPosts] = useState(initialPosts);
  const [savedSnippets, setSavedSnippets] = useState(initialSavedSnippets);
  // Which grid opened the viewer — 'posts' or 'saved' — plus the index
  // into that specific array. PostViewerModal reads posts/handlers for
  // whichever one this points at (see its render below).
  const [viewer, setViewer] = useState(null);
  const isOwnProfile = Boolean(viewerId) && viewerId === profile.userId;
  const initial = profile.displayName && profile.displayName[0] ? profile.displayName[0].toUpperCase() : '?';
  const joinedLabel = profile.joinedAt
    ? new Date(profile.joinedAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : null;
  // Newest post gets the big slot in the middle column; the rest grid up
  // under it. Both still index into the same posts array for the viewer.
  const latestPost = posts[0] || null;
  const olderPosts = posts.slice(1);
  const sections = [
    { id: 'profile-about', label: 'About' },
    latestPost && { id: 'profile-latest', label: 'Latest post' },
    olderPosts.length > 0 && { id: 'profile-posts', label: 'Posts' },
    isOwnProfile && savedSnippets.length > 0 && { id: 'profile-saved', label: 'Saved' },
    { id: 'profile-tagged', label: 'Tagged in' },
    pitches.length > 0 && { id: 'profile-pitches', label: 'Pitches' },
    backedPitches.length > 0 && { id: 'profile-backed', label: 'Backed' }
  ].filter(Boolean);

  async function deleteOwnPost(postId) {
    const res = await fetch(`/api/posts/${postId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Could not delete that post.');
    setPosts((p) => p.filter((post) => post.id !== postId));
  }

  async function editOwnPostCaption(postId, newCaption) {
    const res = await fetch(`/api/posts/${postId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caption: newCaption })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not save that edit.');
    setPosts((p) => p.map((post) => (post.id === postId ? { ...post, caption: newCaption } : post)));
  }

  async function reportPost(postId, reason) {
    await fetch('/api/posts/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId, reason })
    }).catch(() => {});
  }

  async function toggleLike(postId) {
    const res = await fetch('/api/posts/like', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not update that like.');
    // Trusts the server's fresh count/liked state over an optimistic
    // guess — two taps in quick succession (or two tabs) racing each
    // other should settle on whatever actually landed, not whichever
    // request's optimistic update happened to render last.
    setPosts((p) => p.map((post) => (post.id === postId ? { ...post, likesCount: data.likesCount, likedByViewer: data.liked } : post)));
  }

  // Saved Snippets is built entirely from likes — whatever the viewer
  // has liked (lib/posts.js's getLikedVideoPosts) is what's "saved," so
  // unliking one from in here is what removes it, same as Instagram's
  // own unsave. These are separate posts/handlers from the ones above:
  // this list can include other people's posts, so it needs its own
  // owner-or-not per post (see PostViewerModal's own viewerId prop)
  // rather than assuming everything here belongs to isOwnProfile.
  async function deleteSavedPost(postId) {
    const res = await fetch(`/api/posts/${postId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Could not delete that post.');
    setSavedSnippets((p) => p.filter((post) => post.id !== postId));
  }

  async function editSavedPostCaption(postId, newCaption) {
    const res = await fetch(`/api/posts/${postId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caption: newCaption })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not save that edit.');
    setSavedSnippets((p) => p.map((post) => (post.id === postId ? { ...post, caption: newCaption } : post)));
  }

  async function reportSavedPost(postId, reason) {
    await fetch('/api/posts/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId, reason })
    }).catch(() => {});
  }

  async function toggleSavedLike(postId) {
    const res = await fetch('/api/posts/like', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not update that like.');
    if (!data.liked) {
      setSavedSnippets((p) => p.filter((post) => post.id !== postId));
    } else {
      setSavedSnippets((p) => p.map((post) => (post.id === postId ? { ...post, likesCount: data.likesCount, likedByViewer: true } : post)));
    }
  }

  // Follow button — server state wins over the optimistic flip, same as
  // post likes: two quick clicks settle on whatever actually landed.
  async function toggleFollow() {
    setFollowBusy(true);
    setFollowError(null);
    try {
      const res = await fetch('/api/profile-follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ followedId: profile.userId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not update that follow.');
      setFollowing(data.following);
      setFollowerCount(data.followers);
    } catch (err) {
      setFollowError(err.message);
    } finally {
      setFollowBusy(false);
    }
  }

  function share() {
    // Always hand out the canonical link (/profile/<handle> when one is
    // set), even if this page was reached through the raw-id URL.
    const url = typeof window !== 'undefined' ? `${window.location.origin}${canonicalPath || window.location.pathname}` : '';
    if (navigator.share) {
      navigator.share({ title: profile.displayName, url }).catch(() => {});
    } else {
      navigator.clipboard.writeText(url).then(() => {
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 2000);
      });
    }
  }

  // Shared between "Posts" (always the profile owner's own) and "Saved
  // Snippets" (whatever the viewer liked, could belong to anyone) — the
  // tile itself doesn't care which grid it's in, just which handlers and
  // ownership check apply, which `source` picks.
  function renderPostTile(post, i, source) {
    // Plain clickable <div>s, not <Link>/<a> — PostMenu's own trigger
    // button sits inside this tile, and a button nested in a real anchor
    // still triggers the anchor's native navigation on click even with
    // stopPropagation() (that stops JS bubbling, not the browser's
    // built-in anchor behavior). Same workaround already used for
    // "Similar projects" cards in pages/pitches/[id].js.
    // Opens the Instagram-style viewer in place (see PostViewerModal
    // below) rather than navigating anywhere — this used to push video
    // posts to /snippets/discover and window.open() a photo's raw
    // storage URL.
    const openTile = () => setViewer({ source, index: i });
    // Every tile is the same 9:16 shape now (see .profile-post-tile),
    // matching the "+" composer's own video/thumbnail preview exactly —
    // a video always fills it natively. A photo could be any shape
    // someone happens to upload, so instead of cropping it to fit (the
    // old aspect-ratio:1/1 + background-size:cover combination —
    // reliably wrong for anything that wasn't already square), it's
    // shown in full via object-fit:contain, over a blurred/darkened
    // cover-fill of the same image so the letterboxed edges aren't just
    // bare color. Nothing ever gets unexpectedly cut off, regardless of
    // what gets uploaded.
    const imageSrc = post.kind === 'video' ? post.thumbnailUrl : post.imageUrl;
    const isOwner = Boolean(viewerId) && post.userId === viewerId;
    const onDeleteFn = source === 'saved' ? deleteSavedPost : deleteOwnPost;
    const onSaveCaptionFn = source === 'saved' ? editSavedPostCaption : editOwnPostCaption;
    const onReportFn = source === 'saved' ? reportSavedPost : reportPost;
    return (
      <div
        key={post.id}
        className="profile-post-tile"
        role="link"
        tabIndex={0}
        onClick={openTile}
        onKeyDown={(e) => { if (e.key === 'Enter') openTile(); }}
      >
        {imageSrc ? (
          <>
            <div className="profile-post-tile-backdrop" style={{ backgroundImage: `url(${imageSrc})` }} />
            <div className="profile-post-tile-fg" style={{ backgroundImage: `url(${imageSrc})` }} />
          </>
        ) : (
          <span className="profile-post-tile-caption">&ldquo;{post.caption}&rdquo;</span>
        )}

        {/* One combined badge instead of two separately-positioned
            pieces (a bare camera icon top-left, duration text
            bottom-right) — video gets icon+duration together, a
            photo/caption post gets its own icon so the two kinds still
            read apart now that their tiles are the same shape. */}
        <span className={`profile-post-tile-type-badge ${post.kind !== 'video' ? 'profile-post-tile-type-badge-icon-only' : ''}`}>
          {post.kind === 'video' ? (
            <>
              <VideoCameraIcon size={12} />
              Snippet{post.durationSeconds != null && ` · ${formatRuntime(post.durationSeconds)}`}
            </>
          ) : (
            <ImageIcon size={12} />
          )}
        </span>

        <div className="profile-post-tile-menu">
          <PostMenu
            isOwner={isOwner}
            isSignedIn={isSignedIn}
            caption={post.caption}
            onDelete={() => onDeleteFn(post.id)}
            onSaveCaption={(text) => onSaveCaptionFn(post.id, text)}
            onReport={(reason) => onReportFn(post.id, reason)}
          />
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>{`${profile.displayName} — ${SITE.name}`}</title>
        <meta name="description" content={profile.bio || `${profile.displayName} on ${SITE.name}.`} />
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

      <main id="main-content" className="stage stage-single profile-stage">
        <BackButton fallbackHref="/stream" />

        {/* Backdrop (photo > solid color > default gradient, set on the
            account page), the avatar overlapping its bottom edge, then
            name / @handle on the left and Follow · Share · Report on the
            right — Jose's sketch, 2026-10-07. */}
        <header className="profile-hero">
          <div className={`profile-banner ${profile.bannerUrl ? 'has-photo' : ''}`} style={bannerStyle(profile)} />
          <div className="profile-hero-row">
            <div
              className="profile-avatar"
              style={profile.avatarUrl ? { backgroundImage: `url(${profile.avatarUrl})` } : undefined}
            >
              {!profile.avatarUrl && initial}
            </div>
            <div className="profile-hero-id">
              <div className="profile-name-row">
                <h1 className="profile-name">{profile.displayName}</h1>
                {roleBadge && <span className="account-role-badge">{roleBadge}</span>}
              </div>
              {profile.handle && <div className="profile-handle">@{profile.handle}</div>}
              {joinedLabel && <div className="profile-joined">On {SITE.name} since {joinedLabel}</div>}
              {(creditedWork.length > 0 || totalViews > 0 || followerCount > 0) && (
                <div className="profile-stats">
                  {creditedWork.length > 0 && <span>{creditedWork.length} title{creditedWork.length === 1 ? '' : 's'}</span>}
                  {totalViews > 0 && (
                    <>
                      {creditedWork.length > 0 && <span className="profile-stats-dot">&bull;</span>}
                      <span>{formatViews(totalViews)} views</span>
                    </>
                  )}
                  {followerCount > 0 && (
                    <>
                      {(creditedWork.length > 0 || totalViews > 0) && <span className="profile-stats-dot">&bull;</span>}
                      <span>{formatViews(followerCount)} follower{followerCount === 1 ? '' : 's'}</span>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="profile-actions">
              {isOwnProfile ? (
                <Link href="/account" className="profile-action-btn">Edit profile</Link>
              ) : !isSignedIn ? (
                <SignInButton mode="modal">
                  <button type="button" className="profile-action-btn profile-action-btn-primary">Follow</button>
                </SignInButton>
              ) : (
                <button
                  type="button"
                  className={`profile-action-btn ${following ? 'profile-action-btn-following' : 'profile-action-btn-primary'}`}
                  onClick={toggleFollow}
                  disabled={followBusy}
                  aria-pressed={following}
                >
                  {following ? 'Following' : 'Follow'}
                </button>
              )}
              <div className="pitch-share-wrap">
                <button className="wishlist-btn wishlist-btn-large" onClick={share} aria-label="Share profile" title="Share profile">
                  {shareCopied ? <CheckIcon size={17} /> : <ShareIcon src={iconOverrides.share} size={17} />}
                </button>
                {shareCopied && <span className="pitch-share-toast" role="status">Link copied!</span>}
              </div>
              {!isOwnProfile && isSignedIn && (
                <ReportButton targetType="profile" targetId={profile.userId} title={profile.displayName} className="profile-report-btn" />
              )}
            </div>
          </div>
          {followError && <div className="profile-follow-error" role="alert">{followError}</div>}

          {profile.isPlaceholder && (
            <p className="profile-placeholder-note">
              {isOwnProfile
                ? 'This is how your profile looks right now. Add a name, photo and bio in your account settings.'
                : 'This person hasn’t set up their profile yet.'}
            </p>
          )}
        </header>

        <div className="profile-body">
          {/* Left: jump list for the sections below. */}
          <nav className="profile-side-nav" aria-label="Profile sections">
            {sections.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="profile-side-nav-link">{s.label}</a>
            ))}
          </nav>

          {/* Center: the latest post big, then everything else in order. */}
          <div className="profile-content">
            <section id="profile-about" className="profile-section">
              <div className="profile-section-label">About</div>
              {profile.bio ? (
                <p className="profile-bio">{profile.bio}</p>
              ) : (
                <p className="profile-bio profile-bio-empty">
                  {isOwnProfile ? 'Add a line or two about what you make in your account settings.' : `${profile.displayName} hasn’t written a bio yet.`}
                </p>
              )}
              {knownForGenres.length > 0 && (
                <div className="profile-genre-tags">
                  <span className="profile-genre-tags-label">Known for</span>
                  {knownForGenres.map((g) => <span key={g} className="profile-genre-tag">{g}</span>)}
                </div>
              )}
            </section>

            {latestPost && (
              <section id="profile-latest" className="profile-section">
                <div className="profile-section-label">Latest post</div>
                <div className="profile-latest-post">
                  {renderPostTile(latestPost, 0, 'posts')}
                  {latestPost.caption && <p className="profile-latest-caption">{latestPost.caption}</p>}
                </div>
              </section>
            )}

            {olderPosts.length > 0 && (
              <section id="profile-posts" className="profile-section">
                <div className="profile-section-label">Posts</div>
                <div className="profile-posts-grid">
                  {olderPosts.map((post, i) => renderPostTile(post, i + 1, 'posts'))}
                </div>
              </section>
            )}

            {/* Only the viewer's own — see isOwnProfile gating in
                lib/profileHub.js, which skips fetching this list entirely
                for anyone else. Liking a snippet (the heart in
                PostViewerModal's action rail) is what saves it here, same
                as Instagram's own Saved collection doubling up the like. */}
            {isOwnProfile && savedSnippets.length > 0 && (
              <section id="profile-saved" className="profile-section">
                <div className="profile-section-label">Saved Snippets</div>
                <div className="profile-posts-grid">
                  {savedSnippets.map((post, i) => renderPostTile(post, i, 'saved'))}
                </div>
              </section>
            )}

            <section id="profile-tagged" className="profile-section">
              <div className="profile-section-label">Tagged in</div>
              {creditedWork.length === 0 ? (
                <div className="poster-empty">
                  Nothing tagged here yet &mdash; this fills in once {profile.displayName} is credited on something.
                </div>
              ) : (
                <div className="profile-work-grid">
                  {creditedWork.map((item) => (
                    <Link key={`${item.type}-${item.id}`} href={workHref(item)} className="profile-work-item">
                      <div className="profile-work-poster" style={item.poster ? { backgroundImage: `url(${item.poster})` } : undefined} />
                      <div className="profile-work-title">{item.title}</div>
                      <div className="profile-work-type">{workTypeLabel(item)}</div>
                    </Link>
                  ))}
                </div>
              )}
            </section>

            {pitches.length > 0 && (
              <section id="profile-pitches" className="profile-section">
                <div className="profile-section-label">Pitch Room projects</div>
                <div className="pitch-grid">
                  {pitches.map((p) => (
                    <Link key={p.id} href={`/pitches/${p.id}`} className="pitch-card">
                      <div className="pitch-thumb" style={p.thumbnail ? { backgroundImage: `url(${p.thumbnail})` } : {}}>
                        {p.tag && <span className="pitch-tag">{p.tag}</span>}
                      </div>
                      <div className="pitch-info">
                        <h4>{p.title}</h4>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {backedPitches.length > 0 && (
              <section id="profile-backed" className="profile-section">
                <div className="profile-section-label">Projects backed</div>
                <div className="pitch-grid">
                  {backedPitches.map((p) => (
                    <Link key={p.id} href={`/pitches/${p.id}`} className="pitch-card">
                      <div className="pitch-thumb" style={p.thumbnail ? { backgroundImage: `url(${p.thumbnail})` } : {}}>
                        {p.tag && <span className="pitch-tag">{p.tag}</span>}
                      </div>
                      <div className="pitch-info">
                        <h4>{p.title}</h4>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* Right rail: the numbers, then links. */}
          <aside className="profile-rail">
            {profile.socialLinks.length > 0 && (
              <div className="profile-rail-box">
                <div className="profile-rail-box-label">Links</div>
                <div className="profile-links">
                  {profile.socialLinks.map((link, i) => (
                    <a key={i} href={link.url} target="_blank" rel="noopener noreferrer" className="profile-link-pill">
                      {link.platform || hostnameFor(link.url)}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>
      </main>

      <Footer />
      <MobileTabBar />

      {viewer && (
        <PostViewerModal
          posts={viewer.source === 'saved' ? savedSnippets : posts}
          startIndex={viewer.index}
          onClose={() => setViewer(null)}
          viewerId={viewerId}
          isSignedIn={isSignedIn}
          onDelete={viewer.source === 'saved' ? deleteSavedPost : deleteOwnPost}
          onSaveCaption={viewer.source === 'saved' ? editSavedPostCaption : editOwnPostCaption}
          onReport={viewer.source === 'saved' ? reportSavedPost : reportPost}
          onToggleLike={viewer.source === 'saved' ? toggleSavedLike : toggleLike}
        />
      )}
    </>
  );
}
