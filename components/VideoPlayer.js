import { useEffect, useRef } from 'react';

// Google's public sample VAST tag — safe to leave in while you test, since it's
// Google's own documented IMA SDK sample. Swap NEXT_PUBLIC_AD_TAG_URL for your
// own Google Ad Manager tag once you're ready to run real, paying ads.
const DEFAULT_AD_TAG =
  'https://pubads.g.doubleclick.net/gampad/ads?iu=/21775744923/external/single_ad_samples' +
  '&sz=640x480&cust_params=sample_ct%3Dlinear&ciu_szs=300x250&gdfp_req=1&output=vast' +
  '&unviewed_position_start=1&env=vp&impl=s&correlator=';

const AD_TAG_URL = process.env.NEXT_PUBLIC_AD_TAG_URL || DEFAULT_AD_TAG;

export default function VideoPlayer({ episode, adsEnabled, onEnded, initialPosition, onProgress }) {
  const videoRef = useRef(null);
  const adContainerRef = useRef(null);
  const adsManagerRef = useRef(null);
  const adsLoaderRef = useRef(null);
  const hlsRef = useRef(null);
  const lastSavedRef = useRef(0);

  const isYouTube = episode.type === 'youtube';

  // Resume where they left off. Only fires once per episode load, right
  // when the browser actually knows the video's duration — trying to seek
  // any earlier just gets silently ignored by the video element.
  useEffect(() => {
    if (isYouTube || !onProgress) return;
    const videoElement = videoRef.current;
    if (!videoElement) return;

    function handleLoadedMetadata() {
      if (initialPosition && initialPosition > 0 && initialPosition < videoElement.duration - 5) {
        videoElement.currentTime = initialPosition;
      }
    }
    function handleTimeUpdate() {
      const now = videoElement.currentTime;
      // Throttled to roughly every 15s of actual playback — this is a real
      // API call for signed-in visitors, not a free local write, so it
      // can't fire on every timeupdate tick (which is ~4x/second).
      if (now - lastSavedRef.current >= 15) {
        lastSavedRef.current = now;
        onProgress(now, videoElement.duration);
      }
    }
    function handlePause() {
      onProgress(videoElement.currentTime, videoElement.duration);
    }

    videoElement.addEventListener('loadedmetadata', handleLoadedMetadata);
    videoElement.addEventListener('timeupdate', handleTimeUpdate);
    videoElement.addEventListener('pause', handlePause);
    return () => {
      videoElement.removeEventListener('loadedmetadata', handleLoadedMetadata);
      videoElement.removeEventListener('timeupdate', handleTimeUpdate);
      videoElement.removeEventListener('pause', handlePause);
      // Best-effort final save on unmount (episode switch, navigating away).
      if (videoElement.currentTime > 0) {
        onProgress(videoElement.currentTime, videoElement.duration);
      }
    };
  }, [episode.id, isYouTube, initialPosition, onProgress]);

  // Attach the actual video source. Cloudflare Stream (and most real hosts)
  // serve HLS (.m3u8), which only Safari plays natively from a plain `src`
  // attribute — every other browser needs hls.js to feed it into the video
  // element via MediaSource. Regular mp4/webm files skip all of this and
  // just get a normal src assignment.
  useEffect(() => {
    if (isYouTube) return;
    const videoElement = videoRef.current;
    if (!videoElement || !episode.src) return;

    let cancelled = false;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const isHls = episode.src.includes('.m3u8');

    if (isHls) {
      import('hls.js').then(({ default: Hls }) => {
        if (cancelled) return;
        if (Hls.isSupported()) {
          const hls = new Hls();
          hls.loadSource(episode.src);
          hls.attachMedia(videoElement);
          hlsRef.current = hls;
        } else {
          // Safari has native HLS support and doesn't need hls.js at all.
          videoElement.src = episode.src;
        }
      });
    } else {
      videoElement.src = episode.src;
    }

    return () => {
      cancelled = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [episode.id, episode.src, isYouTube]);

  useEffect(() => {
    if (isYouTube) return; // YouTube handles its own player, ads, and playback.

    const videoElement = videoRef.current;
    if (!videoElement) return;

    // Reset playback state for the newly selected episode.
    videoElement.pause();
    videoElement.currentTime = 0;

    if (!adsEnabled) {
      // Cipher Circle members: no ad request at all, just play the content.
      return;
    }

    if (typeof window === 'undefined' || !window.google || !window.google.ima) {
      // IMA SDK script hasn't loaded yet (or failed to, e.g. an ad blocker) —
      // fail open so free viewers still see the show.
      return;
    }

    const google = window.google;
    const adDisplayContainer = new google.ima.AdDisplayContainer(adContainerRef.current, videoElement);
    const adsLoader = new google.ima.AdsLoader(adDisplayContainer);
    adsLoaderRef.current = adsLoader;

    adsLoader.addEventListener(
      google.ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED,
      (adsManagerLoadedEvent) => {
        const adsManager = adsManagerLoadedEvent.getAdsManager(videoElement);
        adsManagerRef.current = adsManager;

        adsManager.addEventListener(google.ima.AdEvent.Type.CONTENT_RESUME_REQUESTED, () => {
          videoElement.play();
        });
        adsManager.addEventListener(google.ima.AdEvent.Type.ALL_ADS_COMPLETED, () => {
          videoElement.play();
        });
        adsManager.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR, () => {
          adsManager.destroy();
          videoElement.play();
        });

        try {
          adsManager.init(videoElement.clientWidth, videoElement.clientHeight, google.ima.ViewMode.NORMAL);
          adsManager.start();
        } catch (adError) {
          videoElement.play();
        }
      },
      false
    );

    adsLoader.addEventListener(
      google.ima.AdErrorEvent.Type.AD_ERROR,
      () => {
        videoElement.play();
      },
      false
    );

    const adsRequest = new google.ima.AdsRequest();
    adsRequest.adTagUrl = AD_TAG_URL;
    adsRequest.linearAdSlotWidth = videoElement.clientWidth || 640;
    adsRequest.linearAdSlotHeight = videoElement.clientHeight || 360;
    adsRequest.nonLinearAdSlotWidth = videoElement.clientWidth || 640;
    adsRequest.nonLinearAdSlotHeight = 150;

    adDisplayContainer.initialize();
    adsLoader.requestAds(adsRequest);

    return () => {
      if (adsManagerRef.current) {
        adsManagerRef.current.destroy();
        adsManagerRef.current = null;
      }
      if (adsLoaderRef.current) {
        adsLoaderRef.current.contentComplete && adsLoaderRef.current.contentComplete();
      }
    };
  }, [episode.id, adsEnabled]);

  function handlePlayClick() {
    const videoElement = videoRef.current;
    if (adsEnabled && adsManagerRef.current) {
      // Ad already kicked off via ADS_MANAGER_LOADED; the play button here is
      // mostly relevant for the ad-free (Cipher Circle) path below.
      return;
    }
    videoElement && videoElement.play();
  }

  if (isYouTube) {
    return (
      <div style={{ position: 'relative' }}>
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${episode.src}`}
          title={episode.title}
          style={{ width: '100%', aspectRatio: '16/9', display: 'block', border: 0 }}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }

  return (
    <div
      style={{ position: 'relative', background: '#000' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <video
        ref={videoRef}
        controls
        controlsList="nodownload noremoteplayback"
        disablePictureInPicture
        playsInline
        style={{ width: '100%', display: 'block', aspectRatio: '16/9', background: '#000' }}
        onClick={handlePlayClick}
        onEnded={(e) => {
          if (onProgress) onProgress(e.target.duration, e.target.duration);
          if (onEnded) onEnded(e);
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div ref={adContainerRef} style={{ position: 'absolute', inset: 0, pointerEvents: adsEnabled ? 'auto' : 'none' }} />
    </div>
  );
}
