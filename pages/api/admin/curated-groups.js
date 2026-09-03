import { getRoleContext } from '../../../lib/roles';
import {
  getAllGroupsForScope,
  createCustomGroup,
  renameCustomGroup,
  setGroupActive,
  deleteCustomGroup,
  setCustomGroupItems,
  getCustomGroupItemIds,
  reorderGroups
} from '../../../lib/curatedGroups';
import { recordAudit } from '../../../lib/auditLog';

export default async function handler(req, res) {
  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    const { scope, itemsForGroup } = req.query;
    if (itemsForGroup) {
      const episodeIds = await getCustomGroupItemIds(itemsForGroup);
      return res.status(200).json({ episodeIds });
    }
    if (!scope) return res.status(400).json({ error: 'scope is required.' });
    const groups = await getAllGroupsForScope(scope);
    return res.status(200).json({ groups });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action } = req.body || {};

  try {
    if (action === 'create') {
      const { scope, title } = req.body;
      if (!scope || !title || !title.trim()) return res.status(400).json({ error: 'scope and title are required.' });
      const group = await createCustomGroup(scope, title.trim());
      await recordAudit({ adminId: userId, adminEmail: email, action: 'create_curated_group', targetType: 'curated_group', targetId: group.id, details: `scope=${scope}, title="${title.trim()}"` });
      return res.status(200).json({ group });
    }

    if (action === 'rename') {
      const { groupId, title } = req.body;
      if (!groupId || !title || !title.trim()) return res.status(400).json({ error: 'groupId and title are required.' });
      await renameCustomGroup(groupId, title.trim());
      await recordAudit({ adminId: userId, adminEmail: email, action: 'rename_curated_group', targetType: 'curated_group', targetId: groupId, details: `title="${title.trim()}"` });
      return res.status(200).json({ ok: true });
    }

    if (action === 'setActive') {
      const { groupId, active } = req.body;
      if (!groupId) return res.status(400).json({ error: 'groupId is required.' });
      await setGroupActive(groupId, !!active);
      await recordAudit({ adminId: userId, adminEmail: email, action: active ? 'activate_curated_group' : 'deactivate_curated_group', targetType: 'curated_group', targetId: groupId });
      return res.status(200).json({ ok: true });
    }

    if (action === 'delete') {
      const { groupId } = req.body;
      if (!groupId) return res.status(400).json({ error: 'groupId is required.' });
      await deleteCustomGroup(groupId);
      await recordAudit({ adminId: userId, adminEmail: email, action: 'delete_curated_group', targetType: 'curated_group', targetId: groupId });
      return res.status(200).json({ ok: true });
    }

    if (action === 'setItems') {
      const { groupId, episodeIds } = req.body;
      if (!groupId || !Array.isArray(episodeIds)) return res.status(400).json({ error: 'groupId and episodeIds (array) are required.' });
      await setCustomGroupItems(groupId, episodeIds);
      await recordAudit({ adminId: userId, adminEmail: email, action: 'set_curated_group_items', targetType: 'curated_group', targetId: groupId, details: `${episodeIds.length} episode(s)` });
      return res.status(200).json({ ok: true });
    }

    if (action === 'reorder') {
      const { orderedGroupIds } = req.body;
      if (!Array.isArray(orderedGroupIds) || orderedGroupIds.length === 0) return res.status(400).json({ error: 'orderedGroupIds (array) is required.' });
      await reorderGroups(orderedGroupIds);
      await recordAudit({ adminId: userId, adminEmail: email, action: 'reorder_curated_groups', targetType: 'curated_group', details: `${orderedGroupIds.length} row(s) reordered` });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err) {
    console.error('curated-groups action error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
