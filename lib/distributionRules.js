// Distribution + screeners (migration 109): the vocabularies the browser
// and the app share. lib/distribution.js pulls in server-only modules.
export const FESTIVAL_STATUS = { planning: 'Planning', submitted: 'Submitted', accepted: 'Accepted', declined: 'Declined', screened: 'Screened', skipped: 'Skipped' };
export const MAX_FESTIVALS = 60;
export const SCREENER_DAYS = [3, 7, 14, 30, 60];
export const SCREENER_SRC_SECONDS = 4 * 3600;
