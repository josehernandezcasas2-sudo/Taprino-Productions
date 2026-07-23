// One-time migration: seeds your original test content directly into
// Supabase. Run this once, after schema.sql, after your .env.local has
// real SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY values:
//
//   node scripts/migrate-to-supabase.js
//
// This data is self-contained here rather than imported from lib/episodes.js
// — that file was rewritten to query Supabase directly a while back, so it
// no longer holds any static data to migrate from. This script is now the
// only place this original test content lives in code form.
//
// Everything gets inserted as status: 'approved' — this is your existing,
// already-trusted test content, not something that needs review.
//
// Safe to re-run: uses upsert, so running it twice just overwrites with the
// same data rather than creating duplicates.

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const series = [
  { id: 'cipher-lore', name: 'Cipher Lore', desc: 'The premium serial at the heart of the Cipher Circle — the found-journal mystery that started it all.', trailerSrc: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4' },
  { id: 'behind-the-frame', name: 'Behind the Frame', desc: 'A process series pulling back the curtain on how Studio Taprino actually gets made.' },
  { id: 'test-series', name: 'Test Series', desc: 'Placeholder series for testing the hub page\'s season-grouping across multiple seasons.', trailerSrc: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4' }
];

const episodes = [
  { id: 'willa-hollow-choir', title: 'Willa and the Hollow Choir', desc: 'A short folklore-horror piece — Willa follows a choir that shouldn\'t exist into the hollow.', tier: 'free', genre: 'Folklore Horror', mainGenre: 'Horror', contentType: 'short', artist: 'Studio Taprino', runtime: '06:12', featured: true, src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4' },
  { id: 'sir-mallory', title: 'Sir Mallory', desc: 'A knight, a debt, and a decision he can\'t take back.', tier: 'free', genre: 'Dark Fantasy', mainGenre: 'Fantasy', contentType: 'short', artist: 'Studio Taprino', runtime: '05:40', src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4' },
  { id: 'clover', title: 'Clover', desc: 'A quiet short about luck, and what it actually costs.', tier: 'free', genre: 'Folklore Horror', mainGenre: 'Horror', contentType: 'short', artist: 'Studio Taprino', runtime: '04:55', src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4' },
  { id: 'fintan', title: 'Fintan', desc: 'Cipher Circle exclusive. The deleted middle act of Fintan\'s arc — the one that explains the cipher.', tier: 'premium', genre: 'Cosmic Horror', mainGenre: 'Horror', contentType: 'series', seriesId: 'cipher-lore', season: 1, seriesOrder: 1, artist: 'Olaga', runtime: '07:18', featured: true, src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4', trailerSrc: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4' },
  { id: 'olaga-between-frames', title: 'Olaga: Between the Frames', desc: 'A look at Olaga\'s own process, in her own words, between two Cipher Lore episodes.', tier: 'free', genre: 'Documentary', mainGenre: 'Documentary', contentType: 'series', seriesId: 'behind-the-frame', season: 1, seriesOrder: 1, artist: 'Olaga', runtime: '08:02', src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4' },
  { id: 'test-video-1', title: 'Test Video 1', desc: 'Placeholder Season 1 episode, testing real Cloudflare Stream playback.', tier: 'free', genre: 'Documentary', mainGenre: 'Documentary', contentType: 'series', seriesId: 'behind-the-frame', season: 1, seriesOrder: 2, artist: 'Studio Taprino', runtime: 'N/A', src: 'https://customer-6lw3ib81r72mjyar.cloudflarestream.com/59178681297b580e6fb8536fe0ea8016/manifest/video.m3u8' },
  { id: 'test-movie-1', title: 'Test Movie 1', desc: 'A placeholder standalone feature film, for testing the Movies type page — hero, poster grid, and the full episode page.', tier: 'free', genre: 'Cosmic Horror', mainGenre: 'Horror', contentType: 'movie', artist: 'Studio Taprino', runtime: 'N/A', featured: true, src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4', trailerSrc: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4', heroImage: 'https://picsum.photos/seed/taprino-hero-test/1600/900' },
  { id: 'test-series-s1e1', title: 'Test Series S1E1', desc: 'Placeholder Season 1 episode, for testing how the series hub page groups and displays multiple seasons.', tier: 'free', genre: 'Drama', mainGenre: 'Documentary', contentType: 'series', seriesId: 'test-series', season: 1, seriesOrder: 1, artist: 'Studio Taprino', runtime: 'N/A', src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4' },
  { id: 'test-series-s2e1', title: 'Test Series S2E1', desc: 'Placeholder Season 2 episode, testing the same series hub\'s second season.', tier: 'free', genre: 'Drama', mainGenre: 'Documentary', contentType: 'series', seriesId: 'test-series', season: 2, seriesOrder: 1, artist: 'Studio Taprino', runtime: 'N/A', src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4' }
];

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local — nothing to do.');
    process.exit(1);
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  console.log(`Migrating ${series.length} series...`);
  const seriesRows = series.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.desc || null,
    trailer_src: s.trailerSrc || null,
    hero_image: s.heroImage || null
  }));
  const { error: seriesError } = await supabase.from('series').upsert(seriesRows);
  if (seriesError) {
    console.error('Series migration failed:', seriesError.message);
    process.exit(1);
  }
  console.log('  done.');

  console.log(`Migrating ${episodes.length} episodes...`);
  const episodeRows = episodes.map((e) => ({
    id: e.id,
    title: e.title,
    description: e.desc || null,
    tier: e.tier || 'free',
    genre: e.genre || null,
    main_genre: e.mainGenre || null,
    content_type: e.contentType,
    series_id: e.seriesId || null,
    season: e.season || null,
    series_order: e.seriesOrder || null,
    artist: e.artist || null,
    runtime: e.runtime || null,
    video_type: e.type || 'html5',
    src: e.src || null,
    trailer_src: e.trailerSrc || null,
    hero_image: e.heroImage || null,
    featured: !!e.featured,
    status: 'approved'
  }));
  const { error: episodesError } = await supabase.from('episodes').upsert(episodeRows);
  if (episodesError) {
    console.error('Episode migration failed:', episodesError.message);
    process.exit(1);
  }
  console.log('  done.');

  console.log('\nMigration complete. Verify in the Supabase Table Editor.');
}

main();
