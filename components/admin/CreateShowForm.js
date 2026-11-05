import { useState } from 'react';
import { MAIN_GENRES } from '../../lib/submitRules';
import { SITE } from '../../lib/siteConfig';
import RatingOptions from '../RatingOptions';
import { RoomSheet } from '../show/AddEpisodesBar';

const NAME_MAX = 120;
const ABOUT_MAX = 2000;

// "+ Create a show for a creator" (Admin → Shows, slice 3a §5.4): who runs
// it (their email), its name, Series or Podcast, one line about it and the
// defaults its episodes start from. The show is private and theirs to
// fill; it goes public when they (or a full admin) press Make it public.
// An account without Creator Studio can't open its show page: a full
// admin can give it to them in the same step, anyone else is told to ask.
// POST /api/admin/shows { action: 'create', … } → the show's admin page.
export default function CreateShowForm({ account, mainGenres = [], onClose, onCreated }) {
  const [ownerEmail, setOwnerEmail] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState('series');
  const [about, setAbout] = useState('');
  const [tier, setTier] = useState('free');
  const [rating, setRating] = useState('');
  const [mainGenre, setMainGenre] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [needsRole, setNeedsRole] = useState(null);
  const genres = [...new Set([...MAIN_GENRES, ...(mainGenres || [])])];
  const fullAdmin = Boolean(account && account.isAdmin);

  const email = ownerEmail.trim();
  const blocked = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? 'Who runs it? Type their email.' : !name.trim() ? 'A show needs a name.' : null;

  async function create(grantCreator = false) {
    if (blocked || busy) return;
    setBusy(true);
    setError(null);
    const defaults = { tier };
    if (rating) defaults.rating = rating;
    if (mainGenre) defaults.mainGenre = mainGenre;
    try {
      const res = await fetch('/api/admin/shows', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', ownerEmail: email, name: name.trim(), kind, description: about.trim(), defaults, grantCreator })
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBusy(false);
        if (res.status === 409 && d.code === 'no-creator-role') {
          setNeedsRole(d.email || email);
          setError(null);
          return;
        }
        setError(d.error || `Couldn’t create the show (${res.status}).`);
        return;
      }
      onCreated(d.href || `/admin/shows/${encodeURIComponent(d.id)}`);
    } catch {
      setBusy(false);
      setError('Couldn’t reach the site — check the connection and try again.');
    }
  }

  const foot = (
    <>
      {needsRole && (
        <div className="show-adm-role-ask" role="alert">
          <p><strong>{needsRole} doesn’t have Creator Studio yet.</strong></p>
          {fullAdmin
            ? <button type="button" className="apl-btn-secondary show-mini" disabled={busy} onClick={() => create(true)}>{busy ? 'Creating…' : 'Give it to them and create'}</button>
            : <p className="show-sheet-help">Ask a full admin to give them Creator Studio first.</p>}
        </div>
      )}
      {error && <p className="show-ed-error" role="alert">{error}</p>}
      <div className="show-sheet-actions">
        <button type="button" className="apl-btn" disabled={Boolean(blocked) || busy} onClick={() => create(false)}>{busy ? 'Creating…' : 'Create the show'}</button>
        <button type="button" className="apl-btn-secondary" onClick={onClose}>Cancel</button>
      </div>
      {blocked && (ownerEmail || name) ? <p className="show-sheet-small" role="status">{blocked}</p> : null}
    </>
  );

  return (
    <RoomSheet title="Create a show for a creator" eyebrow="Shows" onClose={onClose} foot={foot}>
      <p className="show-sheet-help">It’s private and theirs: they add the episodes from Creator Studio and choose when it goes public.</p>
      <div className="show-sheet-block">
        <label className="show-ed-label" htmlFor="adm-create-owner">Who runs it (their email)</label>
        <input id="adm-create-owner" className="show-ed-input" type="email" inputMode="email" autoComplete="off" maxLength={200} value={ownerEmail} autoFocus onChange={(e) => { setOwnerEmail(e.target.value); setNeedsRole(null); }} />
      </div>
      <div className="show-sheet-block">
        <label className="show-ed-label" htmlFor="adm-create-name">Name</label>
        <input id="adm-create-name" className="show-ed-input" type="text" maxLength={NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="show-sheet-block">
        <span className="show-ed-label" id="adm-create-kind">Kind</span>
        <div className="apl-pills" role="radiogroup" aria-labelledby="adm-create-kind">
          {[['series', 'Series'], ['podcast', 'Podcast']].map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={kind === v ? 'true' : 'false'} className={`apl-pill ${kind === v ? 'on' : ''}`} onClick={() => setKind(v)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="show-sheet-block">
        <label className="show-ed-label" htmlFor="adm-create-about">One line about it</label>
        <textarea id="adm-create-about" className="show-ed-textarea is-short" rows={2} maxLength={ABOUT_MAX} value={about} onChange={(e) => setAbout(e.target.value)} />
      </div>
      <div className="show-sheet-block">
        <span className="show-ed-label" id="adm-create-tier">Who can watch</span>
        <div className="apl-pills" role="radiogroup" aria-labelledby="adm-create-tier">
          {[['free', 'Free with ads'], ['premium', `${SITE.premiumTier} members`]].map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={tier === v ? 'true' : 'false'} className={`apl-pill ${tier === v ? 'on' : ''}`} onClick={() => setTier(v)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="show-sheet-block">
        <label className="show-ed-label" htmlFor="adm-create-rating">Rating</label>
        <select id="adm-create-rating" className="show-ed-select" value={rating} onChange={(e) => setRating(e.target.value)}>
          <option value="">Not set (treated as 17+)</option>
          <RatingOptions />
        </select>
      </div>
      <div className="show-sheet-block">
        <label className="show-ed-label" htmlFor="adm-create-genre">Genre</label>
        <select id="adm-create-genre" className="show-ed-select" value={mainGenre} onChange={(e) => setMainGenre(e.target.value)}>
          <option value="">Not set</option>
          {genres.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </div>
    </RoomSheet>
  );
}
