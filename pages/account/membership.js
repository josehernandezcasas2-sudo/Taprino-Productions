import AccountShell from '../../components/account/AccountShell';
import MembershipSection from '../../components/account/MembershipSection';
import { accountPageProps } from '../../lib/accountPage';
import { freeAccessNoteFor } from '../../lib/accountRules';

// /account/membership (option B, 2026-10-29): the plan, Membership Artist
// Support and "Have a code?". Checkout returns here
// (pages/api/confirm-checkout.js).
export async function getServerSideProps({ req, res }) {
  return accountPageProps(req, res, { requireSignedIn: true });
}

export default function AccountMembership({ isSignedIn, isSubscriber, tier, plans, email, isAdmin, isSubAdmin, isCreator, isComped, mainGenres, subscriptionDetails, promoAccessExpiresAt, viaHandle }) {
  const freeAccessNote = freeAccessNoteFor({ isAdmin, isSubAdmin, isComped, promoAccessExpiresAt });
  return (
    <AccountShell title="Membership" mainGenres={mainGenres} isSignedIn={isSignedIn} isSubscriber={isSubscriber} email={email} isAdmin={isAdmin} isCreator={isCreator}>
      <MembershipSection plans={plans} tier={tier} subscriptionDetails={subscriptionDetails} freeAccessNote={freeAccessNote} viaHandle={viaHandle} />
    </AccountShell>
  );
}
