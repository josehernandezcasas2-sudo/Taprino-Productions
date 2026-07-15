export default function EpisodeShelf({ episodes, currentId, onSelect }) {
  return (
    <div className="shelf">
      {episodes.map((ep) => (
        <button
          key={ep.id}
          className={`ep-card ${ep.tier} ${ep.id === currentId ? 'active' : ''}`}
          onClick={() => onSelect(ep)}
        >
          <div className="ep-thumb">
            <span className="ep-badge">{ep.tier === 'premium' ? 'Cipher Circle' : 'Free'}</span>
            {ep.tier === 'premium' ? '◈ locked' : '▶ preview'}
          </div>
          <div className="ep-info">
            <h4>{ep.title}</h4>
            <span>{ep.runtime}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
