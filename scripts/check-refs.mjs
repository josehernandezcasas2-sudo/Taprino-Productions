// Static reference check, run before committing (`npm run check:refs`):
//   1. every named/default import from a local file must exist in that file
//   2. every capitalized JSX tag (<ChatIcon />) and every React/Expo hook used
//      in a file must be imported or defined there
// ESLint isn't set up in this repo and the dev server only compiles the
// branches it renders, so a missing import in a signed-in-only branch (the
// 2026-10-11 ChatIcon crash) reaches production otherwise. Pure text scan,
// no dependencies; VAST XML inside lib/houseAds.js is the one known false
// positive and is skipped.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['pages', 'components', 'lib', 'contexts', 'mobile/src'];
const SKIP = new Set(['lib/houseAds.js']);
const HOOKS = ['useState', 'useEffect', 'useRef', 'useCallback', 'useMemo', 'useContext', 'useReducer', 'useLayoutEffect', 'useRouter', 'useAuth', 'useUser', 'useClerk', 'useWindowDimensions', 'useFocusEffect', 'useLocalSearchParams', 'usePathname'];

const files = [];
for (const d of DIRS) {
  const dir = path.join(ROOT, d);
  if (!fs.existsSync(dir)) continue;
  (function walk(p) {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(full); }
      else if (/\.(js|jsx|mjs)$/.test(e.name)) files.push(full);
    }
  })(dir);
}
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ---- 1. imports resolve to real exports ---- */
const exportCache = new Map();
function exportsOf(file) {
  if (exportCache.has(file)) return exportCache.get(file);
  const src = fs.readFileSync(file, 'utf8');
  const names = new Set();
  let m;
  const re1 = /export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = re1.exec(src))) names.add(m[1]);
  const re2 = /export\s*\{([^}]*)\}/g;
  while ((m = re2.exec(src))) for (const part of m[1].split(',')) { const n = part.trim().split(/\s+as\s+/).pop(); if (n) names.add(n.trim()); }
  if (/export\s+default/.test(src)) names.add('default');
  const out = { names, star: /export\s+\*\s+from/.test(src) };
  exportCache.set(file, out);
  return out;
}
function resolve(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const cand of [base, `${base}.js`, `${base}.jsx`, `${base}.mjs`, path.join(base, 'index.js')]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return 'MISSING';
}

const problems = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const re = /import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const [, def, named, spec] = m;
    const target = resolve(f, spec);
    if (target === null) continue;
    if (target === 'MISSING') { problems.push(`${rel(f)}: import from '${spec}' — file not found`); continue; }
    const ex = exportsOf(target);
    if (ex.star) continue;
    if (def && !ex.names.has('default')) problems.push(`${rel(f)}: default import from '${spec}' but it has no default export`);
    if (named) for (const part of named.split(',')) {
      const n = part.trim().split(/\s+as\s+/)[0].trim();
      if (n && !ex.names.has(n)) problems.push(`${rel(f)}: '${n}' is not exported by '${spec}'`);
    }
  }
}

/* ---- 2. JSX tags and hooks are declared ---- */
for (const f of files) {
  if (SKIP.has(rel(f))) continue;
  const src = stripComments(fs.readFileSync(f, 'utf8'));
  const declared = new Set();
  let m;
  const importRe = /import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\*\s+as\s+([A-Za-z_$][\w$]*))?\s*(?:\{([^}]*)\})?\s*from/g;
  while ((m = importRe.exec(src))) {
    if (m[1]) declared.add(m[1]);
    if (m[2]) declared.add(m[2]);
    if (m[3]) for (const part of m[3].split(',')) { const n = part.trim().split(/\s+as\s+/).pop(); if (n) declared.add(n.trim()); }
  }
  const declRe = /(?:function\s+|const\s+|let\s+|var\s+|class\s+)([A-Za-z_$][\w$]*)/g;
  while ((m = declRe.exec(src))) declared.add(m[1]);
  for (const re of [/(?:const|let|var)\s*\{([^}]*)\}\s*=/g, /function\s*[A-Za-z_$]*\s*\(\s*\{([^}]*)\}/g, /\(\s*\{([^}]*)\}\s*\)\s*=>/g]) {
    while ((m = re.exec(src))) for (const part of m[1].split(',')) { const n = part.trim().split(/\s*:\s*/).pop().split(/\s*=\s*/)[0].trim(); if (n) declared.add(n); }
  }
  const tags = new Set();
  const tagRe = /<([A-Z][A-Za-z0-9_.]*)[\s/>]/g;
  while ((m = tagRe.exec(src))) tags.add(m[1].split('.')[0]);
  for (const t of tags) if (!declared.has(t)) problems.push(`${rel(f)}: <${t}> is used but never imported or defined`);
  for (const h of HOOKS) {
    if (new RegExp(`(?<![\\w$.])${h}\\s*\\(`).test(src) && !declared.has(h)) problems.push(`${rel(f)}: ${h}() used but not imported`);
  }
}

console.log(`check-refs: ${files.length} files`);
if (problems.length) {
  console.log(problems.join('\n'));
  process.exit(1);
}
console.log('ok — no missing imports, undefined JSX tags or hooks');
