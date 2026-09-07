import Link from 'next/link';
import { useRouter } from 'next/router';
import { BackArrowIcon } from './PlayerIcons';

// Shared by any custom back-behaving control that can't use the standard
// pill button directly (e.g. the vertical reel feed's "×" close button,
// which needs this exact smart-back behavior but a different visual
// treatment — a full pill would obstruct the video). Returns a function
// that calls router.back() when there's real in-site history to return
// to, or falls back to fallbackHref otherwise.
export function useSmartBack(fallbackHref = '/') {
  const router = useRouter();
  return function goBack() {
    let hasInSiteHistory = false;
    try {
      hasInSiteHistory = sessionStorage.getItem('st_has_navigated') === '1';
    } catch {
      // Storage unavailable — treat as no history, fall back below.
    }
    if (hasInSiteHistory) {
      router.back();
    } else {
      router.push(fallbackHref);
    }
  };
}

// The single standard back button, used everywhere. Real behavior, not
// just a consistent look: if the person navigated here from somewhere
// else on the site this tab-session, clicking this goes to that exact
// page (true back). If they arrived via a shared link, bookmark, or a
// fresh tab — meaning there's no real in-site page to return to — it
// goes to fallbackHref instead, so the button is never a dead end and
// never accidentally kicks someone back out to whatever app or site
// linked them here.
//
// A real <Link> under the hood (not a <button>) so it's a genuine,
// crawlable, right-click-able link even before JS decides which
// destination to use.
export default function BackButton({ fallbackHref = '/', style }) {
  const router = useRouter();

  function handleClick(e) {
    let hasInSiteHistory = false;
    try {
      hasInSiteHistory = sessionStorage.getItem('st_has_navigated') === '1';
    } catch {
      // Storage unavailable — treat as no history, fall back below.
    }
    if (hasInSiteHistory) {
      e.preventDefault();
      router.back();
    }
    // Otherwise, let the Link's own href navigation proceed normally —
    // it already points at fallbackHref.
  }

  return (
    <Link href={fallbackHref} className="back-button" style={style} onClick={handleClick}>
      <BackArrowIcon size={16} />
      <span>Back</span>
    </Link>
  );
}
