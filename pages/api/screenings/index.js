import { createLink, listForTarget, parseTargetParam, sendScreeningError } from '../../../lib/screenings';
import { originOf, screeningCreator, startScreeningRoute } from '../../../lib/screeningRoute';
import { SCREENING_WORDS_SERVER } from '../../../lib/screeningRules';

// Private screening links of a title or a show (migration 128;
// mockups/private-screenings-contract.md), for whoever runs it.
//   GET  ?target=episode:<id> | series:<id> → { target, links: [Link], suggestion }
//   POST { target: { type, id }, label, recipientEmail, scope, season, episodeIds,
//          startsAt, endsAt, password, access, named: { userIds, emails },
//          maxViews, perPerson, oneScreen, countries, notify } → 201 { link }
export default async function handler(req, res) {
  if (!startScreeningRoute(req, res, ['GET', 'POST'])) return;
  try {
    if (req.method === 'GET') {
      const rc = await screeningCreator(req, res, 'read');
      if (!rc) return;
      const target = parseTargetParam(req.query.target);
      if (!target) return res.status(400).json({ error: SCREENING_WORDS_SERVER.badTarget, field: 'target' });
      return res.status(200).json(await listForTarget(rc, target, { origin: originOf(req) }));
    }
    const rc = await screeningCreator(req, res, 'write', { max: 60, windowSeconds: 3600 });
    if (!rc) return;
    return res.status(201).json(await createLink(rc, req.body, { origin: originOf(req) }));
  } catch (err) {
    return sendScreeningError(res, err, 'screenings');
  }
}
