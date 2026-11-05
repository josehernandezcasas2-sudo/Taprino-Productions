import { useRouter } from 'next/router';
import AdminShell from '../../../../../components/AdminShell';
import EpisodeEditor from '../../../../../components/show/EpisodeEditor';
import ShowControlRoom from '../../../../../components/show/ShowControlRoom';
import { useWide } from '../../../../../components/show/roomBits';
import { adminPageProps } from '../../../../../lib/adminPage';
import { SHOW_ADMIN_CAPS } from '../../../../../lib/showAdminRules';
import { isTitleId } from '../../../../../lib/titleIds';

// An episode's editor on Admin → Shows (the series revamp, slice 3a): on a
// laptop the admin show page with the editor open as its right-hand panel
// (the room pushes this address shallowly when a row is opened), on a
// phone the editor as a screen inside the admin shell. The editor's API
// decides what the team may change (a full admin or manage_episodes:
// every field at once).
export async function getServerSideProps(ctx) {
  const showId = ctx.params && typeof ctx.params.id === 'string' ? ctx.params.id : '';
  const episodeId = ctx.params && typeof ctx.params.episodeId === 'string' ? ctx.params.episodeId : '';
  if (!isTitleId(showId) || !isTitleId(episodeId)) return { notFound: true };
  const isDraft = ctx.query && ctx.query.draft === '1';
  return adminPageProps(ctx, { caps: SHOW_ADMIN_CAPS, extra: async () => ({ showId, episodeId, isDraft }) });
}

export default function AdminShowEpisodePage({ account, mainGenres, showId, episodeId, isDraft }) {
  const router = useRouter();
  const wide = useWide();
  // The room opens another row on this same address shallowly.
  const ep = typeof router.query.episodeId === 'string' && isTitleId(router.query.episodeId) ? router.query.episodeId : episodeId;
  const draft = router.query.draft === '1' || (ep === episodeId && isDraft);
  return (
    <AdminShell account={account} mainGenres={mainGenres} title="Shows" crumbs={['Content']} wide>
      {wide === null ? (
        <div className="show-room-stage is-admin"><div className="show-room is-waiting" aria-busy="true"><div className="show-room-skeleton"><span /><span /><span /></div></div></div>
      ) : wide ? (
        <ShowControlRoom key={showId} showId={showId} mode="admin" openEpisodeId={ep} openIsDraft={draft} />
      ) : (
        <div className="show-ed-stage is-admin">
          <EpisodeEditor
            key={ep}
            showId={showId}
            episodeId={ep}
            isDraft={draft}
            mode="admin"
            layout="page"
            onClose={() => router.push(`/admin/shows/${encodeURIComponent(showId)}`)}
          />
        </div>
      )}
    </AdminShell>
  );
}
