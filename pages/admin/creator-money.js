import AdminShell from '../../components/AdminShell';
import CreatorMoneyPanel from '../../components/admin/CreatorMoneyPanel';
import { adminPageProps } from '../../lib/adminPage';

// Creator Share's money page (full admins): the ledger this month, the
// next payout batch, the platform balance and recent payouts.
export async function getServerSideProps(ctx) {
  return adminPageProps(ctx);
}

export default function AdminCreatorMoney({ account, mainGenres }) {
  return (
    <AdminShell account={account} mainGenres={mainGenres} title="Creator Share payouts" crumbs={['Money']}
      intro="Members’ shares and referral bonuses land in the creator ledger on every paid invoice; this is where they leave it. The batch runs itself on the 1st, or run it here.">
      <CreatorMoneyPanel />
    </AdminShell>
  );
}
