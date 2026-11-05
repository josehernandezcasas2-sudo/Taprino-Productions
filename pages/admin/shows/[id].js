import { useRouter } from 'next/router';
import AdminShell from '../../../components/AdminShell';
import ShowControlRoom from '../../../components/show/ShowControlRoom';
import { adminPageProps } from '../../../lib/adminPage';
import { SHOW_ADMIN_CAPS } from '../../../lib/showAdminRules';
import { isTitleId } from '../../../lib/titleIds';

// One show on Admin → Shows (the series revamp, slice 3a: mockups/
// series-slice3a-contract.md §5.2): the creator's control room in admin
// mode (components/show/ShowControlRoom.js mode="admin") with the team's
// cards. On a laptop the episode editor and Edit show open as a panel over
// the room with the address changed shallowly — ?ep=<id> (+ draft=1) or
// ?edit=details|art ride in this page's query while the bar reads
// /admin/shows/<id>/episode/<eid> or /admin/shows/<id>/edit, the two page
// files that render the same room on a reload. ?created=1 (a show made
// for a creator) says it is set up.
export async function getServerSideProps(ctx) {
  const showId = ctx.params && typeof ctx.params.id === 'string' ? ctx.params.id : '';
  if (!isTitleId(showId)) return { notFound: true };
  return adminPageProps(ctx, { caps: SHOW_ADMIN_CAPS, extra: async () => ({ showId }) });
}

export default function AdminShowPage({ account, mainGenres, showId }) {
  const router = useRouter();
  const q = router.query || {};
  const ep = typeof q.ep === 'string' && isTitleId(q.ep) ? q.ep : null;
  const edit = q.edit === 'art' ? 'art' : q.edit === 'details' ? 'details' : null;
  return (
    <AdminShell account={account} mainGenres={mainGenres} title="Shows" crumbs={['Content']} wide>
      <ShowControlRoom
        key={showId}
        showId={showId}
        mode="admin"
        openEpisodeId={ep}
        openIsDraft={q.draft === '1'}
        openShowEditor={edit}
        created={q.created === '1'}
      />
    </AdminShell>
  );
}
