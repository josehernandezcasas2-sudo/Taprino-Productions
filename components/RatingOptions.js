import { useEffect, useState } from 'react';
import { STANDARD_RATINGS } from '../lib/contentRatings';

// The live ratings list in the browser: the built-in list right away, then
// whatever /api/ratings says (custom ratings an admin added, PNG bugs).
let shared = null; // one fetch per page load, shared by every user of the hook
export function useContentRatings() {
  const [list, setList] = useState(shared || STANDARD_RATINGS.map((r) => ({ ...r, imageUrl: null, custom: false })));
  useEffect(() => {
    let alive = true;
    if (shared) { setList(shared); return undefined; }
    fetch('/api/ratings')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d && Array.isArray(d.ratings) && d.ratings.length) { shared = d.ratings; setList(d.ratings); } })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return list;
}

// Drop-in <option>s for a rating <select>. The value is the rating code,
// which is what episodes store.
export default function RatingOptions() {
  const ratings = useContentRatings();
  return (
    <>
      {ratings.map((r) => <option key={r.code} value={r.code}>{r.code}{r.custom ? ` · ${r.label}` : ''}</option>)}
    </>
  );
}
