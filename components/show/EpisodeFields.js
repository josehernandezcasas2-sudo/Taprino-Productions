import { useState } from 'react';
import { MAIN_GENRES } from '../../lib/submitRules';
import { ONE_LINE_MAX } from '../../lib/showRules';
import { SITE } from '../../lib/siteConfig';
import RatingOptions from '../RatingOptions';
import { FieldHead, FieldNote, StagedBox, SwitchRow, isOpen, lineFor } from './EditorBits';
import { ClockIcon, LockIcon, PlusIcon } from '../PlayerIcons';

// The fields the episode editor and the draft editor share (slice 2): the
// title with what waits for approval, the description as "One line about
// it" + "About it", the "Same as the show" rows (genre, Made by, year,
// rating, Who can watch), the season and number with the taken line, and
// the folded "More options".

export const NOT_SAVED_WORDS = {
  pageNotes: 'the notes',
  hasPage: 'its own page',
  credits: 'the credits',
  defaults: 'the defaults',
  seasons: 'the season names',
  kind: 'the kind'
};

export function askHref(subject) {
  return `mailto:${SITE.contactEmail}?subject=${encodeURIComponent(subject)}`;
}

export function TitleField({ id, value, onChange, policy, placeholder, liveTitle = null, stagedTitle = null, onCancelStaged = null, cancelBusy = false, edited = false }) {
  const staged = policy && policy.mode === 'staged';
  return (
    <div className="show-ed-field">
      <FieldHead htmlFor={id} label="Title" hint={staged ? ' · goes to review on a live episode' : null} staged={staged} locked={policy && policy.mode === 'locked'} count={value.length} max={value.length > 150 ? 200 : null} />
      <input id={id} className="show-ed-input is-title" type="text" value={value} maxLength={200} placeholder={placeholder} disabled={!isOpen(policy)} onChange={(e) => onChange(e.target.value)} />
      {edited && staged ? (
        <StagedBox title="Goes to review when you save" onCancel={() => onChange(liveTitle || '')} cancelLabel="Undo">
          <span className="show-ed-staged-live">Live now: <strong>{liveTitle || placeholder}</strong></span>
        </StagedBox>
      ) : null}
      {stagedTitle ? <StagedBox title="Waiting for approval:" value={stagedTitle} onCancel={onCancelStaged} busy={cancelBusy} /> : null}
      <FieldNote policy={policy} edited={edited && !staged} />
    </div>
  );
}

export function OneLineField({ id, value, onChange, policy, edited = false }) {
  return (
    <div className="show-ed-field">
      <FieldHead htmlFor={id} label="One line about it" count={value.length} max={ONE_LINE_MAX} locked={policy && policy.mode === 'locked'} />
      <textarea
        id={id}
        className="show-ed-textarea is-short"
        rows={2}
        value={value}
        maxLength={ONE_LINE_MAX}
        disabled={!isOpen(policy)}
        placeholder="What a card says about it, in a line."
        onChange={(e) => onChange(e.target.value.replace(/\s*\n\s*/g, ' '))}
      />
      <FieldNote policy={policy} edited={edited} />
    </div>
  );
}

export function AboutField({ id, value, onChange, max, policy, edited = false, label = 'About it', placeholder = 'Everything else: what happens, who’s in it, how it was made.' }) {
  return (
    <div className="show-ed-field">
      <FieldHead htmlFor={id} label={label} count={value.length} max={max} locked={policy && policy.mode === 'locked'} />
      <textarea id={id} className="show-ed-textarea" rows={6} value={value} maxLength={Math.max(0, max)} disabled={!isOpen(policy)} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <FieldNote policy={policy} edited={edited} />
    </div>
  );
}

function tierWord(t) {
  return t === 'premium' ? SITE.premiumTier : 'Free with ads';
}

// "Same as the show": one row per inherited field. Tap a row to open its
// field; a value of its own reads "Differs from the show · Reset". Who can
// watch and the rating are the team's on a live title ("Locked while
// live" and the line to ask us).
//   ctx = { form, set(key, value), defaults (the show's), showYear,
//           resets (a Set), reset(key), pol(field), idPrefix }
export function SameAsShow({ ctx, inShow = true }) {
  const [open, setOpen] = useState(null);
  const { form, set, defaults = {}, showYear = null, resets, reset, pol, idPrefix } = ctx;
  const d = defaults || {};
  // Genre label, Made by and the year borrow the show's when blank (on
  // every page); the main genre, the rating and Who can watch were copied
  // when the episode was added, so a blank one is its own (unrated is 17+).
  const BORROWS = ['genre', 'artist', 'releaseYear'];
  const stateOf = (key, own, def) => {
    if (!inShow) return null;
    if (resets.has(key)) return 'same';
    const blankOwn = own === '' || own === null || own === undefined;
    if (def === null || def === undefined || def === '') return blankOwn ? null : 'own';
    if (blankOwn) return BORROWS.includes(key) ? 'same' : 'differs';
    return String(own) === String(def) ? 'same' : 'differs';
  };
  const rows = [
    {
      key: 'mainGenre',
      label: 'Genre',
      policy: pol('mainGenre'),
      value: [form.mainGenre || d.mainGenre || 'Not set', form.genre && form.genre !== (form.mainGenre || d.mainGenre) ? `· ${form.genre}` : null].filter(Boolean).join(' '),
      state: (() => {
        const a = stateOf('mainGenre', form.mainGenre, d.mainGenre);
        const b = stateOf('genre', form.genre, d.genre);
        return a === 'differs' || b === 'differs' ? 'differs' : a || b;
      })(),
      resetKeys: ['mainGenre', 'genre'],
      editor: (
        <div className="apl-grid2 show-ed-grid2">
          <div className="show-ed-field">
            <label className="show-ed-label" htmlFor={`${idPrefix}-genre`}>Genre</label>
            <select id={`${idPrefix}-genre`} className="show-ed-select" value={form.mainGenre} disabled={!isOpen(pol('mainGenre'))} onChange={(e) => set('mainGenre', e.target.value)}>
              {!form.mainGenre && <option value="">Pick one…</option>}
              {MAIN_GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div className="show-ed-field">
            <label className="show-ed-label" htmlFor={`${idPrefix}-subgenre`}>Specific <em>optional</em></label>
            <input id={`${idPrefix}-subgenre`} className="show-ed-input" type="text" value={form.genre} maxLength={60} placeholder={d.genre || 'e.g. Cosmic Horror'} disabled={!isOpen(pol('genre'))} onChange={(e) => set('genre', e.target.value)} />
          </div>
        </div>
      )
    },
    {
      key: 'artist',
      label: 'Made by',
      policy: pol('artist'),
      value: form.artist || d.artist || 'Not set',
      state: stateOf('artist', form.artist, d.artist),
      resetKeys: ['artist'],
      editor: <input id={`${idPrefix}-artist`} aria-label="Made by" className="show-ed-input" type="text" value={form.artist} maxLength={120} placeholder={d.artist || 'Your name, as credited'} disabled={!isOpen(pol('artist'))} onChange={(e) => set('artist', e.target.value)} />
    },
    {
      key: 'releaseYear',
      label: 'Year',
      policy: pol('releaseYear'),
      value: form.releaseYear || (showYear ? String(showYear) : 'Not set'),
      state: stateOf('releaseYear', form.releaseYear, showYear),
      resetKeys: ['releaseYear'],
      editor: <input id={`${idPrefix}-year`} aria-label="Year" className="show-ed-input" type="text" inputMode="numeric" value={form.releaseYear} maxLength={4} placeholder={showYear ? String(showYear) : String(new Date().getFullYear())} disabled={!isOpen(pol('releaseYear'))} onChange={(e) => set('releaseYear', e.target.value.replace(/[^0-9]/g, ''))} />
    },
    {
      key: 'rating',
      label: 'Rating',
      policy: pol('rating'),
      value: form.rating || 'Not rated (17+)',
      boxed: true,
      state: stateOf('rating', form.rating, d.rating),
      resetKeys: ['rating'],
      editor: (
        <select id={`${idPrefix}-rating`} aria-label="Rating" className="show-ed-select" value={form.rating} disabled={!isOpen(pol('rating'))} onChange={(e) => set('rating', e.target.value)}>
          <option value="">Not set (treated as 17+)</option>
          <RatingOptions />
        </select>
      ),
      ask: 'Ask us to change the rating'
    },
    {
      key: 'tier',
      label: 'Who can watch',
      policy: pol('tier'),
      value: tierWord(form.tier),
      tier: form.tier,
      state: stateOf('tier', form.tier, d.tier),
      resetKeys: ['tier'],
      editor: (
        <div className="apl-pills" role="radiogroup" aria-label="Who can watch">
          {['free', 'premium'].map((t) => (
            <button key={t} type="button" role="radio" aria-checked={form.tier === t ? 'true' : 'false'} className={`apl-pill ${form.tier === t ? 'on' : ''}`} disabled={!isOpen(pol('tier'))} onClick={() => set('tier', t)}>{tierWord(t)}</button>
          ))}
        </div>
      ),
      ask: 'Ask us to change who can watch'
    }
  ];
  const lockedAsk = rows.filter((r) => r.policy && r.policy.mode === 'locked' && r.ask);
  return (
    <div className="show-ed-card show-ed-same">
      {inShow && (
        <>
          <span className="show-ed-card-k">Same as the show</span>
          <p className="show-ed-card-lede">Tap one to give this episode its own.</p>
        </>
      )}
      <ul className="show-ed-same-list">
        {rows.map((r) => {
          const locked = r.policy && r.policy.mode === 'locked';
          const isOpenRow = open === r.key && !locked;
          return (
            <li key={r.key} className={`show-ed-same-row ${isOpenRow ? 'is-open' : ''} ${locked ? 'is-locked' : ''}`}>
              <button type="button" className="show-ed-same-head" aria-expanded={locked ? undefined : isOpenRow ? 'true' : 'false'} disabled={locked} onClick={() => setOpen(isOpenRow ? null : r.key)}>
                <span className="show-ed-same-text">
                  <span className="show-ed-label">{r.label}</span>
                  {r.boxed ? <span className="show-ed-rating-box">{r.value}</span> : r.tier ? <span className={`show-ed-tier ${r.tier === 'premium' ? 'premium' : ''}`}>{r.value}</span> : <span className="show-ed-same-value">{r.value}</span>}
                </span>
                {locked ? (
                  <span className="show-ed-locked"><LockIcon size={11} /> Locked while live</span>
                ) : r.state === 'same' ? (
                  <span className="show-ed-chip-same">Same as the show</span>
                ) : r.state === 'differs' ? (
                  <span className="show-ed-chip-same differs">Differs from the show</span>
                ) : null}
                {!locked && <span className="show-ed-chev" aria-hidden="true">›</span>}
              </button>
              {r.state === 'differs' && !locked && (
                <button type="button" className="show-ed-reset" onClick={() => { for (const k of r.resetKeys) reset(k); setOpen(null); }}>Reset to the show’s</button>
              )}
              {isOpenRow && <div className="show-ed-same-edit">{r.editor}</div>}
              {locked && r.policy.line && !r.ask ? <p className="show-ed-line locked">{r.policy.line}</p> : null}
            </li>
          );
        })}
      </ul>
      {lockedAsk.length > 0 && (
        <p className="show-ed-ask">
          {lockedAsk.map((r, i) => (
            <span key={r.key}>{i > 0 ? ' · ' : ''}<a href={askHref(`${r.ask}: ${ctx.titleForAsk || ''}`.trim())}>{r.policy.line || r.ask}</a></span>
          ))}
        </p>
      )}
    </div>
  );
}

// The season chips and the number stepper, with the line for a taken
// number and what Swap / Insert here would do (planMove's words).
//   place = { seasons: [{ number, label }], season, number, wasCode,
//             nextFree, holder ({ id, title, kind }), loading,
//             swapWords, insertWords, policy, onSeason(n), onNumber(v),
//             onSwap, onInsert, busy, useNext() }
export function PlaceBlock({ idPrefix, place }) {
  const { seasons = [], season, number, wasCode, nextFree, holder, loading, swapWords, insertWords, policy, onSeason, onNumber, onSwap, onInsert, busy, isDraft = false, moveNote = null } = place;
  const open = isOpen(policy) && !busy;
  const nums = [...new Set([...seasons.map((s) => Number(s.number)), Number(season)])].filter(Boolean).sort((a, b) => a - b);
  const labels = Object.fromEntries(seasons.map((s) => [Number(s.number), s.label]));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  const n = Number(number) || 0;
  return (
    <div className="show-ed-place">
      <div className="show-ed-field">
        <span className="show-ed-label" id={`${idPrefix}-season-k`}>Season</span>
        <div className="show-ed-chips" role="radiogroup" aria-labelledby={`${idPrefix}-season-k`}>
          {nums.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={Number(season) === s ? 'true' : 'false'} className={`show-ed-chip ${Number(season) === s ? 'on' : ''}`} disabled={!open} onClick={() => onSeason(s)}>{labels[s] || `Season ${s}`}</button>
          ))}
          <button type="button" className="show-ed-chip is-new" disabled={!open} onClick={() => onSeason(next)}><PlusIcon size={12} /> New season</button>
        </div>
      </div>
      <div className="show-ed-field">
        <label className="show-ed-label" htmlFor={`${idPrefix}-number`}>Number</label>
        <div className="show-ed-number-row">
          <div className={`show-ed-stepper ${holder ? 'is-taken' : ''}`}>
            <button type="button" aria-label="One lower" disabled={!open || n <= 1} onClick={() => onNumber(String(Math.max(1, n - 1)))}>−</button>
            <span aria-hidden="true">E</span>
            <input id={`${idPrefix}-number`} type="text" inputMode="numeric" value={number} maxLength={4} disabled={!open} onChange={(e) => onNumber(e.target.value.replace(/[^0-9]/g, ''))} />
            <button type="button" aria-label="One higher" disabled={!open || n >= 9999} onClick={() => onNumber(String(Math.min(9999, n + 1)))}>+</button>
          </div>
          <span className="show-ed-hint">
            {[wasCode ? `Was ${wasCode}` : null, loading ? 'reading the numbers…' : nextFree ? `E${nextFree} is the next free number` : null].filter(Boolean).join(' · ')}
          </span>
        </div>
        {holder && (holder.kind === 'draft' && !isDraft ? (
          <p className="show-ed-hint">E{n} is also your draft {holder.title ? `“${holder.title}”` : ''} — it keeps that number until you move it.</p>
        ) : isDraft && holder.kind === 'episode' ? (
          <div className="show-ed-conflict" role="status">
            <span><b>E{n}</b> is {holder.title ? `“${holder.title}”` : 'taken'} — an episode holds that place.</span>
            {nextFree ? <button type="button" className="show-ed-choice" onClick={() => onNumber(String(nextFree))}>Use E{nextFree}</button> : null}
          </div>
        ) : (
          <div className="show-ed-conflict" role="status">
            <span><b>E{n}</b> is {holder.title ? holder.title : 'taken'} —</span>
            {onSwap && <button type="button" className="show-ed-choice" disabled={busy} onClick={onSwap}>Swap</button>}
            {onInsert && <button type="button" className="show-ed-choice" disabled={busy} onClick={onInsert}>Insert here</button>}
            {nextFree ? <button type="button" className="show-ed-choice" disabled={busy} onClick={() => onNumber(String(nextFree))}>Use E{nextFree}</button> : null}
            {(onSwap || onInsert) && (swapWords || insertWords) && (
              <span className="show-ed-conflict-words">
                {onSwap && onInsert && swapWords && swapWords === insertWords ? (
                  <span>Either way: {swapWords}</span>
                ) : (
                  <>
                    {onSwap && swapWords ? <span>Swap: {swapWords}</span> : null}
                    {onInsert && insertWords ? <span>Insert here: {insertWords}</span> : null}
                  </>
                )}
              </span>
            )}
            {moveNote ? <span className="show-ed-conflict-words"><span>{moveNote}</span></span> : null}
          </div>
        ))}
        <FieldNote policy={policy} />
      </div>
    </div>
  );
}

// The folded options: runtime, ad breaks, ads, channels, the hero spot,
// Tapa Original (the last two are the studio's on a live title).
export function MoreOptions({ idPrefix, form, set, pol, live = false }) {
  return (
    <details className="show-ed-card show-ed-more">
      <summary>
        <span className="show-ed-more-title">More options</span>
        <span className="show-ed-more-sub">Runtime, ad breaks, let channels air it{live ? ', the hero spot and Tapa Original (the last two are set by the studio)' : ', the hero spot, Tapa Original'}</span>
      </summary>
      <div className="show-ed-more-body">
        <div className="apl-grid2 show-ed-grid2">
          <div className="show-ed-field">
            <FieldHead htmlFor={`${idPrefix}-runtime`} label="Runtime" hint=" MM:SS" locked={pol('runtime').mode === 'locked'} />
            <input id={`${idPrefix}-runtime`} className="show-ed-input" type="text" value={form.runtime} placeholder="22:04" maxLength={9} disabled={!isOpen(pol('runtime'))} onChange={(e) => set('runtime', e.target.value)} />
          </div>
          <div className="show-ed-field">
            <FieldHead htmlFor={`${idPrefix}-breaks`} label="Ad breaks" hint=" MM:SS, commas" locked={pol('adBreakSeconds').mode === 'locked'} />
            <input id={`${idPrefix}-breaks`} className="show-ed-input" type="text" value={form.adBreaksText} placeholder="0:00, 10:00" disabled={!isOpen(pol('adBreakSeconds'))} onChange={(e) => set('adBreaksText', e.target.value)} />
          </div>
        </div>
        <SwitchRow id={`${idPrefix}-ads`} title="Ads in it" on={form.adsEnabled} onChange={(v) => set('adsEnabled', v)} disabled={!isOpen(pol('adsEnabled'))} policy={pol('adsEnabled').mode === 'locked' ? pol('adsEnabled') : null}>
          Off plays it without ad breaks for everyone.
        </SwitchRow>
        <SwitchRow id={`${idPrefix}-channels`} title="Let channels air it" on={form.channelOptIn} onChange={(v) => set('channelOptIn', v)} disabled={!isOpen(pol('channelOptIn'))} policy={pol('channelOptIn').mode === 'locked' ? pol('channelOptIn') : null}>
          TapaTV can schedule it live, with ads.
        </SwitchRow>
        <SwitchRow id={`${idPrefix}-hero`} title="Ask for the home page hero" on={form.featured} onChange={(v) => set('featured', v)} disabled={!isOpen(pol('featured'))} policy={pol('featured').mode === 'locked' ? pol('featured') : null}>
          The studio decides what rotates.
        </SwitchRow>
        <SwitchRow id={`${idPrefix}-original`} title="Tapa Original" on={form.isOriginal} onChange={(v) => set('isOriginal', v)} disabled={!isOpen(pol('isOriginal'))} policy={pol('isOriginal').mode === 'locked' ? pol('isOriginal') : null}>
          Made with or for the studio.
        </SwitchRow>
      </div>
    </details>
  );
}

// The line at the top of More info on a live title.
export function StagedLegend() {
  return <p className="show-ed-legend"><ClockIcon size={13} /> Marked fields go to review on a live episode. Everything else saves at once.</p>;
}

export { lineFor };
