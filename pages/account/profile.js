import Link from 'next/link';
import AccountShell from '../../components/account/AccountShell';
import ProfileSection from '../../components/account/ProfileSection';
import { useOwnProfile } from '../../components/account/useOwnProfile';
import { accountPageProps } from '../../lib/accountPage';

// /account/profile (option B, 2026-10-29): the public profile and, under
// it, the private details (gender, age, fiscal sponsor), one Save.
export async function getServerSideProps({ req, res }) {
  return accountPageProps(req, res, { requireSignedIn: true });
}

export default function AccountProfile({ isSignedIn, isSubscriber, email, isAdmin, isCreator, mainGenres, userId }) {
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
      <ProfileSection profile={profile} setProfile={setProfile} originalAge={originalAge} setOriginalAge={setOriginalAge} email={email} isCreator={isCreator} isAdmin={isAdmin} />
    </AccountShell>
  );
}
