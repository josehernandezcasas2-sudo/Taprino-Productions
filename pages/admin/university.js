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
            Departments hold courses; a course is an ordered syllabus of lessons (video or reading, optionally under module
            headings) plus its files. <strong>Materials</strong> are downloads (templates, worksheets); <strong>examples</strong>{' '}
            are things to look at (sample scripts, example clips) and get their own tab on the site. Only published items show at{' '}
            <Link href="/university" target="_blank">/university</Link>; a hidden department hides everything in it.
          </p>
        </div>
        <Link href="/admin" className="library-back">← Back to admin</Link>
      </div>
      <UniversityEditor />
    </AdminShell>
  );
}
