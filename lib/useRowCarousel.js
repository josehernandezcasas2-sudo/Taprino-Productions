import { useRef } from 'react';

// Matches .row-card's width (190px) + .cat-row-track's gap (1.4rem ≈ 22px)
// in styles/globals.css — scrolling by this amount lines up with actual
// card boundaries instead of an arbitrary pixel jump.
const CARD_STEP_PX = 212;

// Shared by every horizontally-scrolling row (GenreRow, ContinueWatchingRow,
// and any future one) so the loop-around behavior stays identical
// everywhere rather than drifting between two hand-copied versions.
export function useRowCarousel() {
  const trackRef = useRef(null);

  function scroll(direction) {
    const track = trackRef.current;
    if (!track) return;
    const visibleCards = Math.max(1, Math.floor(track.clientWidth / CARD_STEP_PX));
    const amount = CARD_STEP_PX * visibleCards;

    if (direction === 'next') {
      const atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
      track.scrollTo({ left: atEnd ? 0 : track.scrollLeft + amount, behavior: 'smooth' });
    } else {
      const atStart = track.scrollLeft <= 4;
      track.scrollTo({ left: atStart ? track.scrollWidth : track.scrollLeft - amount, behavior: 'smooth' });
    }
  }

  return { trackRef, scroll };
}
