// Crew Call's fixed vocabularies, shared by the website (directly) and the
// app (through /api/crew/options). A working card picks from these lists,
// so the directory can filter on them exactly.

export const CREW_ROLES = [
  'Director', 'Producer', 'Writer', 'DP', 'Camera operator', '1st AC', 'Gaffer', 'Grip',
  'Sound recordist', 'Boom op', 'Editor', 'Colorist', 'Composer', 'Sound designer', 'VFX', 'Animator',
  'Actor', 'Voice actor', 'Makeup & hair', 'Production designer', 'Photographer', 'PA', 'Script supervisor', 'Drone pilot'
];

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

// Straight-line distance in miles between two points on the globe.
export function milesBetween(aLat, aLng, bLat, bLng) {
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
    maxGearItems: MAX_GEAR_ITEMS, maxCredits: MAX_CREDITS, maxLanguages: MAX_LANGUAGES
  };
}
