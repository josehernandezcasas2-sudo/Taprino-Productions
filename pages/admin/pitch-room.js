import AdminShell from '../../components/AdminShell';
import PitchRoomPanel from '../../components/admin/PitchRoomPanel';
import StripeStatusPanel from '../../components/admin/StripeStatusPanel';
import { adminPageProps } from '../../lib/adminPage';

export async function getServerSideProps(ctx) {
  return adminPageProps(ctx);
}

export default function AdminPitchRoom({ account, mainGenres }) {
  return (
    <AdminShell account={account} mainGenres={mainGenres} title="Pitches & comments" crumbs={['Money']}
      intro="The Stripe setup donations depend on, reported comments, every pitch with approve / reject / delete, and the in-platform funding switch per project.">
      <StripeStatusPanel />
      <PitchRoomPanel />
    </AdminShell>
  );
}
