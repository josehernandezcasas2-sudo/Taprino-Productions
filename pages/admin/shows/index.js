import Link from 'next/link';
import { useRouter } from 'next/router';
import AdminShell from '../../../components/AdminShell';
import ShowsList from '../../../components/admin/ShowsList';
import CreatorRoster from '../../../components/admin/CreatorRoster';
import { adminPageProps } from '../../../lib/adminPage';
import { SHOW_ADMIN_CAPS } from '../../../lib/showAdminRules';

// Admin → Shows (the series revamp, slice 3a: mockups/series-slice3a-
// contract.md §5.1, §5.4): every series and podcast, and — for full
// admins — the Creators tab (the roster the old Series ownership page
// carried; /admin/ownership lands here). Any of the five show capabilities
// opens it; each action asks for its own.
export async function getServerSideProps(ctx) {
  return adminPageProps(ctx, { caps: SHOW_ADMIN_CAPS });
}

export default function AdminShows({ account, mainGenres }) {
  const router = useRouter();
  const creators = Boolean(account.isAdmin) && router.query.tab === 'creators';
  return (
    <AdminShell account={account} mainGenres={mainGenres} title="Shows" crumbs={['Content']} wide
      intro="Every series and podcast: what’s in review, what waits for approval, and who runs each one.">
      {account.isAdmin && (
        <nav className="sg-tabs adm-shows-tabs" aria-label="Shows">
          <Link href="/admin/shows" className={`sg-tab ${creators ? '' : 'is-active'}`} aria-current={creators ? undefined : 'page'} shallow>Shows</Link>
          <Link href="/admin/shows?tab=creators" className={`sg-tab ${creators ? 'is-active' : ''}`} aria-current={creators ? 'page' : undefined} shallow>Creators</Link>
        </nav>
      )}
      {creators ? <CreatorRoster /> : <ShowsList account={account} mainGenres={mainGenres} />}
    </AdminShell>
  );
}
