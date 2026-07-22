// One-time migration: copies everything currently in lib/episodes.js and
// lib/series.js into Supabase. Run this once, after schema.sql, after your
// .env.local has real SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY values:
//
//   node scripts/migrate-to-supabase.js
//
// Everything gets inserted as status: 'approved' — this is your existing,
// already-live content, not something that needs review. From this point
// forward, only new creator submissions start as 'pending'.
//
// Safe to re-run: uses upsert, so running it twice just overwrites with the
// same data rather than creating duplicates.

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const { episodes } = require('../lib/episodes');
const { series } = require('../lib/series');

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
    status: 'approved' // existing content — already live, already trusted
  }));
  const { error: episodesError } = await supabase.from('episodes').upsert(episodeRows);
  if (episodesError) {
    console.error('Episode migration failed:', episodesError.message);
    process.exit(1);
  }
  console.log('  done.');

  console.log('\nMigration complete. Verify in the Supabase Table Editor before removing lib/episodes.js.');
}

main();
