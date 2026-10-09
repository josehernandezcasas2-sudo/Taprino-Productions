import Link from 'next/link';
import AdminShell from '../../components/AdminShell';
import UniversityEditor from '../../components/admin/UniversityEditor';
import { adminPageProps } from '../../lib/adminPage';

// Film University editor — see components/admin/UniversityEditor.js.
// Sub-admins get in with the manage_university capability.
export async function getServerSideProps(ctx) {
  return adminPageProps(ctx, { caps: ['manage_university'] });
}

export default function UniversityAdmin({ account, mainGenres }) {
  return (
    <AdminShell account={account} mainGenres={mainGenres} title="Film University" crumbs={['Content']} wide>
      <div className="ca-head">
        <div>
          <div className="eyebrow">Admin</div>
          <h1>Film University</h1>
          <p className="ca-sub">
            Topics hold lessons (a video on Cloudflare Stream or a PDF). Exercises are the Workshop&rsquo;s front door at{' '}
            <Link href="/university" target="_blank">/university</Link>: each one links the lessons that teach it and a template to use with it.
            Only published items show on the site; a topic hides all its lessons when it&rsquo;s hidden.
          </p>
        </div>
        <Link href="/admin" className="library-back">← Back to admin</Link>
      </div>
      <UniversityEditor />
    </AdminShell>
  );
}
