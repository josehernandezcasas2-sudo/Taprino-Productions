// A small, correctness-only lint (2026-10-28): the rules that catch code
// which cannot work — an identifier that was never defined (a prop passed
// from getServerSideProps but not destructured took /locations/mine down
// for every host), a reassigned const, duplicate keys — and nothing about
// style. scripts/check-refs.mjs still covers missing imports and JSX tags;
// this is the identifier half it couldn't see. Run with `npm run lint`.
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import next from '@next/eslint-plugin-next';

// The two plugins are registered so the `eslint-disable` comments the
// code already carries (from Next's old lint set-up) resolve; only
// rules-of-hooks is switched on — a hook called conditionally is a bug.
const plugins = { 'react-hooks': reactHooks, '@next/next': next };

const correctness = {
  'no-undef': 'error',
  'react-hooks/rules-of-hooks': 'error',
  'no-const-assign': 'error',
  'no-dupe-args': 'error',
  'no-dupe-keys': 'error',
  'no-dupe-else-if': 'error',
  'no-duplicate-case': 'error',
  'no-func-assign': 'error',
  'no-import-assign': 'error',
  'no-self-assign': 'error',
  'no-unreachable': 'error',
  'no-unsafe-negation': 'error',
  'no-unused-private-class-members': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error',
  'constructor-super': 'error',
  'no-this-before-super': 'error',
  'no-class-assign': 'error',
  'no-obj-calls': 'error',
  'no-sparse-arrays': 'error',
  'no-unsafe-finally': 'error',
  'for-direction': 'error',
  'getter-return': 'error'
};

export default [
  {
    ignores: ['node_modules/**', '.next/**', 'out/**', 'mobile/node_modules/**', 'mobile/dist/**', 'mobile/.expo/**', 'mockups/**', 'public/**']
  },
  {
    // The web app: pages and components run in the browser and on the
    // server, lib and scripts on the server. One set of globals keeps the
    // config short; what matters is a name that exists nowhere.
    files: ['pages/**/*.js', 'components/**/*.js', 'contexts/**/*.js', 'lib/**/*.js', 'middleware.js', 'next.config.js', 'scripts/**/*.{js,mjs}'],
    plugins,
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node, ...globals.es2021 }
    },
    rules: correctness
  },
  {
    // The Expo app: React Native's runtime has the browser's timers and
    // fetch, Node's require/module through Metro, and __DEV__.
    files: ['mobile/src/**/*.js', 'mobile/*.js'],
    plugins,
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node, ...globals.es2021, __DEV__: 'readonly' }
    },
    rules: correctness
  }
];
