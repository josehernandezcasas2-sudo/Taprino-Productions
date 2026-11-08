// The rig's accounts (seed/accounts.json) and the names they answer to.
// Ids have Clerk's real shape — `user_` and letters/digits only — because
// the app checks it (lib/userProfiles.js looksLikeUserId): an id like
// `user_rig_mara` would be refused as a member on the invoice webhook and
// read as a handle on /profile/<id>. For typing convenience a few aliases
// resolve to them: `mara`, `user_rig_mara`, the handle, the username.
import fs from 'node:fs';
import path from 'node:path';
import { RIG_DIR } from './config.mjs';

export function accounts() {
  return JSON.parse(fs.readFileSync(path.join(RIG_DIR, 'seed', 'accounts.json'), 'utf8')).accounts;
}

export function resolveUserId(name) {
  if (!name) return null;
  const want = String(name).trim();
  const list = accounts();
  if (list.some((a) => a.id === want)) return want;
  const low = want.toLowerCase().replace(/^user_rig_?/, '');
  const hit = list.find((a) => a.id.toLowerCase() === `user_rig${low}` || (a.profile && String(a.profile.handle || '').toLowerCase() === low) || String(a.username || '').toLowerCase() === low || String(a.firstName || '').toLowerCase() === low);
  return hit ? hit.id : want;
}
