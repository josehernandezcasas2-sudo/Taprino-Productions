import { useState } from 'react';
import { parseRuntimeToSeconds } from '../lib/videoMetadata';
import Image from 'next/image';
import { tierBadge } from '../lib/tierBadge';
import { PlayIcon, usePlayerIconOverrides } from './PlayerIcons';

const MAX_CARDS = 15;

// Deliberately NOT reusing GenreRow here, even though it looks similar —
// GenreRow consolidates every episode of a series into one card, which is
// exactly wrong for this row. If you're partway through episode 3, this
// needs to link straight back into episode 3 with its own progress bar,
// not a generic series card that dumps you back at episode 1.
//
// Scrolling is plain native overflow-x — .cat-row-track handles that on
// its own with no JS involved. This used to have a custom carousel layer
// on top (arrows, wheel-to-horizontal conversion, loop-around) that
// wasn't working reliably, so it's been removed; touch, trackpad, and a
// normal scrollbar all already work here without it.
export default function ContinueWatchingRow({ items, onSelect }) {
  const iconOverrides = usePlayerIconOverrides();
  if (!items || items.length === 0) return null;

  // Most recently watched first, capped the same as every other row —
  // nobody needs to scroll through dozens of in-progress items to find
  // what they were just watching.
  const capped = items.slice(0, MAX_CARDS);

  return (
    <div className="cat-row continue-watching-row" id="continue-watching">
      <div className="cat-row-heading">Continue Watching</div>
      <div className="cat-row-track">
        {capped.map((ep) => {
          const totalSeconds = parseRuntimeToSeconds(ep.runtime);
          const pct = totalSeconds ? Math.min(100, Math.round((ep.resumeSeconds / totalSeconds) * 100)) : null;
          return (
            <ContinueWatchingCard
              key={ep.id}
              ep={ep}
              pct={pct}
              onSelect={onSelect}
              iconOverrides={iconOverrides}
            />
          );
        })}
      </div>
    </div>
  );
}

// A title already in progress is already unlocked for this viewer, so the
// no-thumbnail/broken-thumbnail fallback here is always a plain "Resume"
// treatment — unlike GenreRow's browsing cards, there's no tier/lock
// distinction left to make. `imgError` catches a thumbnail URL that's
// present but broken (a corrupted or partially-uploaded file rendering as
// garbled blocks of color) and swaps to the same clean fallback rather
// than letting the browser show whatever it managed to decode.
function ContinueWatchingCard({ ep, pct, onSelect, iconOverrides }) {
  const [imgError, setImgError] = useState(false);
  const showThumb = ep.thumbnail && !imgError;
  return (
    <div className="card-wrap row-card">
      <div
        className={`ep-card ${tierBadge(ep.tier, ep.adsEnabled).key}`}
        onClick={() => onSelect(ep)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') onSelect(ep); }}
      >
        <div className="ep-thumb">
          {showThumb && (
            <Image
              src={ep.thumbnail}
              alt=""
              fill
              sizes="(max-width: 640px) 40vw, 200px"
              className="ep-thumb-img"
              onError={() => setImgError(true)}
            />
          )}
          {!showThumb && (
            <span className="ep-thumb-fallback"><PlayIcon size={13} src={iconOverrides.play} /> Resume</span>
          )}
          <div className="ep-info">
            <h4>{ep.title}</h4>
            <span>{ep.artist}</span>
          </div>
          {pct !== null && (
            <div className="cw-progress-track" aria-hidden="true">
              <div className="cw-progress-fill" style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
