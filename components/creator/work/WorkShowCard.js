import Link from 'next/link';
import { WORK_WORDS } from '../../../lib/workListRules';
import { ChevronIcon, bg } from '../../show/roomBits';

// A show on Your work (2026-11-15; Jose: "show the series, then make a
// drop down to see the rest of the seasons then the rest of the
// episodes"): one card — the poster, the name, Series / Podcast, where the
// show stands (not for a live show), its count line, what needs the
// creator (orange) and the rest; then Make it public (when it can go),
// Open show page and the seasons toggle. Open, it lists its seasons, each
// a row that opens to its episodes, indented under it. The model is
// lib/workListRules.js's show card; the page owns what is open
// (`isOpen` / `onToggle`) and draws the rows (`renderRow`).

export default function WorkShowCard({ card, open, seasonOpen, onToggle, onToggleSeason, renderRow, onMakePublic, publishing = false, note = null }) {
  const nameId = `wk-show-h-${card.id}`;
  const listId = `wk-show-${card.id}`;
  const live = card.state === 'live';
  return (
    <article className="wk-show" aria-labelledby={nameId}>
      <div className="wk-show-head">
        <span className={`wk-poster${card.poster ? '' : ' empty'}`} style={bg(card.poster)} aria-hidden="true" />
        <div className="wk-show-info">
          <div className="wk-show-title">
            <h3 id={nameId} className="wk-show-name">{card.name}</h3>
            <span className={`wk-chip kind-${card.kind}`}>{card.kindLabel}</span>
            {!live && card.stateLabel && <span className={`wk-chip tone-${card.stateTone}`}>{card.stateLabel}</span>}
          </div>
          {card.countLine && <p className="wk-show-count">{card.countLine}</p>}
          {(card.needLine || card.restLine) && (
            <p className="wk-show-lines">
              {card.needLine && <span className="wk-need-text">{card.needLine}</span>}
              {card.needLine && card.restLine ? ' · ' : ''}
              {card.restLine}
            </p>
          )}
        </div>
        <div className={`wk-show-acts${card.makePublic ? ' has-public' : ''}`}>
          {card.makePublic && (
            <button type="button" className="wk-btn gold wk-public" aria-describedby={nameId} disabled={publishing} onClick={() => onMakePublic(card)}>
              {publishing ? 'Making it public…' : WORK_WORDS.makePublic}
            </button>
          )}
          <Link href={card.href} className="wk-btn" aria-describedby={nameId}>{WORK_WORDS.openShow}</Link>
          {card.hasSeasons && (
            <button type="button" className="wk-btn" aria-expanded={open ? 'true' : 'false'} aria-controls={listId} aria-describedby={nameId} onClick={onToggle}>
              <span className={`wk-chev down${open ? ' open' : ''}`}><ChevronIcon size={16} /></span>
              {open ? WORK_WORDS.hideSeasons : card.openLabel}
            </button>
          )}
        </div>
      </div>

      {note && <p className={`wk-show-alert${note.ok ? ' ok' : ''}`} role={note.ok ? 'status' : 'alert'}>{note.text}</p>}

      {card.hasSeasons && (
        <div id={listId} className="wk-seasons" hidden={!open}>
          {open && card.seasons.map((season) => {
            const isOpen = seasonOpen(season);
            const rowsId = `wk-season-${season.key.replace(/[^A-Za-z0-9_-]/g, '-')}`;
            return (
              <div key={season.key} className="wk-season">
                <button type="button" className="wk-season-btn" aria-expanded={isOpen ? 'true' : 'false'} aria-controls={rowsId} onClick={() => onToggleSeason(season, isOpen)}>
                  <span className="wk-season-name">
                    <span className={`wk-chev${isOpen ? ' open' : ''}`}><ChevronIcon size={16} /></span>
                    <span className="wk-season-label">{season.label}</span>
                  </span>
                  <span className="wk-season-sum">
                    {season.summary}
                    {season.needs && <span className="wk-need-text"> · {season.needs}</span>}
                  </span>
                </button>
                <div id={rowsId} className="wk-season-rows" hidden={!isOpen}>
                  {isOpen && season.rows.map((row) => renderRow(row))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}
