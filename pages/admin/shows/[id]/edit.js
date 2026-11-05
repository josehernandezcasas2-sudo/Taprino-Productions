import { useRouter } from 'next/router';
import AdminShell from '../../../../components/AdminShell';
import ShowEditor from '../../../../components/show/ShowEditor';
import ShowControlRoom from '../../../../components/show/ShowControlRoom';
import { useWide } from '../../../../components/show/roomBits';
import { adminPageProps } from '../../../../lib/adminPage';
import { SHOW_ADMIN_CAPS } from '../../../../lib/showAdminRules';
import { isTitleId } from '../../../../lib/titleIds';

// Edit show on Admin → Shows (the series revamp, slice 3a): Details and Art
// (?tab=art opens the second). On a laptop it is the admin show page with
// Edit show open as its right-hand panel; on a phone, the editor as a
// screen inside the admin shell. The show's API decides who may change
// it (its owner or the team).
export async function getServerSideProps(ctx) {
  const showId = ctx.params && typeof ctx.params.id === 'string' ? ctx.params.id : '';
  if (!isTitleId(showId)) return { notFound: true };
  const tab = ctx.query && ctx.query.tab === 'art' ? 'art' : 'details';
  return adminPageProps(ctx, { caps: SHOW_ADMIN_CAPS, extra: async () => ({ showId, tab }) });
}

export default function AdminEditShowPage({ account, mainGenres, showId, tab }) {
  const router = useRouter();
  const wide = useWide();
  return (
    <AdminShell account={account} mainGenres={mainGenres} title="Shows" crumbs={['Content']} wide>
      {wide === null ? (
        <div className="show-room-stage is-admin"><div className="show-room is-waiting" aria-busy="true"><div className="show-room-skeleton"><span /><span /><span /></div></div></div>
      ) : wide ? (
        <ShowControlRoom key={showId} showId={showId} mode="admin" openShowEditor={tab} />
      ) : (
        <div className="show-ed-stage is-admin">
          <ShowEditor
            showId={showId}
            mode="admin"
            layout="page"
            tab={tab}
            onClose={() => router.push(`/admin/shows/${encodeURIComponent(showId)}`)}
          />
        </div>
      )}
    </AdminShell>
  );
}
