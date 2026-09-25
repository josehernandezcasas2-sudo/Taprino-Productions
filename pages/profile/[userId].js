import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import BackButton from '../../components/BackButton';
import { ShareIcon, CheckIcon, VideoCameraIcon, ImageIcon, usePlayerIconOverrides } from '../../components/PlayerIcons';
import PostMenu from '../../components/PostMenu';
import { getAccountContext } from '../../lib/accountContext';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { getPublicProfile, getCreditedWork } from '../../lib/userProfiles';
import { getPitchesForCreator } from '../../lib/pitches';
import { getBackedPitches } from '../../lib/pitchDonations';
import { getPostsForUser } from '../../lib/posts';
import { formatRuntime } from '../../lib/videoMetadata';
import { getUserRole } from '../../lib/roles';
import { getViewCounts, isRedisConfigured } from '../../lib/redis';
import HeaderNav from '../../components/HeaderNav';
import MobileTabBar from '../../components/MobileTabBar';
import Footer from '../../components/Footer';
import { SITE } from '../../lib/siteConfig';

const MAX_GENRE_TAGS = 4;

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

  const account = await getAccountContext(req);
  const [episodes, profile] = await Promise.all([
    getPublicEpisodes(),
    getPublicProfile(params.userId)
  ]);
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];

  if (!profile) {
    return { notFound: true };
  }

  // Everything below only matters once we know the profile actually
  // exists, so it runs after the notFound check rather than racing it in
  // the Promise.all above — no point fetching a stranger's credited work
  // for a userId that turns out to have no profile at all.
  const needsViewCounts = isRedisConfigured();
  const [creditedWork, pitchRows, backedPitchRows, role, viewCounts, posts] = await Promise.all([
    getCreditedWork(profile.userId),
    getPitchesForCreator(profile.userId),
    getBackedPitches(profile.userId),
    getUserRole(profile.userId),
    needsViewCounts ? getViewCounts() : Promise.resolve({}),
    getPostsForUser(profile.userId)
  ]);
  // Public profile — only ever show approved, public pitches, never a
  // pending or rejected submission's review status.
  const pitches = pitchRows.filter((p) => p.status === 'approved');

  // Total views across their credited work — a standalone item's views
  // come straight from viewCounts by its own id, but a series has no
  // view count of its own (only its individual episodes do), so that
  // half sums every episode in `episodes` (already fetched above) that
  // belongs to the series. Same aggregation GenreRow/pages/index.js
  // already do for their own series rankings.
  const totalViews = creditedWork.reduce((sum, item) => {
    if (item.type === 'episode') return sum + (viewCounts[item.id] || 0);
    const seriesViews = episodes
      .filter((e) => e.seriesId === item.id)
      .reduce((s, e) => s + (viewCounts[e.id] || 0), 0);
    return sum + seriesViews;
  }, 0);

  // "Known for" — the genres their own credited episodes actually carry
  // (series rows don't have a genre of their own), most-common first,
  // capped so this stays a short tag row rather than a genre dump.
  const genreCounts = {};
  for (const item of creditedWork) {
    if (item.mainGenre) genreCounts[item.mainGenre] = (genreCounts[item.mainGenre] || 0) + 1;
  }
  const knownForGenres = Object.keys(genreCounts)
    .sort((a, b) => genreCounts[b] - genreCounts[a])
    .slice(0, MAX_GENRE_TAGS);

  return {
    props: {
      profile,
      creditedWork,
      pitches,
      backedPitches: backedPitchRows,
      posts,
      totalViews,
      knownForGenres,
      // Same priority-order rule as account.js's own role badge — an
      // admin is also technically a creator, but only the single
      // highest-privilege badge should ever show.
      roleBadge: role === 'admin' ? 'Admin' : role === 'sub_admin' ? 'Sub-admin' : role === 'creator' ? 'Creator' : null,
      mainGenres,
      isSignedIn: account.isSignedIn,
      viewerId: account.userId,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator
    }
  };
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

export default function PublicProfile({ profile, creditedWork, pitches, backedPitches, posts: initialPosts, totalViews, knownForGenres, roleBadge, mainGenres, isSignedIn, viewerId, isSubscriber, email, isAdmin, isCreator }) {
  const router = useRouter();
  const iconOverrides = usePlayerIconOverrides();
  const [shareCopied, setShareCopied] = useState(false);
  const [posts, setPosts] = useState(initialPosts);
  const [lightboxPost, setLightboxPost] = useState(null);
  const isOwnProfile = Boolean(viewerId) && viewerId === profile.userId;
  const initial = profile.displayName && profile.displayName[0] ? profile.displayName[0].toUpperCase() : '?';
  const joinedLabel = profile.joinedAt
    ? new Date(profile.joinedAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : null;

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

  function share() {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    if (navigator.share) {
      navigator.share({ title: profile.displayName, url }).catch(() => {});
    } else {
      navigator.clipboard.writeText(url).then(() => {
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 2000);
      });
    }
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

      <main id="main-content" className="stage stage-single" style={{ maxWidth: '760px' }}>
        <BackButton fallbackHref="/stream" />
        <div className="profile-header">
          <div
            className="profile-avatar"
            style={profile.avatarUrl ? { backgroundImage: `url(${profile.avatarUrl})` } : undefined}
          >
            {!profile.avatarUrl && initial}
          </div>
          <div className="profile-name-row">
            <h1 className="profile-name">{profile.displayName}</h1>
            {roleBadge && <span className="account-role-badge">{roleBadge}</span>}
          </div>
          {joinedLabel && <div className="profile-joined">On {SITE.name} since {joinedLabel}</div>}

          {(creditedWork.length > 0 || totalViews > 0) && (
            <div className="profile-stats">
              <span>{creditedWork.length} title{creditedWork.length === 1 ? '' : 's'}</span>
              {totalViews > 0 && (
                <>
                  <span className="profile-stats-dot">&bull;</span>
                  <span>{formatViews(totalViews)} views</span>
                </>
              )}
            </div>
          )}

          {knownForGenres.length > 0 && (
            <div className="profile-genre-tags">
              <span className="profile-genre-tags-label">Known for</span>
              {knownForGenres.map((g) => <span key={g} className="profile-genre-tag">{g}</span>)}
            </div>
          )}

          {profile.bio && <p className="profile-bio">{profile.bio}</p>}

          {profile.socialLinks.length > 0 && (
            <div className="profile-links">
              {profile.socialLinks.map((link, i) => (
                <a key={i} href={link.url} target="_blank" rel="noopener noreferrer" className="profile-link-pill">
                  {link.platform || hostnameFor(link.url)}
                </a>
              ))}
            </div>
          )}

          <div className="pitch-share-wrap" style={{ marginTop: '1rem' }}>
            <button className="wishlist-btn wishlist-btn-large" onClick={share} aria-label="Share profile" title="Share profile">
              {shareCopied ? <CheckIcon size={17} /> : <ShareIcon src={iconOverrides.share} size={17} />}
            </button>
            {shareCopied && <span className="pitch-share-toast" role="status">Link copied!</span>}
          </div>
        </div>

        {posts.length > 0 && (
          <>
            <div className="profile-section-divider" />
            <div className="profile-section-label">Posts</div>
            <div className="profile-posts-grid">
              {posts.map((post) => {
                // Plain clickable <div>s, not <Link>/<a> — PostMenu's own
                // trigger button sits inside this tile, and a button
                // nested in a real anchor still triggers the anchor's
                // native navigation on click even with stopPropagation()
                // (that stops JS bubbling, not the browser's built-in
                // anchor behavior). Same workaround already used for
                // "Similar projects" cards in pages/pitches/[id].js.
                const openTile = () => {
                  if (post.kind === 'video') router.push(`/snippets/discover?post=${post.id}`);
                  else if (post.imageUrl) setLightboxPost(post);
                };
                // Every tile is the same 9:16 shape now (see .profile-post-tile),
                // matching the "+" composer's own video/thumbnail preview
                // exactly — a video always fills it natively. A photo could be
                // any shape someone happens to upload, so instead of cropping
                // it to fit (the old aspect-ratio:1/1 + background-size:cover
                // combination — reliably wrong for anything that wasn't
                // already square), it's shown in full via object-fit:contain,
                // over a blurred/darkened cover-fill of the same image so the
                // letterboxed edges aren't just bare color. Nothing ever gets
                // unexpectedly cut off, regardless of what gets uploaded.
                const imageSrc = post.kind === 'video' ? post.thumbnailUrl : post.imageUrl;
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
                        bottom-right) — video gets icon+duration together,
                        a photo/caption post gets its own icon so the two
                        kinds still read apart now that their tiles are the
                        same shape. */}
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
                        isOwner={isOwnProfile}
                        isSignedIn={isSignedIn}
                        caption={post.caption}
                        onDelete={() => deleteOwnPost(post.id)}
                        onSaveCaption={(text) => editOwnPostCaption(post.id, text)}
                        onReport={(reason) => reportPost(post.id, reason)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className="profile-section-divider" />
        <div className="profile-section-label">Tagged in</div>
        {creditedWork.length === 0 ? (
          <div className="poster-empty">
            Nothing tagged here yet — this fills in once {profile.displayName} is credited on something.
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

        {pitches.length > 0 && (
          <>
            <div className="profile-section-divider" />
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
          </>
        )}

        {backedPitches.length > 0 && (
          <>
            <div className="profile-section-divider" />
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
          </>
        )}
      </main>

      <Footer />
      <MobileTabBar />

      {lightboxPost && typeof document !== 'undefined' && createPortal((
        <div className="post-lightbox-backdrop" onClick={() => setLightboxPost(null)}>
          <div className="post-lightbox-card" onClick={(e) => e.stopPropagation()}>
            <button className="post-lightbox-close" onClick={() => setLightboxPost(null)} aria-label="Close">✕</button>
            <img className="post-lightbox-img" src={lightboxPost.imageUrl} alt="" />
            {lightboxPost.caption && (
              <div className="post-lightbox-caption">&ldquo;{lightboxPost.caption}&rdquo;</div>
            )}
          </div>
        </div>
      ), document.body)}
    </>
  );
}
