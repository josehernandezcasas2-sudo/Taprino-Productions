import AdminShell from '../../components/AdminShell';
import StudioMoneyPanel from '../../components/admin/StudioMoneyPanel';
import { adminPageProps } from '../../lib/adminPage';

// Studio money (full admins): the Stripe balance, what has to stay in it,
// what can go to the bank, and how the period's money split between
// creators, Stripe, reserves and the studio. mockups/studio-money-v1.html.
export async function getServerSideProps(ctx) {
  return adminPageProps(ctx);
}

export default function AdminMoney({ account, mainGenres }) {
  return (
    <AdminShell account={account} mainGenres={mainGenres} title="Studio money" crumbs={['Money']}
      intro="The Stripe balance, what has to stay in it, what can go to the bank, and how this period's money split between creators, Stripe, reserves and the studio.">
      <StudioMoneyPanel />
    </AdminShell>
  );
}
