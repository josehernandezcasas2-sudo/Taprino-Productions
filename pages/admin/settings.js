import AdminShell from '../../components/AdminShell';
import SiteSettingsPanel from '../../components/admin/SiteSettingsPanel';
import { adminPageProps } from '../../lib/adminPage';

export async function getServerSideProps(ctx) {
  return adminPageProps(ctx);
}

export default function AdminSettings({ account, mainGenres }) {
  return (
    <AdminShell account={account} mainGenres={mainGenres} title="Settings" crumbs={['Site']}
      intro="Header links and labels, which sections are switched on, the recommendation dial, default ad rate, logo, placeholder content and newsletter export.">
      <SiteSettingsPanel />
    </AdminShell>
  );
}
