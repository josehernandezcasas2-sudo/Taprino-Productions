import { useState } from 'react';
import { callApi } from '../EditorBits';
import { BanIcon, ChevronIcon, NoEyeIcon } from '../roomBits';
import { CheckIcon, ClockIcon, TrashIcon, WarningIcon } from '../../PlayerIcons';
import { AdmCard, ErrorLine, NeedLine, dayWords } from './adminBits';

const NUMBERING = new Set(['duplicate', 'gap', 'parked', 'unnumbered']);
const LEVEL = { live: 'ok', ready: 'ok', review: 'review', drafts: 'neutral', empty: 'neutral', pulled: 'danger', removal: 'neutral', declined: 'warn' };

// Where it stands (the admin show page, slice 3a §5.3), in place of the
// creator's status card: the headline, what the state means for the team,
// Make it public for a full admin (decision 2: it is the owner's call;
// a sub-admin reads who can), and the problem lines — a numbering problem
// gets "Fix numbering in Season N" (manage_episodes).
export default function AdminStatusCard({ admin, view, onDone, onAction, onProblem, say }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const show = admin.show || {};
  const state = show.state || (view.show && view.show.state) || 'empty';
  const owner = admin.ownerName || null;
  const Owner = owner || 'Its owner';
  const ownerLower = owner || 'its owner';
  const name = show.name || 'this show';
  const can = admin.can || {};
  const needs = admin.needs || {};
  const shows118 = Boolean(view.migration && view.migration.shows118);
  const rows = (view.seasons || []).flatMap((s) => s.rows || []);
  const approvedCount = rows.filter((r) => r.kind === 'episode' && r.status === 'approved' && r.inRunningOrder !== false).length;

  const rawHeadline = show.headline || show.statusLabel || 'Not public yet';
  // The creator's headlines speak to them ("your first episode…"): the
  // team reads the plain state instead.
  const headline = state === 'removal' && show.deletion && show.deletion.at
    ? `Removal requested on ${dayWords(show.deletion.at)}`
    : /\byour\b/i.test(rawHeadline) ? show.statusLabel || 'Not public yet' : rawHeadline;

  async function makePublic() {
    const n = approvedCount;
    if (!window.confirm(`Make ${name} public? Its ${n === 1 ? 'approved episode goes' : `${n} approved episodes go`} live now and Premium’s early screening starts again. This can’t be undone.`)) return;
    setBusy('public');
    setError(null);
    const r = await callApi('POST', `/api/show/${encodeURIComponent(show.id)}/public`, {});
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      onDone();
      return;
    }
    say({ tone: 'ok', title: `${name} is public`, lines: [`${owner || 'Its owner'} was told.`] }, 7000);
    onDone();
  }

  async function fixNumbering(season) {
    if (!window.confirm(`Renumber Season ${season} from E1 in play order? Some episodes may change number; ${owner || 'its owner'} is told.`)) return;
    setBusy(`fix-${season}`);
    setError(null);
    const r = await onAction('fix_numbering', { season });
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    say({ tone: 'ok', title: r.data.unchanged ? 'Nothing to fix' : 'Renumbered', lines: [r.data.words].filter(Boolean) }, 7000);
    onDone();
  }

  let icon = <span className="show-status-dot" aria-hidden="true" />;
  let body = null;
  let acts = null;
  if (state === 'empty' || state === 'drafts') {
    icon = <NoEyeIcon size={18} />;
    body = <p>Nothing has been sent for review yet.</p>;
  } else if (state === 'review') {
    icon = <ClockIcon size={18} />;
    body = <p>The first episode is in review. Once one is approved, {ownerLower} makes the show public.</p>;
  } else if (state === 'ready') {
    icon = <CheckIcon size={18} />;
    body = <p>{Owner} chooses when it goes public — maybe once more episodes are approved.</p>;
    acts = (
      <div className="show-status-acts">
        <button type="button" className="apl-btn show-status-btn" disabled={!can.makePublic || Boolean(busy)} onClick={makePublic}>{busy === 'public' ? 'Making it public…' : 'Make it public'}</button>
        <NeedLine line={can.makePublic ? null : needs.makePublic} />
        <p className="show-adm-note">It’s {owner ? `${owner}’s` : 'the owner’s'} call when the show opens — use this when they’ve asked you to.</p>
      </div>
    );
  } else if (state === 'pulled') {
    icon = <BanIcon size={18} />;
    const why = show.holdReason || show.decisionNote || null;
    body = <p>Pulled while the team looks at it{why ? `: ${why}` : ''}. Restore it under Decisions.</p>;
  } else if (state === 'removal') {
    icon = <TrashIcon size={18} />;
    body = <p>{Owner} asked to remove it{show.deletion && show.deletion.at ? ` on ${dayWords(show.deletion.at)}` : ''}. Decide under <a href="#removal">Remove this show</a>.</p>;
  } else if (state === 'declined') {
    icon = <WarningIcon size={18} />;
    body = <p>An older decline, from before shows were reviewed by episode. {Owner} can resubmit it.</p>;
  } else if (state === 'live') {
    body = show.publicAt ? <p>Public since {dayWords(show.publicAt)}. New episodes go live as they’re approved.</p> : <p>New episodes go live as they’re approved.</p>;
  }

  const problems = (view.problems || []).filter((p) => p.code !== 'delay');
  const fixedSeasons = new Set();
  return (
    <AdmCard id="show-adm-status" className={`show-status level-${LEVEL[state] || 'neutral'}`} labelledBy="show-adm-status-h">
      <h2 className="show-status-head" id="show-adm-status-h">{icon}<span>{headline}</span></h2>
      {body ? <div className="show-status-body">{body}</div> : null}
      {acts}
      {problems.length > 0 && (
        <div className="show-status-problems">
          <p className="show-status-k">{problems.length === 1 ? '1 thing to look at' : `${problems.length} things to look at`}</p>
          <ul>
            {problems.map((p, i) => {
              const season = Number(p.season) || 1;
              const fix = NUMBERING.has(p.code) && !fixedSeasons.has(season);
              if (fix) fixedSeasons.add(season);
              const off = !can.edit ? needs.edit : !shows118 ? 'Renumbering needs a database update (migration 118).' : null;
              return (
                <li key={`${p.code}-${i}`}>
                  <button type="button" className={`show-problem level-${p.level || 'warn'}`} onClick={() => onProblem(p)}>
                    {p.level === 'warn' ? <WarningIcon size={15} /> : <ClockIcon size={15} />}
                    <span>{String(p.words || '').replace(/ — pick the same file to resume$/, '')}</span>
                    <ChevronIcon size={14} />
                  </button>
                  {fix && (
                    <div className="show-adm-fix">
                      <button type="button" className="apl-btn-secondary show-mini" disabled={Boolean(off) || Boolean(busy)} onClick={() => fixNumbering(season)}>
                        {busy === `fix-${season}` ? 'Renumbering…' : `Fix numbering in Season ${season}`}
                      </button>
                      <NeedLine line={off} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <ErrorLine text={error} />
    </AdmCard>
  );
}
