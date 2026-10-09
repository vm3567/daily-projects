// Every app file must at least parse. Catches typos (like a missing bracket) before they go live.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  ...readdirSync(join(root, 'docs')).filter((f) => f.endsWith('.js')).map((f) => join(root, 'docs', f)),
  ...readdirSync(join(root, 'docs', 'ui')).filter((f) => f.endsWith('.js')).map((f) => join(root, 'docs', 'ui', f)),
  join(root, 'tools', 'tracker.mjs'),
];

test('all app files parse', () => {
  for (const f of files) {
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }), `syntax error in ${f}`);
  }
});

test('every app file is kept for offline use (listed in sw.js)', async () => {
  const { readFileSync } = await import('node:fs');
  const sw = readFileSync(join(root, 'docs', 'sw.js'), 'utf8');
  const list = [...sw.matchAll(/'([^']+\.(?:js|css|html|png|webmanifest))'/g)].map((m) => m[1]);
  const appFiles = [
    ...readdirSync(join(root, 'docs')).filter((f) => /\.(js|css|html|webmanifest)$/.test(f) && f !== 'sw.js'),
    ...readdirSync(join(root, 'docs', 'ui')).filter((f) => f.endsWith('.js')).map((f) => 'ui/' + f),
  ];
  for (const f of appFiles) assert.ok(list.includes(f), `${f} is missing from the offline list in docs/sw.js`);
});
