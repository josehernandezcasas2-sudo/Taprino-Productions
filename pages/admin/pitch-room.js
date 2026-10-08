import AdminShell from '../../components/AdminShell';
import PitchRoomPanel from '../../components/admin/PitchRoomPanel';
import { adminPageProps } from '../../lib/adminPage';

export async function getServerSideProps(ctx) {
  return adminPageProps(ctx);
}

export default function AdminPitchRoom({ account, mainGenres }) {
  return (
    <AdminShell account={account} mainGenres={mainGenres} title="Pitches & comments" crumbs={['Pitch Room']}
      intro="Reported comments, every pitch with approve / reject / delete, and the in-platform funding switch per project.">
      <PitchRoomPanel />
    </AdminShell>
  );
}
