import { getSupabase } from './supabase';
import { uploadArtworkImage } from './artworkUpload';

// Admin-only channel management: create, edit, delete, and who maintains
// each channel. Callers must already have checked isAdmin.

export const MAIN_CHANNEL_SLUG = 'tapatv';
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// /live/<slug> shares the URL space with anything else under /live.
const RESERVED_SLUGS = new Set(['index', 'new', 'edit', 'admin', 'api', 'guide', 'schedule']);

export function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

export async function listChannelsForAdmin() {
  const supabase = getSupabase();
  const [{ data: channels, error }, { data: schedulers, error: sErr }] = await Promise.all([
    supabase.from('channels').select('id, slug, name, number, description, logo_url, image_url, visibility, created_at').order('number', { ascending: true }),
    supabase.from('channel_schedulers').select('channel_id, user_id')
  ]);
  if (error) throw new Error(error.message);
  if (sErr) throw new Error(sErr.message);
  return (channels || []).map((c) => ({
    ...c,
    isMain: c.slug === MAIN_CHANNEL_SLUG,
    schedulerIds: (schedulers || []).filter((s) => s.channel_id === c.id).map((s) => s.user_id)
  }));
}

export async function nextChannelNumber() {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('channels').select('number').order('number', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? data.number + 1 : 1;
}

function validate(fields, { partial = false } = {}) {
  const out = {};
  if (!partial || fields.name !== undefined) {
    const name = String(fields.name || '').trim();
    if (!name) throw new Error('Give the channel a name.');
    if (name.length > 40) throw new Error('Keep the channel name to 40 characters or fewer.');
    out.name = name;
  }
  if (!partial || fields.slug !== undefined) {
    const slug = String(fields.slug || '').trim().toLowerCase();
    if (!SLUG_RE.test(slug) || slug.length < 2 || slug.length > 30) {
      throw new Error('The web address can only use lowercase letters, numbers and dashes (2 to 30 characters), like "tapa-after-dark".');
    }
    if (RESERVED_SLUGS.has(slug)) throw new Error(`"${slug}" is reserved. Pick a different web address.`);
    out.slug = slug;
  }
  if (!partial || fields.number !== undefined) {
    const number = Number(fields.number);
    if (!Number.isInteger(number) || number < 1 || number > 999) throw new Error('The channel number has to be a whole number from 1 to 999.');
    out.number = number;
  }
  if (fields.description !== undefined) {
    const d = String(fields.description || '').trim();
    if (d.length > 300) throw new Error('Keep the description to 300 characters or fewer.');
    out.description = d || null;
  }
  if (fields.visibility !== undefined) {
    if (!['draft', 'public'].includes(fields.visibility)) throw new Error('Visibility has to be draft or public.');
    out.visibility = fields.visibility;
  }
  return out;
}

function friendlyUniqueError(error) {
  const msg = error.message || '';
  if (/channels_slug_key|slug/.test(msg) && /duplicate|unique/i.test(msg)) return 'Another channel already uses that web address.';
  if (/channels_number_key|number/.test(msg) && /duplicate|unique/i.test(msg)) return 'Another channel already has that number.';
  return msg;
}

async function uploadImages({ logoBase64, logoFileName, imageBase64, imageFileName }, slug) {
  const out = {};
  if (logoBase64) out.logo_url = await uploadArtworkImage({ base64: logoBase64, fileName: logoFileName || 'logo.png', pathPrefix: `channel-logo-${slug}` });
  if (imageBase64) out.image_url = await uploadArtworkImage({ base64: imageBase64, fileName: imageFileName || 'image.jpg', pathPrefix: `channel-image-${slug}` });
  return out;
}

export async function createChannel(fields) {
  const clean = validate({ ...fields, visibility: fields.visibility || 'draft' });
  const images = await uploadImages(fields, clean.slug);
  const supabase = getSupabase();
  const { data, error } = await supabase.from('channels').insert({ ...clean, ...images }).select().single();
  if (error) throw new Error(friendlyUniqueError(error));
  return data;
}

export async function updateChannel(id, fields) {
  const supabase = getSupabase();
  const { data: existing, error: exErr } = await supabase.from('channels').select('id, slug').eq('id', id).maybeSingle();
  if (exErr) throw new Error(exErr.message);
  if (!existing) throw new Error('That channel no longer exists.');

  const clean = validate(fields, { partial: true });
  if (existing.slug === MAIN_CHANNEL_SLUG && clean.slug && clean.slug !== MAIN_CHANNEL_SLUG) {
    throw new Error("TapaTV's web address can't change. It's the main channel at /live.");
  }
  if (existing.slug === MAIN_CHANNEL_SLUG && clean.visibility === 'draft') {
    throw new Error('TapaTV is the main channel and has to stay public.');
  }
  const images = await uploadImages(fields, clean.slug || existing.slug);
  if (fields.clearLogo) images.logo_url = null;
  if (fields.clearImage) images.image_url = null;

  const { data, error } = await supabase
    .from('channels')
    .update({ ...clean, ...images, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(friendlyUniqueError(error));
  return data;
}

// Deleting a channel takes its schedule, loop, and scheduler assignments
// with it (foreign keys cascade). Past broadcasts stay, unlinked.
export async function deleteChannel(id) {
  const supabase = getSupabase();
  const { data: existing, error: exErr } = await supabase.from('channels').select('slug').eq('id', id).maybeSingle();
  if (exErr) throw new Error(exErr.message);
  if (!existing) return;
  if (existing.slug === MAIN_CHANNEL_SLUG) throw new Error("TapaTV is the main channel and can't be deleted.");
  const { error } = await supabase.from('channels').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function assignScheduler(channelId, userId) {
  const supabase = getSupabase();
  const { error } = await supabase.from('channel_schedulers').upsert({ channel_id: channelId, user_id: userId }, { onConflict: 'channel_id,user_id', ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}

export async function unassignScheduler(channelId, userId) {
  const supabase = getSupabase();
  const { error } = await supabase.from('channel_schedulers').delete().eq('channel_id', channelId).eq('user_id', userId);
  if (error) throw new Error(error.message);
}

// When someone stops being a Content Scheduler, their channel assignments
// go too, so granting the role again later starts from nothing.
export async function removeAllAssignments(userId) {
  const supabase = getSupabase();
  const { error } = await supabase.from('channel_schedulers').delete().eq('user_id', userId);
  if (error && !/does not exist|schema cache/i.test(error.message)) throw new Error(error.message);
}
