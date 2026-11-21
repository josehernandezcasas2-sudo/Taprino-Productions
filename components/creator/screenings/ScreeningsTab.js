import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SCREENING_WORDS, screeningHref, screeningText, screeningsList } from '../../../lib/screeningRules';
import { bg } from '../title/TitleBits';
import NewLinkDialog from './NewLinkDialog';
import { ConfirmSheet, CopyButton, PartText, RouteNote, StatePill, callScreenings, errorLine, useScreeningRoute } from './ScreeningBits';

// The Private screenings tab (migration 128, 2026-11-21; the canvas's Main
// and Ended boards, mockups/private-screenings-contract.md): one component
// for a title's dashboard (/creator/title/<id>?tab=screenings, target
// { type: 'episode', id }) and a show's page (/creator/show/<id>?tab=
// screenings, target { type: 'series', id }). It reads GET
// /api/screenings?target=<type>:<id> and lib/screeningRules.js
// screeningsList turns the links into the filter chips, the cards (live
// first, then the soonest to open) and the ended ones (latest first).
// + New link and Run it again open components/creator/screenings/
// NewLinkDialog.js; Discard… asks first, then DELETE /api/screenings/<id>.
//
// The page that holds the tab can read the list itself (useScreeningsList)
// to put "3 live" on the tab, and hand the same answer in as `route`.

export function screeningsUrl(target) {
  if (!target || !target.id || !target.type) return null;
  return `/api/screenings?target=${encodeURIComponent(`${target.type}:${target.id}`)}`;
}

export function useScreeningsList(target, { enabled = true } = {}) {
  return useScreeningRoute(enabled ? screeningsUrl(target) : null);
}

// "3 live" for the tab, or '' (nothing live, or the list isn't in yet).
export function screeningsBadge(route) {
  if (!route || route.state !== 'ok' || !route.data) return '';
  return screeningsList(route.data.links || [], Date.now()).tabBadge;
}

export default function ScreeningsTab({ target, route: given = null, withHead = false }) {
  const own = useScreeningsList(target, { enabled: !given });
  const route = given || own;
  const [now, setNow] = useState(() => Date.now());
  // The lines ("Ends in 3 days", "Live") follow the clock.
  useEffect(() => { setNow(Date.now()); }, [route.data]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);
  const [filter, setFilter] = useState('all');
  const [dialog, setDialog] = useState(null); // { mode: 'new' } | { mode: 'again', link }
  const [discarding, setDiscarding] = useState(null); // a link

  const data = route.state === 'ok' ? route.data : null;
  if (!data) {
    return (
      <section className="scn-tab" aria-label={SCREENING_WORDS.tab}>
        <h2 className="scn-h2">{SCREENING_WORDS.tab}</h2>
        <RouteNote state={route.state} onRetry={route.reload} />
      </section>
    );
  }

  const t = data.target || { type: target.type, id: target.id, title: '' };
  const links = Array.isArray(data.links) ? data.links : [];
  const byId = new Map(links.map((l) => [l.id, l]));
  const list = screeningsList(links, now, filter);
  const newButton = <button type="button" className="scn-btn primary" onClick={() => setDialog({ mode: 'new' })}>{SCREENING_WORDS.newLink}</button>;

  async function discard(link) {
    const r = await callScreenings(`/api/screenings/${encodeURIComponent(link.id)}`, { method: 'DELETE' });
    if (!r.ok) return errorLine(r);
    setDiscarding(null);
    route.reload();
    return null;
  }

  return (
    <section className="scn-tab" aria-labelledby="scn-tab-h">
      {withHead && (
        <div className="scn-target">
          <span className={`scn-target-poster${t.poster ? '' : ' empty'}`} style={bg(t.poster)} aria-hidden="true" />
          <div className="scn-target-text">
            <span className="scn-k">{SCREENING_WORDS.tab}</span>
            <span className="scn-target-title">{t.title}</span>
          </div>
        </div>
      )}

      <div className="scn-tab-head">
        <div className="scn-tab-head-text">
          <h2 id="scn-tab-h" className="scn-h2">{SCREENING_WORDS.tab}</h2>
          <p className="scn-intro">{screeningText('intro', { title: t.title })}</p>
          {t.type === 'series' && <p className="scn-hint">{SCREENING_WORDS.showNote}</p>}
        </div>
        {!list.empty && newButton}
      </div>

      {list.empty ? (
        <div className="scn-empty">
          <h3 className="scn-h3">{SCREENING_WORDS.emptyTitle}</h3>
          <p className="scn-intro">{SCREENING_WORDS.emptyLine}</p>
          {newButton}
        </div>
      ) : (
        <>
          <div className="scn-filters">
            {list.filters.map((f) => (
              <button
                key={f.key}
                type="button"
                className="scn-filter"
                aria-pressed={f.on}
                disabled={f.key !== 'all' && f.count === 0 && !f.on}
                onClick={() => setFilter(f.key)}
              >
                {f.text}
              </button>
            ))}
          </div>

          {list.open.length > 0 && (
            <div className="scn-grid">
              {list.open.map((card) => (
                <OpenCard key={card.id} card={card} link={byId.get(card.id)} />
              ))}
            </div>
          )}

          {list.ended.length > 0 && (
            <>
              <div className="scn-section-head">
                <h3 className="scn-h3">{SCREENING_WORDS.endedHead}</h3>
                <p className="scn-hint">{SCREENING_WORDS.endedLine}</p>
              </div>
              <div className="scn-grid">
                {list.ended.map((card) => (
                  <EndedCard
                    key={card.id}
                    card={card}
                    onRunAgain={() => setDialog({ mode: 'again', link: byId.get(card.id) })}
                    onDiscard={() => setDiscarding(byId.get(card.id))}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {dialog && (
        <NewLinkDialog
          mode={dialog.mode}
          target={t}
          link={dialog.link || null}
          suggestion={dialog.mode === 'new' ? data.suggestion || '' : ''}
          onSaved={() => route.reload()}
          onClose={() => setDialog(null)}
        />
      )}
      {discarding && (
        <ConfirmSheet
          id="scn-discard"
          title={screeningText('discardAsk', { label: discarding.label })}
          line={SCREENING_WORDS.discardLine}
          yes={SCREENING_WORDS.discardYes}
          no={SCREENING_WORDS.keep}
          onYes={() => discard(discarding)}
          onClose={() => setDiscarding(null)}
        />
      )}
    </section>
  );
}

// A link that hasn't ended: state, who can open it, its window, its
// numbers, Copy link / Copy password / Open ›.
export function OpenCard({ card, link, readOnly = false, canOpen = true }) {
  return (
    <article className={`scn-card${card.state.key === 'scheduled' ? ' later' : ''}`}>
      <div className="scn-card-top">
        <span className="scn-pills">
          <StatePill state={card.state} />
          {card.watching > 0 && <span className="scn-pill tone-brass"><span aria-hidden="true">●</span>{card.watchingLine}</span>}
        </span>
        <span className="scn-k">{card.access}</span>
      </div>
      <h3 className="scn-card-label">{card.label}</h3>
      <div className="scn-window">
        <div className="scn-bar" aria-hidden="true">{card.progress > 0 && <span style={{ width: `${Math.round(card.progress * 100)}%` }} />}</div>
        <div className="scn-window-row scn-k">
          {card.state.key !== 'scheduled' && <span>{card.startLabel}</span>}
          <span className={card.soon ? 'soon' : 'on'}>{card.windowLine}</span>
        </div>
      </div>
      {card.parts.length > 0 && (
        <p className="scn-parts">
          {card.parts.map((p, i) => (
            <span key={i} className={p.tone ? `tone-${p.tone}` : p.dim ? 'dim' : undefined}><PartText part={p} /></span>
          ))}
        </p>
      )}
      {(!readOnly || canOpen) && (
        <div className="scn-card-acts">
          {!readOnly && card.actions.copy && link && link.url && <CopyButton text={link.url} label={SCREENING_WORDS.copyLink} />}
          {!readOnly && card.actions.copy && link && link.password && <CopyButton text={link.password} label={SCREENING_WORDS.copyPassword} />}
          {canOpen && <Link href={screeningHref(card.id)} className="scn-btn sm scn-open">{SCREENING_WORDS.open}</Link>}
        </div>
      )}
    </article>
  );
}

// An ended link: when it ended, what it did, Run it again / Discard….
export function EndedCard({ card, onRunAgain, onDiscard, readOnly = false, canOpen = true }) {
  return (
    <article className="scn-card ended">
      <div className="scn-ended-main">
        <StatePill state={card.state} />
        <h3 className="scn-card-label sm">
          {canOpen ? <Link href={screeningHref(card.id)}>{card.label}</Link> : card.label}
        </h3>
        {card.endedLine && <p className="scn-ended-line">{card.endedLine}</p>}
      </div>
      {!readOnly && (
        <div className="scn-ended-acts">
          {card.actions.runAgain && <button type="button" className="scn-btn sm" onClick={onRunAgain}>{SCREENING_WORDS.runAgain}</button>}
          {card.actions.discard && <button type="button" className="scn-btn sm danger" onClick={onDiscard}>{SCREENING_WORDS.discard}</button>}
        </div>
      )}
      {readOnly && canOpen && (
        <div className="scn-ended-acts">
          <Link href={screeningHref(card.id)} className="scn-btn sm">{SCREENING_WORDS.open}</Link>
        </div>
      )}
    </article>
  );
}
