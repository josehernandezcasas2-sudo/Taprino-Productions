// The full menu of individually-toggleable admin capabilities. A full
// 'admin' always has every capability, no matter what — this list only
// matters for 'sub_admin' accounts, whose publicMetadata.permissions array
// holds a subset of these keys.
//
// Adding a new gated admin action later = add one entry here, then use
// hasCapability(roleContext, 'the_new_key') at the top of that page's
// getServerSideProps and its API route(s). Nothing else needs to change —
// the admin toggle UI (pages/admin/team.js) reads this list to render
// itself, so a new capability shows up there automatically.
export const ADMIN_CAPABILITIES = [
  {
    key: 'manage_episodes',
    label: 'Create & edit episodes',
    description: 'Manual episode entry, editing metadata, tier, hero eligibility.'
  },
  {
    key: 'review_submissions',
    label: 'Review creator submissions',
    description: 'Approve, reject, or send a submission back for revision.'
  },
  {
    key: 'manage_deletions',
    label: 'Resolve deletion requests',
    description: 'Confirm (permanently delete) or deny items in the Pending Deletions queue.'
  },
  {
    key: 'manage_artwork',
    label: 'Approve pending artwork',
    description: 'Approve or deny poster/thumbnail/trailer changes submitted for review.'
  },
  {
    key: 'manage_schedule',
    label: 'Manage the channel schedule',
    description: 'Reorder, remove, and toggle ads on the looping free channel.'
  },
  {
    key: 'manage_house_ads',
    label: 'Manage house ads',
    description: 'Create, edit, and review performance of the self-serve house ad network.'
  },
  {
    key: 'manage_live',
    label: 'Manage live streaming',
    description: 'Create broadcasts, get RTMP keys, go live/end live.'
  },
  {
    key: 'manage_applications',
    label: 'Review /apply submissions',
    description: 'Read and act on incoming creator applications.'
  },
  {
    key: 'manage_content_lifecycle',
    label: 'Manage content lifecycle settings',
    description: 'New-release / leaving-soon windows, availability dates.'
  },
  {
    key: 'manage_genre_icons',
    label: 'Manage genre icons',
    description: 'Replace genre emoji with uploaded images.'
  },
  {
    key: 'manage_comped_access',
    label: 'Manage free-access invite list',
    description: 'Add or remove emails that get Studio Tapa + for free.'
  }
  // Deliberately NOT delegable to sub-admins: granting/revoking creator or
  // sub-admin roles itself (pages/api/admin/manage-creators.js,
  // set-permissions.js). Letting a sub-admin hand out roles — including to
  // themselves — would be a privilege-escalation hole, so those two
  // endpoints stay hard-coded to isAdmin only, not capability-gated.
];

const ALL_KEYS = new Set(ADMIN_CAPABILITIES.map((c) => c.key));

// The single check every gated page/route should use. Full admins pass
// everything; sub-admins pass only what's in their permissions array;
// everyone else fails. Unknown/typo'd keys fail closed rather than
// throwing, so a mistyped capability string can never accidentally grant
// access.
export function hasCapability(roleContext, key) {
  if (!ALL_KEYS.has(key)) return false;
  if (roleContext.isAdmin) return true;
  if (roleContext.role === 'sub_admin') {
    return Array.isArray(roleContext.permissions) && roleContext.permissions.includes(key);
  }
  return false;
}

// For nav/UI filtering — which capabilities this account actually has,
// as a plain array of keys. Full admins get the complete list (so nav
// rendering can treat admins and fully-permissioned sub-admins the same
// way without a separate isAdmin branch everywhere).
export function visibleCapabilities(roleContext) {
  if (roleContext.isAdmin) return ADMIN_CAPABILITIES.map((c) => c.key);
  if (roleContext.role === 'sub_admin' && Array.isArray(roleContext.permissions)) {
    return roleContext.permissions.filter((k) => ALL_KEYS.has(k));
  }
  return [];
}
