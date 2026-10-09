// Operations: every change to the tracker is one small operation.
// The same code runs in the browser (docs/store.js) and on the Mac (tools/tracker.mjs),
// so both apply changes the same way.
//
// A "state" is { data, history } where
//   data    = the contents of data.json
//   history = { 'YYYY-MM': [events] } for the months that are loaded.
//
// applyOp(state, op) changes the state in place and returns true, or returns false
// when the operation must be skipped (for example, its item no longer exists).

import { indiaDate, monthOf, laterDate, addDays, REPEATS, nextRepeatDate } from './rules.js';
import { AI_DAILY_LIMIT, BRIEF_CLAIM_MINUTES } from './config.js';

export const START_GROUPS = ['Acton', 'Personal', 'Ceramic Ninja'];
export const PRIORITIES = ['high', 'medium', 'low'];
export const DEFAULT_TARGET_DAYS = 30; // new projects get a target date 30 days ahead
const PROJECT_FIELDS = ['name', 'groupId', 'priority', 'deadline', 'notes', 'tagId'];
const STEP_FIELDS = ['text', 'dueDate', 'note', 'waiting', 'waitingOn', 'repeat'];

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
    people: [],
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

function addEvent(state, op, project, kind, detail = '', extra = null) {
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
    ...(extra || {}),
  });
}

/** Un-tick takes back the "✓ step" line, so summaries, Diary and Dashboard never count a step that is not done. */
function removeTickEvent(state, project, step) {
  let best = null;
  for (const [m, list] of Object.entries(state.history)) {
    list.forEach((e, i) => {
      if (e.kind !== 'step_ticked' || e.projectId !== project.id) return;
      const same = e.stepId ? e.stepId === step.id : e.detail === step.text; // older lines have no stepId
      if (same && (!best || e.at > best.at)) best = { m, i, at: e.at };
    });
  }
  if (best) state.history[best.m].splice(best.i, 1);
}

/** Every change to a project counts as activity for the dot colour (green today). */
function touch(project, op) {
  project.updatedAt = op.at;
  project.lastActivityDate = laterDate(project.lastActivityDate, indiaDate(op.at));
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
      lastActivityDate: indiaDate(op.at),
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
    if (a.field === 'tagId') {
      if (!value) value = null;
      if ((p.tagId || null) === value) return false;
      // a tag must belong to the project's group (or null = no tag)
      const g = state.data.groups.find((x) => x.id === p.groupId);
      if (value !== null && !(g && (g.tags || []).some((t) => t.id === value))) return false;
    }
    if (p[a.field] === value) return false;
    const old = p[a.field];
    p[a.field] = value;
    touch(p, op);
    if (a.field === 'name') addEvent(state, op, p, 'renamed', `${old} → ${value}`);
    else if (a.field === 'groupId') {
      const g = state.data.groups.find((x) => x.id === value);
      if (p.tagId && !(g && (g.tags || []).some((t) => t.id === p.tagId))) p.tagId = null; // tags belong to a group
      addEvent(state, op, p, 'group_changed', g ? g.name : '');
    } else if (a.field === 'tagId') {
      const g = state.data.groups.find((x) => x.id === p.groupId);
      const t = g && (g.tags || []).find((x) => x.id === value);
      addEvent(state, op, p, 'edited', t ? `Tag: ${t.name}` : 'Tag removed');
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

  /** First open of the day: dot turns yellow. Not counted as work, no history line. */
  markOpened(state, op, a) {
    const p = findProject(state.data, a.projectId);
    const day = indiaDate(op.at);
    if (!p || p.state !== 'active' || p.lastOpenedDate === day) return false;
    p.lastOpenedDate = day;
    return true;
  },

  /** "OK for today": looked at it, no more work today. Dot turns green; real-work count is unchanged. */
  okForToday(state, op, a) {
    const p = findProject(state.data, a.projectId);
    const day = indiaDate(op.at);
    if (!p || p.state !== 'active' || p.okDate === day) return false;
    p.okDate = day;
    p.okOpId = op.id;
    p.lastOpenedDate = day;
    addEvent(state, op, p, 'reviewed', 'Reviewed — nothing today');
    return true;
  },

  undoOkForToday(state, op, a) {
    const p = findProject(state.data, a.projectId);
    if (!p || p.okDate !== indiaDate(op.at)) return false;
    p.okDate = null;
    if (p.okOpId) {
      const events = state.history[opMonth(op)] || [];
      const k = events.findIndex((e) => e.id === p.okOpId);
      if (k >= 0) events.splice(k, 1); // so the streak does not count an undone OK
      p.okOpId = null;
    }
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

  /** Undo: put the project back exactly as it was, and remove the undone action's history line. */
  restoreProject(state, op, a) {
    const snap = a.project;
    if (!snap || !snap.id) return false;
    const list = state.data.projects;
    const i = list.findIndex((x) => x.id === snap.id);
    if (i >= 0) list[i] = clone(snap);
    else list.splice(Math.min(Math.max(0, a.index ?? 0), list.length), 0, clone(snap));
    const undone = [a.undoOpId, ...(Array.isArray(a.undoOpIds) ? a.undoOpIds : [])].filter(Boolean);
    for (const id of undone) {
      for (const events of Object.values(state.history)) {
        const k = events.findIndex((e) => e.id === id);
        if (k >= 0) events.splice(k, 1);
      }
    }
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
    if (a.field === 'repeat') value = REPEATS.includes(value) ? value : null;
    if (s[a.field] === value) return false;
    const old = s[a.field];
    s[a.field] = value;
    if (a.field === 'waiting') s.waitingSince = value ? indiaDate(op.at) : null; // for "Waiting · 4d"
    if (s.snoozedUntil && (a.field === 'dueDate' || a.field === 'repeat')) {
      // a step that comes back later follows its new date; no repeat or a date today/past = show it now
      s.snoozedUntil = s.repeat && s.dueDate && s.dueDate > indiaDate(op.at) ? s.dueDate : null;
    }
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
    if (s.repeat) {
      // A repeating step comes back: a fresh copy, due on the next date (same id on every replay).
      const doneDay = indiaDate(op.at);
      const due = nextRepeatDate(s.repeat, s.dueDate, doneDay);
      const copyId = op.id + 'r';
      s.spawnedCopy = copyId;
      if (!p.steps.some((x) => x.id === copyId)) {
        p.steps.push({
          id: copyId, text: s.text, done: false, doneAt: null, dueDate: due, snoozedUntil: due,
          note: s.note || '', waiting: false, waitingOn: '', repeat: s.repeat, createdAt: op.at, updatedAt: op.at,
        });
      }
    }
    touch(p, op);
    if (s.repeat) {
      // keep data small: older finished copies of this repeating step are dropped (the Diary keeps them)
      p.steps = p.steps.filter((x) => x === s || !(x.done && x.repeat === s.repeat && x.text === s.text));
    }
    addEvent(state, op, p, 'step_ticked', s.text, { stepId: s.id });
    return true;
  },

  untickStep(state, op, a) {
    const p = findProject(state.data, a.projectId);
    const s = p && p.steps.find((x) => x.id === a.stepId);
    if (!s || !s.done) return false;
    s.done = false;
    s.doneAt = null;
    s.updatedAt = op.at;
    if (s.spawnedCopy) {
      // un-ticking a repeating step takes back the copy it made (if not started)
      const k = p.steps.findIndex((x) => x.id === s.spawnedCopy && !x.done);
      if (k >= 0) p.steps.splice(k, 1);
      s.spawnedCopy = null;
    }
    recalcLastTick(p);
    touch(p, op);
    removeTickEvent(state, p, s);
    addEvent(state, op, p, 'step_unticked', s.text);
    return true;
  },

  deleteStep(state, op, a) {
    const p = findProject(state.data, a.projectId);
    const i = p ? p.steps.findIndex((x) => x.id === a.stepId) : -1;
    if (i < 0) return false;
    const [s] = p.steps.splice(i, 1);
    touch(p, op); // lastTickDate stays as it is
    addEvent(state, op, p, 'step_deleted', s.text);
    return true;
  },

  moveStep(state, op, a) {
    const p = findProject(state.data, a.projectId);
    if (!p || !moveInList(p.steps, a.stepId, a.afterId, a.beforeId)) return false;
    touch(p, op);
    return true;
  },

  /** "Chased": followed up on a waiting step. Saves a work note and restarts the waiting count. */
  chased(state, op, a) {
    const p = findProject(state.data, a.projectId);
    const s = p && p.steps.find((x) => x.id === a.stepId);
    if (!s || s.done || !s.waiting) return false;
    const day = indiaDate(op.at);
    if (s.chasedDate === day) return false; // once a day is enough
    s.chasedDate = day;
    s.waitingSince = day; // give them time again before turning red
    s.updatedAt = op.at;
    const text = s.waitingOn ? `Followed up with @${s.waitingOn} — ${s.text}` : `Followed up — ${s.text}`;
    p.workNotes.unshift({ id: op.id, text, createdAt: op.at, updatedAt: op.at });
    touch(p, op);
    addEvent(state, op, p, 'note_added', text);
    return true;
  },

  // ---------- Work notes ----------
  addWorkNote(state, op, a) {
    const p = findProject(state.data, a.projectId);
    const text = cleanText(a.text, 5000).trim();
    if (!p || !text || p.workNotes.some((n) => n.id === a.noteId)) return false;
    // A note can belong to a step ("what I did on this step"); it stays even if the step is later ticked.
    const stepId = a.stepId && p.steps.some((s) => s.id === a.stepId) ? a.stepId : null;
    p.workNotes.unshift({ id: a.noteId, text, stepId, createdAt: op.at, updatedAt: op.at });
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
      noteId: a.noteId || null, // photo added with a work note
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

  /** Timer on/off for a group (e.g. on for Acton and Ceramic Ninja, off for Personal). */
  setGroupTimer(state, op, a) {
    const g = state.data.groups.find((x) => x.id === a.groupId);
    if (!g || groupHasTimer(g) === !!a.on) return false;
    g.timer = !!a.on;
    return true;
  },

  /** Tags belong to a group; a project in that group can pick one. */
  addTag(state, op, a) {
    const g = state.data.groups.find((x) => x.id === a.groupId);
    const name = cleanText(a.name, 60).trim();
    if (!g || !name) return false;
    const tags = (g.tags ||= []);
    if (tags.some((t) => t.id === a.tagId || t.name.toLowerCase() === name.toLowerCase())) return false;
    tags.push({ id: a.tagId, name });
    return true;
  },

  renameTag(state, op, a) {
    const g = state.data.groups.find((x) => x.id === a.groupId);
    const t = g && (g.tags || []).find((x) => x.id === a.tagId);
    const name = cleanText(a.name, 60).trim();
    if (!t || !name || t.name === name) return false;
    if (g.tags.some((x) => x.id !== t.id && x.name.toLowerCase() === name.toLowerCase())) return false;
    t.name = name;
    return true;
  },

  deleteTag(state, op, a) {
    const g = state.data.groups.find((x) => x.id === a.groupId);
    const i = g && g.tags ? g.tags.findIndex((x) => x.id === a.tagId) : -1;
    if (i < 0) return false;
    g.tags.splice(i, 1);
    for (const p of state.data.projects) if (p.tagId === a.tagId) p.tagId = null; // time stays, now "No tag"
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

  // ---------- People ----------
  addPerson(state, op, a) {
    const people = (state.data.people ||= []);
    const name = cleanText(a.name, 80).replace(/^@+/, '').trim();
    if (!name || people.some((x) => x.id === a.personId || x.name.toLowerCase() === name.toLowerCase())) return false;
    people.push({ id: a.personId, name, createdAt: op.at });
    people.sort((x, y) => x.name.localeCompare(y.name));
    return true;
  },

  renamePerson(state, op, a) {
    const people = state.data.people || [];
    const person = people.find((x) => x.id === a.personId);
    const name = cleanText(a.name, 80).replace(/^@+/, '').trim();
    if (!person || !name || person.name === name) return false;
    if (people.some((x) => x.id !== person.id && x.name.toLowerCase() === name.toLowerCase())) return false;
    const old = person.name;
    // Change "@Old Name" to "@New Name" everywhere, so the links stay.
    // Skip places where a LONGER name of someone else matches (e.g. "@Ravi Kumar" when renaming "Ravi").
    const longer = people.filter((x) => x.id !== person.id && x.name.length > old.length
      && x.name.toLowerCase().startsWith(old.toLowerCase())).map((x) => x.name.toLowerCase());
    const re = new RegExp('@' + old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}_])', 'giu');
    const wordChar = /[\p{L}\p{N}_]/u;
    const fix = (t) => (typeof t !== 'string' ? t : t.replace(re, (match, offset) => {
      const rest = t.slice(offset + 1).toLowerCase();
      const isLonger = longer.some((n) => rest.startsWith(n) && !wordChar.test(t.charAt(offset + 1 + n.length)));
      return isLonger ? match : '@' + name; // function replacer: "$" in a name is kept as typed
    }));
    for (const p of state.data.projects) {
      p.notes = fix(p.notes);
      for (const s of p.steps) {
        s.text = fix(s.text);
        s.note = fix(s.note);
        if (s.waitingOn && s.waitingOn.toLowerCase() === old.toLowerCase()) s.waitingOn = name;
      }
      for (const n of p.workNotes) n.text = fix(n.text);
    }
    person.name = name;
    people.sort((x, y) => x.name.localeCompare(y.name));
    return true;
  },

  deletePerson(state, op, a) {
    const people = state.data.people || [];
    const i = people.findIndex((x) => x.id === a.personId);
    if (i < 0) return false;
    people.splice(i, 1); // texts keep "@Name"; they are just no longer linked
    return true;
  },

  /** Save the daily scores of past days (for the streak and the 7-day bars). Keeps 120 days. */
  recordScores(state, op, a) {
    const scores = (state.data.dayScores ||= {});
    let changed = false;
    for (const [day, v] of Object.entries(a.scores || {})) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || scores[day]) continue;
      scores[day] = { green: Number(v.green) || 0, total: Number(v.total) || 0 };
      changed = true;
    }
    const days = Object.keys(scores).sort();
    while (days.length > 800) delete scores[days.shift()]; // about 2 years (a day is ~20 bytes)
    return changed;
  },

  /** AI keys shared by all my devices (kept in the PRIVATE data repository). Empty key = remove. */
  setAiKey(state, op, a) {
    if (a.provider !== 'claude' && a.provider !== 'gemini') return false;
    const secrets = (state.data.secrets ||= {});
    const key = String(a.key || '').trim().slice(0, 300);
    if ((secrets[a.provider] || '') === key) return false;
    if (key) secrets[a.provider] = key;
    else delete secrets[a.provider];
    return true;
  },

  // ---------- Time log ----------
  // One timer at a time (data.timer). Starting another project stops the running one first.

  startTimer(state, op, a) {
    const p = findProject(state.data, a.projectId);
    if (!p || p.state !== 'active') return false;
    const grp = state.data.groups.find((g) => g.id === p.groupId);
    if (!groupHasTimer(grp)) return false; // the timer is only for groups that have it switched on
    const t = state.data.timer;
    if (t && t.projectId === p.id) return false; // already running here
    if (t) closeTimer(state, op, op.at);
    state.data.timer = { projectId: p.id, start: op.at, id: op.id };
    touch(p, op);
    return true;
  },

  stopTimer(state, op) {
    if (!state.data.timer) return false;
    closeTimer(state, op, op.at);
    return true;
  },

  /** Time worked but not timed: minutes on a day (default today). */
  addTime(state, op, a) {
    const p = findProject(state.data, a.projectId);
    const minutes = Math.round(Number(a.minutes));
    if (!p || !(minutes > 0) || minutes > 24 * 60) return false;
    const day = cleanDate(a.day) || indiaDate(op.at);
    const start = a.day ? new Date(`${day}T12:00:00+05:30`).toISOString() : new Date(Date.parse(op.at) - minutes * 60000).toISOString();
    (p.timeLogs ||= []).push({ id: op.id, start, minutes, manual: true });
    touch(p, op);
    addEvent(state, op, p, 'time_added', `${minutes} min`);
    return true;
  },

  removeTime(state, op, a) {
    const p = findProject(state.data, a.projectId);
    const i = p && p.timeLogs ? p.timeLogs.findIndex((x) => x.id === a.logId) : -1;
    if (i < 0) return false;
    p.timeLogs.splice(i, 1);
    touch(p, op);
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

export const TIMER_MAX_MINUTES = 10 * 60; // a timer left running is cut to 10 hours

/** A group has the timer unless it was switched off (Personal is off by default). */
export function groupHasTimer(g) {
  if (!g) return false;
  if (typeof g.timer === 'boolean') return g.timer;
  return g.name.trim().toLowerCase() !== 'personal';
}

/** Stop the running timer at `endIso` and log the time on its project. */
function closeTimer(state, op, endIso) {
  const t = state.data.timer;
  state.data.timer = null;
  if (!t) return;
  const p = findProject(state.data, t.projectId);
  if (!p) return;
  let minutes = Math.round((Date.parse(endIso) - Date.parse(t.start)) / 60000);
  if (!(minutes > 0)) return; // under a minute: nothing to log
  const capped = minutes > TIMER_MAX_MINUTES;
  if (capped) minutes = TIMER_MAX_MINUTES;
  (p.timeLogs ||= []).push({ id: t.id, start: t.start, minutes, ...(capped ? { capped: true } : {}) });
  touch(p, op);
  addEvent(state, op, p, 'time_logged', `${minutes} min${capped ? ' (cut to 10 h)' : ''}`);
}

function setState(state, op, a, from, to, kind) {
  const p = findProject(state.data, a.projectId);
  if (!p || p.state !== from) return false;
  if (to !== 'active' && state.data.timer && state.data.timer.projectId === p.id) closeTimer(state, op, op.at);
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
  if (op.type === 'setAiKey') return 'Update AI key';
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
