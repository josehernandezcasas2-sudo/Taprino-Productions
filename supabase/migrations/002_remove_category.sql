-- Removes the `category` field entirely. This was left over from an
-- earlier "Browse by category" homepage design that was removed from the
-- UI a while back — but the underlying field kept getting threaded through
-- the whole app anyway (creator form, admin review, database schema) even
-- though nothing actually rendered it anymore. This migration is the part
-- that makes the removal actually stick, rather than just hiding it again.
--
-- Run this once in Supabase's SQL editor if you already ran the original
-- schema.sql before this change. Safe to run even if the column is
-- already gone (IF EXISTS).

alter table episodes drop column if exists category;
