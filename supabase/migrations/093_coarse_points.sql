-- Points are kept to about a kilometre (two decimals) from now on: a
-- host's place and a crew member's home could otherwise be narrowed down
-- to the street through the distance search (lib/crewOptions.js
-- coarsePoint). The code rounds everything it saves and every distance
-- it works out; this rounds what's already stored, and drops the old
-- "use my location" cache entries, which held the exact point of whoever
-- asked first about each area. Safe to run more than once.

update crew_cards set lat = round(lat::numeric, 2), lng = round(lng::numeric, 2)
  where lat is not null and (lat <> round(lat::numeric, 2) or lng <> round(lng::numeric, 2));

update crew_calls set lat = round(lat::numeric, 2), lng = round(lng::numeric, 2)
  where lat is not null and (lat <> round(lat::numeric, 2) or lng <> round(lng::numeric, 2));

update locations set lat = round(lat::numeric, 2), lng = round(lng::numeric, 2)
  where lat is not null and (lat <> round(lat::numeric, 2) or lng <> round(lng::numeric, 2));

-- Reverse lookups are now cached under 'r2:'; the old 'r:' rows carry
-- the first asker's exact position.
delete from geocode_cache where query like 'r:%';
