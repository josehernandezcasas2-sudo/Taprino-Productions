-- Tracks which video platform an episode's src actually points at.
-- Defaults every existing row to 'cloudflare' since that's the only
-- provider that has ever been wired up — this is purely descriptive
-- metadata (which dashboard to go check, which docs apply) rather than
-- something the player itself branches on: src is always a plain HLS
-- (.m3u8) URL regardless of provider, and the player (components/
-- VideoPlayer.js) already plays any such URL generically via hls.js.
alter table episodes add column if not exists video_provider text not null default 'cloudflare';

comment on column episodes.video_provider is 'Which platform src''s HLS URL was generated for: cloudflare, bunny, or mux. Informational only — the player itself is provider-agnostic.';
