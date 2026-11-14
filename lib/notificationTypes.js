// Every kind of notification the site sends, in one place (the series
// revamp, mockups/series-revamp-spec.md, "notifications, audit_log"): type
// → { label, icon, routeKind }. Until now a type was a free string written
// wherever a notification was sent (lib/notify.js notifyCreator /
// notifyMany); this is the list of them. In development lib/notify.js names
// any type sent that isn't here, once per type (never in production, never
// an error), so a new type is added here — and to the app's copy — in the
// change that first sends it.
//
//   label     — a few words naming the kind ("New tip", "Booking
//               request"), for a heading, a filter or a push title; the
//               row's own message says the rest.
//   icon      — one of NOTIFICATION_ICONS: the glyph the account menu
//               already draws for that part of the site, by name —
//               <Name>Icon in components/PlayerIcons.js on the website and
//               in mobile/src/components/TabBarIcons.js in the app, except
//               tip: TipIcon on the website, TipGlyph (TipSheet.js) in the
//               app, the coin.
//   routeKind — one of ROUTE_KINDS: the screen a tap opens. A row's own
//               href always wins (most rows carry one); the kind says where
//               a row without one belongs, with its episode or pitch id
//               where the kind takes one.
//
// Nothing reads label, icon or routeKind yet (2026-11-02): the bell, the
// home page's "Needs you" and the app's PushListener go by the row's href
// (lib/notify.js pushHref, /api/notifications, lib/homeFeed.js). The series
// revamp's later slices read this file, the app's PushListener first.
//
// Pure and client-safe; imports nothing. The app's copy
// (mobile/src/lib/notificationTypes.js) is this file word for word below
// its header. Change both together.

export const NOTIFICATION_ICONS = Object.freeze([
  'clapperboard', // titles, shows, applications (Creator Studio's glyph)
  'card', // money: Creator Share, sales, crew pay, bookings paid (Money's glyph)
  'tip', // tips (the coin)
  'chat', // messages
  'target', // the Pitch Room
  'account', // crew calls, places, productions (the working card's glyph)
  'lock', // reviews, pulls and the account's standing
  'heart', // My List
  'bell' // anything else
]);

// Where each kind of screen lives on the website (the app's routes mirror
// them; mobile/src/components/PushListener.js hrefToRoute maps one to the
// other). <...> is filled from the row: its href, else its episode or
// pitch id.
export const ROUTE_KINDS = Object.freeze({
  episode: '/episode/<episodeId>',
  series: '/series/<seriesId>',
  show: '/creator/show/<seriesId>',
  creator: '/creator/dashboard',
  apply: '/apply',
  money: '/creator/money',
  account: '/account',
  message: '/messages/<threadId>',
  call: '/crew/calls/<callId>',
  crew_card: '/crew/card',
  location: '/locations/<locationId>',
  location_request: '/locations/requests/<requestId>',
  production: '/productions/<productionId>',
  pitch: '/pitches/<pitchId>',
  profile: '/profile/<handle>',
  none: null // the message is the whole notice
});

const kind = (label, icon, routeKind) => Object.freeze({ label, icon, routeKind });

export const NOTIFICATION_TYPES = Object.freeze({
  // Applications (lib/creatorApplications.js).
  application_accepted: kind('You’re in', 'clapperboard', 'creator'),
  application_live: kind('You’re in · live', 'clapperboard', 'episode'),
  application_held: kind('One thing to fix', 'clapperboard', 'apply'),
  application_declined: kind('Not this time', 'clapperboard', 'apply'),

  // A title's review and the changes that wait on one (lib/reviewQueue.js,
  // pages/api/admin/{review-submission,bulk-review,edit-episode,
  // resolve-artwork,resolve-edit,resolve-deletion}.js).
  episode_approved: kind('Approved', 'clapperboard', 'episode'),
  episode_rejected: kind('Not this time', 'clapperboard', 'creator'),
  status_changed_by_admin: kind('Status changed', 'clapperboard', 'creator'),
  artwork_approved: kind('Artwork approved', 'clapperboard', 'episode'),
  artwork_denied: kind('Artwork not approved', 'clapperboard', 'episode'),
  edit_approved: kind('Edit approved', 'clapperboard', 'episode'),
  edit_denied: kind('Edit not approved', 'clapperboard', 'episode'),
  deletion_denied: kind('Removal declined', 'clapperboard', 'episode'),
  deletion_confirmed: kind('Removed', 'clapperboard', 'creator'),

  // Shows (the series revamp). show_live is a show made public;
  // show_new_episodes and show_pulled stay unsent (the people who saved a
  // show are emailed, lib/seriesDrop.js; a hold tells the owner through
  // `moderation`).
  show_live: kind('Show is public', 'clapperboard', 'series'),
  show_pulled: kind('Show pulled', 'lock', 'show'),
  show_edit_approved: kind('Show change approved', 'clapperboard', 'show'),
  show_edit_denied: kind('Show change not approved', 'clapperboard', 'show'),
  show_video_approved: kind('New video approved', 'clapperboard', 'show'),
  show_video_denied: kind('New video not approved', 'clapperboard', 'show'),
  show_deleted: kind('Show removed', 'clapperboard', 'creator'),
  show_deletion_denied: kind('Removal declined', 'clapperboard', 'show'),
  episode_moved_by_admin: kind('Episode moved', 'clapperboard', 'show'),
  show_numbering_fixed: kind('Numbering fixed', 'clapperboard', 'show'),
  show_owner_changed: kind('Show owner changed', 'clapperboard', 'show'),
  show_new_episodes: kind('New episodes', 'heart', 'series'),
  // Slice 2: "Send N for review" on the show page, one notice per batch.
  show_sent_for_review: kind('Sent for review', 'clapperboard', 'show'),
  // Slice 3a: the admin side. A show's episodes approved or sent back
  // together (one notice per uploader per decision), and a show an admin
  // set up for someone.
  show_episodes_approved: kind('Episodes approved', 'clapperboard', 'show'),
  show_episodes_rejected: kind('Not this time', 'clapperboard', 'show'),
  show_set_up: kind('A show set up for you', 'clapperboard', 'show'),

  // Who gets paid (lib/payees.js, slice 3b).
  payee_invite: kind('Get paid for a title', 'card', 'creator'),
  payee_invite_accepted: kind('Invite accepted', 'card', 'show'),
  payee_invite_declined: kind('Invite declined', 'card', 'show'),
  payee_invite_cancelled: kind('Invite withdrawn', 'card', 'creator'),
  payee_changed: kind('Earnings moved', 'card', 'money'),

  // Creator Share: payouts, holds, departures, the numbers changing
  // (lib/creatorShare.js, lib/creatorShareBatch.js, lib/creatorStanding.js,
  // lib/creatorShareSettings.js).
  payout: kind('Creator Share', 'card', 'money'),

  // Tips (lib/tips.js, lib/paymentDisputes.js).
  tip: kind('New tip', 'tip', 'money'),
  tip_refunded: kind('Tip refunded', 'tip', 'money'),
  tip_disputed: kind('Tip disputed', 'tip', 'money'),
  tip_dispute_won: kind('Tip dispute won', 'tip', 'money'),
  tip_dispute_lost: kind('Tip dispute lost', 'tip', 'money'),

  // Buy to own: prices, sales, refunds (lib/purchases.js,
  // lib/paymentDisputes.js).
  purchase: kind('Title sales', 'card', 'money'),
  purchase_disputed: kind('Sale disputed', 'card', 'money'),
  purchase_dispute_won: kind('Sale dispute won', 'card', 'money'),
  purchase_dispute_lost: kind('Sale dispute lost', 'card', 'money'),

  // The Pitch Room (lib/pitches.js, lib/paymentDisputes.js).
  pitch_update: kind('Pitch update', 'target', 'pitch'),
  backing_disputed: kind('Backing disputed', 'target', 'pitch'),
  backing_dispute_won: kind('Backing dispute won', 'target', 'pitch'),
  backing_dispute_lost: kind('Backing dispute lost', 'target', 'pitch'),

  // Crew Call (lib/crewCalls.js, lib/locationRequests.js for endorsements).
  call: kind('New call', 'account', 'call'),
  call_urgent: kind('Urgent call', 'account', 'call'),
  casting_call: kind('Casting call', 'account', 'call'),
  call_response: kind('New response', 'account', 'call'),
  call_tape: kind('Self-tape', 'account', 'call'),
  call_shortlist: kind('Shortlisted', 'account', 'call'),
  call_callback: kind('Callback', 'account', 'call'),
  call_booked: kind('Booked', 'account', 'call'),
  call_benched: kind('On the bench', 'account', 'call'),
  call_bench: kind('A spot opened', 'account', 'call'),
  call_confirmed: kind('Worked it', 'account', 'call'),
  endorsement: kind('New endorsement', 'account', 'profile'),

  // Secured crew pay (lib/crewPay.js, lib/paymentDisputes.js).
  crew_pay_held: kind('Pay secured', 'card', 'call'),
  crew_pay_hold: kind('Pay on hold', 'card', 'call'),
  crew_pay_setup: kind('Set up payouts', 'card', 'crew_card'),
  crew_pay_released: kind('Pay released', 'card', 'call'),
  crew_pay_refunded: kind('Pay refunded', 'card', 'call'),
  crew_pay_reversed: kind('Pay taken back', 'card', 'crew_card'),
  crew_pay_disputed: kind('Pay disputed', 'card', 'call'),
  crew_pay_dispute_won: kind('Pay dispute won', 'card', 'call'),
  crew_pay_dispute_lost: kind('Pay dispute lost', 'card', 'call'),

  // Locations: places, booking requests, Shot here (lib/locations.js,
  // lib/locationRequests.js, lib/locationCredits.js, lib/paymentDisputes.js).
  location_approved: kind('Place approved', 'account', 'location'),
  location_rejected: kind('Place not approved', 'account', 'location'),
  location_paused: kind('Places paused', 'account', 'location'),
  location_credit: kind('Shot here', 'account', 'location'),
  location_request: kind('Booking request', 'account', 'location_request'),
  location_accepted: kind('Request accepted', 'account', 'location_request'),
  location_countered: kind('Counter offer', 'account', 'location_request'),
  location_declined: kind('Request declined', 'account', 'location_request'),
  location_expired: kind('Request expired', 'account', 'location_request'),
  location_paid: kind('Booking paid', 'card', 'location_request'),
  location_cancelled: kind('Booking cancelled', 'account', 'location_request'),
  location_refunded: kind('Booking refunded', 'card', 'location_request'),
  location_done: kind('Shoot confirmed', 'account', 'location_request'),
  location_issue: kind('Problem reported', 'account', 'location_request'),
  booking_disputed: kind('Booking disputed', 'card', 'location_request'),
  booking_dispute_won: kind('Booking dispute won', 'card', 'location_request'),
  booking_dispute_lost: kind('Booking dispute lost', 'card', 'location_request'),
  booking_dispute_clawback: kind('Payout taken back', 'card', 'location_request'),

  // Productions and their screeners (lib/productions.js,
  // lib/productionLinks.js, lib/distribution.js).
  production_added: kind('Added to a production', 'account', 'production'),
  production_worked: kind('Worked it', 'account', 'production'),
  production_left: kind('Left the crew', 'account', 'production'),
  production_days: kind('Shoot days added', 'account', 'production'),
  production_sheet: kind('Call sheet', 'account', 'production'),
  production_released: kind('Credit is live', 'clapperboard', 'production'),
  screener_opened: kind('Screener opened', 'clapperboard', 'production'),

  // Messages (lib/messages.js).
  message: kind('New message', 'chat', 'message'),

  // Reviews and the account's standing (lib/moderation.js,
  // lib/suspensions.js). A pull's notice has nowhere public to go.
  moderation: kind('Content review', 'lock', 'none'),
  suspended: kind('Account suspended', 'lock', 'account'),
  tips_blocked: kind('Tipping switched off', 'lock', 'account'),
  suspension_lifted: kind('Suspension lifted', 'lock', 'account')
});

// What a type nobody registered reads as.
export const UNKNOWN_NOTIFICATION_TYPE = kind('Notification', 'bell', 'none');

export function isNotificationType(type) {
  return typeof type === 'string' && Object.prototype.hasOwnProperty.call(NOTIFICATION_TYPES, type);
}

// The entry for a type, or UNKNOWN_NOTIFICATION_TYPE.
export function notificationType(type) {
  return isNotificationType(type) ? NOTIFICATION_TYPES[type] : UNKNOWN_NOTIFICATION_TYPE;
}
