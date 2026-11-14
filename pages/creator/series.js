import { isTitleId } from '../../lib/titleIds';

// Series management is gone (the series revamp, slice 2): every show has
// its own page, /creator/show/<id>, and Creator Studio's hub lists them.
// This address forwards for good — 308 to the hub, or with ?series=<id>
// (the show_live, show_edit_* and artwork notices still link it that way)
// straight to that show's page, which checks who may open it. Nothing is
// read here, so the forward works signed in or out (the destination asks).
// components/SeriesMediaForm.js and its helpers are caller-less now and
// stay in the tree for one round, like CreatorSubmissionForm.
export async function getServerSideProps({ query }) {
  const sid = typeof query.series === 'string' ? query.series : '';
  const destination = sid && isTitleId(sid) ? `/creator/show/${encodeURIComponent(sid)}` : '/creator/dashboard';
  return { redirect: { destination, statusCode: 308 } };
}

export default function SeriesManagementMoved() {
  return null;
}
