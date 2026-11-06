import { useRef, useState } from 'react';
import { SITE } from '../../lib/siteConfig';
import { askHref } from './EpisodeFields';
import { CheckIcon, ClockIcon, ExternalLinkIcon, EyeIcon, LockIcon, PencilIcon, PlusIcon, TrashIcon, WarningIcon } from '../PlayerIcons';
import { BanIcon, ChevronIcon, KebabIcon, NoEyeIcon, bg, minutesOf } from './roomBits';
import { shortDate } from './EditorBits';
import { PayeeLine } from './PayeeCard';

// The show page's cards (series revamp slice 2; spec Screens, "Show page",
// boards Main, ShowStates, ShowLaptop): the show card, the status card, the
// Sell card, the channels switch, "Remove this show…" and the Extras shelf.
// Presentational: ShowControlRoom owns the data and the requests.

const STATE_CHIP = { live: 'state-live', ready: 'state-ready', review: 'state-private', drafts: 'state-private', empty: 'state-private', pulled: 'state-pulled', removal: 'state-removal', declined: 'state-declined' };

// The private preview of a show or an episode page (?preview=1) is the
// series revamp's slice 4; until it is built the preview links stay hidden
// (they led to a 404 for the owner). EpisodeEditor reads the same flag.
export const PREVIEW_BUILT = false;

export function publicHref(show, preview = false) {
  const base = show.kind === 'podcast' ? `/podcasts/${encodeURIComponent(show.id)}` : `/series/${encodeURIComponent(show.id)}`;
  return preview ? `${base}?preview=1` : base;
}

// "S2 · 8 episodes · 1 in review · 2 drafts" (the hub card's words).
export function countLine(seasons) {
  const rows = (seasons || []).flatMap((s) => s.rows || []);
  const eps = rows.filter((r) => r.kind === 'episode' && r.inRunningOrder !== false);
  const drafts = rows.filter((r) => r.kind === 'draft');
  const inReview = eps.filter((r) => r.status === 'pending').length;
  const seasonCount = (seasons || []).filter((s) => (s.rows || []).some((r) => r.kind !== 'gap')).length;
  const parts = [];
  if (seasonCount > 1) parts.push(`S${seasonCount}`);
  if (eps.length) {
    parts.push(`${eps.length} episode${eps.length === 1 ? '' : 's'}`);
    if (inReview) parts.push(inReview === eps.length ? 'in review' : `${inReview} in review`);
  }
  if (drafts.length) parts.push(`${drafts.length} draft${drafts.length === 1 ? '' : 's'}`);
  return parts.join(' · ') || 'Nothing added yet';
}

export function ShowCard({ view, canEdit, onEdit, onCancelStaged, busy }) {
  const show = view.show;
  const st = show.staged || {};
  const art = show.art || {};
  const firstLine = (show.description || '').split(/\n\s*\n/)[0].trim();
  const staged = [
    st.name ? { field: 'name', words: `New name “${st.name}” waiting` } : null,
    st.poster ? { field: 'poster', words: 'New poster waiting' } : null,
    st.thumbnail ? { field: 'thumbnail', words: 'New still waiting' } : null,
    st.heroImage ? { field: 'heroImage', words: 'New hero image waiting' } : null,
    st.titleImageUrl || st.titleImageRemoval ? { field: 'titleImage', words: st.titleImageRemoval ? 'Title image removal waiting' : 'New title image waiting' } : null,
    st.trailer ? { field: 'trailer', words: 'New trailer waiting' } : null,
    st.description ? { field: 'description', words: 'New description waiting' } : null
  ].filter(Boolean);
  const isPublic = show.isPublic;
  const chip = STATE_CHIP[show.state] || 'state-private';
  return (
    <section className="show-room-card" aria-label={show.name || 'The show'}>
      <div className="show-card-top">
        {canEdit ? (
          <button type="button" className={`show-card-poster ${art.poster ? '' : 'is-empty'}`} style={bg(art.poster)} onClick={() => onEdit('art')} aria-label="Change the poster (Edit show, Art)">
            {!art.poster && <span>{show.name}</span>}
          </button>
        ) : (
          <span className={`show-card-poster ${art.poster ? '' : 'is-empty'}`} style={bg(art.poster)} aria-hidden="true">{!art.poster && <span>{show.name}</span>}</span>
        )}
        <div className="show-card-body">
          {art.titleImageUrl ? <h1 className="show-card-name has-image"><img src={art.titleImageUrl} alt={show.name || ''} /></h1> : <h1 className="show-card-name">{show.name}</h1>}
          <div className="cs-show-chips show-card-chips">
            <span className={`cs-chip ${show.kind === 'podcast' ? 'kind-podcast' : 'kind-series'}`}>{show.kind === 'podcast' ? 'Podcast' : show.kind === 'vertical' ? 'Vertical' : 'Series'}</span>
            <span className={`cs-chip ${chip}`}>{show.state === 'live' ? <i /> : null}{show.statusLabel || 'Not public yet'}</span>
          </div>
          <p className="show-card-count">{countLine(view.seasons)}</p>
          {firstLine && <p className="show-card-desc">{firstLine}</p>}
        </div>
      </div>
      {/* Who runs it and who it pays (slice 3b), for those who may see who is paid. */}
      {view.payee && view.payee.line ? <PayeeLine payee={view.payee} className="show-card-paid" /> : null}
      {staged.length > 0 && (
        <ul className="show-card-staged">
          {staged.map((s) => (
            <li key={s.field}>
              <ClockIcon size={12} />
              <span>{s.words}</span>
              {canEdit && onCancelStaged && <button type="button" className="apl-link" disabled={busy === `staged-${s.field}`} onClick={() => onCancelStaged(s.field)}>{busy === `staged-${s.field}` ? '…' : 'Cancel'}</button>}
            </li>
          ))}
        </ul>
      )}
      <div className="show-card-acts">
        {canEdit && <button type="button" className="apl-btn-secondary show-card-btn" onClick={() => onEdit('details')}><PencilIcon size={15} /> Edit show</button>}
        {isPublic ? (
          <a className="apl-btn-secondary show-card-btn" href={publicHref(show)} target="_blank" rel="noopener noreferrer"><ExternalLinkIcon size={15} /> View page</a>
        ) : (
          PREVIEW_BUILT && <a className="apl-btn-secondary show-card-btn is-preview" href={publicHref(show, true)} target="_blank" rel="noopener noreferrer"><EyeIcon size={15} /> Preview · not public yet</a>
        )}
      </div>
    </section>
  );
}

// The status card: the headline by where the show stands (lib/showRules.js
// showState), what it means, its buttons (Make it public, Preview, Cancel
// request, Resubmit), and the problem lines (showProblems), each leading
// to its row.
export function ShowStatusCard({ view, contributor, onProblem, onMakePublic, onCancelRemoval, onResubmit, busy }) {
  const show = view.show;
  const noun = show.kind === 'podcast' ? 'show' : 'series';
  const state = show.state;
  const problems = (view.problems || []).filter((p) => p.code !== 'delay');
  const delay = (view.problems || []).some((p) => p.code === 'delay');
  const rows = (view.seasons || []).flatMap((s) => s.rows || []);
  const eps = rows.filter((r) => r.kind === 'episode');
  const firstReview = eps.filter((r) => r.status === 'pending').sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))[0] || null;
  const firstApproved = eps.find((r) => r.status === 'approved') || null;
  const level = state === 'pulled' ? 'danger' : state === 'declined' ? 'warn' : state === 'removal' || state === 'empty' || state === 'drafts' ? 'neutral' : state === 'review' ? 'review' : 'ok';
  const make = view.makePublic;
  let icon = null;
  let body = null;
  let acts = null;
  if (state === 'empty' || state === 'drafts') {
    icon = <NoEyeIcon size={18} />;
    body = <p>Once we approve an episode, you choose when it goes public.</p>;
  } else if (state === 'review') {
    icon = <ClockIcon size={18} />;
    body = firstReview
      ? <p><strong>{firstReview.displayTitle}</strong> ({firstReview.code}) was sent {firstReview.createdAt ? agoWords(firstReview.createdAt) : 'for review'}. Once we approve it, you choose when {show.name} goes public.</p>
      : <p>Once we approve an episode, you choose when {show.name} goes public.</p>;
  } else if (state === 'ready') {
    icon = <CheckIcon size={18} />;
    body = <p>{firstApproved ? <><strong>{firstApproved.displayTitle}</strong> is approved. </> : null}{show.name} stays private until you make it public, so you can wait for more episodes and open a whole season at once. Episodes approved after that go live straight away.</p>;
    acts = (
      <div className="show-status-acts">
        {make && make.ok ? (
          <button type="button" className="apl-btn show-status-btn" disabled={busy === 'public'} onClick={onMakePublic}>{busy === 'public' ? 'Making it public…' : 'Make it public'}</button>
        ) : make && make.reason ? <p className="show-status-why">{make.reason}</p> : null}
        {PREVIEW_BUILT && <a className="apl-btn-secondary show-status-btn" href={publicHref(show, true)} target="_blank" rel="noopener noreferrer">Preview the page</a>}
      </div>
    );
  } else if (state === 'pulled') {
    icon = <BanIcon size={18} />;
    body = <p>You can still replace the file (the new one comes to us first), add captions and edit page notes. <a href={askHref(`Pulled: ${show.name}`)}>Email us</a></p>;
  } else if (state === 'removal') {
    icon = <TrashIcon size={18} />;
    body = <p>Nothing on the {noun} can be changed while the request is open.{show.deletion && show.deletion.reason ? <> Your reason: “{show.deletion.reason}”</> : null}</p>;
    acts = !contributor && onCancelRemoval ? <div className="show-status-acts"><button type="button" className="apl-btn-secondary show-status-btn" disabled={busy === 'removal'} onClick={onCancelRemoval}>{busy === 'removal' ? 'Cancelling…' : 'Cancel request'}</button></div> : null;
  } else if (state === 'declined') {
    icon = <WarningIcon size={18} />;
    body = <p>{show.decisionNote ? <><strong>Their note:</strong> {show.decisionNote} </> : null}Fix what it needs and press Resubmit; it comes back as not public yet.</p>;
    acts = !contributor && onResubmit ? <div className="show-status-acts"><button type="button" className="apl-btn show-status-btn" disabled={busy === 'resubmit'} onClick={onResubmit}>{busy === 'resubmit' ? 'Sending…' : 'Resubmit'}</button></div> : null;
  } else {
    icon = <span className="show-status-dot" aria-hidden="true" />;
  }
  const headline = state === 'removal' && show.deletion && show.deletion.at ? `Removal requested on ${shortDate(show.deletion.at)}` : show.headline || show.statusLabel;
  return (
    <section className={`show-status level-${level}`} aria-label="Where the show stands">
      <h2 className="show-status-head">{icon}<span>{headline}</span></h2>
      {body && !contributor ? <div className="show-status-body">{body}</div> : null}
      {contributor && (
        <p className="show-status-lock"><LockIcon size={13} /> <span>Only {show.ownerName || 'its owner'} can change this {noun}. You can still edit your own episodes.</span></p>
      )}
      {!contributor && acts}
      {problems.length > 0 && !contributor && (
        <div className="show-status-problems">
          <p className="show-status-k">{problems.length === 1 ? '1 thing needs you' : `${problems.length} things need you`}</p>
          <ul>
            {problems.map((p, i) => (
              <li key={`${p.code}-${i}`}>
                <button type="button" className={`show-problem level-${p.level || 'warn'}`} onClick={() => onProblem(p)}>
                  {p.level === 'warn' ? <WarningIcon size={15} /> : <ClockIcon size={15} />}
                  <span>{p.words}</span>
                  <ChevronIcon size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {delay && <p className="show-status-foot"><ClockIcon size={12} /> Changes reach visitors within a few minutes</p>}
    </section>
  );
}

function agoWords(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 'for review';
  const h = Math.floor((Date.now() - t) / 3600000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

const dollars = (cents) => `$${(Number(cents) / 100).toFixed(2)}`;

// "Sell" (live shows only): the whole series' price state, the episodes'
// price when they share one, how many own the whole series, and the button
// that opens SellTitleModal for the series.
export function SellCard({ view, episodePrices, onOpen }) {
  const price = view.price;
  const state = !price ? 'none' : price.pendingCents != null ? 'pending' : price.status || 'off';
  const pill = { on: { text: 'On sale', cls: 'state-live' }, pending: { text: 'In review', cls: 'state-private' }, off: { text: 'Not selling', cls: 'state-removal' }, rejected: { text: 'Not approved', cls: 'state-declined' }, none: null }[state];
  const each = (episodePrices || []).filter((c) => c > 0);
  const same = each.length > 0 && each.every((c) => c === each[0]);
  const buyers = view.cascade ? Number(view.cascade.seriesBuyers) || 0 : 0;
  return (
    <section className="show-side-card show-sell" aria-labelledby="show-sell-k">
      <p className="show-side-k" id="show-sell-k">Sell</p>
      <div className="show-sell-row">
        <span className="show-sell-what">Whole {view.show.kind === 'podcast' ? 'show' : 'series'}{pill ? <span className={`cs-chip ${pill.cls}`}>{pill.text}</span> : null}</span>
        <span className="show-sell-price">{price && price.priceCents ? dollars(price.priceCents) : price && price.pendingCents ? dollars(price.pendingCents) : '—'}</span>
      </div>
      {each.length > 0 && (
        <div className="show-sell-row">
          <span className="show-sell-what">Each episode</span>
          <span className="show-sell-price">{same ? dollars(each[0]) : `from ${dollars(Math.min(...each))}`}</span>
        </div>
      )}
      {buyers > 0 && <p className="show-sell-note">{buyers} {buyers === 1 ? 'person owns' : 'people own'} the whole {view.show.kind === 'podcast' ? 'show' : 'series'}</p>}
      <button type="button" className="apl-btn-secondary show-side-btn" onClick={onOpen}>{price ? 'Price and sales' : `Sell the whole ${view.show.kind === 'podcast' ? 'show' : 'series'}`}</button>
    </section>
  );
}

export function ChannelsCard({ view, canEdit, locked, busy, onToggle }) {
  const on = Boolean(view.show.channelOptIn);
  const noun = view.show.kind === 'podcast' ? 'show' : 'show';
  return (
    <section className="show-side-card show-channels">
      <div className="show-channels-row">
        <div>
          <p className="show-channels-title" id="show-chan-title">Let channels air the whole {noun}</p>
          <p className="show-channels-sub">{on ? 'On.' : 'Off.'} TapaTV can schedule every episode live, with ads.{locked ? ` ${locked}` : ''}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on ? 'true' : 'false'}
          aria-labelledby="show-chan-title"
          className={`seal-switch show-ed-switch ${on ? 'on' : ''}`}
          disabled={!canEdit || Boolean(locked) || busy}
          onClick={() => onToggle(!on)}
        />
      </div>
    </section>
  );
}

export function RemoveShowCard({ view, canRequest, busy, onRequest, onCancel }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const show = view.show;
  const noun = show.kind === 'podcast' ? 'show' : 'show';
  const deletion = show.deletion || {};
  if (deletion.requested) {
    return (
      <p className="show-remove-line">
        Removal requested{deletion.at ? ` on ${shortDate(deletion.at)}` : ''}
        {canRequest && <> · <button type="button" className="apl-link" disabled={busy === 'removal'} onClick={onCancel}>{busy === 'removal' ? 'Cancelling…' : 'Cancel'}</button></>}
      </p>
    );
  }
  if (!canRequest) return null;
  if (!open) return <button type="button" className="show-remove-open" onClick={() => setOpen(true)}>Remove this {noun}…</button>;
  return (
    <section className="show-side-card show-remove" aria-labelledby="show-remove-k">
      <p className="show-side-k is-danger" id="show-remove-k">Remove this {noun}</p>
      <p className="show-remove-words">{view.cascade ? view.cascade.words : show.name}</p>
      <p className="show-remove-sub">It leaves the site as soon as you ask; we confirm it. Anything someone bought stays theirs.</p>
      <label className="show-ed-label" htmlFor="show-remove-reason">Why?</label>
      <textarea id="show-remove-reason" className="show-ed-textarea is-short" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="A line for us" />
      <div className="show-remove-acts">
        <button type="button" className="show-danger-btn" disabled={!reason.trim() || busy === 'removal'} onClick={() => onRequest(reason.trim())}>{busy === 'removal' ? 'Asking…' : 'Ask us to remove it'}</button>
        <button type="button" className="apl-link" onClick={() => { setOpen(false); setReason(''); }}>Keep it</button>
      </div>
    </section>
  );
}

// Extras: bonus clips with the show or after one of its episodes.
export function ExtrasShelf({ view, ctx, actions }) {
  const extras = view.extras || [];
  const still = view.show.art ? view.show.art.thumbnail || view.show.art.poster : null;
  return (
    <section className="show-extras" aria-labelledby="show-extras-h">
      <h2 className="show-extras-h" id="show-extras-h">Extras <span className="show-extras-n">· {extras.length}</span></h2>
      {extras.length > 0 && (
        <ul className="show-extras-grid">
          {extras.map((x) => {
            const tag = x.anchor && x.anchor.code ? `After ${x.anchor.code}` : 'With the show';
            const mine = x.mine || ctx.team;
            return (
              <li key={x.id} id={`ep-${x.id}`} className={`show-extra ${ctx.openId === x.id ? 'is-open' : ''} ${ctx.flashId === x.id ? 'is-flash' : ''}`}>
                <div className="show-extra-art" style={bg(x.thumbnail || still)}>
                  <span className="show-extra-name" aria-hidden="true">{x.thumbnail ? '' : x.displayTitle}</span>
                  {(ctx.isOwner || mine) && (
                    <ExtraMenu
                      label={`More for ${x.displayTitle}`}
                      items={[
                        mine ? { label: 'Edit', onClick: () => actions.open(x) } : null,
                        ctx.isOwner || mine ? { label: 'Place after…', onClick: () => actions.placeExtra(x) } : null,
                        // Extras follow their show (Jose, 2026-11-06): whoever
                        // runs it prices a live extra, a contributor's too.
                        ctx.canSell && x.status === 'approved' && !x.held && !x.deletionRequested && !x.withdrawnAt ? { label: ctx.priceOf(x.id) ? 'Price and sales' : 'Sell…', onClick: () => actions.sell(x) } : null,
                        x.mine && !x.deletionRequested ? { label: 'Remove…', danger: true, onClick: () => actions.askRemove(x) } : null
                      ]}
                    />
                  )}
                </div>
                <button type="button" className="show-extra-title" disabled={!mine} onClick={() => actions.open(x)}>{x.displayTitle}</button>
                <div className="show-extra-meta">
                  <span className="show-extra-tag">{tag}</span>
                  {minutesOf(x.runtime) ? <span>{minutesOf(x.runtime)}</span> : null}
                  {x.status === 'pending' ? <span className="tone-wait">in review</span> : x.status === 'rejected' ? <span className="tone-warn">not this time</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {ctx.canAdd && <a className="apl-btn-secondary show-extras-add" href={`/creator/submit?type=bonus&series=${encodeURIComponent(view.show.id)}`}><PlusIcon size={15} /> Add extra</a>}
    </section>
  );
}

function ExtraMenu({ items, label }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const shown = items.filter(Boolean);
  if (!shown.length) return null;
  // Escape closes it; Escape or an item puts the focus back on the kebab.
  const back = () => { if (btnRef.current) btnRef.current.focus({ preventScroll: true }); };
  return (
    <div className="show-kebab-wrap show-extra-kebab" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }} onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); back(); } }}>
      <button type="button" ref={btnRef} className="show-kebab is-dark" aria-haspopup="menu" aria-expanded={open ? 'true' : 'false'} aria-label={label} onClick={() => setOpen((v) => !v)}><KebabIcon size={16} /></button>
      {open && (
        <div className="show-menu" role="menu">
          {shown.map((it) => <button key={it.label} type="button" role="menuitem" className={`show-menu-item ${it.danger ? 'is-danger' : ''}`} onClick={() => { setOpen(false); back(); it.onClick(); }}><span>{it.label}</span></button>)}
        </div>
      )}
    </div>
  );
}

export const PREMIUM_WORD = SITE.premiumTier;
