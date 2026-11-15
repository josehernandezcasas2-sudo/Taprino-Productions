import { hasCapability } from './capabilities';
import { holdsAnyCap, titleTeamWith } from './titleSecurityRules';

// SERVER-ONLY (it reads lib/capabilities.js). "Is this account on the team
// that reads and plays other people's titles before they're public?" — a
// full admin, or a sub-admin holding review_submissions or manage_episodes
// (lib/titleSecurityRules.js TITLE_TEAM_CAPS). Until 2026-11-15 any team
// account counted (canAccessAdmin), so a sub-admin with no permission at
// all could preview-play every title in review, pulled or private, and
// read every show, draft and episode editor. `rc` is a getRoleContext or
// getAccountContext shape.
export function isTitleTeam(rc) {
  return titleTeamWith(rc, hasCapability);
}

// The same question for any list of capabilities (with the same two-step
// rule: a sub-admin kept out of the admin area holds none).
export function holdsCap(rc, caps) {
  return holdsAnyCap(rc, Array.isArray(caps) ? caps : [caps], hasCapability);
}
