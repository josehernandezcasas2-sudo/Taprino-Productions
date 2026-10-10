import { getSupabase } from './supabase';
import { SITE } from './siteConfig';

// Turns a typed place ("long beach", "echo park los angeles") into a point,
// and a point into a place name, for Crew Call's location-based search.
// Uses OpenStreetMap's Nominatim, which is free for light use provided the
// app identifies itself and stays under a request a second, so every
// answer is cached (in memory, and in geocode_cache, migration 079) and
// upstream calls are spaced out. Swapping in a paid geocoder later only
// touches this file.

const UA = `StudioTapaTV/1.0 (${SITE.contactEmail || 'https://www.studiotapatv.site'})`;
const BASE = 'https://nominatim.openstreetmap.org';
const mem = new Map();
let lastUpstream = 0;

async function upstream(path) {
  const wait = Math.max(0, lastUpstream + 1100 - Date.now());
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  lastUpstream = Date.now();
  const res = await fetch(`${BASE}${path}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } });
  if (!res.ok) throw new Error(`The map service answered ${res.status}.`);
  return res.json();
}

const US_STATES = { Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY', 'District of Columbia': 'DC' };

// One place, the way a card shows it: "Long Beach, CA" or "Lisbon, Portugal".
function toPlace(r) {
  const a = r.address || {};
  const city = a.city || a.town || a.village || a.hamlet || a.municipality || a.suburb || a.county || r.name || '';
  const country = (a.country_code || '').toUpperCase();
  const region = country === 'US' ? (US_STATES[a.state] || a.state || '') : (a.country || '');
  const label = [city, region].filter(Boolean).join(', ');
  const lat = Number(r.lat);
  const lng = Number(r.lon);
  if (!label || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { label, city, region, country, lat: Math.round(lat * 10000) / 10000, lng: Math.round(lng * 10000) / 10000 };
}

async function cached(key, produce) {
  const hit = mem.get(key);
  if (hit && Date.now() - hit.at < 6 * 3600 * 1000) return hit.value;
  let value = null;
  try {
    const { data } = await getSupabase().from('geocode_cache').select('results').eq('query', key).maybeSingle();
    if (data) value = data.results;
  } catch (err) { /* before migration 079, or a hiccup: just ask upstream */ }
  if (value === null) {
    value = await produce();
    try { await getSupabase().from('geocode_cache').upsert({ query: key, results: value, created_at: new Date().toISOString() }, { onConflict: 'query' }); } catch (err) { /* cache only */ }
  }
  mem.set(key, { at: Date.now(), value });
  return value;
}

// Up to five places matching what someone typed.
export async function geocode(q) {
  const query = String(q || '').trim().replace(/\s+/g, ' ');
  if (query.length < 2) return [];
  return cached(`q:${query.toLowerCase().slice(0, 80)}`, async () => {
    const rows = await upstream(`/search?format=jsonv2&addressdetails=1&limit=6&q=${encodeURIComponent(query)}`);
    const seen = new Set();
    const out = [];
    for (const r of rows || []) {
      const p = toPlace(r);
      if (p && !seen.has(p.label)) { seen.add(p.label); out.push(p); }
    }
    return out.slice(0, 5);
  });
}

// The place a point is in, for "use my location".
export async function reverseGeocode(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
  return cached(`r:${la.toFixed(2)},${ln.toFixed(2)}`, async () => {
    const r = await upstream(`/reverse?format=jsonv2&addressdetails=1&zoom=10&lat=${la}&lon=${ln}`);
    const p = r && !r.error ? toPlace(r) : null;
    return p ? { ...p, lat: Math.round(la * 10000) / 10000, lng: Math.round(ln * 10000) / 10000 } : null;
  });
}
