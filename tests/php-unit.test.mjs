// Runs the quick PHP tests (team/tests/unit.php) with npm test. Skipped when php is not installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let php = true;
try { execFileSync('which', ['php'], { stdio: 'ignore' }); } catch { php = false; }

test('PHP: server building blocks (team/tests/unit.php)', { skip: php ? false : 'php not installed' }, () => {
  let out;
  try { out = execFileSync('php', [join(ROOT, 'team', 'tests', 'unit.php')], { encoding: 'utf8' }); }
  catch (e) { assert.fail(`${e.stdout}${e.stderr}`); }
  assert.match(out, /0 failed/);
});
