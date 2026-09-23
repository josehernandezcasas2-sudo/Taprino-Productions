// The three surfaces an ad can be scoped to — see lib/houseAds.js's
// pickActiveHouseAd() for where these values are actually checked
// against an ad's placements column. Kept here as the single source of
// truth so the submission form, the pending-ad edit modal, and admin's
// review modal all offer exactly the same options, in the same order,
// with the same labels, with no risk of one of them drifting out of
// sync with the others or with what pickActiveHouseAd() actually
// recognizes.
export const AD_PLACEMENTS = [
  { value: 'main_player', label: 'Main player (movies, series, standalone episodes)' },
  { value: 'live_tv', label: 'Live TV (the looping channel and live streams)' },
  { value: 'vertical_discover', label: 'Vertical Discover' }
];
