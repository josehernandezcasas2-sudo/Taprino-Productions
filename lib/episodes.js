// Central catalog of episodes.
//
// `type` controls how VideoPlayer renders the source:
//   'html5'   — a direct mp4/webm/HLS url (Cloudflare Stream, Mux, Bunny, R2, S3, etc.)
//   'youtube' — a YouTube video id (good zero-cost starting point — ads are YouTube's problem)
//
// The two placeholder "free" videos below point at Google's public sample video so the
// app actually plays something the moment you run it. Swap `src` for your own hosted
// files whenever you're ready — nothing else in the app needs to change.

export const episodes = [
  {
    id: 'willa-hollow-choir',
    title: 'Willa and the Hollow Choir',
    tier: 'free',
    runtime: '06:12',
    desc: "A lighthouse keeper's daughter hears something singing back from the fog. Six minutes, hand-inked, frame by frame.",
    type: 'html5',
    src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'
  },
  {
    id: 'sir-mallory-last-watch',
    title: "Sir Mallory's Last Watch",
    tier: 'free',
    runtime: '04:40',
    desc: 'An armored knight guards a door that was sealed before he was born.',
    type: 'html5',
    src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4'
  },
  {
    id: 'clover-paper-boat',
    title: "Clover's Paper Boat",
    tier: 'free',
    runtime: '05:03',
    desc: "A folded paper boat carries a message downstream, past things that shouldn't be listening.",
    type: 'html5',
    src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4'
  },
  {
    id: 'fintan-static-fields',
    title: 'Fintan in the Static Fields',
    tier: 'premium',
    runtime: '07:18',
    desc: "Cipher Circle exclusive. The deleted middle act of Fintan's arc — the one that explains the cipher.",
    type: 'html5',
    src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4'
  },
  {
    id: 'olaga-between-frames',
    title: 'Olaga: Between the Frames',
    tier: 'premium',
    runtime: '09:44',
    desc: "Cipher Circle exclusive. A behind-the-frame walkthrough of Olaga's animation passes, narrated.",
    type: 'html5',
    src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4'
  }
];

export function findEpisode(id) {
  return episodes.find((e) => e.id === id) || episodes[0];
}
