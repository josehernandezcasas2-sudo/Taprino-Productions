import { getSupabase } from './supabase';

// Same "best-effort, never block the real operation" pattern as
// lib/orphanedMedia.js — a failed audit-log write shouldn't stop an
// admin's actual approve/reject/delete action from going through.
export async function recordAudit({ adminId, adminEmail, action, targetType, targetId, details }) {
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from('audit_log').insert({
      admin_id: adminId,
      admin_email: adminEmail || null,
      action,
      target_type: targetType,
      target_id: targetId ? String(targetId) : null,
      details: details || null
    });
    if (error) console.error('recordAudit error:', error.message);
  } catch (err) {
    console.error('recordAudit error:', err.message);
  }
}
