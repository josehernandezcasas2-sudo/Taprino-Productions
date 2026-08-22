-- Live-editable theme overrides for play-testing color changes without a
-- deploy. Stored as {"--olive": "#c2c775", ...} keyed exactly by the real
-- CSS custom property names in styles/globals.css :root — only variables
-- someone has actually changed are present here; anything absent falls
-- back to the stylesheet's own default. Injected as an inline <style>
-- override in pages/_document.js on every request, so a change here takes
-- effect on next page load with no deploy needed.
alter table site_settings add column if not exists theme_overrides jsonb not null default '{}';
