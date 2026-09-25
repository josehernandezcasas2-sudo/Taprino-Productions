import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import PostMenu from './PostMenu';
import ReelPlayer from './ReelPlayer';

const SWIPE_THRESHOLD = 50;

// Instagram-style post viewer — opens in place over the profile grid
// instead of navigating anywhere, and lets you step through every post
// (photos and snippets mixed, same order as the grid) without closing
// and reopening. `posts` and the index into it are read live from the
// parent's own state, so an edit/delete made from the PostMenu inside
// here (same component the grid tiles already use) shows up immediately
// — no separate copy of the post to keep in sync.
export default function PostViewerModal({ posts, startIndex, onClose, isOwnProfile, isSignedIn, onDelete, onSaveCaption, onReport }) {
  const [index, setIndex] = useState(startIndex);
  const [muted, setMuted] = useState(true);
  const touchStartX = useRef(null);
  const post = posts[index];

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
      else if (e.key === 'ArrowRight') setIndex((i) => Math.min(posts.length - 1, i + 1));
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [posts.length, onClose]);

  // A delete can shrink `posts` out from under the index this modal is
  // showing (see the component doc above) — this is the fallback for
  // when that leaves nothing at the current position, e.g. deleting the
  // very last post in the array. Deleting anything else just reveals
  // whatever shifted into this index, which reads as "advanced to the
  // next post" for free.
  if (!post) {
    onClose();
    return null;
  }

  function goPrev() { setIndex((i) => Math.max(0, i - 1)); }
  function goNext() { setIndex((i) => Math.min(posts.length - 1, i + 1)); }

  function onTouchStart(e) {
    touchStartX.current = e.touches[0].clientX;
  }
  function onTouchEnd(e) {
    if (touchStartX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) < SWIPE_THRESHOLD) return;
    if (dx < 0) goNext();
    else goPrev();
  }

  const hasMedia = post.kind === 'video' || Boolean(post.imageUrl);

  if (typeof document === 'undefined') return null;
  return createPortal((
    <div className="post-viewer-backdrop" onClick={onClose}>
      <div
        className="post-viewer-card"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="post-viewer-media">
          <button className="post-viewer-close" onClick={onClose} aria-label="Close">&times;</button>
          <div className="post-viewer-menu">
            <PostMenu
              isOwner={isOwnProfile}
              isSignedIn={isSignedIn}
              caption={post.caption}
              onDelete={() => onDelete(post.id)}
              onSaveCaption={(text) => onSaveCaption(post.id, text)}
              onReport={(reason) => onReport(post.id, reason)}
            />
          </div>

          {index > 0 && (
            <button className="post-viewer-nav post-viewer-nav-prev" onClick={goPrev} aria-label="Previous post">&lsaquo;</button>
          )}
          {index < posts.length - 1 && (
            <button className="post-viewer-nav post-viewer-nav-next" onClick={goNext} aria-label="Next post">&rsaquo;</button>
          )}

          {post.kind === 'video' ? (
            <ReelPlayer
              key={post.id}
              src={post.videoSrc}
              active
              muted={muted}
              onToggleMute={() => setMuted((m) => !m)}
              thumbnail={post.thumbnailUrl}
              showControls
            />
          ) : post.imageUrl ? (
            <>
              <div className="post-viewer-media-backdrop" style={{ backgroundImage: `url(${post.imageUrl})` }} />
              <img className="post-viewer-media-img" src={post.imageUrl} alt="" />
            </>
          ) : (
            <div className="post-viewer-caption-only">&ldquo;{post.caption}&rdquo;</div>
          )}
        </div>

        {hasMedia && post.caption && (
          <div className="post-viewer-caption">&ldquo;{post.caption}&rdquo;</div>
        )}
      </div>
    </div>
  ), document.body);
}
