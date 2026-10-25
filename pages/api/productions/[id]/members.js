import { getRoleContext } from '../../../../lib/roles';
import { addMember, setMemberWorked, removeMember, leaveProduction } from '../../../../lib/productions';
import { applyCors } from '../../../../lib/cors';

// Who's on a production.
//   POST   { userId | handle, role }        owner adds someone
//   POST   { op: 'leave' }                   the viewer takes themselves off
//   PATCH  { memberId, worked: true|false }  owner (or admin) confirms the work
//   DELETE { memberId }                      owner removes someone
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  const id = String(req.query.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(404).json({ error: 'That production isn’t here.' });
  try {
    const account = await getRoleContext(req).catch(() => ({ userId: null, isAdmin: false }));
    if (!account.userId) return res.status(401).json({ error: 'Sign in first.' });
    const body = req.body || {};
    const opts = { isAdmin: account.isAdmin };
    if (req.method === 'POST') {
      if (body.op === 'leave') return res.status(200).json(await leaveProduction(account.userId, id));
      return res.status(201).json(await addMember(account.userId, id, { userId: body.userId, handle: body.handle, role: body.role }, opts));
    }
    if (req.method === 'PATCH') return res.status(200).json(await setMemberWorked(account.userId, id, String(body.memberId || ''), body.worked !== false, opts));
    if (req.method === 'DELETE') return res.status(200).json(await removeMember(account.userId, id, String(body.memberId || ''), opts));
    res.setHeader('Allow', 'POST, PATCH, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('productions/[id]/members:', err.message);
    return res.status(500).json({ error: 'Could not change the crew list right now.' });
  }
}
