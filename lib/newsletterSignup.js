import { getSupabase } from './supabase';

// Real API details confirmed against Brevo's current docs (POST
// /v3/contacts, api-key header) before writing this — not guessed from
// memory, since third-party API shapes are exactly the kind of thing
// that drifts and breaks silently if assumed.
async function syncToBrevo(email) {
  if (!process.env.BREVO_API_KEY) return { synced: false, reason: 'not_configured' };
  try {
    const res = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email })
    });
    if (res.status === 201) return { synced: true };
    // Brevo returns 400 "duplicate_parameter" if the contact already
    // exists there — not a real failure from this app's point of view,
    // since the desired end state (this email is in Brevo) is already
    // true either way.
    const body = await res.json().catch(() => ({}));
    if (res.status === 400 && body.code === 'duplicate_parameter') {
      return { synced: true };
    }
    return { synced: false, reason: body.message || `HTTP ${res.status}` };
  } catch (err) {
    return { synced: false, reason: err.message };
  }
}

// Always stores in Supabase first — this app's own reliable database,
// not dependent on any third-party account being set up yet. The Brevo
// sync (or whichever ESP eventually gets configured) is a bonus on top,
// not a requirement for the signup itself to succeed. This means email
// collection can start today even before an ESP account exists; the
// signups already stored can be bulk-exported (CSV) into whatever ESP
// gets chosen later, or picked up automatically once BREVO_API_KEY is set
// for anyone who signs up after that point.
export async function saveNewsletterSignup(email, source = 'footer') {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('newsletter_signups')
    .insert({ email: email.toLowerCase().trim(), source });

  if (error) {
    // Unique constraint violation — already signed up. Treat as success
    // from the visitor's point of view; nothing about resubmitting the
    // same email should look like a failure to them.
    if (error.code === '23505') {
      return { ok: true, alreadySubscribed: true };
    }
    throw new Error(error.message);
  }

  const brevoResult = await syncToBrevo(email);
  if (brevoResult.synced) {
    await supabase.from('newsletter_signups').update({ synced_to_esp: true }).eq('email', email.toLowerCase().trim());
  }

  return { ok: true, alreadySubscribed: false, espSynced: brevoResult.synced };
}
