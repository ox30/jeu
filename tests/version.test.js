// One version number: the page, the saves and the package tell the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VERSION } from '../src/core/version.js';

const root = new URL('..', import.meta.url);

test('the version of the game is that of the package, and the README tells it', () => {
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  assert.equal(VERSION, pkg.version);
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
  const readme = readFileSync(new URL('README.md', root), 'utf8');
  assert.ok(readme.includes(`Version ${VERSION}`), `README.md tells version ${VERSION}`);
});
