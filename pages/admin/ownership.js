import AdminShell from '../../components/AdminShell';
import OwnershipPanel from '../../components/admin/OwnershipPanel';
import { adminPageProps } from '../../lib/adminPage';

export async function getServerSideProps(ctx) {
  return adminPageProps(ctx);
}

export default function AdminOwnership({ account, mainGenres }) {
  return (
    <AdminShell account={account} mainGenres={mainGenres} title="Series ownership" crumbs={['Content']}
      intro="Which creator each show belongs to, plus the read-only roster of everyone with creator or admin access.">
      <OwnershipPanel />
    </AdminShell>
  );
}
