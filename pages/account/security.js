import AccountShell from '../../components/account/AccountShell';
import SecuritySection from '../../components/account/SecuritySection';
import { accountPageProps } from '../../lib/accountPage';

// /account/security (option B, 2026-10-29): sign-in settings through
// Clerk, log out, the delete request. lib/adminPage.js sends a team
// account without two-step here (?twostep=1).
export async function getServerSideProps({ req, res }) {
  return accountPageProps(req, res, { requireSignedIn: true });
}

export default function AccountSecurity({ isSignedIn, isSubscriber, email, isAdmin, isCreator, mainGenres, teamTwoStep, twoFactorEnabled }) {
  return (
    <AccountShell title="Security" mainGenres={mainGenres} isSignedIn={isSignedIn} isSubscriber={isSubscriber} email={email} isAdmin={isAdmin} isCreator={isCreator}>
      <SecuritySection email={email} teamTwoStep={teamTwoStep} twoFactorEnabled={twoFactorEnabled} />
    </AccountShell>
  );
}
