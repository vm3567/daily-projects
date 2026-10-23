// A pretend worktask.in server for the tracker tests (stands in for "ssh … php dp-cli.php").
// State lives in the JSON file named by FAKE_DP_STATE. FAKE_DP_TROUBLE (one word, used once) can be:
//   drop-after  — saves, then the line drops (no answer)      drop-before — the line drops, nothing saved
//   clash       — another device saves first (and the save is refused with exit code 3)
// 'mail-body <id>' answers from st.bodies (by the Inbox item / step / project id, set by the test).
// It keeps every version (id, parent, at, tree of path → sha) and the file contents by sha, so
// 'before', 'tree' and 'cat' (used by /restore) work like dp-cli.php. "at" is India time; a test can
// set st.now to choose the time of the next save.
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';

const file = process.env.FAKE_DP_STATE;
const st = JSON.parse(readFileSync(file, 'utf8'));
const troubleFile = file + '.trouble';
const trouble = existsSync(troubleFile) ? readFileSync(troubleFile, 'utf8').trim() : '';
const once = () => { if (existsSync(troubleFile)) unlinkSync(troubleFile); };
const save = () => writeFileSync(file, JSON.stringify(st));
const fail = (msg) => { process.stderr.write(msg); process.exit(1); };
st.blobs ||= {};
const treeOf = (files) => {
  const tree = {};
  for (const [path, text] of Object.entries(files)) {
    const sha = createHash('sha1').update(text).digest('hex');
    st.blobs[sha] = text;
    tree[path] = sha;
  }
  return tree;
};
const indiaNow = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
st.log ||= [{ id: st.head, parent: null, at: st.at0 || '2026-10-01 09:00:00', tree: treeOf(st.files) }];
const newVersion = () => {
  const parent = st.head;
  st.head = 'c' + (++st.n);
  st.log.push({ id: st.head, parent, at: st.now || indiaNow(), tree: treeOf(st.files) });
  delete st.now;
};
const version = (id) => st.log.find((c) => c.id === id);

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
    newVersion();
    save();
    process.stderr.write('Another device saved first.');
    process.exit(3);
  }
  if (input.parent !== st.head) { process.stderr.write('Another device saved first.'); process.exit(3); }
  if (input.changes.length > 500) fail('Too many changes at once.'); // (as dp_commit on the real server)
  for (const c of input.changes) {
    if ('content' in c) st.files[c.path] = c.content;
    else if (c.sha === null) delete st.files[c.path];
    else if (c.sha in st.blobs) st.files[c.path] = st.blobs[c.sha]; // an older file brought back
    else fail(`Unknown file ${c.sha}`);
  }
  newVersion();
  st.commits = (st.commits || 0) + 1;
  save();
  if (trouble === 'drop-after') { once(); process.stderr.write('Connection reset by peer'); process.exit(255); }
  process.stdout.write(JSON.stringify({ commit: st.head, tree: 't' + st.n }));
} else if (cmd === 'before') {
  const date = process.argv[3] || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('Give a date like 2026-10-09.');
  let c = version(st.head); // follow the versions back from the newest
  while (c && c.at > `${date} 23:59:59`) c = c.parent ? version(c.parent) : null;
  process.stdout.write(JSON.stringify(c ? { commit: c.id, at: c.at } : null));
} else if (cmd === 'tree') {
  const c = version(process.argv[3]);
  if (!c) fail('No such version.');
  process.stdout.write(JSON.stringify(c.tree));
} else if (cmd === 'cat') {
  const c = version(process.argv[3]);
  if (!c) fail('No such version.');
  const sha = c.tree[process.argv[4]];
  if (!sha) fail('No such file in that version.');
  process.stdout.write(st.blobs[sha]);
} else if (cmd === 'mail-body') { // the newest email's words (st.bodies: id → the answer), like dp-cli.php
  const b = (st.bodies || {})[process.argv[3]];
  if (!b) fail('No email with that id in the projects.');
  process.stdout.write(JSON.stringify(b));
} else {
  process.stderr.write('unknown command');
  process.exit(1);
}
