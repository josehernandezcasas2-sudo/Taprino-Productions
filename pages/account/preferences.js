import AccountShell from '../../components/account/AccountShell';
import PreferencesSection from '../../components/account/PreferencesSection';
import { useOwnProfile } from '../../components/account/useOwnProfile';
import { accountPageProps } from '../../lib/accountPage';

// /account/preferences (option B, 2026-10-29): newsletter, Start in
// Stream, and where push lives.
export async function getServerSideProps({ req, res }) {
  return accountPageProps(req, res, { requireSignedIn: true });
}

export default function AccountPreferences({ isSignedIn, isSubscriber, email, isAdmin, isCreator, mainGenres, newsletterStatus }) {
  const { profile, setProfile } = useOwnProfile();
  return (
    <AccountShell title="Preferences" mainGenres={mainGenres} isSignedIn={isSignedIn} isSubscriber={isSubscriber} email={email} isAdmin={isAdmin} isCreator={isCreator}>
      <PreferencesSection newsletterStatus={newsletterStatus} profile={profile} setProfile={setProfile} />
    </AccountShell>
  );
}
