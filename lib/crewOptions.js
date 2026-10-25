// Crew Call's fixed vocabularies, shared by the website (directly) and the
// app (through /api/crew/options). A working card picks from these lists,
// so the directory can filter on them exactly.

export const CREW_ROLES = [
  'Director', 'Producer', 'Writer', 'DP', 'Camera operator', '1st AC', 'Gaffer', 'Grip',
  'Sound recordist', 'Boom op', 'Editor', 'Colorist', 'Composer', 'Sound designer', 'VFX', 'Animator',
  'Actor', 'Voice actor', 'Makeup & hair', 'Production designer', 'Photographer', 'PA', 'Script supervisor', 'Drone pilot',
  'Extra / background', 'Stunt performer', 'Dancer', 'Singer', 'Host / presenter', 'Model'
];

// Casting (migration 106): the roles a casting call is for, and what a
// performer card carries on top of the working card.
export const CAST_ROLES = ['Actor', 'Voice actor', 'Extra / background', 'Stunt performer', 'Dancer', 'Singer', 'Host / presenter', 'Model'];
export const UNION_STATUS = { non_union: 'Non-union', sag_aftra: 'SAG-AFTRA', sag_eligible: 'SAG-eligible', other: 'Other union' };
export const SKILL_SUGGESTIONS = ['Improv', 'Stage combat', 'Stunts', 'Dance', 'Singing', 'Accents', 'Spanish', 'Instruments', 'Comedy', 'Drama', 'Horseback', 'Driving (manual)', 'Swimming', 'Martial arts', 'Sign language', 'Puppetry', 'Voice-over'];
export const MAX_HEADSHOTS = 6;
export const MAX_SKILLS = 12;
export const CALL_KINDS = { crew: 'Crew', cast: 'Casting' };

export const GEAR_CATEGORIES = ['Camera', 'Lenses', 'Lighting', 'Audio', 'Grip & support', 'Drone', 'Monitors', 'Space & vehicles'];

// What the owner does with a piece of gear on a shoot. No money changes
// hands through the site; "ask" just means talk to them.
export const GEAR_FLAGS = { brings: 'Brings it to set', lends: 'Open to lending', ask: 'Ask' };

export const AVAILABILITY = ['open', 'booked'];
export const MAX_ROLES = 6;
export const MAX_TRAVEL_MILES = 500;
export const DEFAULT_TRAVEL_MILES = 25;
// Directory distance filter, miles; 0 is "anywhere".
export const WITHIN_CHOICES = [10, 25, 50, 100, 0];
export const MAX_GEAR_ITEMS = 40;
export const MAX_CREDITS = 40;
export const MAX_LANGUAGES = 8;

// Where a person or a place is, as far as anyone else can learn: about a
// kilometre (two decimals). Stored points go through this, and so does
// every distance, so stepping a search point around and watching "3 mi"
// flip to "4 mi" (or a radius filter flip in or out) can't narrow a
// host's street or a crew member's home down past that.
export function coarsePoint(n) {
  return Math.round(Number(n) * 100) / 100;
}

// Straight-line distance in miles between two points on the globe, at
// coarsePoint precision.
export function milesBetween(aLat, aLng, bLat, bLng) {
  [aLat, aLng, bLat, bLng] = [aLat, aLng, bLat, bLng].map(coarsePoint);
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function crewOptions() {
  return {
    roles: CREW_ROLES, gearCategories: GEAR_CATEGORIES, gearFlags: GEAR_FLAGS, availability: AVAILABILITY,
    maxRoles: MAX_ROLES, maxTravelMiles: MAX_TRAVEL_MILES, defaultTravelMiles: DEFAULT_TRAVEL_MILES, withinChoices: WITHIN_CHOICES,
    maxGearItems: MAX_GEAR_ITEMS, maxCredits: MAX_CREDITS, maxLanguages: MAX_LANGUAGES,
    castRoles: CAST_ROLES, unionStatus: UNION_STATUS, skillSuggestions: SKILL_SUGGESTIONS, maxHeadshots: MAX_HEADSHOTS, maxSkills: MAX_SKILLS, callKinds: CALL_KINDS
  };
}
