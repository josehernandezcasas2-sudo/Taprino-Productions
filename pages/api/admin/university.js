import { requireCapability } from '../../../lib/adminAuth';
import { recordAudit } from '../../../lib/auditLog';
import {
  getUniversityAdminData,
  saveTopic, deleteTopic,
  saveCourse, deleteCourse,
  saveModule, deleteModule,
  saveLesson, deleteLesson,
  saveFile, deleteFile,
  reorder
} from '../../../lib/university';

// One route for the whole Film University editor (pages/admin/university.js):
//   GET                      → departments, courses, modules, lessons, files (drafts included)
//   POST { type, ...fields } → create or update a topic / course / module / lesson / file
//   PUT  { table, ids }      → reorder (ids in their new order)
//   DELETE { type, id }      → delete
// Videos and course files don't pass through here — they go straight to
// Cloudflare / Supabase Storage via the upload-url routes beside this one,
// and only the resulting uid / URL is saved. Cover images do arrive here,
// as base64 (same as episode artwork).
export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

const SAVERS = { topic: saveTopic, course: saveCourse, module: saveModule, lesson: saveLesson, file: saveFile };
const DELETERS = { topic: deleteTopic, course: deleteCourse, module: deleteModule, lesson: deleteLesson, file: deleteFile };

export default async function handler(req, res) {
  const roleContext = await requireCapability(req, res, 'manage_university');
  if (!roleContext) return;
  const body = req.body || {};

  try {
    if (req.method === 'GET') {
      return res.status(200).json(await getUniversityAdminData());
    }

    if (req.method === 'POST') {
      const save = SAVERS[body.type];
      if (!save) return res.status(400).json({ error: 'type must be topic, course, module, lesson or file.' });
      const saved = await save(body);
      await recordAudit({
        adminId: roleContext.userId,
        adminEmail: roleContext.email,
        action: `university_save_${body.type}`,
        targetType: `uni_${body.type}`,
        targetId: saved.id,
        details: body.title || body.name || ''
      });
      return res.status(200).json({ saved });
    }

    if (req.method === 'PUT') {
      const { table, ids } = body;
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) return res.status(400).json({ error: 'ids must be a list.' });
      await reorder(table, ids);
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const { type, id } = body;
      const del = DELETERS[type];
      if (!del) return res.status(400).json({ error: 'type must be topic, course, module, lesson or file.' });
      if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id is required.' });
      await del(id);
      await recordAudit({ adminId: roleContext.userId, adminEmail: roleContext.email, action: `university_delete_${type}`, targetType: `uni_${type}`, targetId: id, details: '' });
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, PUT, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('admin/university error:', err.message);
    const missingTable = /uni_(topics|courses|modules|lessons|files|progress)/.test(err.message || '') && /not find|does not exist|schema cache/i.test(err.message || '');
    return res.status(missingTable ? 500 : 400).json({
      error: missingTable ? 'Run migrations 078 and 081 (supabase/migrations) in the Supabase SQL Editor first.' : err.message || 'Something went wrong.'
    });
  }
}
