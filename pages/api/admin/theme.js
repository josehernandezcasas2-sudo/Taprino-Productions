import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { getSiteSettings } from '../../../lib/siteSettings';
import { ALL_THEME_KEYS } from '../../../lib/themeColors';

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

export default async function handler(req, res) {
  const { isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  if (req.method === 'GET') {
    const settings = await getSiteSettings();
    return res.status(200).json({ overrides: settings.themeOverrides });
  }

  if (req.method === 'POST') {
    const { overrides } = req.body || {};
    if (!overrides || typeof overrides !== 'object') {
      return res.status(400).json({ error: 'overrides object is required.' });
    }

    // SECURITY: this gets injected as raw CSS text in _document.js on
    // every page load. Restricting both which keys are accepted (must be
    // a real theme variable — no arbitrary CSS custom property names) and
    // the value shape (strict 6-digit hex only) closes off any path to
    // injecting something like `red; } body { display:none` through a
    // value field and breaking out of the declaration.
    const clean = {};
    for (const [key, value] of Object.entries(overrides)) {
      if (!ALL_THEME_KEYS.includes(key)) {
        return res.status(400).json({ error: `Unknown theme variable: ${key}` });
      }
      if (value === null || value === '') continue; // omitting = reset to default
      if (!HEX_PATTERN.test(value)) {
        return res.status(400).json({ error: `${key} must be a 6-digit hex color like #c2c775.` });
      }
      clean[key] = value;
    }

    const supabase = getSupabase();
    const { error } = await supabase.from('site_settings').update({ theme_overrides: clean }).eq('id', 1);
    if (error) {
      console.error('theme save error:', error.message);
      return res.status(500).json({ error: 'Could not save theme.' });
    }
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
