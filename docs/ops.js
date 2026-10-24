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

import { WORK, indiaDate, monthOf, laterDate, addDays, REPEATS, nextRepeatDate, waitingAgain, WEEKDAYS, indiaDateTime, validRemindOnce, remindOnceText, canPutUnder, parentIdsOf, normalizeParents, isMainProject, descendantIds, MOVE_EVERY_DEFAULT, DEFAULT_TARGET_DAYS, THREAD_MAX, timerOn, MISC_ID, STAGES, STAGE_LABELS, cleanWaitingFor } from './rules.js';
import { AI_DAILY_LIMIT, BRIEF_CLAIM_MINUTES } from './config.js';
import { sanitizeRich, htmlToText, isRich, RICH_MAX } from './rich.js';

export const PRIORITIES = ['high', 'medium', 'low'];
export { DEFAULT_TARGET_DAYS } from './rules.js'; // new projects get a target date 30 days ahead (marked autoTarget: it does not colour the dot)
const PROJECT_FIELDS = ['name', 'priority', 'deadline', 'notes', 'tagId', 'status', 'about'];
export const ABOUT_MAX = 1000; // the project's description (owner asked for 1000 letters, 22 Oct)
export const MAX_SNOOZE_DAYS = 365;
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
    tags: [], // one list of tags (groups are gone)
    groups: [], // always empty, never used: only so an older copy of the app still open on a phone does not break
    projects: [],
    people: [],
    settings: { aiProvider: 'claude', timer: true },
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

/**
 * A work note's words and (optional) rich HTML. The HTML is cleaned (only safe tags) and kept only when it has
 * more than plain words (a table, list, bold, link, photo or several lines). `text` is always there: the plain words
 * made from the HTML (tables as "a | b | c", lists as "• item"), or the given text (e.g. "📷 1 photo").
 * Returns null when the cleaned HTML is bigger than RICH_MAX.
 */
function richNote(a) {
  if (a.html === undefined || a.html === null || a.html === '') return { text: cleanText(a.text, 5000).trim(), html: null };
  const html = sanitizeRich(String(a.html));
  if (html.length > RICH_MAX) return null;
  const text = cleanText(htmlToText(html) || a.text, 5000).trim();
  return { text, html: isRich(html) ? html : null };
}

function cleanDate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/** Only http and https links are allowed. Returns null if not allowed. */
/** A phone number for WhatsApp: digits only, India (91) added to a 10-digit number. '' = none, null = not a phone number. */
export function cleanPhone(v) {
  const raw = String(v || '').trim();
  if (!raw) return '';
  let d = raw.replace(/[^\d]/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = '91' + d.slice(1);
  if (d.length === 10 && !raw.startsWith('+')) d = '91' + d;
  return d.length >= 8 && d.length <= 15 ? d : null;
}

/** { url, title } of the mail or web page a step came from, or null. */
export function cleanLink(v) {
  const url = v && cleanUrl(v.url);
  if (!url) return null;
  return { url, title: cleanText(v.title, 200).replace(/\s+/g, ' ').trim() || url };
}

export function cleanUrl(v) {
  try {
    const u = new URL(String(v).trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/** An Inbox item's optional parts: link, note (up to 600 letters), mail = { conversationId, count } of the email thread. */
export function inboxExtras(a) {
  const out = {};
  const link = cleanLink(a && a.link);
  if (link) out.link = link;
  const note = cleanText(a && a.note, 600).trim();
  if (note) out.note = note;
  const mail = cleanMail(a && a.mail, true);
  if (mail) out.mail = mail;
  return out;
}

/**
 * The email thread an Inbox item / step / project came from: conversationId, and the newest email's Graph id, sender
 * and subject (kept for a later "draft a reply" in Outlook). With `withCount`, how many emails the item holds.
 */
export function cleanMail(m, withCount = false) {
  const conv = m && typeof m.conversationId === 'string' ? m.conversationId.slice(0, 400) : '';
  if (!conv) return null;
  const out = { conversationId: conv };
  if (withCount) out.count = Math.max(1, Math.min(9999, Math.floor(Number(m.count) || 1)));
  const str = (k, max) => { const v = typeof m[k] === 'string' ? m[k].replace(/\s+/g, ' ').trim().slice(0, max) : ''; if (v) out[k] = v; };
  str('messageId', 400); str('fromName', 120); str('subject', 200);
  if (typeof m.fromAddress === 'string' && /^[^\s@]+@[^\s@]+$/.test(m.fromAddress.trim()) && m.fromAddress.length <= 200) out.fromAddress = m.fromAddress.trim();
  if (typeof m.at === 'string' && m.at.length <= 40 && !Number.isNaN(Date.parse(m.at))) out.at = m.at; // when the newest email came
  if (m.fromMe === true) out.fromMe = true; // the newest email is your own (sent to yourself): nothing to answer
  return out;
}

export const REPLY_MAX = 5000; // a reply draft, in letters

/**
 * Where an email thread lives: an Inbox item ({ itemId }), a step ({ projectId, stepId }) or a project ({ projectId }).
 * Returns { target, project } (project = null for an Inbox item), or null when there is none or it has no email.
 */
export function mailTarget(data, a) {
  if (!a) return null;
  if (a.itemId) {
    const item = (data.inbox || []).find((x) => x.id === a.itemId);
    return item && item.mail ? { target: item, project: null } : null;
  }
  const p = a.projectId && data.projects.find((x) => x.id === a.projectId);
  if (!p) return null;
  const target = a.stepId ? p.steps.find((s) => s.id === a.stepId) : p;
  return target && target.mail ? { target, project: p } : null;
}

const replyOpen = (r) => !!r && (r.state === 'ready' || r.state === 'later');

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

/** A step the person added on Work Task that you deleted (or undid): remembered in the data, so no device adds it back. */
function dropTeamStep(p, stepId) {
  p.teamDropped = [...(p.teamDropped || []).filter((x) => x !== stepId), stepId].slice(-300);
}

/** Undo puts a project back as it was, but a step the person added on Work Task since then stays
 *  (unless this Undo is the one that takes that very step away: then it is remembered as deleted). */
function keepTeamSteps(now, back, dropIds) {
  const had = new Set(back.steps.map((x) => x.id));
  now.steps.forEach((st, k) => {
    if (!st.addedByTeam || had.has(st.id)) return;
    if (dropIds.includes(st.id)) { dropTeamStep(back, st.id); return; }
    back.steps.splice(Math.min(k, back.steps.length), 0, clone(st));
  });
  const dropped = [...new Set([...(back.teamDropped || []), ...(now.teamDropped || [])])].filter((x) => !back.steps.some((st) => st.id === x));
  if (dropped.length) back.teamDropped = dropped.slice(-300);
  else delete back.teamDropped;
}

/**
 * Undo puts back a saved copy, but what the server added since stays (worktask.in writes these straight into the data:
 * outlook.php / connect.php): the task's email thread (by messageId), the newer `mail` of the thread, a reply seen as sent
 * in Outlook, and 🔌 app / 📧 mail notes. Works the same on every device (only the data decides).
 */
function keepServerParts(now, back) {
  if (!now || !back) return;
  const key = (e) => (e && typeof e.messageId === 'string' && e.messageId ? 'm:' + e.messageId : 'x:' + JSON.stringify([e && e.at, e && e.fromName, e && e.preview]));
  if (Array.isArray(now.thread)) {
    const seen = new Map();
    for (const e of [...(Array.isArray(back.thread) ? back.thread : []), ...now.thread]) if (e && typeof e === 'object' && !seen.has(key(e))) seen.set(key(e), clone(e));
    back.thread = [...seen.values()].sort((x, y) => String(x.at || '').localeCompare(String(y.at || ''))).slice(-THREAD_MAX);
  }
  const keepMail = (n, b) => {
    if (!n || !b) return;
    if (n.mail && b.mail && n.mail.conversationId === b.mail.conversationId && n.mail.at && (!b.mail.at || Date.parse(n.mail.at) > Date.parse(b.mail.at))) b.mail = clone(n.mail);
    const r = n.reply;
    if (r && r.state === 'sent' && b.mail && (!b.reply || b.reply.state !== 'sent' || Date.parse(r.sentAt || 0) > Date.parse(b.reply.sentAt || 0))) b.reply = clone(r);
  };
  keepMail(now, back);
  for (const st of back.steps || []) keepMail((now.steps || []).find((x) => x.id === st.id), st);
  const had = new Set((back.workNotes || []).map((n) => n.id));
  (now.workNotes || []).forEach((n, k) => {
    if (!n || had.has(n.id) || !(n.mail || n.app)) return; // (a 👥 team note comes as a change of its own, which Undo may take back)
    back.workNotes ||= [];
    back.workNotes.splice(Math.min(k, back.workNotes.length), 0, clone(n));
  });
}

/** Can `child` stay in `main` after an Undo? (main still there, not the same, not a task inside a project, no circle) */
function linkStillOk(data, child, main) {
  return !!child && !!main && child.id !== main.id && !(parentIdsOf(main).length && !isMainProject(data, main))
    && !(isMainProject(data, child) && descendantIds(data, child.id).has(main.id));
}

/** A team tick / untick you undid stays undone (see teamUndoKey in rules.js): kept through every later Undo too. */
function keepTeamUndone(now, back, mark) {
  const list = [...new Set([...(back.teamUndone || []), ...((now && now.teamUndone) || []), ...(mark ? [mark.slice(0, 80)] : [])])];
  if (list.length) back.teamUndone = list.slice(-300);
  else delete back.teamUndone;
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
      if ((e.kind !== 'step_ticked' && e.kind !== 'team_ticked') || e.projectId !== project.id) return;
      const same = e.stepId ? e.stepId === step.id : e.detail === step.text; // older lines have no stepId
      if (same && (!best || e.at > best.at)) best = { m, i, at: e.at };
    });
  }
  if (!best) return null;
  const [event] = state.history[best.m].splice(best.i, 1);
  return { month: best.m, event }; // kept on the untick's line, so its Undo puts it back
}

/**
 * A task made from an email: did an email from someone else come AFTER `at`? (The server adds it to the thread, and
 * opens a finished task again.) A Finish or Delete pressed before it, and saved only later (offline, or a save that
 * had to try again), must not hide or delete that email: the server will not bring it in a second time.
 * seen = the newest email you could see when you pressed (seenMailAt, server time): compared with that, not with the
 * device clock, which can be behind or ahead of the server. Old saved changes without it use `at`.
 */
// addedAt = when the server brought the email in (an email can be received before you pressed, but come in after)
const mailWhen = (e) => (typeof e.addedAt === 'string' && !Number.isNaN(Date.parse(e.addedAt)) ? e.addedAt : e.at);
function theirMailTimes(p) {
  const thread = Array.isArray(p.thread) ? p.thread : [];
  const theirs = thread.filter((e) => e && !e.fromMe && typeof mailWhen(e) === 'string').map((e) => Date.parse(mailWhen(e)));
  if (!thread.length && !p.mail.fromMe && typeof mailWhen(p.mail) === 'string') theirs.push(Date.parse(mailWhen(p.mail)));
  return theirs.filter((x) => !Number.isNaN(x));
}

/** The newest email from someone else on an email task (server time), or null: kept with a Finish / Delete as seenMailAt. */
export function seenMailOf(p) {
  if (!p || !p.mail) return null;
  const theirs = theirMailTimes(p);
  return theirs.length ? new Date(Math.max(...theirs)).toISOString() : null;
}

function newerMailThan(p, at, a = {}) {
  if (!p || !p.mail) return false;
  const seen = a && 'seenMailAt' in a;
  if (seen && a.seenMailAt !== null && (typeof a.seenMailAt !== 'string' || Number.isNaN(Date.parse(a.seenMailAt)))) return false;
  const t = seen ? (a.seenMailAt === null ? -Infinity : Date.parse(a.seenMailAt)) : Date.parse(at);
  if (Number.isNaN(t)) return false;
  return theirMailTimes(p).some((x) => x > t);
}

/** A task leaves 📂 projects: its place in their order (taskOrder) goes too, so added back it comes after the placed ones. */
function dropFromOrder(data, taskId, mainIds = null) {
  for (const m of data.projects) {
    if (!Array.isArray(m.taskOrder) || (mainIds && !mainIds.includes(m.id))) continue;
    if (m.taskOrder.includes(taskId)) m.taskOrder = m.taskOrder.filter((x) => x !== taskId);
  }
}

/** Where a task sits in each 📂 project's order ({ mainId: index }), so Undo can put it back in its place. */
export function orderPosOf(data, taskId) {
  const pos = {};
  for (const m of data.projects) {
    const k = Array.isArray(m.taskOrder) ? m.taskOrder.indexOf(taskId) : -1;
    if (k >= 0) pos[m.id] = k;
  }
  return pos;
}

/** Every change to a project counts as activity for the dot colour (green today). */
function touch(project, op) {
  project.updatedAt = op.at;
  project.lastActivityDate = laterDate(project.lastActivityDate, indiaDate(op.at));
}

/** A real update today: makes the dot green (edits like renaming or moving steps do not). */
function markWork(project, op) {
  project.workDate = laterDate(project.workDate, indiaDate(op.at));
}

/** When the team did it (a time from the server), never later than the change itself. */
function teamTime(v, op) {
  const ms = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(ms) && ms < Date.parse(op.at) ? new Date(ms).toISOString() : op.at;
}

/** The projects a task is in (parentIds; an older parentId is folded in). An empty list: the field goes. */
/** A task put into a project with a "move every" takes it, unless it has its own (owner asked 23 Oct). */
function inheritEvery(child, main) {
  if (child && main && Number.isInteger(main.moveEvery) && !Number.isInteger(child.moveEvery)) child.moveEvery = main.moveEvery;
}

function setParents(p, ids) {
  const list = [...new Set(ids.filter((x) => typeof x === 'string' && x && x !== p.id))];
  delete p.parentId;
  if (list.length) p.parentIds = list; else delete p.parentIds;
}

function recalcLastTick(project) {
  let last = null;
  for (const s of project.steps) if (s.done && s.doneAt && !s.byTeam) last = laterDate(last, indiaDate(s.doneAt));
  project.lastTickDate = last;
}

const handlers = {
  // ---------- Projects ----------
  createProject(state, op, a) {
    const { data } = state;
    if (findProject(data, a.projectId)) return false;
    const project = {
      id: a.projectId,
      name: cleanText(a.name, 200) || 'New project',
      priority: PRIORITIES.includes(a.priority) ? a.priority : 'medium',
      deadline: a.deadline === undefined ? addDays(indiaDate(op.at), DEFAULT_TARGET_DAYS) : cleanDate(a.deadline),
      ...(a.deadline === undefined ? { autoTarget: true } : {}),
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
    // "+ New task here" on a project's page: made already in it
    const main = typeof a.parentId === 'string' ? findProject(data, a.parentId) : null;
    if (main && canPutUnder(data, project, main)) {
      project.parentIds = [main.id];
      main.isMain = true;
      inheritEvery(project, main);
      addEvent(state, { ...op, id: op.id + 'm' }, main, 'main_changed', `${project.name} added`);
    }
    return true;
  },

  /**
   * 📂 Add a task to a project (a task can be in several projects), or a project into another project (never in a circle).
   * Not work (the dot does not change). Undo: restoreProject of the task (both history lines go).
   */
  /** The order of a 📂 project's tasks, as the owner arranged them (ids not in it keep their place after). Not work. */
  setTaskOrder(state, op, a) {
    const p = findProject(state.data, a.projectId);
    if (!p || !Array.isArray(a.order)) return false;
    const order = [...new Set(a.order.map(String))].filter((id) => state.data.projects.some((x) => x.id === id)).slice(0, 500);
    if (JSON.stringify(order) === JSON.stringify(p.taskOrder || [])) return false;
    p.taskOrder = order;
    return true;
  },

  addToProject(state, op, a) {
    const { data } = state;
    const p = findProject(data, a.projectId);
    const main = typeof a.parentId === 'string' ? findProject(data, a.parentId) : null;
    if (!p || !main) return false;
    const now = parentIdsOf(p);
    if (now.includes(main.id) || !canPutUnder(data, p, main)) return false;
    setParents(p, [...now, main.id]);
    main.isMain = true;
    inheritEvery(p, main);
    p.updatedAt = op.at;
    addEvent(state, op, p, 'main_changed', `Added to 📂 ${main.name}`);
    addEvent(state, { ...op, id: op.id + 'm' }, main, 'main_changed', `${p.name} added`);
    return true;
  },

  /** 📂 Take a task out of one project (it stays in its other projects). Not work. */
  removeFromProject(state, op, a) {
    const { data } = state;
    const p = findProject(data, a.projectId);
    if (!p || typeof a.parentId !== 'string') return false;
    const now = parentIdsOf(p);
    if (!now.includes(a.parentId)) return false;
    setParents(p, now.filter((x) => x !== a.parentId));
    dropFromOrder(data, p.id, [a.parentId]);
    p.updatedAt = op.at;
    const main = findProject(data, a.parentId);
    addEvent(state, op, p, 'main_changed', main ? `Taken out of 📂 ${main.name}` : 'Taken out of a project');
    if (main) addEvent(state, { ...op, id: op.id + 'm' }, main, 'main_changed', `${p.name} taken out`);
    return true;
  },

  /**
   * The older way (changes saved before a task could be in several projects, still replayed): parentId = a project →
   * the task is in that one project only (out of the others); parentId null → out of every project. Not work.
   */
  setParent(state, op, a) {
    const { data } = state;
    const p = findProject(data, a.projectId);
    if (!p) return false;
    const now = parentIdsOf(p);
    const old = now.length ? findProject(data, now[0]) : null;
    if (a.parentId === null || a.parentId === undefined || a.parentId === '') {
      if (!now.length) return false;
      setParents(p, []);
      dropFromOrder(data, p.id, now);
      p.updatedAt = op.at;
      addEvent(state, op, p, 'main_changed', old ? `Taken out of 📂 ${old.name}` : 'Taken out of its project');
      if (old) addEvent(state, { ...op, id: op.id + 'm' }, old, 'main_changed', `${p.name} taken out`);
      return true;
    }
    const main = typeof a.parentId === 'string' ? findProject(data, a.parentId) : null;
    if (!main || (now.length === 1 && now[0] === main.id) || !canPutUnder(data, p, main)) return false;
    setParents(p, [main.id]);
    dropFromOrder(data, p.id, now.filter((x) => x !== main.id));
    main.isMain = true;
    inheritEvery(p, main);
    p.updatedAt = op.at;
    addEvent(state, op, p, 'main_changed', `Added to 📂 ${main.name}`);
    addEvent(state, { ...op, id: op.id + 'm' }, main, 'main_changed', `${p.name} added`);
    if (old && old.id !== main.id) addEvent(state, { ...op, id: op.id + 't' }, old, 'main_changed', `${p.name} taken out`);
    return true;
  },

  /** A new project (isMain, so it shows even while empty); with childId, that task is added to it in the same change (one Undo). */
  /** 📂 Misc, made once (its fixed id: made on two devices at once, it is still one). See rules.js MISC_ID. */
  makeMisc(state, op) {
    if (findProject(state.data, MISC_ID)) return false;
    if (!handlers.createProject(state, op, { projectId: MISC_ID, name: 'Misc', deadline: null })) return false;
    const m = findProject(state.data, MISC_ID);
    m.isMain = true; m.misc = true; m.about = 'Every task that is in no other project';
    state.data.projects.splice(state.data.projects.indexOf(m), 1);
    state.data.projects.push(m); // (at the end of the list)
    return true;
  },

  createMainProject(state, op, a) {
    const { data } = state;
    const child = typeof a.childId === 'string' && a.childId ? findProject(data, a.childId) : null;
    if (a.childId && (!child || child.misc)) return false; // (a 📂 project can go into the new one too, owner asked 23 Oct; never 📂 Misc)
    if (!handlers.createProject(state, op, { projectId: a.projectId, name: a.name })) return false;
    const main = findProject(data, a.projectId);
    main.isMain = true;
    if (child) {
      setParents(child, [...parentIdsOf(child), main.id]); // it stays in its other projects too
      child.updatedAt = op.at;
      addEvent(state, { ...op, id: op.id + 'm' }, child, 'main_changed', `Added to 📂 ${main.name}`);
      addEvent(state, { ...op, id: op.id + 't' }, main, 'main_changed', `${child.name} added`);
    }
    return true;
  },

  setProjectField(state, op, a) {
    const p = findProject(state.data, a.projectId);
    if (!p || !PROJECT_FIELDS.includes(a.field)) return false;
    let value = a.value;
    if (a.field === 'name') value = cleanText(value, 200).trim() || p.name;
    if (a.field === 'notes') value = cleanText(value, 50000);
    if (a.field === 'about') {
      value = cleanText(value, 5000).replace(/\s+/g, ' ').trim().slice(0, ABOUT_MAX);
      if ((p.about || '') === value) return false; // older projects have no about: the same as ''
    }
    if (a.field === 'status') {
      value = cleanText(value, 200).replace(/\s+/g, ' ').trim();
      if ((p.status || '') === value) return false; // leaving the empty box is not a change (and not work)
      p.statusAt = op.at;
    }
    if (a.field === 'priority' && !PRIORITIES.includes(value)) return false;
    if (a.field === 'deadline') { // chosen by you now (even the same date as the automatic one): it counts for the colour
      value = cleanDate(value);
      const chosen = !!p.targetSet;
      delete p.autoTarget; p.targetSet = true;
      if (p.deadline === value) return !chosen;
    }
    if (a.field === 'tagId') {
      if (!value) value = null;
      if ((p.tagId || null) === value) return false;
      if (value !== null && !(state.data.tags || []).some((t) => t.id === value)) return false; // one of the tags (or null = no tag)
    }
    if (p[a.field] === value) return false;
    const old = p[a.field];
    p[a.field] = value;
    touch(p, op);
    if (a.field === 'name') addEvent(state, op, p, 'renamed', `${old} → ${value}`);
    else if (a.field === 'tagId') {
      const t = (state.data.tags || []).find((x) => x.id === value);
      addEvent(state, op, p, 'edited', t ? `Tag: ${t.name}` : 'Tag removed');
    } else if (a.field === 'priority') addEvent(state, op, p, 'edited', `Priority: ${value}`);
    else if (a.field === 'deadline') addEvent(state, op, p, 'edited', value ? `Target date: ${value}` : 'Target date removed');
    // status: no history event (it saves while typing)
    // notes: no history event (it would add a line for every few words typed)
    // about: no history event (it saves while typing, like status)
    return true;
  },

  /** Hide an active project from Today for N days; it comes back by itself. Not "work", so the dot is not made green. */
  snooze(state, op, a) {
    const p = findProject(state.data, a.projectId);
    const days = Math.round(Number(a.days));
    if (!p || p.state !== 'active' || !(days >= 1 && days <= MAX_SNOOZE_DAYS)) return false;
    const today = indiaDate(op.at);
    p.snoozedFrom = today;
    p.snoozedUntil = addDays(today, days);
    p.updatedAt = op.at;
    addEvent(state, op, p, 'snoozed', `for ${days} day${days === 1 ? '' : 's'} (back ${p.snoozedUntil})`);
    return true;
  },

  /**
   * "📅 Only on": the project comes up only on these weekdays (India time, 0 = Sunday … 6 = Saturday);
   * on other days it rests like a snooze. [] (or all seven) = every day. Not "work", so the dot is not made green.
   */
  setOnlyDays(state, op, a) {
    const p = findProject(state.data, a.projectId);
    if (!p || !Array.isArray(a.days)) return false;
    if (!a.days.every((n) => Number.isInteger(n) && n >= 0 && n <= 6)) return false;
    let days = [...new Set(a.days)].sort((x, y) => x - y);
    if (days.length === 7) days = []; // every day
    const old = Array.isArray(p.onlyDays) ? p.onlyDays : [];
    if (old.length === days.length && old.every((n, i) => n === days[i])) return false; // no change
    if (days.length) { p.onlyDays = days; p.onlyDaysSince = indiaDate(op.at); } else { delete p.onlyDays; delete p.onlyDaysSince; }
    p.updatedAt = op.at;
    addEvent(state, op, p, 'edited', `Only on: ${days.length ? days.map((n) => WEEKDAYS[n]).join(', ') : 'every day'}`);
    return true;
  },

  /**
   * "🔔 Remind me at": a phone notification at this time (India time, "HH:MM") on the project's chosen days
   * (every day when none are chosen). null / '' = no reminder. Not "work".
   */
  setRemindAt(state, op, a) {
    const p = findProject(state.data, a.projectId);
    const time = a.time == null || a.time === '' ? null : a.time;
    if (!p || (time !== null && !(typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time)))) return false;
    if ((p.remindAt || null) === time) return false; // no change
    if (time) p.remindAt = time; else delete p.remindAt;
    p.updatedAt = op.at;
    addEvent(state, op, p, 'edited', time ? `Reminder at ${time}` : 'Reminder off');
    return true;
  },

  /** "🔔 Remind me once": one phone notification at "YYYY-MM-DD HH:MM" (India time, not in the past). null = clear. Not "work". */
  setRemindOnce(state, op, a) {
    const p = findProject(state.data, a.projectId);
    const at = a.at == null || a.at === '' ? null : a.at;
    if (!p || (at !== null && (!validRemindOnce(at) || at < indiaDateTime(op.at)))) return false;
    if ((p.remindOnce || null) === at) return false;
    if (at) p.remindOnce = at; else delete p.remindOnce;
    p.updatedAt = op.at;
    addEvent(state, op, p, 'edited', at ? `Reminder: ${remindOnceText(at)}` : 'Reminder removed');
    return true;
  },

  wake(state, op, a) {
    const p = findProject(state.data, a.projectId);
    if (!p || !p.snoozedUntil || p.snoozedUntil <= indiaDate(op.at)) return false;
    p.snoozedUntil = indiaDate(op.at); // ends today (keeps today's snooze out of the score)
    p.updatedAt = op.at;
    addEvent(state, op, p, 'woke', '');
    return true;
  },

  /**
   * "Remind me": hide a step until a date (it comes back first in line on that day). date = null cancels.
   * Not "work", so the dot is not made green.
   */
  remindStep(state, op, a) {
    const p = findProject(state.data, a.projectId);
    const s = p && p.steps.find((x) => x.id === a.stepId);
    if (!s || s.done) return false;
    const today = indiaDate(op.at);
    const date = cleanDate(a.date);
    if (date) {
      if (date <= today || date > addDays(today, MAX_SNOOZE_DAYS)) return false;
      if (s.remindUntil === date && s.snoozedUntil === date) return false;
      s.remindFrom = today;
      s.remindUntil = date;
      s.snoozedUntil = date;
      s.updatedAt = op.at;
      addEvent(state, op, p, 'step_remind', `${s.text} → ${date}`, { stepId: s.id });
      return true;
    }
    if (!s.remindUntil) return false;
    // cancel: back now (a repeating step keeps waiting for its own next date)
    s.snoozedUntil = s.repeat && s.dueDate && s.dueDate > today ? s.dueDate : null;
    s.remindUntil = null;
    s.remindFrom = null;
    s.updatedAt = op.at;
    addEvent(state, op, p, 'step_remind', `${s.text} → now`, { stepId: s.id });
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
    if (!p || p.state === 'finished' || p.misc) return false; // (📂 Misc stays: it holds every task in no other project)
    if (newerMailThan(p, op.at, a)) return false; // an email came after you pressed Finish (a change saved late): it stays open for it
    if (!setState(state, op, a, p.state, 'finished', 'finished')) return false;
    clearStage(p); // finished = ✅ Done (the stage worked out from it)
    return true;
  },
  reopen(state, op, a) {
    const p = findProject(state.data, a.projectId);
    if (!setState(state, op, a, 'finished', 'active', 'reopened')) return false;
    if (p.stage === 'done') clearStage(p); // open again: no longer done (back to the stage worked out)
    return true;
  },

  /**
   * The task's Stage label (rules.js stageOf): 'notstarted' | 'inprogress' | 'waiting' (+ waitingFor, up to 80 letters) | 'done';
   * null = worked out by itself again. Not work (the dot does not change). The same change twice changes nothing.
   */
  setStage(state, op, a) {
    const p = findProject(state.data, a.projectId);
    const stage = a.stage === null || a.stage === undefined || a.stage === '' || a.stage === 'auto' ? null : a.stage;
    if (!p || (stage !== null && !STAGES.includes(stage))) return false;
    const wf = stage === 'waiting' ? cleanWaitingFor(a.waitingFor) : '';
    if ((p.stage || null) === stage && (p.waitingFor || '') === wf) return false;
    const was = p.stage || null;
    if (!stage) clearStage(p);
    else {
      p.stage = stage;
      if (wf) p.waitingFor = wf; else delete p.waitingFor;
      if (was !== stage || !p.stageAt) p.stageAt = op.at; // (since when: a new "waiting for" keeps the day the wait began)
    }
    p.updatedAt = op.at;
    addEvent(state, op, p, 'edited', stage ? `Stage: ${STAGE_LABELS[stage].replace(/^\S+ /, '')}${wf ? ` (${wf})` : ''}` : 'Stage: automatic');
    return true;
  },

  /**
   * "Move every N days" (1–90; null = back to 3): how often it should have a real update; its dot follows it.
   * On a 📂 project: the project and everything inside it, every level (each can be changed after). Not work.
   */
  setMoveEvery(state, op, a) {
    const { data } = state;
    const p = findProject(data, a.projectId);
    const days = a.days === null || a.days === undefined ? null : a.days;
    if (!p || (days !== null && !(Number.isInteger(days) && days >= 1 && days <= 90))) return false;
    const list = [p, ...(isMainProject(data, p) ? data.projects.filter((x) => descendantIds(data, p.id).has(x.id)) : [])];
    let changed = false;
    for (const x of list) {
      if ((x.moveEvery ?? null) === days) continue;
      if (days === null) delete x.moveEvery; else x.moveEvery = days;
      changed = true;
    }
    if (!changed) return false;
    p.updatedAt = op.at;
    addEvent(state, op, p, 'edited', `Move every: ${days === null ? MOVE_EVERY_DEFAULT : days} day${(days || MOVE_EVERY_DEFAULT) === 1 ? '' : 's'}${list.length > 1 ? ` (and the ${list.length - 1} inside)` : ''}`);
    return true;
  },

  deleteProject(state, op, a) {
    const { data } = state;
    const i = data.projects.findIndex((p) => p.id === a.projectId);
    if (i < 0 || data.projects[i].misc) return false; // (📂 Misc is never deleted)
    if (newerMailThan(data.projects[i], op.at, a)) return false; // an email came after you pressed Delete: the task (and that email) stays
    const [p] = data.projects.splice(i, 1);
    for (const c of data.projects) if (parentIdsOf(c).includes(p.id)) setParents(c, parentIdsOf(c).filter((x) => x !== p.id)); // its tasks stay, just no longer in it
    dropFromOrder(data, p.id);
    addEvent(state, op, p, 'deleted', p.name);
    return true;
  },

  /** Undo: put the project back exactly as it was, and remove the undone action's history line. */
  restoreProject(state, op, a) {
    const snap = a.project;
    if (!snap || !snap.id) return false;
    const list = state.data.projects;
    const i = list.findIndex((x) => x.id === snap.id);
    const back = clone(snap);
    if (i >= 0) keepTeamSteps(list[i], back, Array.isArray(a.dropTeamSteps) ? a.dropTeamSteps : []);
    keepTeamUndone(i >= 0 ? list[i] : null, back, typeof a.teamUndone === 'string' ? a.teamUndone : null);
    if (i >= 0) keepServerParts(list[i], back);
    // an undone delete of a task made from an email: a task the server made since for the same thread is folded back into it
    const conv = i < 0 && Array.isArray(back.thread) && back.mail && back.mail.conversationId;
    if (conv) {
      for (let k = list.length - 1; k >= 0; k--) {
        const d = list[k];
        if (!d || d.id === back.id || !Array.isArray(d.thread) || !d.mail || d.mail.conversationId !== conv) continue;
        keepServerParts(d, back);
        const onlyServer = !(d.steps || []).length && !(d.files || []).length && (d.workNotes || []).every((n) => n.mail || n.app)
          && !list.some((x) => parentIdsOf(x).includes(d.id));
        if (onlyServer) list.splice(k, 1); // nothing of yours in it: the two are one task again
      }
    }
    // Undo of Pause / Finish while its timer ran: the timer runs again from its start, so no timed minutes are lost;
    // another timer running by now: the minutes stay logged instead
    const tm = a.timer && typeof a.timer === 'object' && a.timer.projectId === snap.id && typeof a.timer.start === 'string' && typeof a.timer.id === 'string' ? a.timer : null;
    let keepLogged = false;
    if (tm && back.state === 'active' && !state.data.timer) state.data.timer = { projectId: snap.id, start: tm.start, id: tm.id };
    else if (tm && !(state.data.timer && state.data.timer.id === tm.id)) {
      const logged = i >= 0 && (list[i].timeLogs || []).find((l) => l && l.id === tm.id);
      if (logged && !(back.timeLogs || []).some((l) => l && l.id === tm.id)) { (back.timeLogs ||= []).push(clone(logged)); keepLogged = true; }
    }
    if (i >= 0) list[i] = back;
    else list.splice(Math.min(Math.max(0, a.index ?? 0), list.length), 0, back);
    if (typeof a.removeProjectId === 'string' && a.removeProjectId !== snap.id) { // Undo of "Make it a project": the new one goes
      const k = list.findIndex((x) => x.id === a.removeProjectId);
      if (k >= 0) list.splice(k, 1);
      // like deleteProject: a task put into the new project meanwhile (this or another device) is no longer in it
      for (const c of list) if (parentIdsOf(c).includes(a.removeProjectId)) setParents(c, parentIdsOf(c).filter((x) => x !== a.removeProjectId));
    }
    // the saved links are checked against the data as it is now (another device may have deleted a project, or made
    // this task a project): only projects that are still there, never a project inside a project
    const data = state.data;
    if (parentIdsOf(back).length) setParents(back, parentIdsOf(back).filter((pid) => linkStillOk(data, back, list.find((x) => x.id === pid))));
    // Undo of deleting a project: its tasks go back into it ({ childId: projectId }; only the link, nothing else of theirs)
    if (a.parentIds && typeof a.parentIds === 'object' && !Array.isArray(a.parentIds)) {
      for (const [cid, pid] of Object.entries(a.parentIds)) {
        const c = list.find((x) => x.id === cid);
        if (c && pid === snap.id && c.id !== snap.id && !parentIdsOf(c).includes(pid) && linkStillOk(data, c, back)) setParents(c, [...parentIdsOf(c), pid]);
      }
    }
    // Undo of taking it out (or deleting it): its place in each 📂 project's order comes back ({ mainId: index })
    if (a.orderPos && typeof a.orderPos === 'object' && !Array.isArray(a.orderPos)) {
      for (const [mid, k] of Object.entries(a.orderPos)) {
        const m = list.find((x) => x.id === mid);
        if (!m || !Number.isInteger(k) || k < 0 || !parentIdsOf(back).includes(mid)) continue;
        const order = Array.isArray(m.taskOrder) ? m.taskOrder : [];
        if (!order.includes(back.id)) m.taskOrder = [...order.slice(0, k), back.id, ...order.slice(k)];
      }
    }
    for (const pid of parentIdsOf(back)) { const m = list.find((x) => x.id === pid); if (m) m.isMain = true; }
    if (list.some((x) => x.id !== back.id && parentIdsOf(x).includes(back.id))) back.isMain = true;
    const undone = [a.undoOpId, ...(Array.isArray(a.undoOpIds) ? a.undoOpIds : [])].filter(Boolean).flatMap((id) => [id, ...(keepLogged && id === a.undoOpId ? [] : [id + 't']), id + 'm', id + 'u']);
    for (const id of undone) {
      for (const events of Object.values(state.history)) {
        const k = events.findIndex((e) => e.id === id);
        if (k < 0) continue;
        const [gone] = events.splice(k, 1);
        // an undone untick: its step is done again, so the tick line it took away comes back (if that month is loaded)
        const t = gone.tick && gone.tick.event;
        const back = t && state.history[gone.tick.month];
        if (back && !back.some((e) => e.id === t.id)) {
          const at = back.findIndex((e) => e.at > t.at);
          back.splice(at < 0 ? back.length : at, 0, clone(t));
        }
      }
    }
    return true;
  },

  // ---------- Steps ----------
  addStep(state, op, a) {
    const p = findProject(state.data, a.projectId);
    if (!p || p.steps.some((s) => s.id === a.stepId)) return false;
    if (a.byTeam && (p.teamDropped || []).includes(a.stepId)) return false; // a team step you deleted or undid: stays away (every device)
    const text = cleanText(a.text, 1000).trim();
    if (!text) return false;
    const step = {
      id: a.stepId, text, done: false, doneAt: null,
      dueDate: cleanDate(a.dueDate), note: '', waiting: false, waitingOn: '',
      createdAt: op.at, updatedAt: op.at,
    };
    const link = cleanLink(a.link);
    if (link) step.link = link; // the mail or web page this step came from (✉ Open mail)
    if (a.byTeam) step.addedByTeam = true; // the person added it on Work Task (a delete is remembered, see teamDropped)
    // New steps go after the last unfinished step (above the Done section).
    let at = p.steps.length;
    for (let i = p.steps.length - 1; i >= 0; i--) if (!p.steps[i].done) { at = i + 1; break; }
    if (!p.steps.some((s) => !s.done)) at = 0;
    p.steps.splice(at, 0, step);
    touch(p, op);
    addEvent(state, op, p, a.byTeam ? 'team_step_added' : 'step_added', text);
    return true;
  },

  /** worktask.in: the whole project is given to a team member ({userId, name}), or taken back (userId null). */
  setProjectTeam(state, op, a) {
    const p = findProject(state.data, a.projectId);
    if (!p || p.misc) return false; // (📂 Misc is never given: it holds every loose task)
    const userId = Number.isInteger(a.userId) && a.userId > 0 ? a.userId : null;
    const name = cleanText(a.name || '', 80).trim();
    const needsPhoto = !!a.needsPhoto;
    const record = !!a.record; // 📒 the person adds entries (a record), not one update a day
    // given through a 📂 project (its tasks go with it): which one (rules.js projectGiveChanges)
    const via = userId && typeof a.viaProject === 'string' && findProject(state.data, a.viaProject) ? a.viaProject : null;
    const main = isMainProject(state.data, p);
    if (!userId && !p.team) { // not given: "I keep this one" (a task in a 📂 project you give; it does not go with it)
      if (!a.keepOff || main || p.teamOff) return false;
      p.teamOff = true; touch(p, op);
      return true;
    }
    if (userId && p.team && p.team.userId === userId && p.team.name === name && !!p.team.needsPhoto === needsPhoto && !!p.team.record === record && (p.team.viaProject || null) === via && !(main && a.giveTasks)) return false;
    const old = p.team;
    if (userId) {
      p.team = { userId, name, since: old && old.userId === userId ? old.since : indiaDate(op.at), ...(needsPhoto ? { needsPhoto: true } : {}), ...(record ? { record: true } : {}), ...(via ? { viaProject: via } : {}) };
      delete p.teamOff;
      // giving a 📂 project gives all its tasks again, also one taken back on its own before
      if (main && a.giveTasks) for (const c of state.data.projects) if (parentIdsOf(c).includes(p.id)) delete c.teamOff;
    } else {
      delete p.team;
      if (a.keepOff && !main) p.teamOff = true; // taken back on its own: does not come back with its 📂 project
    }
    touch(p, op);
    const viaName = via ? findProject(state.data, via).name : '';
    addEvent(state, op, p, a.byTeam ? 'team_moved' : 'edited', userId ? `Given to ${name}${viaName ? ` (with 📂 ${viaName})` : ''}` : `Taken back from ${old.name}`);
    return true;
  },

  /** worktask.in: a team member sent an update on this project that day (makes it green, shown with 👥). */
  teamWorked(state, op, a) {
    const p = findProject(state.data, a.projectId);
    const day = cleanDate(a.day);
    if (!p || !day || day > indiaDate(op.at)) return false;
    const days = p.teamDays || [];
    const isNew = !days.includes(day), later = !p.teamWorkDate || p.teamWorkDate < day;
    if (!isNew && !later) return false;
    if (isNew) p.teamDays = [...days, day].sort().slice(-60); // the days the team worked on it (for the day boxes)
    if (later) p.teamWorkDate = day;
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
    const reminderOn = s.remindUntil && s.snoozedUntil === s.remindUntil && s.snoozedUntil > indiaDate(op.at);
    if (s.snoozedUntil && !reminderOn && (a.field === 'dueDate' || a.field === 'repeat')) {
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
    delete s.movedTo; // a normal tick is never a move (only stepToProject sets it)
    // ticked for the team (they finished it, maybe days ago): their day, and not your own work today
    s.doneAt = a.byTeam ? teamTime(a.at, op) : op.at;
    s.updatedAt = op.at;
    if (a.byTeam) s.byTeam = true;
    else p.lastTickDate = laterDate(p.lastTickDate, indiaDate(op.at));
    if (s.repeat) {
      // A repeating step comes back: a fresh copy, due on the next date (same id on every replay).
      const doneDay = indiaDate(op.at);
      // the day of the month: from its due date (a date you moved wins); the kept day only when the due date is that day
      // or a short month cut it (31st → 30 Apr keeps 31)
      const dueDay = s.dueDate ? Number(s.dueDate.slice(8, 10)) : 0;
      const keptDay = s.repeatDay && dueDay && (dueDay === s.repeatDay || (dueDay < s.repeatDay && addDays(s.dueDate, 1).endsWith('-01'))) ? s.repeatDay : 0;
      const repeatDay = s.repeat === 'monthly' ? (keptDay || dueDay || s.repeatDay || Number(doneDay.slice(8, 10))) : null;
      const due = nextRepeatDate(s.repeat, s.dueDate, doneDay, repeatDay);
      const copyId = op.id + 'r';
      s.spawnedCopy = copyId;
      if (!p.steps.some((x) => x.id === copyId)) {
        p.steps.push({
          id: copyId, text: s.text, done: false, doneAt: null, dueDate: due, snoozedUntil: due,
          note: s.note || '', waiting: false, waitingOn: '', repeat: s.repeat, createdAt: op.at, updatedAt: op.at,
          ...(repeatDay ? { repeatDay } : {}),
        });
      }
    }
    touch(p, op);
    if (s.repeat) {
      // keep data small: older finished copies of this repeating step are dropped (the Diary keeps them)
      p.steps = p.steps.filter((x) => x === s || !(x.done && x.repeat === s.repeat && x.text === s.text));
    }
    addEvent(state, op, p, a.byTeam ? 'team_ticked' : 'step_ticked', s.text, { stepId: s.id });
    return true;
  },

  untickStep(state, op, a) {
    const p = findProject(state.data, a.projectId);
    const s = p && p.steps.find((x) => x.id === a.stepId);
    if (!s || !s.done) return false;
    s.done = false;
    s.doneAt = null;
    s.updatedAt = op.at;
    delete s.byTeam;
    delete s.movedTo; // a moved step ("Make it a project") un-ticked: an ordinary open step again
    if (s.spawnedCopy) {
      // un-ticking a repeating step takes back the copy it made (if not started)
      const k = p.steps.findIndex((x) => x.id === s.spawnedCopy && !x.done);
      if (k >= 0) p.steps.splice(k, 1);
      s.spawnedCopy = null;
    }
    recalcLastTick(p);
    touch(p, op);
    const tick = removeTickEvent(state, p, s);
    addEvent(state, op, p, a.byTeam ? 'team_step_unticked' : 'step_unticked', s.text, tick ? { tick } : null);
    return true;
  },

  deleteStep(state, op, a) {
    const p = findProject(state.data, a.projectId);
    const i = p ? p.steps.findIndex((x) => x.id === a.stepId) : -1;
    if (i < 0) return false;
    const [s] = p.steps.splice(i, 1);
    if (s.addedByTeam) dropTeamStep(p, s.id);
    touch(p, op); // lastTickDate stays as it is
    addEvent(state, op, p, 'step_deleted', s.text, { stepId: s.id });
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
    const rich = richNote(a);
    if (!rich) return false; // the table / pasted page is too big
    const text = rich.text;
    if (!p || !text || p.workNotes.some((n) => n.id === a.noteId)) return false;
    // A note can belong to a step ("what I did on this step"); it stays even if the step is later ticked.
    const stepId = a.stepId && p.steps.some((s) => s.id === a.stepId) ? a.stepId : null;
    // a note for the team's work (their day, not your work today)
    const at = a.team ? teamTime(a.at, op) : op.at;
    p.workNotes.unshift({ id: a.noteId, text, ...(rich.html ? { html: rich.html } : {}), stepId, createdAt: at, updatedAt: at, ...(a.team ? { team: true } : {}) });
    touch(p, op);
    addEvent(state, op, p, a.team ? 'team_note' : 'note_added', text);
    return true;
  },

  editWorkNote(state, op, a) {
    const p = findProject(state.data, a.projectId);
    const n = p && p.workNotes.find((x) => x.id === a.noteId);
    const rich = richNote(a);
    if (!rich) return false;
    const { text, html } = rich;
    if (!n || !text || (n.text === text && (n.html || null) === html)) return false;
    n.text = text;
    if (html) n.html = html; else delete n.html;
    n.updatedAt = op.at;
    touch(p, op);
    addEvent(state, op, p, 'note_edited', text);
    return true;
  },

  /** ✎ an update saved under the wrong step: move it to another step of the same task, or to the whole task (stepId null). */
  setNoteStep(state, op, a) {
    const p = findProject(state.data, a.projectId);
    const n = p && p.workNotes.find((x) => x.id === a.noteId);
    const stepId = a.stepId && p && p.steps.some((x) => x.id === a.stepId) ? a.stepId : null;
    if (!n || (a.stepId && !stepId) || (n.stepId || null) === stepId) return false;
    n.stepId = stepId;
    n.updatedAt = op.at;
    touch(p, op);
    return true;
  },

  deleteWorkNote(state, op, a) {
    const p = findProject(state.data, a.projectId);
    const i = p ? p.workNotes.findIndex((x) => x.id === a.noteId) : -1;
    if (i < 0) return false;
    const [n] = p.workNotes.splice(i, 1);
    touch(p, op);
    addEvent(state, op, p, a.byTeam ? 'team_note_deleted' : 'note_deleted', n.text);
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

  // ---------- Tags and the timer (groups are gone, 23 Oct: one list) ----------
  /** The timer (and the Time report) on or off. */
  setTimer(state, op, a) {
    const settings = (state.data.settings ||= {});
    if (timerOn(state.data) === !!a.on) return false;
    settings.timer = !!a.on;
    return true;
  },

  /** A tag any task can pick. */
  addTag(state, op, a) {
    const name = cleanText(a.name, 60).trim();
    if (!name) return false;
    const tags = (state.data.tags ||= []);
    if (tags.some((t) => t.id === a.tagId || t.name.toLowerCase() === name.toLowerCase())) return false;
    tags.push({ id: a.tagId, name });
    return true;
  },

  renameTag(state, op, a) {
    const tags = state.data.tags || [];
    const t = tags.find((x) => x.id === a.tagId);
    const name = cleanText(a.name, 60).trim();
    if (!t || !name || t.name === name) return false;
    if (tags.some((x) => x.id !== t.id && x.name.toLowerCase() === name.toLowerCase())) return false;
    t.name = name;
    return true;
  },

  deleteTag(state, op, a) {
    const tags = state.data.tags || [];
    const i = tags.findIndex((x) => x.id === a.tagId);
    if (i < 0) return false;
    tags.splice(i, 1);
    for (const p of state.data.projects) if (p.tagId === a.tagId) p.tagId = null; // time stays, now "No tag"
    return true;
  },

  // ---------- People ----------
  // ---- Inbox (quick capture): ideas and tasks written down fast, sorted into projects later ----
  // An item can come from an email (worktask.in reads the owner's Outlook Inbox): it then has a short `note`
  // (when it came, the start of the email) and `mail` = { conversationId, count } so replies join it.
  addInbox(state, op, a) {
    const inbox = (state.data.inbox ||= []);
    const text = cleanText(a.text, 1000).replace(/\s+/g, ' ').trim();
    if (!text || inbox.some((x) => x.id === a.itemId)) return false;
    inbox.push({ id: a.itemId, text, createdAt: op.at, ...inboxExtras(a) });
    return true;
  },

  /** A reply in the same email thread: the item says how many emails, the newest one's start and its link. */
  updateInbox(state, op, a) {
    const item = (state.data.inbox || []).find((x) => x.id === a.itemId);
    if (!item) return false;
    const ex = inboxExtras({ note: a.note, link: a.link, mail: item.mail && { ...item.mail, ...(a.mail || {}), conversationId: item.mail.conversationId, count: a.count ?? item.mail.count } });
    if (a.note !== undefined) { if (ex.note) item.note = ex.note; else delete item.note; }
    if (ex.link) item.link = ex.link;
    if (ex.mail) item.mail = ex.mail;
    return true;
  },

  /**
   * A new email in a thread that is already a step or a project: a short note on the project (on the step, if it was one),
   * with the email's link. It is not your work (it does not make the dot green or count in the day score).
   */
  addMailNote(state, op, a) {
    const p = findProject(state.data, a.projectId);
    const text = cleanText(a.text, 1000).replace(/\s+/g, ' ').trim();
    if (!p || !text || (p.workNotes ||= []).some((n) => n.id === a.noteId)) return false;
    const stepId = a.stepId && p.steps.some((s) => s.id === a.stepId) ? a.stepId : null;
    const link = cleanLink(a.link);
    p.workNotes.unshift({ id: a.noteId, text, stepId, createdAt: op.at, updatedAt: op.at, mail: true, ...(link ? { link } : {}) });
    // the step / project remembers the newest email of its thread (for a later "draft a reply")
    const target = stepId ? p.steps.find((s) => s.id === stepId) : p;
    if (a.mail && target.mail) target.mail = cleanMail({ ...target.mail, ...a.mail, conversationId: target.mail.conversationId }) || target.mail;
    addEvent(state, op, p, 'mail_note', text);
    return true;
  },

  // ---- Email replies: a draft kept where the email lives (never sent from here; you press Send in Outlook) ----
  // reply = { text, at, by: 'claude' | 'you', forMessageId, state: 'ready' | 'later' | 'sent', laterUntil?, sentAt? }

  /** A reply draft (by Claude, or typed by you; it saves by itself). Up to REPLY_MAX letters. */
  setReply(state, op, a) {
    const t = mailTarget(state.data, a);
    const text = cleanText(a.text, REPLY_MAX).replace(/\s+$/, '');
    if (!t || !text.trim()) return false;
    const old = t.target.reply;
    const by = a.by === 'claude' ? 'claude' : 'you';
    if (replyOpen(old) && old.text === text) return false;
    const fresh = !replyOpen(old);
    t.target.reply = {
      // the email it answers: the one Claude read (an email that came meanwhile then shows as newer), else the newest
      text, at: op.at, by, forMessageId: (typeof a.forMessageId === 'string' && a.forMessageId.trim().slice(0, 400)) || t.target.mail.messageId || null,
      state: fresh ? 'ready' : old.state, ...(!fresh && old.laterUntil ? { laterUntil: old.laterUntil } : {}),
    };
    if (fresh) addEvent(state, op, t.project, 'reply_prepared', `Reply prepared${by === 'claude' ? ' by Claude' : ''}: ${t.target.mail.subject || ''}`.trim());
    return true;
  },

  /** ✕ Clear: the draft is thrown away. */
  clearReply(state, op, a) {
    const t = mailTarget(state.data, a);
    if (!t || !replyOpen(t.target.reply)) return false;
    delete t.target.reply;
    return true;
  },

  /** ⏭ Later: the draft waits until a date (tomorrow when none is given). */
  replyLater(state, op, a) {
    const t = mailTarget(state.data, a);
    if (!t || !replyOpen(t.target.reply)) return false;
    const today = indiaDate(op.at);
    const until = cleanDate(a.until) || addDays(today, 1);
    if (until <= today) return false;
    t.target.reply = { ...t.target.reply, state: 'later', laterUntil: until };
    return true;
  },

  /** ✓ Sent: you sent the reply (in Outlook). Your work, like a note: the project turns green today. */
  markReplySent(state, op, a) {
    const t = mailTarget(state.data, a);
    if (!t || (t.target.reply && t.target.reply.state === 'sent' && !waitingAgain(t.target))) return false;
    const old = t.target.reply || { text: '', at: op.at, by: 'you', forMessageId: t.target.mail.messageId || null };
    const { laterUntil, ...rest } = old;
    void laterUntil;
    t.target.reply = { ...rest, state: 'sent', sentAt: op.at };
    if (t.project) {
      touch(t.project, op);
      markWork(t.project, op);
      addEvent(state, op, t.project, 'reply_sent', `Reply sent: ${t.target.mail.subject || ''}`.trim());
    }
    return true;
  },

  /**
   * Undo of ✓ Sent: the draft comes back as it was (a.reply; none = waiting again), the "Reply sent" line goes, and the
   * day is not counted as work any more unless something else was done that day (a.workDate = the date before).
   * Only for that ✓ Sent (a.sentAt = its time): a reply seen in Outlook since is left alone.
   */
  undoReplySent(state, op, a) {
    const t = mailTarget(state.data, a);
    const r = t && t.target.reply;
    if (!r || r.state !== 'sent' || typeof a.sentAt !== 'string' || r.sentAt !== a.sentAt) return false;
    const b = a.reply && typeof a.reply === 'object' ? a.reply : null;
    const text = b ? cleanText(b.text, REPLY_MAX).replace(/\s+$/, '') : '';
    if (text.trim()) {
      const until = b.state === 'later' ? cleanDate(b.laterUntil) : null;
      t.target.reply = { text, at: typeof b.at === 'string' ? b.at : op.at, by: b.by === 'claude' ? 'claude' : 'you', forMessageId: r.forMessageId || null, state: until ? 'later' : 'ready', ...(until ? { laterUntil: until } : {}) };
    } else delete t.target.reply;
    if (typeof a.undoOpId === 'string' && a.undoOpId) {
      for (const events of Object.values(state.history)) {
        const k = events.findIndex((e) => e.id === a.undoOpId && e.kind === 'reply_sent');
        if (k >= 0) events.splice(k, 1);
      }
    }
    const p = t.project;
    const day = indiaDate(a.sentAt);
    if (p && p.workDate === day) {
      const other = Object.values(state.history).some((list) => list.some((e) => e.projectId === p.id && WORK.has(e.kind) && indiaDate(e.at) === day));
      const was = cleanDate(a.workDate) || null;
      if (!other && (!was || was < day)) p.workDate = was;
    }
    return true;
  },

  /**
   * Seen in Outlook's Sent Items (worktask.in does this by itself, see team/app/outlook.php): a reply in this thread
   * was sent after its newest email. Not your work (it does not make the dot green). a.sentAt = when it was sent.
   */
  mailReplied(state, op, a) {
    const t = mailTarget(state.data, a);
    const sentAt = typeof a.sentAt === 'string' && !Number.isNaN(Date.parse(a.sentAt)) ? new Date(a.sentAt).toISOString() : null;
    if (!t || !sentAt) return false;
    const { target } = t;
    const r = target.reply;
    if (!(replyOpen(r) || !r || waitingAgain(target))) return false;
    if (target.mail.at && Date.parse(sentAt) < Date.parse(target.mail.at)) return false; // sent before the newest email
    const { laterUntil, ...rest } = r || { text: '', at: sentAt, by: 'you', forMessageId: target.mail.messageId || null };
    void laterUntil;
    target.reply = { ...rest, state: 'sent', sentAt };
    if (t.project) addEvent(state, op, t.project, 'mail_replied', `Replied in Outlook: ${target.mail.subject || ''}`.trim());
    return true;
  },

  removeInbox(state, op, a) {
    const inbox = state.data.inbox || [];
    const i = inbox.findIndex((x) => x.id === a.itemId);
    if (i < 0) return false;
    inbox.splice(i, 1);
    return true;
  },

  /**
   * Undo for the Inbox (one change): the item goes back in its place, and the step / project it became is taken back.
   * a = { item: {id, text, createdAt}, index, undoOpId, projectId? + stepId? (the step inboxToStep added), removeProjectId? }
   * Only the added step (or the made project) is taken away — never an old copy of the whole task put back, so what
   * other devices or the server did meanwhile stays. Safe to replay (twice, or on another device). Older saved changes
   * carry project = a copy from before: only the step(s) not in that copy with the item's words are taken away.
   */
  inboxUndo(state, op, a) {
    const it = a.item;
    if (!it || !it.id) return false;
    const inbox = (state.data.inbox ||= []);
    const list = state.data.projects;
    if (typeof a.removeProjectId === 'string' && a.removeProjectId) {
      const i = list.findIndex((p) => p.id === a.removeProjectId);
      if (i >= 0) list.splice(i, 1);
      for (const c of list) if (parentIdsOf(c).includes(a.removeProjectId)) setParents(c, parentIdsOf(c).filter((x) => x !== a.removeProjectId));
      dropFromOrder(state.data, a.removeProjectId);
    } else {
      const pid = typeof a.projectId === 'string' ? a.projectId : a.project && typeof a.project.id === 'string' ? a.project.id : null;
      const p = pid ? findProject(state.data, pid) : null;
      if (p) {
        let gone;
        if (typeof a.stepId === 'string') gone = (s) => s.id === a.stepId;
        else if (a.project && Array.isArray(a.project.steps)) {
          const had = new Set(a.project.steps.map((s) => s && s.id));
          const words = cleanText(it.text, 1000).trim();
          gone = (s) => !had.has(s.id) && s.text === words;
        }
        if (gone) p.steps = p.steps.filter((s) => !gone(s));
      }
    }
    if (a.undoOpId) for (const events of Object.values(state.history)) {
      const k = events.findIndex((e) => e.id === a.undoOpId);
      if (k >= 0) events.splice(k, 1);
    }
    if (!inbox.some((x) => x.id === it.id)) {
      const text = cleanText(it.text, 1000).trim();
      if (text) inbox.splice(Math.min(Math.max(0, a.index ?? inbox.length), inbox.length), 0, { id: it.id, text, createdAt: it.createdAt || op.at, ...inboxExtras(it), ...(it.mail && it.reply ? { reply: clone(it.reply) } : {}) });
    }
    return true;
  },

  /** Inbox item → a step in a project (one change, so it can't be half done). */
  inboxToStep(state, op, a) {
    const inbox = state.data.inbox || [];
    const item = inbox.find((x) => x.id === a.itemId);
    if (!item || !handlers.addStep(state, op, { projectId: a.projectId, stepId: a.stepId, text: item.text, link: item.link })) return false;
    const step = findProject(state.data, a.projectId).steps.find((s) => s.id === a.stepId);
    if (item.note) step.note = item.note; // the email's start, kept on the step
    if (item.mail) step.mail = cleanMail(item.mail); // later replies in the thread come here as notes
    if (item.mail && item.reply) step.reply = clone(item.reply); // a reply draft goes with it
    inbox.splice(inbox.indexOf(item), 1);
    return true;
  },

  /**
   * "↗ Make it a project": an open step becomes its own active project (one change, so Undo is one step). The new
   * project: name = the step's words, same tag / priority, about = the step's note, target date = the step's
   * due date, and the step's email thread and reply draft. The old step is ticked done (your work, like a tick) with
   * movedTo = the new project. A team task on the step is left as it is (see rules.js singleStepClose).
   */
  stepToProject(state, op, a) {
    const { data } = state;
    const p = findProject(data, a.projectId);
    const s = p && p.steps.find((x) => x.id === a.stepId);
    if (!s || s.done || typeof a.newProjectId !== 'string' || !a.newProjectId || findProject(data, a.newProjectId)) return false;
    const name = cleanText(s.text, 1000).replace(/\s+/g, ' ').trim().slice(0, 200) || 'New project';
    const made0 = { ...op, id: op.id + 't' }; // its own history line (Undo takes both away, see restoreProject)
    if (!handlers.createProject(state, made0, { projectId: a.newProjectId, name, priority: p.priority, ...(cleanDate(s.dueDate) ? { deadline: s.dueDate } : {}) })) return false;
    const made = findProject(data, a.newProjectId);
    if (p.tagId) made.tagId = p.tagId;
    const about = cleanText(s.note, 5000).replace(/\s+/g, ' ').trim().slice(0, ABOUT_MAX);
    if (about) made.about = about;
    if (s.link) made.links.push({ id: a.newProjectId + '-link', ...s.link });
    if (s.mail) { made.mail = clone(s.mail); delete s.mail; } // later replies in the thread go to the new project
    if (s.reply) { made.reply = clone(s.reply); delete s.reply; }
    for (const e of Object.values(state.history)) for (const x of e) if (x.id === made0.id) x.detail = `Made from a step of ${p.name}`;
    // the old step: done (moved), like a tick — no repeat copy, it lives on as the new project
    s.done = true;
    s.doneAt = op.at;
    s.updatedAt = op.at;
    s.movedTo = a.newProjectId;
    p.lastTickDate = laterDate(p.lastTickDate, indiaDate(op.at));
    touch(p, op);
    addEvent(state, op, p, 'step_ticked', s.text, { stepId: s.id, movedTo: a.newProjectId });
    addEvent(state, { ...op, id: op.id + 'm' }, p, 'step_to_project', `Step moved to its own project: ${made.name}`);
    return true;
  },

  /** Inbox item → a new project with that name. */
  inboxToProject(state, op, a) {
    const inbox = state.data.inbox || [];
    const item = inbox.find((x) => x.id === a.itemId);
    const long = item && item.text.length > 120;
    const name = long ? item.text.slice(0, 117).replace(/\s+\S*$/, '') + '…' : item && item.text;
    if (!item || !handlers.createProject(state, op, { projectId: a.projectId, name })) return false;
    const made = findProject(state.data, a.projectId);
    if (long) made.notes = item.text; // nothing is cut off: the full text goes into the notes
    if (item.link) made.links.push({ id: a.projectId + '-link', ...item.link }); // the mail or page it came from
    if (item.note) made.notes = made.notes ? `${made.notes}\n\n${item.note}` : item.note;
    if (item.mail) made.mail = cleanMail(item.mail); // later replies in the thread come here as notes
    if (item.mail && item.reply) made.reply = clone(item.reply); // a reply draft goes with it
    inbox.splice(inbox.indexOf(item), 1);
    return true;
  },

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
    // Never inside an email address (x@acton-finishing.com).
    // Skip places where a LONGER name of someone else matches (e.g. "@Ravi Kumar" when renaming "Ravi").
    const longer = people.filter((x) => x.id !== person.id && x.name.length > old.length
      && x.name.toLowerCase().startsWith(old.toLowerCase())).map((x) => x.name.toLowerCase());
    const re = new RegExp('(?<![\\p{L}\\p{N}_.+-])@' + old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}_])', 'giu');
    const wordChar = /[\p{L}\p{N}_]/u;
    const fix = (t, nm = name) => (typeof t !== 'string' ? t : t.replace(re, (match, offset) => {
      const rest = t.slice(offset + 1).toLowerCase();
      const isLonger = longer.some((n) => rest.startsWith(n) && !wordChar.test(t.charAt(offset + 1 + n.length)));
      return isLonger ? match : '@' + nm; // function replacer: "$" in a name is kept as typed
    }));
    for (const p of state.data.projects) {
      p.notes = fix(p.notes);
      for (const s of p.steps) {
        s.text = fix(s.text);
        s.note = fix(s.note);
        if (s.waitingOn && s.waitingOn.toLowerCase() === old.toLowerCase()) s.waitingOn = name;
      }
      for (const n of p.workNotes) { n.text = fix(n.text); if (n.html) n.html = sanitizeRich(fix(n.html, name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))); }
    }
    person.name = name;
    people.sort((x, y) => x.name.localeCompare(y.name));
    return true;
  },

  /** Phone (for WhatsApp) and email (for Outlook) of a person. Empty clears it. */
  setPersonContact(state, op, a) {
    const person = (state.data.people || []).find((x) => x.id === a.personId);
    if (!person) return false;
    let changed = false;
    if ('phone' in a) {
      const phone = cleanPhone(a.phone);
      if (phone === null) return false;
      if ((person.phone || '') !== phone) { person.phone = phone; changed = true; }
    }
    if ('email' in a) {
      const email = cleanText(a.email, 120).trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
      if ((person.email || '') !== email) { person.email = email; changed = true; }
    }
    return changed;
  },

  deletePerson(state, op, a) {
    const people = state.data.people || [];
    const i = people.findIndex((x) => x.id === a.personId);
    if (i < 0) return false;
    people.splice(i, 1); // texts keep "@Name"; they are just no longer linked
    return true;
  },

  /** "📋 Send pending list" went out (WhatsApp or Outlook): remember when, on the person. Not work: no history line. */
  markPersonSent(state, op, a) {
    const person = (state.data.people || []).find((x) => x.id === a.personId);
    const at = typeof a.at === 'string' && !Number.isNaN(Date.parse(a.at)) ? new Date(a.at).toISOString() : op.at;
    if (!person || person.sentAt === at) return false;
    person.sentAt = at;
    return true;
  },

  /** Save the daily scores of past days (for the streak and the 7-day bars). Keeps 120 days. */
  recordScores(state, op, a) {
    const scores = (state.data.dayScores ||= {});
    let changed = false;
    for (const [day, v] of Object.entries(a.scores || {})) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      if (scores[day] && !(a.raise && (Number(v.green) || 0) > scores[day].green)) continue; // kept, unless the team's work raises it
      if (scores[day]) { scores[day] = { green: Math.min(Number(v.green) || 0, scores[day].total), total: scores[day].total }; changed = true; continue; } // only green goes up
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
    const removed = (secrets.removed ||= {});
    if ((secrets[a.provider] || '') === key && (key || removed[a.provider])) return false;
    if (key) { secrets[a.provider] = key; delete removed[a.provider]; } else {
      delete secrets[a.provider];
      removed[a.provider] = true; // remembered, so an old copy on another device is never uploaded again
    }
    return true;
  },

  // ---------- Time log ----------
  // One timer at a time (data.timer). Starting another project stops the running one first.

  startTimer(state, op, a) {
    const p = findProject(state.data, a.projectId);
    if (!p || p.state !== 'active') return false;
    if (!timerOn(state.data)) return false; // the timer is switched off in Settings
    const t = state.data.timer;
    if (t && t.projectId === p.id) return false; // already running here
    // pressed while another timer (or none) ran: a timer started since on another device is never stopped by this late press
    if ('running' in a && (t ? t.id : null) !== a.running) return false;
    if (t) closeTimer(state, op, op.at);
    state.data.timer = { projectId: p.id, start: op.at, id: op.id };
    touch(p, op);
    return true;
  },

  stopTimer(state, op, a) {
    if (!state.data.timer) return false;
    // a late Stop (pressed offline) stops only the timer it was pressed for, never one started since
    if (a && a.timerId && a.timerId !== state.data.timer.id) return false;
    closeTimer(state, op, op.at);
    return true;
  },

  /** Time worked but not timed: minutes on a day (default today). */
  addTime(state, op, a) {
    const p = findProject(state.data, a.projectId);
    const minutes = Math.round(Number(a.minutes));
    if (!p || !(minutes > 0) || minutes > 24 * 60) return false;
    if ((p.timeLogs || []).some((l) => l.id === op.id)) return false; // replayed after a clash: already added
    const day = cleanDate(a.day) || indiaDate(op.at);
    const start = a.day ? new Date(`${day}T12:00:00+05:30`).toISOString() : new Date(Date.parse(op.at) - minutes * 60000).toISOString();
    (p.timeLogs ||= []).push({ id: op.id, start, minutes, manual: true });
    touch(p, op);
    if (day === indiaDate(op.at)) markWork(p, op); // time added for today is a real update
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
  /** Settings: how often a task with no choice of its own should move (1–90 days; null = back to 3). Not work. */
  setEveryDefault(state, op, a) {
    const settings = (state.data.settings ||= {});
    const days = a.days === null || a.days === undefined ? null : a.days;
    if (days !== null && !(Number.isInteger(days) && days >= 1 && days <= 90)) return false;
    if ((settings.moveEvery ?? null) === days) return false;
    if (days === null) delete settings.moveEvery; else settings.moveEvery = days;
    return true;
  },

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
  markWork(p, op); // time worked is a real update
  // its own event id: a Pause / Finish in the same change also writes a history line with op.id
  addEvent(state, { ...op, id: op.id + 't' }, p, 'time_logged', `${minutes} min${capped ? ' (cut to 10 h)' : ''}`);
}

function clearStage(p) { delete p.stage; delete p.waitingFor; delete p.stageAt; }

function setState(state, op, a, from, to, kind) {
  const p = findProject(state.data, a.projectId);
  if (!p || p.state !== from) return false;
  if (to !== 'active' && state.data.timer && state.data.timer.projectId === p.id) closeTimer(state, op, op.at);
  p.state = to;
  p.stateChangedAt = op.at;
  if (to === 'active') {
    p.activeSince = indiaDate(op.at);
    if (p.snoozedUntil && p.snoozedUntil > indiaDate(op.at)) p.snoozedUntil = indiaDate(op.at); // back on Today now
  }
  touch(p, op);
  addEvent(state, op, p, kind, p.name);
  return true;
}

export const OP_TYPES = Object.keys(handlers);

export function applyOp(state, op) {
  // own keys only ('__proto__', 'toString'… are not changes); a broken change is skipped, never stops the app
  if (typeof op?.type !== 'string' || !Object.prototype.hasOwnProperty.call(handlers, op.type)) return false;
  try { return handlers[op.type](state, op, op.args || {}); } catch { return false; }
}

// Changes that may not come in through a link: they delete, give away, plant data or swap the AI key.
// addFile from the old address points at a GitHub file the server does not have, so its save would always fail.
// Only these kinds come along (a list of what is allowed, so a new kind of change is left out until it is added here):
// they add or change things without removing anything. Deletes, removals, edits that could empty a text, team, AI-key,
// timer-switch and the app's own bookkeeping changes never come in through a link (it can come from anyone).
export const CARRIED = new Set(['createProject', 'createMainProject', 'addToProject', 'setTaskOrder', 'snooze', 'setOnlyDays', 'setRemindAt',
  'setRemindOnce', 'wake', 'remindStep', 'addLink', 'markOpened', 'okForToday', 'undoOkForToday', 'moveProject', 'pause', 'unpause', 'reopen',
  'addStep', 'tickStep', 'untickStep', 'moveStep', 'chased', 'addWorkNote', 'addTag', 'renameTag', 'addInbox', 'updateInbox', 'addMailNote',
  'setReply', 'replyLater', 'inboxToStep', 'stepToProject', 'inboxToProject', 'addPerson', 'renamePerson', 'setPersonContact', 'markPersonSent',
  'startTimer', 'stopTimer', 'addTime', 'setStage', 'setMoveEvery']);
export const NOT_CARRIED = new Set(['deleteProject', 'restoreProject', 'deleteStep', 'setProjectTeam', 'addFile', 'setAiKey', 'setAiProvider',
  'removeFromProject', 'setParent', 'removeLink', 'editLink', 'finish', 'teamWorked', 'deleteWorkNote', 'editWorkNote', 'setNoteStep', 'setProjectField', 'setStepField',
  'removeFile', 'setTimer', 'setEveryDefault', 'deleteTag', 'clearReply', 'markReplySent', 'undoReplySent', 'mailReplied', 'removeInbox', 'inboxUndo', 'deletePerson',
  'recordScores', 'removeTime', 'incrementAiUsage', 'claimBrief', 'setBriefReady', 'addEvent', 'makeMisc']);

/** Changes carried from the old address (#ops=): keeps only known, harmless ones. Returns { ok, files, dropped }. */
export function carriedOps(list) {
  const out = { ok: [], files: 0, dropped: 0 };
  if (!Array.isArray(list)) return out;
  for (const o of list.slice(0, 500)) {
    const good = o && typeof o === 'object' && typeof o.id === 'string' && typeof o.type === 'string'
      && Object.prototype.hasOwnProperty.call(handlers, o.type) && typeof o.at === 'string' && !Number.isNaN(Date.parse(o.at))
      && (o.args === undefined || (o.args && typeof o.args === 'object' && !Array.isArray(o.args)));
    if (good && o.type === 'addFile') out.files++;
    else if (good && CARRIED.has(o.type) && !NOT_CARRIED.has(o.type) && !(o.args && o.args.sha)) out.ok.push(o);
    else out.dropped++;
  }
  out.dropped += Math.max(0, list.length - 500);
  return out;
}

export function applyOps(state, ops) {
  if (state && state.data) normalizeParents(state.data); // older saved data (parentId) read the new way
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
