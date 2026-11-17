// Sets the password of the developer mode: its SHA-256 goes into data/dev.json (the password
// itself is written nowhere). Spaces around it and capitals do not count.
//
//   node tools/dev-password.mjs "nouveau mot de passe"
//
// Then rebuild the single file (cd tools && node build-page.mjs).

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const password = process.argv[2];
if (!password || !password.trim()) {
  console.error('Usage : node tools/dev-password.mjs "mot de passe"');
  process.exit(1);
}
const path = fileURLToPath(new URL('../data/dev.json', import.meta.url));
const dev = JSON.parse(readFileSync(path, 'utf8'));
dev.passwordSha256 = createHash('sha256').update(password.trim().toLowerCase(), 'utf8').digest('hex');
writeFileSync(path, `${JSON.stringify(dev, null, 2)}\n`);
console.log('Mot de passe du mode développeur changé dans data/dev.json. Reconstruisez dist/index.html.');
