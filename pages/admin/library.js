import AdminShell from '../../components/AdminShell';
import LibraryPanel from '../../components/admin/LibraryPanel';
import { adminPageProps } from '../../lib/adminPage';
import { getAllSeriesForCreator } from '../../lib/series';

export async function getServerSideProps(ctx) {
  return adminPageProps(ctx, {
    caps: ['manage_episodes', 'manage_artwork', 'manage_deletions'],
    extra: async () => ({ allSeries: await getAllSeriesForCreator() })
  });
}

export default function AdminLibrary({ account, mainGenres, allSeries }) {
  return (
    <AdminShell account={account} mainGenres={mainGenres} title="Library & queues" crumbs={['Content']}
      intro="Every episode in any status, the homepage hero pool, adding an episode by hand, and the artwork / edit / deletion / orphaned-media queues.">
      <LibraryPanel allSeries={allSeries} />
    </AdminShell>
  );
}
