import { useEffect, useState } from 'react';

export default function InstallButton() {
  const [installEvent, setInstallEvent] = useState(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showIOSHint, setShowIOSHint] = useState(false);

  useEffect(() => {
    const ua = window.navigator.userAgent;
    setIsIOS(/iPhone|iPad|iPod/.test(ua));
    setIsStandalone(window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true);

    function handleBeforeInstallPrompt(e) {
      e.preventDefault();
      setInstallEvent(e);
    }
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  if (isStandalone) return null; // Already installed — nothing to show.

  async function handleClick() {
    if (installEvent) {
      installEvent.prompt();
      await installEvent.userChoice;
      setInstallEvent(null);
      return;
    }
    if (isIOS) {
      setShowIOSHint((v) => !v);
    }
  }

  // Chrome/Android/desktop has a real install prompt available, or we're on
  // iOS where "install" means a manual Share-menu step instead.
  if (!installEvent && !isIOS) return null;

  return (
    <div style={{ position: 'relative' }}>
      <button className="install-btn" onClick={handleClick}>
        ⇩ Install app
      </button>
      {showIOSHint && (
        <div className="ios-hint">
          Tap the <strong>Share</strong> icon in Safari's toolbar, then <strong>Add to Home Screen</strong>.
        </div>
      )}
    </div>
  );
}
