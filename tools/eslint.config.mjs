// Lint rules for the game, its tests and its tools. Run from the repository root:
//   npm run lint
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/**', '**/node_modules/**', 'tools/bot/out/**'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': ['error', { destructuring: 'all' }],
      'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-shadow': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['src/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    // The simulation runs in the browser and in Node alike: no browser object in it.
    files: ['src/sim/**/*.js', 'src/core/random.js', 'src/core/time.js'],
    languageOptions: { globals: { performance: 'readonly' } },
  },
  {
    files: ['tests/**/*.js', 'tests/**/*.mjs', 'tools/**/*.mjs', 'tools/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
