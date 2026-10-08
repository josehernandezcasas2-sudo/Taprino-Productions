import AdminShell from '../../components/AdminShell';
import ReviewQueue from '../../components/admin/ReviewQueue';
import { adminPageProps } from '../../lib/adminPage';
import { getSiteSettings } from '../../lib/siteSettings';

// The full merged review queue: creator submissions, advertiser ads,
// new series, channel uploads. Sub-admins with review_submissions see
// episodes and channel uploads; ads and series are full-admin only.
export async function getServerSideProps(ctx) {
  return adminPageProps(ctx, {
    caps: ['review_submissions'],
    extra: async () => ({ defaultCpmCents: (await getSiteSettings()).adCpmCents || null })
  });
}

export default function AdminReview({ account, mainGenres, defaultCpmCents }) {
  return (
    <AdminShell
      account={account}
      mainGenres={mainGenres}
      title="Review queue"
      crumbs={['Content']}
      intro="Everything waiting on a decision, oldest first. Approve inline, or open an item to watch it and reject with a reason. Ads open the full review modal so you can set the billing rate."
    >
      <div className="adm-card">
        <ReviewQueue defaultCpmCents={defaultCpmCents} />
      </div>
    </AdminShell>
  );
}
