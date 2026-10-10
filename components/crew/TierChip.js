import { TIERS } from '../../lib/crewCallRules';

// The track-record tier next to a name: New crew / Crew / Veteran, with
// the number of confirmed jobs + released titles behind it. Earned only
// through work someone else confirmed — see lib/crewCalls.js.
export default function TierChip({ person, showCount = true, title }) {
  if (!person) return null;
  const tier = TIERS[person.tier] ? person.tier : 'new';
  const done = person.done || 0;
  const tip = title || `${TIERS[tier].label}: ${person.jobs || 0} confirmed ${person.jobs === 1 ? 'job' : 'jobs'} on Crew Call + ${person.titles || 0} released ${person.titles === 1 ? 'title' : 'titles'}`;
  return (
    <span className={`crew-tier t-${tier}`} title={tip}>
      <i aria-hidden="true" />{TIERS[tier].label}{showCount && done > 0 ? ` · ${done}` : ''}
    </span>
  );
}
