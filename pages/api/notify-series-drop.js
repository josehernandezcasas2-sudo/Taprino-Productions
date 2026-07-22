import Stripe from 'stripe';
import { findSeries } from '../../lib/series';
import { checkRateLimit, rateLimitKeyForRequest } from '../../lib/rateLimit';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

// This is a manually-triggered tool, not an automated pipeline — there's no
// database watching for "a new episode was added," so you call this
// yourself (curl, Postman, a bookmarked form, whatever's easiest) whenever
// you actually publish a new episode in an existing series. See the README
// for exactly how to call it.
//
// Scale note: since wishlists live in Stripe customer metadata rather than a
// real database, finding "everyone who wishlisted series X" means paginating
// through every customer and checking their metadata client-side — Stripe's
// API can't search inside a comma-separated string field. Fine at hundreds
// to low thousands of customers; if this ever needs to scale further, that's
// the point to introduce a real database for wishlists specifically.
async function sendDropEmail(email, seriesName, seriesUrl) {
  if (!process.env.RESEND_API_KEY) {
    return { skipped: true, reason: 'RESEND_API_KEY not configured' };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL || 'Taprino Transmission <onboarding@resend.dev>',
      to: email,
      subject: `New episode of ${seriesName} just dropped`,
      html: `<p>A new episode of <strong>${seriesName}</strong> is up — you saved this series to get notified.</p><p><a href="${seriesUrl}">${seriesUrl}</a></p>`
    })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend API error: ${body}`);
  }
  return { sent: true };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { seriesId, secret } = req.body || {};

  // Rate limit before checking the secret, not just after — this also
  // throttles repeated guesses at ADMIN_NOTIFY_SECRET itself, not just
  // abuse once someone already has it.
  const allowed = await checkRateLimit(rateLimitKeyForRequest(req, 'notify-series-drop'), 5, 3600);
  if (!allowed) {
    return res.status(429).json({ error: 'Too many requests.' });
  }

  if (!process.env.ADMIN_NOTIFY_SECRET || secret !== process.env.ADMIN_NOTIFY_SECRET) {
    return res.status(401).json({ error: 'Missing or incorrect secret.' });
  }

  const seriesInfo = await findSeries(seriesId);
  if (!seriesInfo) {
    return res.status(400).json({ error: `No series found with id "${seriesId}".` });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'Stripe is not configured.' });
  }

  const origin = req.headers.origin || `https://${req.headers.host}`;
  const seriesUrl = `${origin}/series/${seriesId}`;

  let notified = 0;
  let checked = 0;
  let startingAfter;

  try {
    // Paginate through every customer, 100 at a time, checking metadata.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const page = await stripe.customers.list({ limit: 100, starting_after: startingAfter });
      for (const customer of page.data) {
        checked += 1;
        const wishlist = (customer.metadata && customer.metadata.wishlist) || '';
        const optedOut = customer.metadata && customer.metadata.newsletter === 'opted_out';
        if (wishlist.split(',').includes(seriesId) && !optedOut && customer.email) {
          await sendDropEmail(customer.email, seriesInfo.name, seriesUrl);
          notified += 1;
        }
      }
      if (!page.has_more) break;
      startingAfter = page.data[page.data.length - 1].id;
    }

    return res.status(200).json({ ok: true, seriesId, checked, notified });
  } catch (err) {
    console.error('notify-series-drop error:', err.message);
    return res.status(500).json({ error: 'Something went wrong sending notifications.' });
  }
}
