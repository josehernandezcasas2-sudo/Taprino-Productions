// Admin → Security and AI security (2026-11-05; the rules are
// lib/securityRules.js, the live read lib/securitySwitches.js). What the
// two pages show, and the one way their switches and ticks are written.
// Full admins only: the callers check getRoleContext(req).isAdmin.
import { getSupabase } from './supabase';
import { recordAudit } from './auditLog';
import { securityAlert } from './securityAlerts';
import { listTeamAccess } from './roles';
import { SITE } from './siteConfig';
import { AI_TRAINING_AGENTS, AI_SEARCH_AGENTS } from './robotsRules';
import { getSecurityRow, forgetSecuritySwitches } from './securitySwitches';
import { googleFillOn } from './googleAds';
import {
  SWITCHES, effectiveSwitches, hasSecurityColumns, switchRefusal, switchAuditLine,
  normalizeChecklist, isChecklistKey, keyStatus, SECURITY_EVENT_ACTIONS, PROTECTION_RUNS, securityEventLine
} from './securityRules';

export class SecurityError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

function isMissingColumn(error) {
  if (!error) return false;
  const msg = String(error.message || '');
  return error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist|Could not find the '.*' column/i.test(msg);
}

// The switches as the pages draw them: each one's state, whether a
// Vercel variable is holding it, and whether its column exists yet.
function switchView(row, env) {
  const eff = effectiveSwitches(row, env);
  const ready119 = hasSecurityColumns(row);
  const hasCapture = Boolean(row) && Object.prototype.hasOwnProperty.call(row, 'screen_capture_block');
  return {
    ready119,
    privateBeta: { on: eff.doorShut, stored: eff.stored.privateBeta, forced: eff.doorForced, needsMigration: !ready119 },
    hideFromSearch: { on: eff.stored.hideFromSearch, inForce: eff.hidden, needsMigration: !ready119 },
    blockAiSearch: { on: eff.aiSearchBlocked, needsMigration: !ready119 },
    adminRequire2fa: { on: eff.twoStepRequired, stored: eff.stored.adminRequire2fa, forced: eff.twoStepForced, needsMigration: !ready119 },
    screenCaptureBlock: { on: eff.captureBlock, stored: eff.stored.screenCaptureBlock, envOff: eff.captureEnvOff, needsMigration: Boolean(row) && !hasCapture }
  };
}

function when(row) {
  return row ? { at: row.created_at || null, by: row.admin_email || null } : null;
}

async function latestAudit(actions, limit) {
  try {
    const { data, error } = await getSupabase()
      .from('audit_log')
      .select('created_at, admin_email, action, target_type, target_id, details')
      .in('action', actions)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('securityPage audit read:', err.message);
    return [];
  }
}

// Just the switches (the app's Admin tab asks for this).
export async function getSecuritySwitchView() {
  const row = await getSecurityRow({ fresh: true });
  return switchView(row, process.env);
}

export async function getSecurityPage({ userId, twoFactorEnabled }) {
  const row = await getSecurityRow({ fresh: true });
  const [team, events] = await Promise.all([
    listTeamAccess().catch((err) => { console.error('securityPage team:', err.message); return null; }),
    latestAudit(SECURITY_EVENT_ACTIONS, 6)
  ]);
  const alertSet = Boolean(String(process.env.SECURITY_ALERT_EMAIL || '').trim());
  return {
    switches: switchView(row, process.env),
    you: { userId, twoFactorEnabled: Boolean(twoFactorEnabled) },
    team: team ? team.map((t) => ({ ...t, you: t.id === userId })) : null,
    alerts: {
      to: alertSet ? process.env.SECURITY_ALERT_EMAIL : SITE.contactEmail,
      set: alertSet,
      events: events.map((e) => ({ at: e.created_at, line: securityEventLine(e) }))
    },
    // Google's video ad tag set but not an Ad Manager tag counts as unset
    // (lib/googleAds.js): said so here rather than "Set".
    keys: keyStatus(process.env).map((k) => (k.id === 'googleVideoAds' && k.set && !googleFillOn() ? { ...k, set: false, invalid: true } : k)),
    checklist: normalizeChecklist(row && row.security_checklist),
    checklistReady: Boolean(row) && Object.prototype.hasOwnProperty.call(row, 'security_checklist')
  };
}

// Creators with released work, and how many of them turned the "Not for
// AI training" seal off (user_profiles.ai_seal, migration 111).
async function sealCounts() {
  try {
    const supabase = getSupabase();
    const { data: eps, error } = await supabase.from('episodes').select('submitted_by').eq('status', 'approved').not('submitted_by', 'is', null).limit(5000);
    if (error) throw error;
    const ids = [...new Set((eps || []).map((e) => e.submitted_by).filter(Boolean))];
    if (!ids.length) return { creators: 0, off: 0 };
    const off = new Set();
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error: e2 } = await supabase.from('user_profiles').select('user_id, ai_seal').in('user_id', ids.slice(i, i + 200));
      if (e2) throw e2;
      for (const p of data || []) if (p.ai_seal === false) off.add(p.user_id);
    }
    return { creators: ids.length, off: off.size };
  } catch (err) {
    console.error('securityPage seal counts:', err.message);
    return null;
  }
}

export async function getAiSecurityPage() {
  const row = await getSecurityRow({ fresh: true });
  const [runRows, switchRows, seal] = await Promise.all([
    latestAudit(PROTECTION_RUNS.map((r) => r.action), 40),
    latestAudit(['security_switch', 'update_site_settings'], 60),
    sealCounts()
  ]);
  const runs = {};
  for (const r of PROTECTION_RUNS) runs[r.key] = when(runRows.find((x) => x.action === r.action));
  const captureRow = switchRows.find((x) => /screenCaptureBlock|screen_capture_block/.test(String(x.details || '')));
  return {
    switches: switchView(row, process.env),
    captureChanged: when(captureRow),
    crawlers: {
      training: AI_TRAINING_AGENTS.length,
      trainingSample: AI_TRAINING_AGENTS.slice(0, 4),
      answer: AI_SEARCH_AGENTS.length,
      answerSample: ['ChatGPT search', 'Perplexity', 'Claude’s search']
    },
    runs,
    seal
  };
}

// Flip one switch. Returns the fresh switch view.
export async function setSecuritySwitch({ field, value, rc }) {
  const refusal = switchRefusal(field, value, { you: { twoFactorEnabled: rc.twoFactorEnabled }, env: process.env });
  if (refusal) throw new SecurityError(refusal, 409);
  const spec = SWITCHES[field];
  const before = await getSecurityRow({ fresh: true });
  const from = effectiveSwitches(before, process.env).stored[field];
  const { error } = await getSupabase().from('site_settings').update({ [spec.column]: value }).eq('id', 1);
  if (error) {
    if (isMissingColumn(error)) throw new SecurityError(`This switch needs a database update first (migration ${spec.migration}).`, 503, { code: `migration-${spec.migration}` });
    throw error;
  }
  forgetSecuritySwitches();
  const line = switchAuditLine(field, from, value);
  await recordAudit({ adminId: rc.userId, adminEmail: rc.email || null, action: 'security_switch', targetType: 'site_settings', targetId: field, details: line });
  // Awaited: a function frozen after the response would lose the email.
  if (field === 'privateBeta' || field === 'adminRequire2fa' || field === 'hideFromSearch') {
    await securityAlert(`Security switch: ${line}`, [`Changed by ${rc.email || rc.userId} on Admin → Security.`]).catch(() => {});
  }
  return getSecuritySwitchView();
}

// Tick or untick one of the "done in other dashboards" items.
export async function setChecklistTick({ key, value, rc }) {
  if (!isChecklistKey(key)) throw new SecurityError('That isn’t on the list.');
  if (typeof value !== 'boolean') throw new SecurityError('Send ticked or not.');
  const row = await getSecurityRow({ fresh: true });
  const next = { ...normalizeChecklist(row && row.security_checklist) };
  if (value) next[key] = true; else delete next[key];
  const { error } = await getSupabase().from('site_settings').update({ security_checklist: next }).eq('id', 1);
  if (error) {
    if (isMissingColumn(error)) throw new SecurityError('The list needs a database update first (migration 119).', 503, { code: 'migration-119' });
    throw error;
  }
  forgetSecuritySwitches();
  await recordAudit({ adminId: rc.userId, adminEmail: rc.email || null, action: 'security_checklist', targetType: 'site_settings', targetId: key, details: `${key}: ${value ? 'ticked' : 'unticked'}` });
  return next;
}
