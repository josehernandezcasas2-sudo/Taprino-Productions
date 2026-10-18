import { getSupabase } from './supabase';

// A crew call or a location request can name the project it's for: one
// of the poster's own approved Pitch Room projects or series. Only their
// own: the call then shows as "Crew needed" on that project's page, and
// its title is copied into the call, so someone else's (or a pending or
// rejected) project must never be accepted here.
//
// Returns { type, id, title } or null when no project was given; throws
// (through `fail`) when the project isn't the owner's. `keep` is the
// project the record already has, which an edit may leave as it is.
export async function ownProjectInfo(project, ownerId, fail, { keep = null } = {}) {
  if (!project || typeof project !== 'object') return null;
  const type = project.type === 'pitch' || project.type === 'series' ? project.type : null;
  const id = project.id == null ? '' : String(project.id).trim().slice(0, 80);
  if (!type || !id) return null;
  const unchanged = Boolean(keep) && keep.type === type && keep.id === id;
  const supabase = getSupabase();
  if (type === 'pitch') {
    const { data: p } = await supabase.from('pitches').select('id, title, created_by, status').eq('id', id).maybeSingle();
    if (!p) fail('That Pitch Room project doesn’t exist.');
    if (!unchanged && (p.created_by !== ownerId || p.status !== 'approved')) fail('You can only link one of your own approved Pitch Room projects.', 403);
    return { type, id, title: p.title };
  }
  const { data: s } = await supabase.from('series').select('id, name, creator_id, status, moderation_hold, deletion_requested').eq('id', id).maybeSingle();
  if (!s) fail('That series doesn’t exist.');
  const approved = !s.status || s.status === 'approved';
  if (!unchanged && (s.creator_id !== ownerId || !approved || s.moderation_hold || s.deletion_requested)) fail('You can only link one of your own published series.', 403);
  return { type, id, title: s.name };
}
