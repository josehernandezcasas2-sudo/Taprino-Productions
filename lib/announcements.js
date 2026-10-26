import { getSupabase } from './supabase';

function rowToAnnouncement(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    imageUrl: row.image_url,
    linkUrl: row.link_url,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// Public — only active announcements, curation order first (sort_order),
// then newest first as the tiebreaker. Used by the homepage carousel.
export async function getActiveAnnouncements() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) {
    console.error('getActiveAnnouncements error:', error.message);
    return [];
  }
  return (data || []).map(rowToAnnouncement);
}

// Admin — everything, active or not, so the management page can show and
// toggle announcements that are currently hidden.
export async function getAllAnnouncements() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) {
    console.error('getAllAnnouncements error:', error.message);
    return [];
  }
  return (data || []).map(rowToAnnouncement);
}

// New announcements default to the front of the queue (lowest existing
// sort_order minus one) — see the migration's own comment: a freshly
// written announcement is normally the one admin most wants seen first,
// not tacked onto the end.
async function nextFrontSortOrder(supabase) {
  const { data } = await supabase.from('announcements').select('sort_order').order('sort_order', { ascending: true }).limit(1);
  const lowest = data && data[0] ? data[0].sort_order : 0;
  return lowest - 1;
}

// A link is either a web address or a path on this site; anything else
// (a javascript: link, a protocol-relative //other.site) is refused
// (security round, 2026-10-26): the home page draws it as a link.
function cleanLink(linkUrl) {
  const v = linkUrl ? String(linkUrl).trim() : '';
  if (!v) return null;
  if (/^https?:\/\/[^\s]+$/i.test(v)) return v;
  if (v.startsWith('/') && !v.startsWith('//') && !/[\\\s]/.test(v)) return v;
  throw new Error('The link needs to start with https:// or be a path on this site like /series/…');
}

export async function createAnnouncement({ title, body, imageUrl, linkUrl, createdBy }) {
  if (!title || !title.trim()) throw new Error('Title is required.');
  const supabase = getSupabase();
  const sortOrder = await nextFrontSortOrder(supabase);

  const { data, error } = await supabase
    .from('announcements')
    .insert({
      title: title.trim(),
      body: body ? body.trim() : null,
      image_url: imageUrl || null,
      link_url: cleanLink(linkUrl),
      sort_order: sortOrder,
      created_by: createdBy || null
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return rowToAnnouncement(data);
}

export async function updateAnnouncement(id, { title, body, imageUrl, linkUrl, isActive, sortOrder }) {
  if (!id) throw new Error('id is required.');
  const supabase = getSupabase();
  const updates = { updated_at: new Date().toISOString() };
  if (title !== undefined) {
    if (!title.trim()) throw new Error('Title is required.');
    updates.title = title.trim();
  }
  if (body !== undefined) updates.body = body ? body.trim() : null;
  if (imageUrl !== undefined) updates.image_url = imageUrl || null;
  if (linkUrl !== undefined) updates.link_url = cleanLink(linkUrl);
  if (isActive !== undefined) updates.is_active = !!isActive;
  if (sortOrder !== undefined) updates.sort_order = Number(sortOrder);

  const { data, error } = await supabase.from('announcements').update(updates).eq('id', id).select('*').single();
  if (error) throw new Error(error.message);
  return rowToAnnouncement(data);
}

export async function deleteAnnouncement(id) {
  if (!id) throw new Error('id is required.');
  const supabase = getSupabase();
  const { error } = await supabase.from('announcements').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
