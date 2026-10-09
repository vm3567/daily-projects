#!/usr/bin/env node
// Command-line helper used by the Claude commands /review, /add and /today.
// Works on the local copy of the private data repository in ../data, using git and the
// Mac's existing GitHub login. Uses the SAME rules and operations as the app.
//
//   node tools/tracker.mjs pull
//   node tools/tracker.mjs summary
//   node tools/tracker.mjs list [--today]
//   node tools/tracker.mjs show <project>
//   node tools/tracker.mjs add-steps <project> "<step>" ["<step>" ...]
//   node tools/tracker.mjs tick <project> "<step text or id>"
//   node tools/tracker.mjs add-note <project> "<text>"
//   node tools/tracker.mjs new-project "<name>" [--group "<group>"] [--priority high|medium|low] [--steps "<a>" "<b>" ...]
//   node tools/tracker.mjs restore <YYYY-MM-DD>
//
// <project> is a project id, or part of its name.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyOps, makeOp, newId, emptyData } from '../docs/ops.js';
import { dotColour, nextStep, todayIndia, isOverdue, colourCounts } from '../docs/rules.js';
import { DATA_OWNER, DATA_REPO } from '../docs/config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.DP_DATA_DIR || join(ROOT, 'data'); // DP_DATA_DIR is only for tests

function git(...args) {
  return execFileSync('git', ['-C', DATA, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function ensureClone() {
  if (existsSync(join(DATA, '.git'))) return;
  execFileSync('gh', ['repo', 'clone', `${DATA_OWNER}/${DATA_REPO}`, DATA], { stdio: 'inherit' });
}

function pull() {
  ensureClone();
  git('fetch', '-q', 'origin');
  git('reset', '-q', '--hard', 'origin/main'); // the local copy never keeps its own changes
}

function readState() {
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

const ORDER = { red: 0, orange: 1, green: 2, grey: 3 };

function line(p, today) {
  const ns = nextStep(p);
  const c = dotColour(p, today);
  const bits = [
    `${c.toUpperCase().padEnd(6)} ${p.name} [${p.id}]`,
    `group: ${p.groupName}`,
    `priority: ${p.priority}`,
    p.deadline ? `target date: ${p.deadline}${isOverdue(p, today) ? ' (PASSED)' : ''}` : null,
    ns ? `next: ${ns.text}${ns.waiting ? ` (WAITING${ns.waitingOn ? ' on ' + ns.waitingOn : ''})` : ''}` : 'next: NONE',
    p.lastTickDate ? `last tick: ${p.lastTickDate}` : 'never ticked',
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
      console.log(`Up to date (${git('log', '-1', '--format=%h %s')}).`);
      break;
    }
    case 'summary': {
      pull();
      const { data } = readState();
      withGroups(data);
      const c = colourCounts(data, today);
      const active = data.projects.filter((p) => p.state === 'active');
      console.log(`Today ${today}: ${active.length} active projects — ${c.red} red, ${c.orange} orange, ${c.green} green.`);
      console.log(`Paused: ${data.projects.filter((p) => p.state === 'paused').length}. Finished: ${data.projects.filter((p) => p.state === 'finished').length}.`);
      for (const p of sorted(active, today)) console.log('  ' + line(p, today));
      break;
    }
    case 'list': {
      pull();
      const { data } = readState();
      withGroups(data);
      let list = data.projects.filter((p) => p.state === 'active');
      if (args.includes('--today')) list = list.filter((p) => dotColour(p, today) !== 'green');
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
      console.log(`State: ${p.state}`);
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
      const commit = git('rev-list', '-1', `--before=${date} 23:59:59 +0530`, 'HEAD');
      if (!commit) throw new Error(`No saved version on or before ${date}.`);
      // Bring back data.json, history and files exactly as they were (as a NEW commit; never a force-push).
      for (const path of ['data.json', 'history', 'files']) {
        try { git('rm', '-r', '-q', '--ignore-unmatch', path); } catch { /* nothing there */ }
        try { git('checkout', commit, '--', path); } catch { /* did not exist then */ }
      }
      git('add', '-A');
      try {
        git('commit', '-q', '-m', `Restore to ${date} (${commit.slice(0, 7)}) (via Claude)`);
      } catch {
        console.log('Nothing to restore: the data is already the same as on that date.');
        break;
      }
      git('push', '-q', 'origin', 'HEAD:main');
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

