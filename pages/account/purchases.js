import AccountShell from '../../components/account/AccountShell';
import PurchasesCard from '../../components/PurchasesCard';
import { accountPageProps } from '../../lib/accountPage';

// /account/purchases (option B, 2026-10-29): the titles this account
// owns, with the self-serve refund while it's allowed, and the tips sent
// (components/PurchasesCard.js, always open here).
export async function getServerSideProps({ req, res }) {
  return accountPageProps(req, res, { requireSignedIn: true });
}

export default function AccountPurchases({ isSignedIn, isSubscriber, email, isAdmin, isCreator, mainGenres }) {
  return (
    <AccountShell title="Your purchases" mainGenres={mainGenres} isSignedIn={isSignedIn} isSubscriber={isSubscriber} email={email} isAdmin={isAdmin} isCreator={isCreator}>
      <PurchasesCard forceOpen isSubscriber={isSubscriber} />
    </AccountShell>
  );
}
