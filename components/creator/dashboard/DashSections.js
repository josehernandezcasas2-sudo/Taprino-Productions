import { useState } from 'react';
import Link from 'next/link';
import { DASH_WORDS, TITLE_FILTERS, TITLES_LIMIT, count, dollars, filterTitles } from '../../../lib/creatorDashboardRules';
import { Spark } from './DashCharts';

// The Dashboard's sections (2026-11-14). Each takes what
// lib/creatorDashboardRules.js built and draws it: no number or sentence
// is worked out here. Start something, Get paid, Paid to you and Discard
// came over from Creator Studio's hub when the Dashboard took its place;
// Supporters and a tip's note in Latest came with them.

function bg(url) {
  return url ? { backgroundImage: `url("${String(url).replace(/"/g, '%22')}")` } : undefined;
}

function Chevron() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

// A button for "Make it public", a link for everything else.
function Act({ action, busy, onPublish, className }) {
  if (!action) return null;
  if (action.kind === 'publish') {
    return (
      <button type="button" className={className} disabled={busy === action.showId} onClick={() => onPublish(action)}>
        {busy === action.showId ? 'Making it public…' : action.label}
      </button>
    );
  }
  return <Link href={action.href} className={className}>{action.label}</Link>;
}

export function Tiles({ tiles }) {
  return (
    <div className="dash-tiles">
      {tiles.map((tile) => (
        <div key={tile.key} className={`dash-tile${tile.tone ? ` ${tile.tone}` : ''}`}>
          <div className="dash-tile-k">{tile.label}</div>
          <div className="dash-tile-v">{tile.value == null ? <span className="dash-skel" aria-label="Loading" /> : tile.value}</div>
          <div className="dash-tile-sub">{tile.sub}</div>
        </div>
      ))}
    </div>
  );
}

export function Needs({ needs, loading, busy, onPublish }) {
  return (
    <section className="dash-card dash-needs" aria-labelledby="dash-needs-h">
      <h2 id="dash-needs-h" className="dash-k accent">{DASH_WORDS.needs}{needs.total > 0 ? ` · ${needs.total}` : ''}</h2>
      {needs.rows.length === 0 ? (
        <p className="dash-empty">{loading ? 'Loading…' : DASH_WORDS.needsNone}</p>
      ) : (
        <ul className="dash-needs-list">
          {needs.rows.map((row) => (
            <li key={row.key} className="dash-need">
              <div className="dash-need-text">
                <div className="dash-need-title">{row.title}</div>
                {row.sub && <div className="dash-need-sub">{row.sub}</div>}
              </div>
              <Act action={row.action} busy={busy} onPublish={onPublish} className="dash-need-act" />
            </li>
          ))}
        </ul>
      )}
      {needs.more > 0 && <Link href="/creator/my-work?attention=1" className="dash-more-link">{needs.more} more in Your work →</Link>}
    </section>
  );
}

function TitleRow({ row, busy, onPublish, onDiscard }) {
  const live = row.state === 'live';
  return (
    <li className={`dash-row state-${row.state}`}>
      <Link href={row.href} className="dash-row-main">
        <span className={`dash-thumb${row.poster ? '' : ' empty'}`} style={bg(row.poster)} aria-hidden="true" />
        <span className="dash-row-text">
          <span className="dash-row-title">{row.title}</span>
          <span className="dash-row-meta">
            <span className={`dash-chip state-${row.state}`}>{row.state === 'live' && <i aria-hidden="true" />}{row.stateLabel}</span>
            {row.meta && <span>{row.meta}</span>}
          </span>
          {row.needsWhy && <span className="dash-row-why">{row.needsWhy}</span>}
        </span>
      </Link>
      {live ? (
        <span className="dash-nums">
          <span className="dash-cell dash-views">
            <span className="dash-num">{row.views == null ? '—' : count(row.views)}</span>
            <span className="dash-unit">views</span>
            <Spark values={row.spark} label={`Views over the last 30 days: ${row.views == null ? 'not known' : count(row.views)}`} />
          </span>
          <span className="dash-cell dash-watched">{row.watchedPct == null ? '—' : `${row.watchedPct}%`}</span>
          <span className="dash-cell dash-earned">
            <span className="dash-num strong">{row.earnedCents == null ? '—' : dollars(row.earnedCents)}</span>
            {row.earnedDetail && <span className="dash-detail">{row.earnedDetail}</span>}
          </span>
        </span>
      ) : (
        <span className="dash-cell dash-note">
          {row.note && <span>{row.note}</span>}
          <Act action={row.action} busy={busy} onPublish={onPublish} className={row.action && row.action.kind === 'publish' ? 'dash-btn gold' : 'dash-btn'} />
          {row.secondary && row.secondary.kind === 'discard' && (
            <button type="button" className="dash-quiet" disabled={busy === `discard:${row.secondary.draftId}`} onClick={() => onDiscard(row.secondary)} aria-label={`${row.secondary.label} ${row.title}`}>
              {busy === `discard:${row.secondary.draftId}` ? DASH_WORDS.discarding : row.secondary.label}
            </button>
          )}
        </span>
      )}
      <Link href={row.href} className="dash-open" aria-label={`Open ${row.title}`}><Chevron /></Link>
    </li>
  );
}

export function Titles({ titles, loading, failed, busy, onPublish, onDiscard, monthShort, filter, setFilter, all, setAll }) {
  const rows = filterTitles(titles.rows, filter);
  const shown = all ? rows : rows.slice(0, TITLES_LIMIT);
  const countOf = { all: titles.counts.all, live: titles.counts.live, review: titles.counts.review, drafts: titles.counts.drafts, needs: titles.counts.needs };
  return (
    <section className="dash-card dash-titles" aria-labelledby="dash-titles-h">
      <div className="dash-card-head">
        <h2 id="dash-titles-h" className="dash-h2">{DASH_WORDS.titles}</h2>
        <Link href="/creator/my-work" className="dash-link">{DASH_WORDS.seeAll} →</Link>
      </div>
      <div className="dash-filters" role="group" aria-label="Show">
        {TITLE_FILTERS.map((f) => (
          <button key={f.key} type="button" className={`dash-filter${filter === f.key ? ' on' : ''}`} aria-pressed={filter === f.key} onClick={() => { setFilter(f.key); setAll(false); }}>
            {f.label} {countOf[f.key]}
          </button>
        ))}
      </div>
      <div className="dash-row dash-row-head" aria-hidden="true">
        <span>Title</span>
        <span className="dash-nums">
          <span className="dash-cell dash-views">Views · 30 days</span>
          <span className="dash-cell dash-watched">Watched</span>
          <span className="dash-cell dash-earned">Earned{monthShort ? ` · ${monthShort}` : ''}</span>
        </span>
        <span className="dash-open" />
      </div>
      {shown.length === 0 ? (
        <p className="dash-empty pad">{loading ? 'Loading your titles…' : failed ? 'Your titles couldn’t be loaded. Reload the page to try again.' : filter === 'all' ? DASH_WORDS.noTitles : 'Nothing in this group.'}</p>
      ) : (
        <ul className="dash-rows">
          {shown.map((row) => <TitleRow key={row.key} row={row} busy={busy} onPublish={onPublish} onDiscard={onDiscard} />)}
        </ul>
      )}
      {rows.length > TITLES_LIMIT && (
        <button type="button" className="dash-show-all" aria-expanded={all} onClick={() => setAll((v) => !v)}>{all ? 'Show fewer' : `Show all ${rows.length}`}</button>
      )}
      <p className="dash-foot">{DASH_WORDS.earnedNote}</p>
    </section>
  );
}

export function Money({ card, loading, failed }) {
  return (
    <section className="dash-card dash-money" aria-labelledby="dash-money-h">
      <div className="dash-card-head baseline">
        <h2 id="dash-money-h" className="dash-k">{card ? card.label : DASH_WORDS.money}</h2>
        {card && <span className="dash-total">{card.total}</span>}
      </div>
      {!card ? (
        <p className="dash-empty">{loading ? 'Adding it up…' : failed ? 'The money couldn’t be loaded just now.' : ''}</p>
      ) : (
        <>
          <ul className="dash-lanes">
            {card.lanes.map((lane) => (
              <li key={lane.key} className="dash-lane">
                <span className="dash-lane-name">{lane.label}</span>
                <span className="dash-lane-track" aria-hidden="true"><span className="dash-lane-bar" style={{ width: `${Math.round(lane.share * 100)}%` }} /></span>
                <span className="dash-lane-value">{dollars(lane.cents)}</span>
              </li>
            ))}
          </ul>
          <p className="dash-fine">{card.adShareNote}</p>
          <div className="dash-moves">
            <div className="dash-move">
              <div>
                <div className="dash-move-title">{card.onFirst.title}</div>
                <div className="dash-move-sub">{card.onFirst.sub}</div>
              </div>
              <span className="dash-move-value">{card.onFirst.value}</span>
            </div>
            {card.stripe && (
              <div className="dash-move">
                <div>
                  <div className="dash-move-title">{card.stripe.title}</div>
                  <div className="dash-move-sub">{card.stripe.sub}</div>
                </div>
                <span className="dash-move-value">{card.stripe.value}</span>
              </div>
            )}
            {card.stripeError && <p className="dash-fine">{card.stripeError}</p>}
          </div>
        </>
      )}
      <Link href="/creator/money" className="dash-link">{DASH_WORDS.openMoney} →</Link>
    </section>
  );
}

export function Latest({ rows, loading }) {
  return (
    <section className="dash-card dash-latest" aria-labelledby="dash-latest-h">
      <h2 id="dash-latest-h" className="dash-k">{DASH_WORDS.latest}</h2>
      {rows.length === 0 ? (
        <p className="dash-empty">{loading ? 'Loading…' : DASH_WORDS.latestNone}</p>
      ) : (
        <ul className="dash-latest-list">
          {rows.map((row) => (
            <li key={row.key}>
              <Link href={row.href} className="dash-latest-row">
                <span className="dash-latest-text">
                  {row.text}{row.amount && <span className="dash-latest-amount"> · {row.amount}</span>}
                  {row.quote && <span className="dash-quote">{row.quote}</span>}
                </span>
                <span className="dash-latest-when">{row.when}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// The shortcuts under Submit a title: one per kind of title, then a pitch.
export function Start({ items }) {
  if (!items || items.length === 0) return null;
  return (
    <nav className="dash-start" aria-label={DASH_WORDS.start}>
      <span className="dash-k dash-start-k">{DASH_WORDS.start}</span>
      <div className="dash-start-row">
        {items.map((item) => <Link key={item.key} href={item.href} className="dash-pill">{item.label}</Link>)}
      </div>
    </nav>
  );
}

// An invite to be paid for a title, with its two answers. Drawn only
// while one waits; the notification and the email open it at #get-paid.
export function GetPaid({ invites, busy, errors, onAnswer }) {
  if (!invites || invites.length === 0) return null;
  return (
    <section id="get-paid" className="dash-card dash-getpaid" aria-labelledby="dash-getpaid-h">
      <h2 id="dash-getpaid-h" className="dash-k accent">{DASH_WORDS.getPaid}{invites.length > 1 ? ` · ${invites.length}` : ''}</h2>
      <ul className="dash-invites">
        {invites.map((inv) => {
          const mine = typeof busy === 'string' && busy.startsWith(`invite:${inv.id}:`);
          return (
            <li key={inv.key} className="dash-invite">
              <h3 className="dash-invite-title">{inv.headline}</h3>
              <div className="dash-need-sub">{inv.asked}</div>
              {inv.body.length > 0 && (
                <ul className="dash-invite-body">
                  {inv.body.map((line) => (
                    <li key={line.text}>
                      {line.payouts ? <>To receive it, set up payouts under <Link href="/creator/money#payouts" className="dash-inline-link">Money</Link>.</> : line.text}
                    </li>
                  ))}
                </ul>
              )}
              {errors && errors[inv.id] && <p className="dash-error" role="alert">{errors[inv.id]}</p>}
              <div className="dash-invite-acts">
                <button type="button" className="dash-btn gold" disabled={mine} onClick={() => onAnswer(inv, 'accept')}>{busy === `invite:${inv.id}:accept` ? DASH_WORDS.accepting : DASH_WORDS.accept}</button>
                <button type="button" className="dash-btn" disabled={mine} onClick={() => onAnswer(inv, 'decline')}>{busy === `invite:${inv.id}:decline` ? DASH_WORDS.declining : DASH_WORDS.notNow}</button>
              </div>
              <p className="dash-fine">{inv.foot}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// The titles whose earnings come to this account.
export function PaidTo({ rows, busy, error, onStop }) {
  if (!rows || rows.length === 0) return null;
  return (
    <section className="dash-card dash-paidto" aria-labelledby="dash-paidto-h">
      <h2 id="dash-paidto-h" className="dash-k">{DASH_WORDS.paidToYou}{rows.length > 1 ? ` · ${rows.length}` : ''}</h2>
      <ul className="dash-needs-list">
        {rows.map((row) => (
          <li key={row.key} className="dash-need">
            <div className="dash-need-text">
              {row.href ? <Link href={row.href} className="dash-need-title dash-paidto-title">{row.title}</Link> : <div className="dash-need-title">{row.title}</div>}
              {row.meta && <div className="dash-need-sub">{row.meta}</div>}
              {!row.canStop && row.locked && <div className="dash-need-sub">{row.locked}</div>}
            </div>
            {row.canStop && (
              <button type="button" className="dash-quiet" disabled={busy === `stop:${row.key}`} onClick={() => onStop(row)}>{busy === `stop:${row.key}` ? DASH_WORDS.stopping : DASH_WORDS.stop}</button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="dash-error" role="alert">{error}</p>}
    </section>
  );
}

// Who is behind the money: counts, and names only where a member chose
// to share theirs.
export function Supporters({ card }) {
  if (!card) return null;
  return (
    <section className="dash-card dash-supporters" aria-labelledby="dash-supporters-h">
      <h2 id="dash-supporters-h" className="dash-k">{DASH_WORDS.supporters}</h2>
      <dl className="dash-facts">
        {card.rows.map((row) => (
          <div key={row.key} className="dash-fact">
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      {card.names.length > 0 && (
        <p className="dash-names"><span className="dash-names-k">{card.namesLabel}</span> {card.names.join(', ')}{card.more ? ` ${card.more}` : ''}</p>
      )}
      <p className="dash-fine">{card.note}</p>
      <Link href={card.href} className="dash-link">{DASH_WORDS.openSupporters} →</Link>
    </section>
  );
}

export function Pitch({ pitch }) {
  if (!pitch) return null;
  return (
    <section className="dash-card dash-pitch" aria-labelledby="dash-pitch-h">
      <h2 id="dash-pitch-h" className="dash-k">{DASH_WORDS.pitch}</h2>
      <div className="dash-pitch-title">{pitch.title}</div>
      {pitch.share != null && (
        <div className="dash-progress" role="img" aria-label={pitch.line}><span style={{ width: `${Math.round(pitch.share * 100)}%` }} /></div>
      )}
      <div className="dash-move-sub">{pitch.line}</div>
      <Link href={pitch.href} className="dash-link push">{pitch.action} →</Link>
    </section>
  );
}

export function YourLink({ link }) {
  const [copied, setCopied] = useState(false);
  if (!link) return null;
  const host = typeof window !== 'undefined' ? window.location.host : '';
  const shown = `${host}${link.path}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${link.path}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <section className="dash-card dash-yourlink" aria-labelledby="dash-link-h">
      <h2 id="dash-link-h" className="dash-k">{DASH_WORDS.link}</h2>
      <div className="dash-link-box">
        <span className="dash-link-url" suppressHydrationWarning>{shown}</span>
        <button type="button" className="dash-copy" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <div className="dash-move-sub">{link.joined}</div>
      <div className="dash-move-sub">{link.bonus}</div>
    </section>
  );
}
