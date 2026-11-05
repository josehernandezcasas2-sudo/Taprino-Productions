import { useEffect, useState } from 'react';

// The signed-in person's own profile row (/api/account/profile), the way
// the account pages edit it: `profile` is the live form value,
// `originalAge` what was loaded, so the age-change warning only shows
// when they really changed it this session. `savedHandle` rides along
// for the handle-availability check. `enabled: false` (the hub, signed
// out) asks for nothing: the route answers 401 without a session.
export function useOwnProfile({ enabled = true } = {}) {
  const [profile, setProfile] = useState(null);
  const [originalAge, setOriginalAge] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    fetch('/api/account/profile')
      .then((r) => r.json())
      .then((data) => { if (!cancelled) { setProfile({ ...data, savedHandle: data.handle || '' }); setOriginalAge(data.age ?? null); } })
      .catch(() => { if (!cancelled) setProfile({ displayName: '', gender: '', age: '', bio: '', avatarUrl: null, socialLinks: [], stayInStream: false }); });
    return () => { cancelled = true; };
  }, [enabled]);
  return { profile, setProfile, originalAge, setOriginalAge };
}
