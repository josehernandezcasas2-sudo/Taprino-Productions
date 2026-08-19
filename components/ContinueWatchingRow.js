import { parseRuntimeToSeconds } from '../lib/videoMetadata';

// Deliberately NOT reusing GenreRow here, even though it looks similar —
// GenreRow consolidates every episode of a series into one card, which is
// exactly wrong for this row. If you're partway through episode 3, this
// needs to link straight back into episode 3 with its own progress bar,
// not a generic series card that dumps you back at episode 1.
export default function ContinueWatchingRow({ items, onSelect }) {
  if (!items || items.length === 0) return null;

  return (
    <div className="cat-row continue-watching-row">
      <div className="cat-row-heading">Continue Watching</div>
      <div className="cat-row-track">
        {items.map((ep) => {
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
    </div>
  );
}
