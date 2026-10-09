// Operations: every change to the tracker is one small operation.
// The same code runs in the browser (docs/store.js) and on the Mac (tools/tracker.mjs),
// so both apply changes the same way. See PLAN.md section 25 "Saving: operation queue".
//
// A "state" is { data, history } where
//   data    = the contents of data.json
//   history = { 'YYYY-MM': [events] } for the months that are loaded.
//
// applyOp(state, op) changes the state in place and returns true, or returns false
// when the operation must be skipped (for example, its item no longer exists).

import { indiaDate, monthOf, laterDate, addDays } from './rules.js';
import { AI_DAILY_LIMIT, BRIEF_CLAIM_MINUTES } from './config.js';

export const START_GROUPS = ['AI', 'Ceramic', 'General', 'Work / Office'];
export const PRIORITIES = ['high', 'medium', 'low'];
export const DEFAULT_TARGET_DAYS = 30; // new projects get a target date 30 days ahead
const PROJECT_FIELDS = ['name', 'groupId', 'priority', 'deadline', 'notes'];
const STEP_FIELDS = ['text', 'dueDate', 'note', 'waiting', 'waitingOn'];

export function newId() {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => (b % 36).toString(36)).join('');
}

export function makeOp(type, args = {}, at = new Date().toISOString()) {
  return { id: newId(), type, at, args };
}

export function emptyData() {
  return {
    version: 1,
    groups: START_GROUPS.map((name, i) => ({ id: 'g' + (i + 1), name })),
    projects: [],
    settings: { aiProvider: 'claude' },
    aiUsage: { date: null, count: 0 },
    aiBriefs: { morning: null, weekly: null },
  };
}

/** Months an operation will write a history event into. */
export function opMonth(op) {
  return monthOf(indiaDate(op.at));
}

/** Safe file name: letters, numbers, dot, dash, underscore only. */
export function safeFileName(name) {
  const cleaned = String(name || 'file').normalize('NFKD').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_');
  return cleaned.slice(-80) || 'file';
}

export function filePath(projectId, fileId, name) {
  return `files/${projectId}/${fileId}-${safeFileName(name)}`;
}

function findProject(data, id) {
  return data.projects.find((p) => p.id === id);
}

function cleanText(v, max = 5000) {
  return String(v ?? '').slice(0, max);
}

function cleanDate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/** Only http and https links are allowed. Returns null if not allowed. */
export function cleanUrl(v) {
  try {
    const u = new URL(String(v).trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/** Move item `id` in `list` to just after `afterId`, or just before `beforeId`, or to the start. */
function moveInList(list, id, afterId, beforeId) {
  const from = list.findIndex((x) => x.id === id);
  if (from < 0) return false;
  const [item] = list.splice(from, 1);
  let to = 0;
  if (afterId) {
    const i = list.findIndex((x) => x.id === afterId);
    to = i < 0 ? list.length : i + 1;
  } else if (beforeId) {
    const i = list.findIndex((x) => x.id === beforeId);
    to = i < 0 ? 0 : i;
  }
  list.splice(to, 0, item);
  return true;
}

function addEvent(state, op, project, kind, detail = '') {
  const month = opMonth(op);
  if (!state.history[month]) state.history[month] = [];
  const list = state.history[month];
  if (list.some((e) => e.id === op.id)) return; // never doubled on replay
  list.push({
    id: op.id,
    projectId: project ? project.id : null,
    projectName: project ? project.name : null,
    kind,
    detail: cleanText(detail, 2000),
    at: op.at,
  });
}

function touch(project, op) {
  project.updatedAt = op.at;
}

function recalcLastTick(project) {
  let last = null;
  for (const s of project.steps) if (s.done && s.doneAt) last = laterDate(last, indiaDate(s.doneAt));
  project.lastTickDate = last;
}

const handlers = {
  // ---------- Projects ----------
  createProject(state, op, a) {
    const { data } = state;
    if (findProject(data, a.projectId)) return false;
    const groupId = data.groups.some((g) => g.id === a.groupId) ? a.groupId : data.groups[0]?.id;
    const project = {
      id: a.projectId,
      groupId,
      name: cleanText(a.name, 200) || 'New project',
      priority: PRIORITIES.includes(a.priority) ? a.priority : 'medium',
      deadline: a.deadline === undefined ? addDays(indiaDate(op.at), DEFAULT_TARGET_DAYS) : cleanDate(a.deadline),
      notes: '',
      links: [],
      state: 'active',
      lastTickDate: null,
      activeSince: indiaDate(op.at),
      stateChangedAt: op.at,
      createdAt: op.at,
      updatedAt: op.at,
      steps: [],
      workNotes: [],
      files: [],
    };
    data.projects.unshift(project); // new projects go to the top
    addEvent(state, op, project, 'created', project.name);
    return true;
  },

  setProjectField(state, op, a) {
    const p = findProject(state.data, a.projectId);
    if (!p || !PROJECT_FIELDS.includes(a.field)) return false;
    let value = a.value;
    if (a.field === 'name') value = cleanText(value, 200).trim() || p.name;
    if (a.field === 'notes') value = cleanText(value, 50000);
    if (a.field === 'priority' && !PRIORITIES.includes(value)) return false;
    if (a.field === 'deadline') value = cleanDate(value);
    if (a.field === 'groupId' && !state.data.groups.some((g) => g.id === value)) return false;
    if (p[a.field] === value) return false;
    const old = p[a.field];
    p[a.field] = value;
    touch(p, op);
    if (a.field === 'name') addEvent(state, op, p, 'renamed', `${old} → ${value}`);
    else if (a.field === 'groupId') {
      const g = state.data.groups.find((x) => x.id === value);
      addEvent(state, op, p, 'group_changed', g ? g.name : '');
    } else if (a.field === 'priority') addEvent(state, op, p, 'edited', `Priority: ${value}`);
    else if (a.field === 'deadline') addEvent(state, op, p, 'edited', value ? `Target date: ${value}` : 'Target date removed');
    // notes: no history event (it would add a line for every few words typed)
    return true;
  },

  addLink(state, op, a) {
    const p = findProject(state.data, a.projectId);
    const url = cleanUrl(a.url);
    if (!p || !url || p.links.some((l) => l.id === a.linkId)) return false;
    const title = cleanText(a.title, 200).trim() || url;
    p.links.push({ id: a.linkId, title, url });
    touch(p, op);
    addEvent(state, op, p, 'edited', `Link added: ${title}`);
    return true;
  },

  editLink(state, op, a) {
    const p = findProject(state.data, a.projectId);
    const link = p && p.links.find((l) => l.id === a.linkId);
    const url = cleanUrl(a.url);
    if (!link || !url) return false;
    link.url = url;
    link.title = cleanText(a.title, 200).trim() || url;
    touch(p, op);
    addEvent(state, op, p, 'edited', `Link changed: ${link.title}`);
    return true;
  },

  removeLink(state, op, a) {
    const p = findProject(state.data, a.projectId);
    const i = p ? p.links.findIndex((l) => l.id === a.linkId) : -1;
    if (i < 0) return false;
    const [link] = p.links.splice(i, 1);
    touch(p, op);
    addEvent(state, op, p, 'edited', `Link removed: ${link.title}`);
    return true;
  },

  moveProject(state, op, a) {
    return moveInList(state.data.projects, a.projectId, a.afterId, a.beforeId);
  },

  pause(state, op, a) { return setState(state, op, a, 'active', 'paused', 'paused'); },
  unpause(state, op, a) { return setState(state, op, a, 'paused', 'active', 'unpaused'); },
  finish(state, op, a) {
    const p = findProject(state.data, a.projectId);
    if (!p || p.state === 'finished') return false;
    return setState(state, op, a, p.state, 'finished', 'finished');
  },
  reopen(state, op, a) { return setState(state, op, a, 'finished', 'active', 'reopened'); },

  deleteProject(state, op, a) {
    const { data } = state;
    const i = data.projects.findIndex((p) => p.id === a.projectId);
    if (i < 0) return false;
    const [p] = data.projects.splice(i, 1);
    addEvent(state, op, p, 'deleted', p.name);
    return true;
  },

  // ---------- Steps ----------
  addStep(state, op, a) {
    const p = findProject(state.data, a.projectId);
    if (!p || p.steps.some((s) => s.id === a.stepId)) return false;
    const text = cleanText(a.text, 1000).trim();
    if (!text) return false;
    const step = {
      id: a.stepId, text, done: false, doneAt: null,
      dueDate: cleanDate(a.dueDate), note: '', waiting: false, waitingOn: '',
      createdAt: op.at, updatedAt: op.at,
    };
    // New steps go after the last unfinished step (above the Done section).
    let at = p.steps.length;
    for (let i = p.steps.length - 1; i >= 0; i--) if (!p.steps[i].done) { at = i + 1; break; }
    if (!p.steps.some((s) => !s.done)) at = 0;
    p.steps.splice(at, 0, step);
    touch(p, op);
    addEvent(state, op, p, 'step_added', text);
    return true;
  },

  setStepField(state, op, a) {
    const p = findProject(state.data, a.projectId);
    const s = p && p.steps.find((x) => x.id === a.stepId);
    if (!s || !STEP_FIELDS.includes(a.field)) return false;
    let value = a.value;
    if (a.field === 'text') value = cleanText(value, 1000).trim() || s.text;
    if (a.field === 'note') value = cleanText(value, 5000);
    if (a.field === 'waitingOn') value = cleanText(value, 200);
    if (a.field === 'waiting') value = !!value;
    if (a.field === 'dueDate') value = cleanDate(value);
    if (s[a.field] === value) return false;
    const old = s[a.field];
    s[a.field] = value;
    s.updatedAt = op.at;
    touch(p, op);
    if (a.field === 'text') addEvent(state, op, p, 'step_edited', `${old} → ${value}`);
    return true;
  },

  tickStep(state, op, a) {
    const p = findProject(state.data, a.projectId);
    const s = p && p.steps.find((x) => x.id === a.stepId);
    if (!s || s.done) return false;
    s.done = true;
    s.doneAt = op.at;
    s.updatedAt = op.at;
    p.lastTickDate = laterDate(p.lastTickDate, indiaDate(op.at));
    touch(p, op);
    addEvent(state, op, p, 'step_ticked', s.text);
    return true;
  },

  untickStep(state, op, a) {
    const p = findProject(state.data, a.projectId);
    const s = p && p.steps.find((x) => x.id === a.stepId);
    if (!s || !s.done) return false;
    s.done = false;
    s.doneAt = null;
    s.updatedAt = op.at;
    recalcLastTick(p);
    touch(p, op);
    addEvent(state, op, p, 'step_unticked', s.text);
    return true;
  },

  deleteStep(state, op, a) {
    const p = findProject(state.data, a.projectId);
    const i = p ? p.steps.findIndex((x) => x.id === a.stepId) : -1;
    if (i < 0) return false;
    const [s] = p.steps.splice(i, 1);
    touch(p, op); // lastTickDate stays as it is (PLAN.md section 5)
    addEvent(state, op, p, 'step_deleted', s.text);
    return true;
  },

  moveStep(state, op, a) {
    const p = findProject(state.data, a.projectId);
    if (!p) return false;
    return moveInList(p.steps, a.stepId, a.afterId, a.beforeId);
  },

  // ---------- Work notes ----------
  addWorkNote(state, op, a) {
    const p = findProject(state.data, a.projectId);
    const text = cleanText(a.text, 5000).trim();
    if (!p || !text || p.workNotes.some((n) => n.id === a.noteId)) return false;
    p.workNotes.unshift({ id: a.noteId, text, createdAt: op.at, updatedAt: op.at });
    touch(p, op);
    addEvent(state, op, p, 'note_added', text);
    return true;
  },

  editWorkNote(state, op, a) {
    const p = findProject(state.data, a.projectId);
    const n = p && p.workNotes.find((x) => x.id === a.noteId);
    const text = cleanText(a.text, 5000).trim();
    if (!n || !text || n.text === text) return false;
    n.text = text;
    n.updatedAt = op.at;
    touch(p, op);
    addEvent(state, op, p, 'note_edited', text);
    return true;
  },

  deleteWorkNote(state, op, a) {
    const p = findProject(state.data, a.projectId);
    const i = p ? p.workNotes.findIndex((x) => x.id === a.noteId) : -1;
    if (i < 0) return false;
    const [n] = p.workNotes.splice(i, 1);
    touch(p, op);
    addEvent(state, op, p, 'note_deleted', n.text);
    return true;
  },

  // ---------- Files ----------
  addFile(state, op, a) {
    const p = findProject(state.data, a.projectId);
    if (!p || !a.sha || p.files.some((f) => f.id === a.fileId)) return false;
    const name = cleanText(a.name, 200) || 'file';
    p.files.push({
      id: a.fileId, name, path: filePath(p.id, a.fileId, name), sha: a.sha,
      size: Number(a.size) || 0, type: cleanText(a.type, 100), createdAt: op.at,
    });
    touch(p, op);
    addEvent(state, op, p, 'file_added', name);
    return true;
  },

  removeFile(state, op, a) {
    const p = findProject(state.data, a.projectId);
    const i = p ? p.files.findIndex((f) => f.id === a.fileId) : -1;
    if (i < 0) return false;
    const [f] = p.files.splice(i, 1);
    touch(p, op);
    addEvent(state, op, p, 'file_removed', f.name);
    return true;
  },

  // ---------- Groups ----------
  addGroup(state, op, a) {
    const name = cleanText(a.name, 100).trim();
    if (!name || state.data.groups.some((g) => g.id === a.groupId)) return false;
    state.data.groups.push({ id: a.groupId, name });
    addEvent(state, op, null, 'group_added', name);
    return true;
  },

  renameGroup(state, op, a) {
    const g = state.data.groups.find((x) => x.id === a.groupId);
    const name = cleanText(a.name, 100).trim();
    if (!g || !name || g.name === name) return false;
    const old = g.name;
    g.name = name;
    addEvent(state, op, null, 'group_renamed', `${old} → ${name}`);
    return true;
  },

  deleteGroup(state, op, a) {
    const { data } = state;
    const i = data.groups.findIndex((g) => g.id === a.groupId);
    if (i < 0 || data.groups.length <= 1) return false;
    if (data.projects.some((p) => p.groupId === a.groupId)) return false;
    const [g] = data.groups.splice(i, 1);
    addEvent(state, op, null, 'group_deleted', g.name);
    return true;
  },

  // ---------- Settings and AI ----------
  setAiProvider(state, op, a) {
    if (a.provider !== 'claude' && a.provider !== 'gemini') return false;
    state.data.settings.aiProvider = a.provider;
    return true;
  },

  incrementAiUsage(state, op) {
    const u = state.data.aiUsage;
    const day = indiaDate(op.at);
    if (u.date !== day) { u.date = day; u.count = 0; }
    if (u.count >= AI_DAILY_LIMIT) return false;
    u.count++;
    return true;
  },

  claimBrief(state, op, a) {
    if (a.kind !== 'morning' && a.kind !== 'weekly') return false;
    const b = state.data.aiBriefs[a.kind];
    if (b && b.date === a.date) {
      if (b.status === 'ready' && !a.force) return false; // force = "↻ Make again"
      const ageMin = (Date.parse(op.at) - Date.parse(b.claimedAt)) / 60000;
      if (b.status === 'pending' && ageMin < BRIEF_CLAIM_MINUTES) return false;
    }
    state.data.aiBriefs[a.kind] = { date: a.date, status: 'pending', claimId: op.id, claimedAt: op.at, content: null };
    return true;
  },

  setBriefReady(state, op, a) {
    if (a.kind !== 'morning' && a.kind !== 'weekly') return false;
    const b = state.data.aiBriefs[a.kind];
    if (!b || b.date !== a.date) return false;
    state.data.aiBriefs[a.kind] = { ...b, status: 'ready', content: a.content, readyAt: op.at };
    return true;
  },
};

function setState(state, op, a, from, to, kind) {
  const p = findProject(state.data, a.projectId);
  if (!p || p.state !== from) return false;
  p.state = to;
  p.stateChangedAt = op.at;
  if (to === 'active') p.activeSince = indiaDate(op.at);
  touch(p, op);
  addEvent(state, op, p, kind, p.name);
  return true;
}

export const OP_TYPES = Object.keys(handlers);

export function applyOp(state, op) {
  const h = handlers[op.type];
  if (!h) return false;
  return h(state, op, op.args || {});
}

export function applyOps(state, ops) {
  const applied = [];
  for (const op of ops) if (applyOp(state, op)) applied.push(op);
  return applied;
}

/** Short commit message for a list of operations. */
export function commitMessage(ops, data) {
  if (ops.length !== 1) return `${ops.length} changes`;
  const op = ops[0];
  const a = op.args || {};
  const p = a.projectId && data.projects.find((x) => x.id === a.projectId);
  const name = p ? p.name : '';
  const step = p && a.stepId && p.steps.find((s) => s.id === a.stepId);
  const words = {
    createProject: `New project: ${a.name || ''}`,
    tickStep: `Tick step: ${step ? step.text : ''}`,
    addStep: `Add step: ${a.text || ''}`,
    addWorkNote: `Work note: ${name}`,
  };
  return (words[op.type] || `${op.type}${name ? ': ' + name : ''}`).slice(0, 120);
}

/** A deep copy that works in browsers and Node. */
export function clone(x) {
  return JSON.parse(JSON.stringify(x));
}
