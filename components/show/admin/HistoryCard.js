import { useState } from 'react';
import { AdmCard, stampWords } from './adminBits';

const SHOWN = 20;

// History (the admin show page, slice 3a §5.3): the show's audit lines and
// its episodes', newest first — the owner's own changes say the owner's
// name, the team's the admin's email with "(admin)". Twenty, then Show all
// (up to 60, all the server sends).
export default function HistoryCard({ admin }) {
  const [all, setAll] = useState(false);
  const entries = Array.isArray(admin.history) ? admin.history : [];
  const shown = all ? entries : entries.slice(0, SHOWN);
  return (
    <AdmCard id="show-adm-history" k="History" className="show-adm-history">
      {entries.length === 0 ? (
        <p className="show-adm-line">Nothing yet.</p>
      ) : (
        <ol className="show-adm-log">
          {shown.map((e, i) => (
            <li key={e.id ?? `${e.at}-${i}`} className={e.actor === 'owner' ? 'is-owner' : e.actor === 'admin' ? 'is-admin' : ''}>
              <span className="show-adm-log-at">{stampWords(e.at)}</span>
              <span className="show-adm-log-who">{e.who}</span>
              <span className="show-adm-log-words">{e.words || (e.action ? e.action.replace(/_/g, ' ') : '')}</span>
            </li>
          ))}
        </ol>
      )}
      {!all && entries.length > SHOWN && <button type="button" className="apl-link" onClick={() => setAll(true)}>Show all ({entries.length})</button>}
    </AdmCard>
  );
}
