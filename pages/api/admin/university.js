import { requireCapability } from '../../../lib/adminAuth';
import { recordAudit } from '../../../lib/auditLog';
import {
  getUniversityAdminData,
  saveTopic,
  deleteTopic,
  saveLesson,
  deleteLesson,
  saveExercise,
  deleteExercise,
  reorder
} from '../../../lib/university';

// One route for the whole Film University editor (pages/admin/university.js):
//   GET                      → every topic, lesson and exercise, drafts included
//   POST { type, ...fields } → create or update a topic / lesson / exercise
//   PUT  { table, ids }      → reorder (ids in their new order)
//   DELETE { type, id }      → delete
// Videos and PDFs don't pass through here — they go straight to Cloudflare
// / Supabase Storage via the two upload-url routes beside this one, and
// only the resulting uid / URL is saved on the lesson.
export default async function handler(req, res) {
  const roleContext = await requireCapability(req, res, 'manage_university');
  if (!roleContext) return;
  const body = req.body || {};

  try {
    if (req.method === 'GET') {
      return res.status(200).json(await getUniversityAdminData());
    }

    if (req.method === 'POST') {
      const { type } = body;
      let saved;
      if (type === 'topic') saved = await saveTopic(body);
      else if (type === 'lesson') saved = await saveLesson(body);
      else if (type === 'exercise') saved = await saveExercise(body);
      else return res.status(400).json({ error: 'type must be topic, lesson or exercise.' });
      await recordAudit({
        adminId: roleContext.userId,
        adminEmail: roleContext.email,
        action: `university_save_${type}`,
        targetType: `uni_${type}`,
        targetId: saved.id,
        details: body.title || body.name || ''
      });
      return res.status(200).json({ saved });
    }

    if (req.method === 'PUT') {
      const { table, ids } = body;
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
        return res.status(400).json({ error: 'ids must be a list.' });
      }
      await reorder(table, ids);
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const { type, id } = body;
      if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id is required.' });
      if (type === 'topic') await deleteTopic(id);
      else if (type === 'lesson') await deleteLesson(id);
      else if (type === 'exercise') await deleteExercise(id);
      else return res.status(400).json({ error: 'type must be topic, lesson or exercise.' });
      await recordAudit({
        adminId: roleContext.userId,
        adminEmail: roleContext.email,
        action: `university_delete_${type}`,
        targetType: `uni_${type}`,
        targetId: id,
        details: ''
      });
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, PUT, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('admin/university error:', err.message);
    const missingTable = /uni_(topics|lessons|exercises)/.test(err.message || '') && /not find|does not exist|schema cache/i.test(err.message || '');
    return res.status(missingTable ? 500 : 400).json({
      error: missingTable ? 'Run migration 078_film_university.sql in the Supabase SQL Editor first.' : err.message || 'Something went wrong.'
    });
  }
}
