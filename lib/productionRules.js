// Productions' fixed vocabularies and limits — the parts the browser and
// the app need too (lib/productions.js pulls in server-only modules, so
// the shared bits live here; the app reads them from /api/productions/options).

export const PRODUCTION_KINDS = {
  short: 'Short film',
  feature: 'Feature',
  series: 'Series',
  documentary: 'Documentary',
  podcast: 'Podcast',
  music_video: 'Music video',
  commercial: 'Commercial / branded',
  vertical: 'Vertical / Snippets',
  other: 'Other'
};

// prep → shooting → post → released. archived hides it from the public
// list (the owner keeps it); removed is an admin takedown.
export const PRODUCTION_STATUS = {
  prep: 'In prep',
  shooting: 'Shooting',
  post: 'In post',
  released: 'Released',
  archived: 'Archived',
  removed: 'Removed'
};
export const OWNER_STATUSES = ['prep', 'shooting', 'post', 'released', 'archived'];

export const VISIBILITY = {
  public: 'Public — on /productions and your profile',
  crew: 'Crew only — the people on it and you',
  private: 'Just you'
};

export const MAX_MEMBERS = 80;
export const MAX_DAYS = 60;
export const MAX_OPEN_PRODUCTIONS = 20;
export const MAX_TITLE_CHARS = 90;
export const MAX_LOGLINE_CHARS = 300;
export const MAX_NOTES_CHARS = 4000;
export const MAX_ROLE_CHARS = 40;

// Departments the call sheet groups people by, from the role name.
const DEPARTMENTS = [
  ['Direction', ['Director', 'Producer', 'Writer', 'Script supervisor', '1st AD', '2nd AD', 'Showrunner', 'Host']],
  ['Camera', ['DP', 'Camera operator', '1st AC', '2nd AC', 'Drone pilot', 'Photographer', 'DIT', 'Steadicam']],
  ['Lighting & grip', ['Gaffer', 'Grip', 'Key grip', 'Best boy', 'Electric']],
  ['Sound', ['Sound recordist', 'Boom op', 'Sound mixer']],
  ['Art', ['Production designer', 'Art director', 'Set decorator', 'Props', 'Costume', 'Wardrobe', 'Makeup & hair']],
  ['Cast', ['Actor', 'Voice actor', 'Performer', 'Extra', 'Stunt']],
  ['Post', ['Editor', 'Colorist', 'Composer', 'Sound designer', 'VFX', 'Animator']],
  ['Production', ['PA', 'Location manager', 'Craft services', 'Driver', 'Coordinator', 'Line producer']]
];
export function departmentFor(role) {
  const r = String(role || '').toLowerCase();
  for (const [dept, roles] of DEPARTMENTS) {
    if (roles.some((x) => x.toLowerCase() === r)) return dept;
  }
  return 'Crew';
}
export const DEPARTMENT_ORDER = [...DEPARTMENTS.map((d) => d[0]), 'Crew'];

export function productionRules() {
  return {
    kinds: PRODUCTION_KINDS, statuses: PRODUCTION_STATUS, ownerStatuses: OWNER_STATUSES, visibility: VISIBILITY,
    maxMembers: MAX_MEMBERS, maxDays: MAX_DAYS, maxOpenProductions: MAX_OPEN_PRODUCTIONS,
    maxTitleChars: MAX_TITLE_CHARS, maxLoglineChars: MAX_LOGLINE_CHARS, maxNotesChars: MAX_NOTES_CHARS, maxRoleChars: MAX_ROLE_CHARS,
    departmentOrder: DEPARTMENT_ORDER
  };
}
