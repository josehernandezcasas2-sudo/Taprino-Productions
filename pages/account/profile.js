import Link from 'next/link';
import AccountShell from '../../components/account/AccountShell';
import ProfileSection from '../../components/account/ProfileSection';
import { useOwnProfile } from '../../components/account/useOwnProfile';
import { accountPageProps } from '../../lib/accountPage';
import { readAccountTypes } from '../../lib/accountTypes';

// /account/profile (option B, 2026-10-29): the public profile and, under
// it, the private details (gender, age, fiscal sponsor), one Save. At the
// top, "Your types" (account types, migration 126), read here so the row
// draws with the page; before 126 it is greyed with the reason.
export async function getServerSideProps({ req, res }) {
  const result = await accountPageProps(req, res, { requireSignedIn: true });
  if (result.props && result.props.userId) {
    result.props.accountTypes = await readAccountTypes(result.props.userId).catch(() => ({ types: [], main: null, asked: false, watcher: true, available: false }));
  }
  return result;
}

export default function AccountProfile({ isSignedIn, isSubscriber, email, isAdmin, isCreator, mainGenres, userId, accountTypes = null }) {
  const { profile, setProfile, originalAge, setOriginalAge } = useOwnProfile();
  const publicHref = userId ? `/profile/${(profile && profile.handle) || userId}` : null;
  return (
    <AccountShell
      title="Profile"
      aside={publicHref && <Link href={publicHref} className="acct-title-link">View it →</Link>}
      mainGenres={mainGenres}
      isSignedIn={isSignedIn}
      isSubscriber={isSubscriber}
      email={email}
      isAdmin={isAdmin}
      isCreator={isCreator}
    >
      <ProfileSection profile={profile} setProfile={setProfile} originalAge={originalAge} setOriginalAge={setOriginalAge} email={email} isCreator={isCreator} isAdmin={isAdmin} accountTypes={accountTypes} />
    </AccountShell>
  );
}
