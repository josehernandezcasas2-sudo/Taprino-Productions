import { discardLink, endLink, linkDetail, newLinkPassword, sendScreeningError, updateLink } from '../../../../lib/screenings';
import { originOf, screeningCreator, startScreeningRoute } from '../../../../lib/screeningRoute';
import { SCREENING_WORDS_SERVER } from '../../../../lib/screeningRules';

// One private screening link (migration 128), for whoever runs its title.
//   GET    → { link, target, views: [ViewRow], refusals: [RefusalRow] }
//   PATCH  { action: 'update', …settings } → { link }
//   PATCH  { action: 'password', password? } → { link } (none sent: a suggestion)
//   PATCH  { action: 'end' } → { link }
//   DELETE → { ok: true } (ended links only)
export default async function handler(req, res) {
  if (!startScreeningRoute(req, res, ['GET', 'PATCH', 'DELETE'])) return;
  const id = String(req.query.id || '');
  try {
    if (req.method === 'GET') {
      const rc = await screeningCreator(req, res, 'read');
      if (!rc) return;
      return res.status(200).json(await linkDetail(rc, id, { origin: originOf(req) }));
    }
    const rc = await screeningCreator(req, res, 'write', { max: 60, windowSeconds: 3600 });
    if (!rc) return;
    if (req.method === 'DELETE') return res.status(200).json(await discardLink(rc, id));
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const origin = originOf(req);
    if (body.action === 'update') return res.status(200).json(await updateLink(rc, id, body, { origin }));
    if (body.action === 'password') return res.status(200).json(await newLinkPassword(rc, id, body, { origin }));
    if (body.action === 'end') return res.status(200).json(await endLink(rc, id, { origin }));
    return res.status(400).json({ error: SCREENING_WORDS_SERVER.badAction, field: 'action' });
  } catch (err) {
    return sendScreeningError(res, err, 'screenings/[id]');
  }
}
