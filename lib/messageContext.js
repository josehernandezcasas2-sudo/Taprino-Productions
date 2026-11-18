import { getSupabase } from './supabase';
import { CONTEXT_KINDS } from './messageRules';

// What a conversation is about, checked on the server (2026-11-18, Jose:
// "note down what it's from, ie, a production, just a chat, or from
// somewhere else that it can link back to … producer and users can contact
// each other through project … it keeps it private to a degree").
//
// A context arrives from a page's link (/messages?to=…&kind=…&ref=…&label=…)
// or from the server itself (a call response, a place request). Anything
// with something to link back to is read here by its id, so its label is
// the real title and the link goes somewhere real:
//   - production: both people must be on that production (its owner or on
//     its crew list), else nothing is sent — a production's conversations
//     stay between the people on it;
//   - call / location: the row must still be there (not removed, not held);
//     otherwise the context keeps the label it came with and no link;
//   - gear / card / profile: the label it came with, no id (they live on
//     the other person's profile).
// → { context } or { refused: 'line' }. A read error throws.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v, max) => (v == null ? '' : String(v).trim().slice(0, max));

async function one(table, columns, id) {
  const { data, error } = await getSupabase().from(table).select(columns).eq('id', id).maybeSingle();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data || null;
}

export async function resolveContext(me, other, raw) {
  if (!raw || typeof raw !== 'object') return { context: null };
  const kind = CONTEXT_KINDS.includes(raw.kind) ? raw.kind : null;
  if (!kind) return { context: null };
  const id = str(raw.id || raw.ref, 80);
  const label = str(raw.label, 80);

  if (kind === 'production') {
    if (!UUID.test(id)) return { refused: 'That production isn’t here.' };
    const row = await one('productions', 'id, title, owner_id, status, moderation_hold', id);
    if (!row || row.status === 'removed' || row.moderation_hold) return { refused: 'That production isn’t here.' };
    const { data, error } = await getSupabase().from('production_members').select('user_id').eq('production_id', id).in('user_id', [me, other]);
    if (error) throw new Error(`production_members: ${error.message}`);
    const on = new Set([row.owner_id, ...(data || []).map((m) => m.user_id)]);
    if (!on.has(me) || !on.has(other)) return { refused: 'Only people on this production can message each other from it.' };
    const title = str(row.title, 80);
    return { context: title ? { kind, label: title, id } : null };
  }

  if (kind === 'call' || kind === 'location') {
    if (UUID.test(id)) {
      const row = kind === 'call'
        ? await one('crew_calls', 'id, title, role, status, moderation_hold', id)
        : await one('locations', 'id, title, status, moderation_hold', id);
      if (row && row.status !== 'removed' && !row.moderation_hold) {
        const title = str(row.title || row.role, 80);
        if (title) return { context: { kind, label: title, id } };
      }
    }
    return { context: label ? { kind, label } : null };
  }

  return { context: label ? { kind, label } : null };
}
