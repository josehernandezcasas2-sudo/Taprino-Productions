import { useEffect, useRef } from 'react';

// Google's public sample VAST tag — safe to leave in while you test, since it's
// Google's own documented IMA SDK sample. Swap NEXT_PUBLIC_AD_TAG_URL for your
// own Google Ad Manager tag once you're ready to run real, paying ads.
const DEFAULT_AD_TAG =
  'https://pubads.g.doubleclick.net/gampad/ads?iu=/21775744923/external/single_ad_samples' +
  '&sz=640x480&cust_params=sample_ct%3Dlinear&ciu_szs=300x250&gdfp_req=1&output=vast' +
  '&unviewed_position_start=1&env=vp&impl=s&correlator=';

const AD_TAG_URL = process.env.NEXT_PUBLIC_AD_TAG_URL || DEFAULT_AD_TAG;

export default function VideoPlayer({ episode, adsEnabled }) {
  const videoRef = useRef(null);
  const adContainerRef = useRef(null);
  const adsManagerRef = useRef(null);
  const adsLoaderRef = useRef(null);

  useEffect(() => {
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

  return (
    <div style={{ position: 'relative', background: '#000' }}>
      <video
        ref={videoRef}
        src={episode.src}
        controls
        playsInline
        style={{ width: '100%', display: 'block', aspectRatio: '16/9', background: '#000' }}
        onClick={handlePlayClick}
      />
      <div ref={adContainerRef} style={{ position: 'absolute', inset: 0, pointerEvents: adsEnabled ? 'auto' : 'none' }} />
    </div>
  );
}
