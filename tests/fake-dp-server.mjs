// A pretend worktask.in server for the tracker tests (stands in for "ssh … php dp-cli.php").
// State lives in the JSON file named by FAKE_DP_STATE. FAKE_DP_TROUBLE (one word, used once) can be:
//   drop-after  — saves, then the line drops (no answer)      drop-before — the line drops, nothing saved
//   clash       — another device saves first (and the save is refused with exit code 3)
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';

const file = process.env.FAKE_DP_STATE;
const st = JSON.parse(readFileSync(file, 'utf8'));
const troubleFile = file + '.trouble';
const trouble = existsSync(troubleFile) ? readFileSync(troubleFile, 'utf8').trim() : '';
const once = () => { if (existsSync(troubleFile)) unlinkSync(troubleFile); };
const save = () => writeFileSync(file, JSON.stringify(st));

const cmd = process.argv[2];
if (cmd === 'export') {
  process.stdout.write(JSON.stringify({ head: st.head, files: st.files }));
} else if (cmd === 'commit') {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  if (trouble === 'drop-before') { once(); process.stderr.write('Connection reset by peer'); process.exit(255); }
  if (trouble === 'clash') { // another device saved a different change first
    once();
    const d = JSON.parse(st.files['data.json']);
    d.inbox = [...(d.inbox || []), { id: 'other-device', text: 'From the other device', createdAt: '2026-10-17T05:00:00.000Z' }];
    st.files['data.json'] = JSON.stringify(d);
    st.head = 'c' + (++st.n);
    save();
    process.stderr.write('Another device saved first.');
    process.exit(3);
  }
  if (input.parent !== st.head) { process.stderr.write('Another device saved first.'); process.exit(3); }
  for (const c of input.changes) {
    if ('content' in c) st.files[c.path] = c.content;
    else if (c.sha === null) delete st.files[c.path];
  }
  st.head = 'c' + (++st.n);
  st.commits = (st.commits || 0) + 1;
  save();
  if (trouble === 'drop-after') { once(); process.stderr.write('Connection reset by peer'); process.exit(255); }
  process.stdout.write(JSON.stringify({ commit: st.head, tree: 't' + st.n }));
} else {
  process.stderr.write('unknown command');
  process.exit(1);
}
