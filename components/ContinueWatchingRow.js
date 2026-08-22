import { parseRuntimeToSeconds } from '../lib/videoMetadata';
import { useRowCarousel } from '../lib/useRowCarousel';

const MAX_CARDS = 15;

// Deliberately NOT reusing GenreRow here, even though it looks similar —
// GenreRow consolidates every episode of a series into one card, which is
// exactly wrong for this row. If you're partway through episode 3, this
// needs to link straight back into episode 3 with its own progress bar,
// not a generic series card that dumps you back at episode 1. The
// carousel wrapper (arrows, loop, cap) is shared via useRowCarousel so
// this stays in sync with GenreRow's behavior without duplicating it.
export default function ContinueWatchingRow({ items, onSelect }) {
  const { trackRef, scroll } = useRowCarousel();

  if (!items || items.length === 0) return null;

  // Most recently watched first, capped the same as every other row —
  // nobody needs to scroll through dozens of in-progress items to find
  // what they were just watching.
  const capped = items.slice(0, MAX_CARDS);

  return (
    <div className="cat-row continue-watching-row" id="continue-watching">
      <div className="cat-row-heading">Continue Watching</div>
      <div className="cat-row-carousel">
        {capped.length > 1 && (
          <button className="cat-row-arrow left" onClick={() => scroll('prev')} aria-label="Scroll Continue Watching left">
            ‹
          </button>
        )}
        <div className="cat-row-track" ref={trackRef}>
          {capped.map((ep) => {
            const totalSeconds = parseRuntimeToSeconds(ep.runtime);
            const pct = totalSeconds ? Math.min(100, Math.round((ep.resumeSeconds / totalSeconds) * 100)) : null;
            return (
              <div key={ep.id} className="card-wrap row-card">
                <div
                  className={`ep-card ${ep.tier}`}
                  onClick={() => onSelect(ep)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') onSelect(ep); }}
                >
                  <div className="ep-thumb">
                    {ep.thumbnail && <img src={ep.thumbnail} alt="" className="ep-thumb-img" />}
                    {pct !== null && (
                      <div className="cw-progress-track" aria-hidden="true">
                        <div className="cw-progress-fill" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </div>
                  <div className="ep-info">
                    <h4>{ep.title}</h4>
                    <span>{ep.artist}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {capped.length > 1 && (
          <button className="cat-row-arrow right" onClick={() => scroll('next')} aria-label="Scroll Continue Watching right">
            ›
          </button>
        )}
      </div>
    </div>
  );
}
