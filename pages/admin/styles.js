import AdminShell from '../../components/AdminShell';
import StylesGuides from '../../components/admin/StylesGuides';
import { adminPageProps } from '../../lib/adminPage';

// Styles & Guides — theme colors, every icon set, type and component
// reference. Replaces /admin/theme, /admin/genre-icons,
// /admin/player-icons and /admin/site-icons (which now redirect here).
export async function getServerSideProps(ctx) {
  return adminPageProps(ctx, { caps: ['manage_genre_icons'] });
}

export default function AdminStyles({ account, mainGenres }) {
  return (
    <AdminShell account={account} mainGenres={mainGenres} title="Styles & Guides" crumbs={['Site']}>
      <StylesGuides />
    </AdminShell>
  );
}
