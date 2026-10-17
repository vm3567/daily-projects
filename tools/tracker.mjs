#!/usr/bin/env node
// Command-line helper used by the Claude commands /review-projects, /add, /today and /restore.
// Since the move to worktask.in it works on the Work Task server, over SSH with the Mac's
// worktask key (~/.ssh/hostinger_dp). Before the move (or in tests) it used the local copy of the
// private GitHub data repository in ../data. Uses the SAME rules and operations as the app.
//
//   node tools/tracker.mjs pull
//   node tools/tracker.mjs summary
//   node tools/tracker.mjs list [--today]
//   node tools/tracker.mjs show <project>
//   node tools/tracker.mjs add-steps <project> "<step>" ["<step>" ...]
//   node tools/tracker.mjs tick <project> "<step text or id>"
//   node tools/tracker.mjs add-note <project> "<text>"
//   node tools/tracker.mjs new-project "<name>" [--group "<group>"] [--priority high|medium|low] [--steps "<a>" "<b>" ...]
//   node tools/tracker.mjs restore <YYYY-MM-DD>          (shows that version; add --yes to restore it)
//
// <project> is a project id, or part of its name.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyOps, makeOp, newId, emptyData } from '../docs/ops.js';
import { dotColour, nextStep, todayIndia, isOverdue, colourCounts, isSnoozed, restUntil, awakeProjects } from '../docs/rules.js';
import { DATA_OWNER, DATA_REPO, MOVED_TO } from '../docs/config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.DP_DATA_DIR || join(ROOT, 'data'); // DP_DATA_DIR is only for tests

// ---- Work Task server (after the move) ----
const SERVER = !process.env.DP_DATA_DIR && (!!MOVED_TO || !!process.env.DP_SERVER_LOCAL);
const SSH = ['-i', join(process.env.HOME || '', '.ssh', 'hostinger_dp'), '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', '-p', '65002', 'u578596396@145.79.25.173'];
const CLI = 'domains/worktask.in/app/dp-cli.php';
let server = null; // { head, data, history } from the last export

function serverRun(args, input) {
  const opts = { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 };
  const quoted = args.map((a) => `'${String(a).replace(/'/g, "'\\''")}'`).join(' ');
  try {
    return process.env.DP_SERVER_LOCAL // testing on this Mac: the local copy of the server
      ? execFileSync('php', [join(ROOT, 'team', 'app', 'dp-cli.php'), ...args], opts)
      : execFileSync('ssh', [...SSH, `php ${CLI} ${quoted}`], opts);
  } catch (e) {
    if (e.status === 3) { const err = new Error('clash'); err.clash = true; throw err; }
    throw new Error((e.stderr || e.message || '').toString().trim() || 'The server did not answer.');
  }
}

function serverPull() {
  const out = JSON.parse(serverRun(['export']));
  const history = {};
  for (const [path, text] of Object.entries(out.files)) {
    const m = /^history\/(\d{4}-\d{2})\.json$/.exec(path);
    if (m) history[m[1]] = JSON.parse(text);
  }
  // a data.json that is there but empty or broken must stop here (JSON.parse throws), never become "no projects"
  server = { head: out.head, data: 'data.json' in out.files ? JSON.parse(out.files['data.json']) : emptyData(), history };
}

function git(...args) {
  return execFileSync('git', ['-C', DATA, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function ensureClone() {
  if (existsSync(join(DATA, '.git'))) return;
  execFileSync('gh', ['repo', 'clone', `${DATA_OWNER}/${DATA_REPO}`, DATA], { stdio: 'inherit' });
}

function pull() {
  if (SERVER) { serverPull(); return; }
  ensureClone();
  git('fetch', '-q', 'origin');
  git('reset', '-q', '--hard', 'origin/main'); // the local copy never keeps its own changes
}

function readState() {
  if (SERVER) return JSON.parse(JSON.stringify({ data: server.data, history: server.history }));
  const dataFile = join(DATA, 'data.json');
  const data = existsSync(dataFile) ? JSON.parse(readFileSync(dataFile, 'utf8')) : emptyData();
  const history = {};
  const hdir = join(DATA, 'history');
  if (existsSync(hdir)) {
    for (const f of readdirSync(hdir)) {
      const m = /^(\d{4}-\d{2})\.json$/.exec(f);
      if (m) history[m[1]] = JSON.parse(readFileSync(join(hdir, f), 'utf8'));
    }
  }
  return { data, history };
}

function writeState(before, state) {
  writeFileSync(join(DATA, 'data.json'), JSON.stringify(state.data, null, 1) + '\n');
  mkdirSync(join(DATA, 'history'), { recursive: true });
  for (const [m, list] of Object.entries(state.history)) {
    if (JSON.stringify(before.history[m] || []) !== JSON.stringify(list)) {
      writeFileSync(join(DATA, 'history', `${m}.json`), JSON.stringify(list, null, 1) + '\n');
    }
  }
}

/** Apply operations and push. On a refused push: get the latest, replay, push again. */
function commitOps(buildOps, message) {
  for (let attempt = 0; attempt < 3; attempt++) {
    pull();
    const state = readState();
    const before = JSON.parse(JSON.stringify(state));
    const ops = buildOps(state);
    const applied = applyOps(state, ops);
    if (!applied.length) { console.log('Nothing changed.'); return state; }
    if (SERVER) {
      const changes = [{ path: 'data.json', content: JSON.stringify(state.data, null, 1) + '\n' }];
      for (const [m, list] of Object.entries(state.history)) {
        if (JSON.stringify(before.history[m] || []) !== JSON.stringify(list)) changes.push({ path: `history/${m}.json`, content: JSON.stringify(list, null, 1) + '\n' });
      }
      try {
        serverRun(['commit'], JSON.stringify({ parent: server.head, changes, message: `${message} (via Claude)` }));
        console.log(`Saved to worktask.in: ${message}`);
        return state;
      } catch (e) {
        if (!e.clash) throw e;
        continue; // another device saved first: get the latest, replay
      }
    }
    writeState(before, state);
    git('add', '-A');
    git('commit', '-q', '-m', `${message} (via Claude)`);
    try {
      git('push', '-q', 'origin', 'HEAD:main');
      console.log(`Saved to GitHub: ${message}`);
      return state;
    } catch {
      // another device saved first: loop = fetch, reset, replay
    }
  }
  throw new Error('Could not save after 3 tries. Try again in a minute.');
}

/** /restore on the server: the version from that day comes back as a NEW version (today's AI keys are kept). */
function serverRestore(date, yes) {
  const v = JSON.parse(serverRun(['before', date]));
  if (!v) throw new Error(`No saved version on or before ${date}.`);
  const old = JSON.parse(serverRun(['cat', v.commit, 'data.json']));
  if (!yes) {
    console.log(`Version from ${date} (${v.commit.slice(0, 7)}, saved ${v.at}):`);
    console.log(`  ${old.projects.length} projects: ${old.projects.map((p) => p.name).slice(0, 12).join(', ')}${old.projects.length > 12 ? ' …' : ''}`);
    console.log('Nothing changed yet. To restore, run the same command with --yes');
    return;
  }
  const oldTree = JSON.parse(serverRun(['tree', v.commit]));
  const nowTree = JSON.parse(serverRun(['tree', server.head]));
  const ours = (p) => p === 'data.json' || p.startsWith('history/') || p.startsWith('files/');
  const changes = [];
  for (const p of Object.keys(nowTree)) if (ours(p) && !(p in oldTree)) changes.push({ path: p, sha: null });
  for (const [p, sha] of Object.entries(oldTree)) if (ours(p) && p !== 'data.json' && nowTree[p] !== sha) changes.push({ path: p, sha });
  if (server.data.secrets) old.secrets = server.data.secrets; else delete old.secrets;
  changes.push({ path: 'data.json', content: JSON.stringify(old, null, 1) + '\n' });
  try {
    serverRun(['commit'], JSON.stringify({ parent: server.head, changes, message: `Restore to ${date} (${v.commit.slice(0, 7)}) (via Claude)` }));
  } catch (e) {
    if (e.clash) throw new Error('Another device saved just now. Run the restore again in a moment.');
    throw e;
  }
  console.log(`Restored to the version from ${date} (${v.commit.slice(0, 7)}). Saved as a new version.`);
}

function findProject(data, query) {
  if (!query) throw new Error('Say which project (id or part of its name).');
  const q = query.toLowerCase();
  const exact = data.projects.find((p) => p.id === query || p.name.toLowerCase() === q);
  if (exact) return exact;
  const hits = data.projects.filter((p) => p.name.toLowerCase().includes(q));
  if (hits.length === 1) return hits[0];
  if (!hits.length) throw new Error(`No project matches "${query}".`);
  throw new Error(`Several projects match "${query}": ${hits.map((p) => `${p.name} [${p.id}]`).join(', ')}`);
}

const ORDER = { red: 0, yellow: 1, green: 2, grey: 3 };

function line(p, today) {
  const ns = nextStep(p);
  const c = dotColour(p, today);
  const bits = [
    `${(isSnoozed(p, today) ? 'SNOOZE' : c.toUpperCase()).padEnd(6)} ${p.name} [${p.id}]`,
    isSnoozed(p, today) ? `snoozed until ${restUntil(p, today)}` : null,
    p.status ? `status: ${p.status}` : null,
    `group: ${p.groupName}`,
    `priority: ${p.priority}`,
    p.deadline ? `target date: ${p.deadline}${isOverdue(p, today) ? ' (PASSED)' : ''}` : null,
    ns ? `next: ${ns.text}${ns.waiting ? ` (WAITING${ns.waitingOn ? ' on ' + ns.waitingOn : ''})` : ''}` : 'next: NONE',
    (p.lastActivityDate || p.lastTickDate) ? `last activity: ${p.lastActivityDate || p.lastTickDate}` : 'no activity yet',
  ];
  return bits.filter(Boolean).join(' | ');
}

function withGroups(data) {
  for (const p of data.projects) p.groupName = (data.groups.find((g) => g.id === p.groupId) || {}).name || '';
  return data;
}

function sorted(projects, today) {
  return [...projects].sort((a, b) => ORDER[dotColour(a, today)] - ORDER[dotColour(b, today)]);
}

function argValue(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

const [cmd, ...args] = process.argv.slice(2);
const today = todayIndia();

try {
  switch (cmd) {
    case 'pull': {
      pull();
      console.log(SERVER ? `Up to date (version ${server.head.slice(0, 7)}).` : `Up to date (${git('log', '-1', '--format=%h %s')}).`);
      break;
    }
    case 'summary': {
      pull();
      const { data } = readState();
      withGroups(data);
      const c = colourCounts(data, today);
      const active = data.projects.filter((p) => p.state === 'active');
      const awake = awakeProjects(data, today);
      const snoozed = active.length - awake.length;
      console.log(`Today ${today}: ${awake.length} active projects — ${c.red} red (not looked at), ${c.yellow} yellow (opened), ${c.green} green (done for today).${snoozed ? ` ${snoozed} snoozed.` : ''}`);
      console.log(`Paused: ${data.projects.filter((p) => p.state === 'paused').length}. Finished: ${data.projects.filter((p) => p.state === 'finished').length}.`);
      if ((data.inbox || []).length) console.log(`Inbox: ${data.inbox.length} item(s) to sort — ${data.inbox.map((x) => x.text).join(' · ')}`);
      for (const p of sorted(active, today)) console.log('  ' + line(p, today));
      break;
    }
    case 'list': {
      pull();
      const { data } = readState();
      withGroups(data);
      let list = data.projects.filter((p) => p.state === 'active');
      if (args.includes('--today')) list = list.filter((p) => ['red', 'yellow'].includes(dotColour(p, today))); // not green, not snoozed
      if (!list.length) console.log(args.includes('--today') ? 'All active projects are green today.' : 'No active projects.');
      for (const p of sorted(list, today)) console.log(line(p, today));
      break;
    }
    case 'show': {
      pull();
      const { data, history } = readState();
      withGroups(data);
      const p = findProject(data, args.join(' '));
      console.log(line(p, today));
      console.log(`State: ${p.state}${isSnoozed(p, today) ? ` (snoozed until ${restUntil(p, today)})` : ''}`);
      if (p.status) console.log(`Status: ${p.status}`);
      if (p.notes) console.log(`Notes: ${p.notes}`);
      console.log('Open steps:');
      for (const s of p.steps.filter((x) => !x.done)) {
        console.log(`  [ ] ${s.text} [${s.id}]${s.waiting ? ` (waiting${s.waitingOn ? ' on ' + s.waitingOn : ''})` : ''}${s.dueDate ? ` (due ${s.dueDate})` : ''}${s.note ? ` — note: ${s.note}` : ''}`);
      }
      const done = p.steps.filter((x) => x.done).slice(-5);
      if (done.length) console.log('Recently done:\n' + done.map((s) => `  [x] ${s.text} (${s.doneAt.slice(0, 10)})`).join('\n'));
      if (p.workNotes.length) console.log('Work notes:\n' + p.workNotes.slice(0, 5).map((n) => `  ${n.createdAt.slice(0, 10)}: ${n.text}`).join('\n'));
      if (p.links.length) console.log('Links:\n' + p.links.map((l) => `  ${l.title}: ${l.url}`).join('\n'));
      if (p.files.length) console.log('Files: ' + p.files.map((f) => f.name).join(', '));
      const events = Object.values(history).flat().filter((e) => e.projectId === p.id).slice(-8);
      if (events.length) console.log('Recent history:\n' + events.map((e) => `  ${e.at.slice(0, 10)} ${e.kind}: ${e.detail}`).join('\n'));
      break;
    }
    case 'add-steps': {
      const [query, ...steps] = args;
      if (!steps.length) throw new Error('Give at least one step.');
      commitOps((state) => {
        const p = findProject(state.data, query);
        return steps.map((text) => makeOp('addStep', { projectId: p.id, stepId: newId(), text }));
      }, `Add ${steps.length} step(s)`);
      break;
    }
    case 'tick': {
      const [query, stepQuery] = args;
      commitOps((state) => {
        const p = findProject(state.data, query);
        const q = String(stepQuery || '').toLowerCase();
        const s = p.steps.find((x) => !x.done && (x.id === stepQuery || x.text.toLowerCase().includes(q)));
        if (!s) throw new Error(`No open step matches "${stepQuery}" in ${p.name}.`);
        return [makeOp('tickStep', { projectId: p.id, stepId: s.id })];
      }, 'Tick step');
      break;
    }
    case 'add-note': {
      const [query, ...words] = args;
      const text = words.join(' ').trim();
      if (!text) throw new Error('Give the note text.');
      commitOps((state) => {
        const p = findProject(state.data, query);
        return [makeOp('addWorkNote', { projectId: p.id, noteId: newId(), text })];
      }, 'Work note');
      break;
    }
    case 'new-project': {
      const name = args[0];
      if (!name || name.startsWith('--')) throw new Error('Give the project name first.');
      const groupName = argValue(args, '--group');
      const priority = argValue(args, '--priority');
      const si = args.indexOf('--steps');
      const steps = si >= 0 ? args.slice(si + 1).filter((s) => !s.startsWith('--')) : [];
      commitOps((state) => {
        const g = groupName
          ? state.data.groups.find((x) => x.name.toLowerCase() === groupName.toLowerCase())
          : state.data.groups[0];
        if (!g) throw new Error(`No group called "${groupName}". Groups: ${state.data.groups.map((x) => x.name).join(', ')}`);
        const projectId = newId();
        const ops = [makeOp('createProject', { projectId, name, groupId: g.id, priority })];
        for (const text of steps) ops.push(makeOp('addStep', { projectId, stepId: newId(), text }));
        return ops;
      }, `New project: ${name}`);
      break;
    }
    case 'restore': {
      const date = args[0];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('Give a date like 2026-10-09.');
      pull();
      if (SERVER) { serverRestore(date, args.includes('--yes')); break; }
      const commit = git('rev-list', '-1', `--before=${date} 23:59:59 +0530`, 'HEAD');
      if (!commit) throw new Error(`No saved version on or before ${date}.`);
      if (!args.includes('--yes')) {
        // Show what would come back, and change nothing (the Claude skill asks "yes?" first).
        const old = JSON.parse(git('show', `${commit}:data.json`));
        console.log(`Version from ${date} (${commit.slice(0, 7)}, ${git('log', '-1', '--format=%cd', '--date=format:%d %b %H:%M', commit)}):`);
        console.log(`  ${old.projects.length} projects: ${old.projects.map((p) => p.name).slice(0, 12).join(', ')}${old.projects.length > 12 ? ' …' : ''}`);
        console.log('Nothing changed yet. To restore, run the same command with --yes');
        break;
      }
      const currentSecrets = readState().data.secrets || null;
      // Bring back data.json, history and files exactly as they were (as a NEW commit; never a force-push).
      for (const path of ['data.json', 'history', 'files']) {
        try { git('rm', '-r', '-q', '--ignore-unmatch', path); } catch { /* nothing there */ }
        try { git('checkout', commit, '--', path); } catch { /* did not exist then */ }
      }
      // Keep TODAY's AI keys: a restore must not bring back old keys or remove new ones.
      const restored = JSON.parse(readFileSync(join(DATA, 'data.json'), 'utf8'));
      if (currentSecrets) restored.secrets = currentSecrets; else delete restored.secrets;
      writeFileSync(join(DATA, 'data.json'), JSON.stringify(restored, null, 1) + '\n');
      git('add', '-A');
      try {
        git('commit', '-q', '-m', `Restore to ${date} (${commit.slice(0, 7)}) (via Claude)`);
      } catch {
        console.log('Nothing to restore: the data is already the same as on that date.');
        break;
      }
      try {
        git('push', '-q', 'origin', 'HEAD:main');
      } catch {
        throw new Error('Another device saved just now. Run the restore again in a moment.');
      }
      console.log(`Restored to the version from ${date} (${commit.slice(0, 7)}). Saved as a new version.`);
      break;
    }
    default:
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 17).join('\n').replace(/^\/\/ ?/gm, ''));
  }
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}

