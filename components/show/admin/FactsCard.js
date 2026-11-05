import Link from 'next/link';
import { AdmCard, ageWords, dayWords, fileStateWords, plural } from './adminBits';

// About this show (the admin show page, slice 3a §5.3): who runs it, what
// people bought, the channels it is on, open reports, the files waiting in
// review, the trailer, and when it was made and went public.
export default function FactsCard({ admin, view }) {
  const show = admin.show || {};
  const facts = admin.facts || {};
  const owner = admin.owner;
  const hasOwner = Boolean(owner || (view && view.show && view.show.ownerId));
  const ownerName = (owner && owner.name) || admin.ownerName || null;

  let runBy;
  if (owner) {
    const parts = [`Run by ${owner.name || 'an account with no name yet'}`];
    if (owner.email) parts.push(owner.email);
    const age = ageWords(owner.accountAgeDays);
    if (age) parts.push(`account ${age}`);
    parts.push(plural(Number(owner.otherShows) || 0, 'other show', 'other shows'));
    parts.push(plural(Number(owner.otherTitles) || 0, 'title', 'titles'));
    runBy = parts.join(' · ');
  } else if (hasOwner) {
    runBy = `Run by ${ownerName || 'its owner'}`;
  } else {
    runBy = 'No one runs it yet';
  }

  const seriesBuyers = Number(facts.seriesBuyers) || 0;
  const episodeBuyers = Number(facts.episodeBuyers) || 0;
  const bought = seriesBuyers || episodeBuyers
    ? `Bought: whole ${show.kind === 'podcast' ? 'show' : 'series'} ${seriesBuyers} · episodes ${episodeBuyers}`
    : 'No one has bought anything in it yet';

  const slots = (facts.channelSlots || []).filter((c) => c && c.slots > 0);
  const channels = slots.length
    ? `On channels: ${slots.map((c) => `${c.channel} (${plural(c.slots, 'slot', 'slots')})`).join(', ')}`
    : 'Not on any channel';

  const reports = Number(facts.openReports) || 0;
  const reviewCount = admin.review ? Number(admin.review.count) || 0 : 0;
  const f = facts.files || {};
  const fileParts = [
    f.ready ? `${f.ready} ready` : null,
    f.processing ? `${f.processing} processing` : null,
    f.uploading ? `${f.uploading} still uploading` : null,
    f.failed ? `${f.failed} failed` : null,
    f.unknown ? `${f.unknown} not checked yet` : null
  ].filter(Boolean);

  const trailer = facts.trailer;
  const trailerWords = trailer === 'ready' || trailer === 'unknown' || trailer === 'external' ? 'ready'
    : trailer === 'processing' || trailer === 'uploading' ? 'still processing'
      : trailer === 'error' || trailer === 'deleted' ? 'failed' : fileStateWords(trailer).toLowerCase();

  const created = dayWords(show.createdAt);
  const when = [created ? `Created ${created}` : null, show.isPublic ? (show.publicAt ? `Public since ${dayWords(show.publicAt)}` : 'Public') : 'Private'].filter(Boolean).join(' · ');

  return (
    <AdmCard id="show-adm-facts" k="About this show">
      <ul className="show-adm-facts">
        <li className={hasOwner ? '' : 'tone-warn'}>{runBy}</li>
        <li>{bought}</li>
        <li>{channels}</li>
        <li className={reports ? 'tone-warn' : ''}>
          {reports ? <>Open reports: {reports} · <Link href="/admin/content" className="apl-link">All content &amp; flags →</Link></> : 'No open reports'}
        </li>
        {reviewCount > 0 && fileParts.length > 0 && <li>Files in review: {fileParts.join(' · ')}</li>}
        {trailer ? <li className={trailerWords === 'failed' ? 'tone-warn' : ''}>Trailer: {trailerWords}</li> : null}
        <li className="show-adm-facts-when">{when}</li>
      </ul>
    </AdmCard>
  );
}
