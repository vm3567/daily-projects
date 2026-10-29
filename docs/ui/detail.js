// The right column: everything about one task (or 📂 project), all editable in place.

import { h, fmtDay, fmtTime, fmtSize, HAS_KEYBOARD } from './dom.js';
import { isPhoto } from './heic.js';

const MOD = /Mac|iPhone|iPad/.test(globalThis.navigator ? navigator.platform || navigator.userAgent || '' : '') ? '⌘' : 'Ctrl';
import { dotColour, isSnoozed, restUntil, restReason, onlyDaysOf, onlyDaysLabel, onlyDaysChip, remindOnceChip, indiaDateTime, WEEKDAYS, weekdayOf, stepWaitsForReminder, daysBetween, addDays, todayIndia, isOverdue, indiaDate, waitingDays, lastWorkDate, nextStep, stepLinkedTo, personStatus, minutesBetween, fmtMinutes, weekStart, seenUpTo, deleteQuestion, parseDuration } from '../rules.js';
import { WAIT_RED_DAYS } from '../config.js';
import { newId, PRIORITIES, cleanUrl, MAX_SNOOZE_DAYS, ABOUT_MAX } from '../ops.js';

const STATUS_OLD_DAYS = 7; // a status older than this turns grey and asks for an update
import { uploadFiles, uploadBlob, openFile, photoThumb } from './files.js';
import { richArea, richView, addDraftPhotos, readDraft, clearDraft, photoArgs, findEditor, fillEditor, editorPhoto, cursorInBlock, editorIsRich, namePasted } from './richedit.js';
import { enterAction, richFileIds, textToHtml } from '../rich.js';
import { projectEmailCards, emailThreadBlock } from './replies.js';
import { mainBox, mainChip, subProjectsBlock, openMainBox } from './mains.js';
import { isMainProject, timerOn, childrenOf, projectTasks, moveEveryOf, everyText, colourWhy, colourShort, todayList, MOVE_EVERY_PICKS } from '../rules.js';
import { stageLine } from './stage.js';
import { IN_NO_PROJECT } from './workparts.js';

/** 'project' for a 📂 project, 'task' for everything else (what the app once called a project). */
const kindWord = (ctx, p) => (isMainProject(ctx.store.view.data, p) ? 'project' : 'task');

const REPEAT_WORD = { daily: 'every day', weekly: 'every week', monthly: 'every month' };
const HISTORY_WORDS = {
  created: 'Task created', edited: 'Changed', renamed: 'Renamed', group_changed: 'Moved to group',
  step_added: 'Step added', step_edited: 'Step changed', step_ticked: 'Step done', step_unticked: 'Step un-ticked',
  step_deleted: 'Step deleted', note_added: 'Work note', note_edited: 'Work note changed', note_deleted: 'Work note deleted',
  paused: 'Paused', unpaused: 'Unpaused', finished: 'Finished', reopened: 'Reopened',
  file_added: 'File added', file_removed: 'File removed', deleted: 'Deleted', reviewed: 'OK for today',
  snoozed: 'Snoozed', woke: 'Woken up', step_remind: 'Remind me', time_added: 'Time added', time_logged: 'Time logged',
  group_added: 'Group added', group_renamed: 'Group renamed', group_deleted: 'Group deleted',
  team_ticked: 'Done by the team', team_note: 'Team note', team_step_added: 'Step added by the team', team_step_unticked: 'Opened again by the team',
  team_note_deleted: 'Team note removed', team_moved: 'Moved by the team', mail_note: 'Email reply', mail_task: 'Task made from an email', app_task: '🔌 Task from an app', app_note: '🔌 Update from an app',
  reply_prepared: 'Reply prepared', reply_sent: 'Reply sent', mail_replied: 'Reply sent (seen in Outlook)',
  step_to_project: 'Step made a task', main_changed: '📂 Project',
};

/** Text box that saves on its own: after a short pause in typing, and when leaving the box. */
function autoField(tag, props, onSave, onEnter = null) {
  let timer = null;
  const save = (el) => { clearTimeout(timer); onSave(el.value); };
  const { oneLine, ...rest } = props; // oneLine: a textarea that wraps, but Enter ends it like an input
  return h(tag, {
    ...rest,
    onInput: (e, el) => { clearTimeout(timer); timer = setTimeout(() => save(el), 900); },
    onChange: (e, el) => save(el),
    onFocusout: (e, el) => save(el),
    onKeydown: tag === 'input' || oneLine ? (e, el) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); if (onEnter) onEnter(); } } : undefined,
  });
}

export function updateState(ui, p) {
  return ((ui.update ||= {})[p.id] ||= { note: '', next: '' });
}

/** Upload photos for the write box (inline: shown inside the box, like a pasted screenshot). Save waits for them. */
function addUpdatePhotos(ctx, p, files, opts = {}) {
  return addDraftPhotos(ctx, updateState(ctx.ui, p), files, 'wn-' + p.id, opts);
}

/** Ctrl+V on a project: screenshots become photos inside today's update (write a line and Save); other files go to its files. */
export function pasteIntoProject(ctx, p, files) {
  const images = files.filter(isPhoto);
  const others = files.filter((f) => !isPhoto(f));
  if (images.length && p.state === 'active') {
    addUpdatePhotos(ctx, p, namePasted(images), { inline: true });
    ctx.toast('📷 Pasted — write a line in "What happened today?" and Save', 4000);
    focusUpdate(p);
  } else if (images.length) others.push(...images);
  if (others.length) uploadFiles(ctx, p.id, others);
}

/**
 * A photo pasted while in a step's box (owner, 29 Oct: "I am trying to add it in the step"): on a step that is
 * there, it is added to that step at once; in "+ Add the next step" it waits under the box and goes with the step
 * when Enter adds it. Other files go to the task's Files, as before.
 */
export async function pasteIntoStep(ctx, p, files, stepId = null) {
  const photos = files.filter(isPhoto);
  const others = files.filter((f) => !isPhoto(f));
  if (others.length) uploadFiles(ctx, p.id, others);
  const step = stepId ? p.steps.find((s) => s.id === stepId) : null;
  for (const f of photos) {
    const url = typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(f) : '';
    const wait = step ? null : { url, args: null };
    if (wait) { ((ctx.ui.stepPhotos ||= {})[p.id] ||= []).push(wait); ctx.render(); }
    const args = await uploadBlob(ctx, f);
    if (!args) { if (wait) { ctx.ui.stepPhotos[p.id] = ctx.ui.stepPhotos[p.id].filter((x) => x !== wait); ctx.render(); } continue; }
    if (step) ctx.act('addFile', { projectId: p.id, ...args, stepId: step.id }, `📷 Added to the step “${step.text}”`);
    else { wait.args = args; ctx.render(); }
  }
  if (!step && photos.length) ctx.toast('📷 Now type the step and press Enter: the photo goes with it', 4000);
}

/** The photos that belong to a step (pasted on it), small; a tap opens one. */
function stepOwnPhotos(ctx, p, s) {
  const mine = (p.files || []).filter((f) => f.stepId === s.id);
  return mine.length ? h('div', { class: 'step-photos step-own-photos' }, mine.map((f) => photoThumb(ctx, f))) : null;
}

/** A work note's words: a rich one (table, list, photos) drawn from its html, else its plain text. */
export function noteBody(ctx, p, n) {
  if (!n.html) return n.text;
  return richView(n.html, (id) => photoThumb(ctx, (p.files || []).find((f) => f.id === id)), 'rn-' + n.id);
}

/** The photos of a note that are not already shown inside it. */
function notePhotos(p, n) {
  const inside = new Set(n.html ? richFileIds(n.html) : []);
  return (p.files || []).filter((f) => f.noteId === n.id && !inside.has(f.id));
}

/** ✎ on an update: open it in the write box (rich, with its table and photos), Save changes it. */
export function startEditNote(ctx, p, n) {
  const u = updateState(ctx.ui, p);
  const draft = readDraft(u, findEditor('wn-' + p.id));
  if (!u.editing && (draft.text || draft.photos.length) && globalThis.confirm && !confirm('Put this update in the box to change it? What you are writing now is cleared.')) return;
  u.editing = n.id;
  u.html = n.html || textToHtml(n.text);
  u.photos = [];
  u.rich = !!n.html;
  ctx.render();
  setTimeout(() => {
    const ed = findEditor('wn-' + p.id);
    if (!ed) return;
    fillEditor(ed, u.html, editorPhoto(u, p.files));
    if (ed.scrollIntoView) ed.scrollIntoView({ block: 'center' });
    if (ed.focus) ed.focus();
  }, 30);
}

/**
 * ✎ on a paused or finished task's update: a small question box. It holds one line only, so an update with a table, a
 * list, photos or several lines is not changed there (it would come back flat); an answer with no change saves nothing.
 */
function promptEditNote(ctx, p, n) {
  if (n.html || String(n.text).includes('\n')) { ctx.toast('Unpause or reopen the task to change this update (it has a table, list, photos or several lines)', 4000); return; }
  const v = prompt('Change your update:', n.text);
  if (v && v.trim() && v !== n.text) ctx.store.dispatch('editWorkNote', { projectId: p.id, noteId: n.id, text: v });
}

/** New messages from the team on this project: read them and answer here (or mark them seen). */
function teamMessages(ctx, p) {
  const t = ctx.onServer && ctx.teamDaily ? ctx.teamDaily(p) : null;
  const list = t && t.data ? (t.data.comments || []).filter((c) => c.unread).slice().reverse() : [];
  if (!list.length) return null;
  const ui = ctx.ui;
  const taskIds = [...new Set(list.map((c) => c.taskId))];
  const upTo = seenUpTo(list); // read only up to what is shown here
  const send = async (form) => {
    const text = form.elements.reply.value.trim();
    if (!text) return;
    form.elements.reply.disabled = true;
    const cids = (ui.teamReplyCid = ui.teamReplyCid || {});
    if (!cids[p.id] || cids[p.id].text !== text) cids[p.id] = { id: 'r' + newId() + newId(), text }; // a retry of the same words: the same id (never twice)
    // the answer goes on the newest message's task: only that person's messages count as answered (another person's
    // question stays new, so it is never marked read without an answer)
    const to = list[list.length - 1];
    const answered = [...new Set(list.filter((c) => c.by === to.by).map((c) => c.taskId))];
    try { await ctx.teamReply(p, to.taskId, text, answered, cids[p.id].id, upTo); delete (ui.teamReply ||= {})[p.id]; delete cids[p.id]; }
    catch (e) { ctx.toast(e.message, 5000); form.elements.reply.disabled = false; }
  };
  return h('div', { class: 'banner team-msgs', key: 'tmsg-' + p.id },
    h('strong', null, `💬 New message${list.length > 1 ? 's' : ''} from the team`),
    list.map((c) => {
      const src = c.photo && ctx.teamMsgPhoto ? ctx.teamMsgPhoto(c.id) : null;
      return h('div', { class: 'team-msg', key: 'tm-' + c.id },
        h('span', { class: 'muted small' }, `${c.by} · ${fmtDay(c.at.slice(0, 10))} ${fmtTime(c.at.replace(' ', 'T') + '+05:30')}`),
        c.text ? h('div', null, `“${c.text}”`) : null,
        c.photo ? (src ? h('img', { class: 'diary-photo', src, alt: 'Photo', onClick: () => window.open(src, '_blank', 'noopener') }) : h('span', { class: 'muted small' }, '📷 photo')) : null);
    }),
    h('form', { class: 'row', onSubmit: (e) => { e.preventDefault(); send(e.target); } },
      h('input', { name: 'reply', key: 'reply-' + p.id, placeholder: 'Answer…', autocomplete: 'off', value: (ui.teamReply || {})[p.id] || '', onInput: (e, el) => { (ui.teamReply = typeof ui.teamReply === 'object' && ui.teamReply ? ui.teamReply : {})[p.id] = el.value; } }),
      h('button', { class: 'btn primary small', type: 'submit' }, 'Send'),
      h('button', { class: 'btn small', type: 'button', title: 'Mark as read without answering', onClick: () => ctx.teamSeen(p, taskIds, upTo).catch((e) => ctx.toast(e.message, 5000)) }, '✓ Seen')));
}

/** Put the cursor in Today's update ("What did you do on this step?"). */
function focusUpdate(p) {
  setTimeout(() => {
    const n = document.querySelector(`[data-key="wn-${p.id}"]`);
    if (n) { n.scrollIntoView({ block: 'center' }); n.focus(); }
  }, 30);
}

/** ⏰ Remind me: 1 day · 2 days · 1 week · a date — or cancel. */
function remindRow(ctx, p, s, today) {
  const set = (date) => {
    const r = ctx.act('remindStep', { projectId: p.id, stepId: s.id, date }, date ? `⏰ "${s.text}" comes back on ${fmtDay(date)}` : `⏰ Reminder cancelled — "${s.text}" is back`);
    if (r) { ctx.ui.openStep = null; ctx.render(); }
  };
  const waiting = stepWaitsForReminder(s, today);
  return h('div', { class: 'remind-row', key: 'rm-' + s.id },
    h('span', { class: 'remind-label' }, waiting ? `⏰ Comes back on ${fmtDay(s.snoozedUntil)} ·` : '⏰ Remind me in'),
    waiting ? null : [[1, '1 day'], [2, '2 days'], [7, '1 week']].map(([n, label]) => h('button', { class: 'chip', type: 'button', key: 'rd' + n, onClick: () => set(addDays(today, n)) }, label)),
    h('label', { class: 'remind-date' }, waiting ? 'change: ' : 'or on ',
      h('input', { type: 'date', min: addDays(today, 1), value: waiting ? s.snoozedUntil : '', 'aria-label': 'Remind me on this date', onChange: (e, el) => { if (el.value) set(el.value); } })),
    waiting ? h('button', { class: 'chip', type: 'button', onClick: () => set(null) }, 'Show it now') : null);
}

/** Notes written about this step (newest 2), shown under it, with their photos (owner, 24 Oct: 📷 under the step too). */
function stepNotes(ctx, p, s) {
  const notes = p.workNotes.filter((n) => n.stepId === s.id).slice(0, 2);
  if (!notes.length) return null;
  const isImage = (f) => /\.(png|jpe?g|gif|webp|heic|heif)$/i.test(f.name || '');
  const pics = (n) => {
    const ids = new Set(n.html ? richFileIds(n.html) : []); // a photo put inside the words, and one added under them
    return (p.files || []).filter((f) => (f.noteId === n.id || ids.has(f.id)) && isImage(f));
  };
  // up to 5 small photos, then "+N more" (it opens this step's days, where all of them are: owner, 24 Oct — a 6th was hidden)
  const more = (n) => h('button', { class: 'link small more-photos', type: 'button', title: 'See all the photos in What\'s happening', onClick: () => { ctx.ui.diaryTask = { projectId: p.id, stepId: s.id }; ctx.render(); } }, `+${pics(n).length - 5} more`);
  return h('div', { class: 'step-notes' }, notes.map((n) => h('div', { key: 'sn-' + n.id }, `📝 ${fmtDay(indiaDate(n.createdAt))}: ${n.text}`,
    pics(n).length ? h('div', { class: 'step-photos' }, pics(n).slice(0, 5).map((f) => photoThumb(ctx, f)), pics(n).length > 5 ? more(n) : null) : null)));
}

/**
 * "↗ Make it a project": the step becomes its own project (one change; Undo puts both back as they were), then the new
 * project opens with its name ready to change. A step given to the team: ask first (the person's task stays as it is).
 */
export function makeItAProject(ctx, p, s, tt) {
  if (tt && tt.status === 'open' && !confirm(`${tt.assignee.name}'s task stays with ${p.name}. Continue?`)) return;
  const newProjectId = newId();
  const done = ctx.act('stepToProject', { projectId: p.id, stepId: s.id, newProjectId }, `↗ Now its own task: ${s.text}`, 8000);
  if (!done) return;
  ctx.ui.openStep = null;
  ctx.openProject(newProjectId);
  setTimeout(() => { const f = document.querySelector('.title-input'); if (f) { f.focus(); f.select(); } }, 30);
}

/** The photos on a staff step (its newest updates: today's and the one before), small; a tap opens one. */
export function stepPhotos(ctx, tt) {
  if (!tt || !ctx.teamPhoto) return null;
  const ids = [...new Set([...((tt.today && tt.today.photos) || []), ...((tt.last && tt.last.photos) || [])])];
  if (!ids.length) return null;
  return h('div', { class: 'step-photos', key: 'sp-' + tt.id }, ids.map((pid) => {
    const src = ctx.teamPhoto(pid);
    return src ? h('img', { class: 'diary-photo', src, alt: 'Photo', key: 'spp-' + pid, onClick: () => window.open(src, '_blank', 'noopener') }) : h('span', { class: 'muted small', key: 'spp-' + pid }, ' 📷');
  }));
}

/** A step made into its own project: "→ moved to project: <name>", a link that opens it. */
function movedLink(ctx, s) {
  const to = ctx.store.view.data.projects.find((x) => x.id === s.movedTo);
  return to ? h('button', { class: 'link small moved-to', type: 'button', title: 'Open that task', onClick: () => ctx.openProject(to.id) }, ` → moved to task: ${to.name}`)
    : h('span', { class: 'muted small' }, ' → moved to a task (deleted)');
}

/** 👥 on a step given to the team: who, and today's update (or that it is missing). Opens the team task. */
function teamChip(t, info) {
  const u = t.today;
  const time = (at) => { const [hh, mm] = at.slice(11, 16).split(':').map(Number); return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}`; };
  let text; let cls = 'tag team';
  if (t.status !== 'open') { text = `👥 ${t.assignee.name} · ${t.status === 'done' ? 'finished ✓' : 'cancelled'}`; cls += ' done'; }
  else if (u) { text = `👥 ${t.assignee.name} · ✓ ${time(u.at)}${u.state === 'stuck' ? ' · stuck' : ''}`; if (u.state === 'stuck') cls += ' late'; }
  else if (t.queued) text = `👥 ${t.assignee.name} · coming next`;
  else if (t.dueToday) { text = `👥 ${t.assignee.name} · not filled today`; if (info.late) cls += ' late'; }
  else text = `👥 ${t.assignee.name}${t.last ? ` · last ${fmtDay(t.last.day)}` : ''}`;
  const note = u ? u.note : t.last ? t.last.note : '';
  return h('a', { class: cls, href: `#team-task=${t.id}`, title: note ? `${note.slice(0, 300)}\n\nClick to see all updates and photos.` : 'Click to see the team task.' }, text);
}

function stepRow(ctx, p, s, box = null, writing = false) {
  const { store, ui } = ctx;
  const open = ui.openStep === s.id;
  const today = todayIndia();
  const tags = [];
  if (s.waiting && !s.done) {
    const d = waitingDays(s, today);
    const who = s.waitingOn ? `Waiting: ${s.waitingOn}` : 'Waiting';
    tags.push(h('span', { class: 'tag waiting' + (d >= WAIT_RED_DAYS ? ' late' : '') }, d ? `${who} · ${d}d` : who));
    if (s.chasedDate !== today) {
      tags.push(h('button', { class: 'row-act chase', title: 'I followed up today', onClick: () => ctx.chase(p, s) }, 'Chased'));
    }
    tags.push(h('button', { class: 'row-act draft', title: 'AI writes a short follow-up message', onClick: () => ctx.draftFollowUp(p, s) }, '✍ Draft'));
  }
  if (s.dueDate && !s.done) tags.push(h('span', { class: 'tag' + (s.dueDate < today ? ' late' : '') }, `by ${fmtDay(s.dueDate)}`));
  if (s.note && !open) tags.push(h('span', { class: 'tag' }, 'note'));
  if (s.link) tags.push(linkChip(s.link));
  const tt = ctx.teamTask ? ctx.teamTask(s.id) : null;
  const live = !!tt && tt.status === 'open'; // a finished or cancelled task: the step can be given again
  if (tt && (tt.status === 'open' || s.done)) tags.push(teamChip(tt, ctx.teamInfo())); // an old closed task on an open step: nothing to show
  if (!live && ctx.onServer && !s.done && p.state === 'active') { // you do it yourself: tap to give it to someone
    tags.push(h('a', { class: 'tag me', href: '#team-new=' + encodeURIComponent(JSON.stringify({ title: s.text, project: p.name, projectRef: p.id, stepRef: s.id })), title: 'You do this step now. Tap to give it to someone in your team.' }, '👥 Give'));
  }
  if (!s.done) tags.push(h('button', { class: 'link small days-link', type: 'button', title: 'Show only this step\'s days in What\'s happening', onClick: () => { ui.diaryTask = { projectId: p.id, stepId: s.id }; ctx.render(); setTimeout(() => { const d = document.querySelector('.diary'); if (d) d.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 30); } }, '📅 History'));
  if (s.repeat && !s.done) tags.push(h('span', { class: 'tag repeat', title: 'Repeats' }, `↻ ${REPEAT_WORD[s.repeat]}`));
  if (stepWaitsForReminder(s, today)) tags.push(h('span', { class: 'tag remind', title: 'Comes back on this day' }, `⏰ ${fmtDay(s.snoozedUntil)}`));
  else if (s.snoozedUntil && s.snoozedUntil > today && !s.done) tags.push(h('span', { class: 'tag' }, `from ${fmtDay(s.snoozedUntil)}`));
  else if (!s.done && s.remindUntil && s.remindUntil <= today) tags.push(h('span', { class: 'tag remind due', title: 'Your reminder for this step' }, '⏰ Reminder'));
  const aboutThis = () => { const u = updateState(ui, p); if (u.about !== s.id) { u.about = s.id; ctx.render(); } };
  if (writing) tags.unshift(h('span', { class: 'tag writing-tag', title: 'What you write in What\'s happening goes on this step' }, '📝 writing'));
  return h('li', { class: 'step' + (writing ? ' writing-about' : '') + (box ? ' has-update' : '') + (s.done ? ' done' : '') + (s.snoozedUntil && s.snoozedUntil > today && !s.done ? ' later' : ''), key: 's-' + s.id, 'data-id': s.id,
    onContextmenu: (e) => ctx.openStepMenu && ctx.openStepMenu(p.id, s.id, e) }, // right-click: tick, waiting, give, delete…
    h('div', { class: 'step-main' },
      s.done ? null : h('span', { class: 'grip', title: 'Drag to reorder', 'aria-hidden': 'true' }, '⋮⋮'),
      h('input', {
        type: 'checkbox', checked: s.done, 'aria-label': s.done ? 'Un-tick step' : 'Tick step',
        onChange: () => {
          const wasDone = s.done;
          const done = ctx.act(wasDone ? 'untickStep' : 'tickStep', { projectId: p.id, stepId: s.id }, wasDone ? null : `✓ ${s.text}`);
          if (done && !wasDone) ctx.afterTick(p.id, 'detail', done.undo);
        },
      }),
      s.done
        ? h('span', { class: 'step-text' }, s.text, h('span', { class: 'muted small' }, ` · ${fmtDay(s.doneAt ? indiaDate(s.doneAt) : '')}`), s.movedTo ? movedLink(ctx, s) : null)
        : autoField('input', {
          class: 'step-text', value: s.text, 'aria-label': 'Step', key: 'st-' + s.id, 'data-mention': '1', 'data-rowmenu': '1', // right-click: the step menu
          title: 'Click: Today\'s update is about this step. Enter: write what happened.',
          // clicking a step points "Today's update" at it, so there is no extra button to reach for
          onFocusin: () => aboutThis(),
          onClick: () => aboutThis(),
        },
        (v) => store.dispatch('setStepField', { projectId: p.id, stepId: s.id, field: 'text', value: v }),
        () => { const u = updateState(ui, p); u.about = s.id; ctx.render(); focusUpdate(p); }),
      ...tags,
      s.done ? null : h('button', {
        class: 'icon', title: 'Write what happened on this step', 'aria-label': `Update on ${s.text}`,
        onClick: () => { updateState(ui, p).about = s.id; ctx.render(); focusUpdate(p); },
      }, '📝'),
      s.done ? null : h('button', {
        class: 'icon', title: 'Remind me later (hide this step until a day)', 'aria-label': `Remind me about ${s.text}`,
        onClick: () => { ui.openStep = open ? null : s.id; ctx.render(); },
      }, '⏰'),
      h('button', {
        class: 'icon step-more', title: 'More', 'aria-label': 'More about this step',
        onClick: () => { ui.openStep = open ? null : s.id; ctx.render(); },
      }, open ? '▴' : '⋯')),
    stepOwnPhotos(ctx, p, s),
    stepNotes(ctx, p, s),
    live && !s.done && (tt.today || tt.last) ? h('div', { class: 'step-last muted small' }, `Last from ${tt.assignee.name} (${fmtDay((tt.today || tt.last).day)}): `, h('span', null, (tt.today || tt.last).note.slice(0, 160))) : null,
    stepPhotos(ctx, tt), // 📷 the photos the person sent on this step (e.g. each test step), done steps too
    box,
    open ? h('div', { class: 'step-extra' },
      s.done ? null : remindRow(ctx, p, s, today),
      h('label', null, 'Due date ',
        h('input', {
          type: 'date', value: s.dueDate || '',
          onChange: (e, el) => store.dispatch('setStepField', { projectId: p.id, stepId: s.id, field: 'dueDate', value: el.value || null }),
        })),
      h('label', null, 'Repeat ',
        h('select', {
          value: s.repeat || '',
          onChange: (e, el) => store.dispatch('setStepField', { projectId: p.id, stepId: s.id, field: 'repeat', value: el.value || null }),
        },
        h('option', { value: '' }, 'Never'),
        h('option', { value: 'daily' }, 'Every day'),
        h('option', { value: 'weekly' }, 'Every week'),
        h('option', { value: 'monthly' }, 'Every month'))),
      h('label', { class: 'check' },
        h('input', {
          type: 'checkbox', checked: s.waiting,
          onChange: (e, el) => store.dispatch('setStepField', { projectId: p.id, stepId: s.id, field: 'waiting', value: el.checked }),
        }), ' Waiting'),
      s.waiting ? autoField('input', { placeholder: 'Waiting on whom? (type a name)', value: s.waitingOn, key: 'wo-' + s.id, 'data-mention': 'plain', autocomplete: 'off' },
        (v) => store.dispatch('setStepField', { projectId: p.id, stepId: s.id, field: 'waitingOn', value: v })) : null,
      autoField('textarea', { placeholder: 'Small note for this step', value: s.note, rows: 2, key: 'sn-' + s.id, 'data-mention': '1' },
        (v) => store.dispatch('setStepField', { projectId: p.id, stepId: s.id, field: 'note', value: v })),
      ctx.onServer && !s.done ? h('a', {
        class: 'btn small',
        href: live ? `#team-task=${tt.id}` : '#team-new=' + encodeURIComponent(JSON.stringify({ title: s.text, project: p.name, projectRef: p.id, stepRef: s.id })),
        title: live ? 'See the daily updates for this step' : 'Give this step to a team member; their daily updates show here',
      }, live ? `👥 Team task: ${tt.assignee.name}` : '👥 Give to team') : null,
      s.done ? null : h('button', {
        class: 'btn small', title: 'This step is really a task of its own: make it one (the step is ticked here, with a link)',
        onClick: () => makeItAProject(ctx, p, s, live ? tt : null),
      }, '↗ Make it a task'),
      h('button', {
        class: 'btn danger small',
        onClick: () => ctx.act('deleteStep', { projectId: p.id, stepId: s.id }, `Step deleted: ${s.text}`),
      }, '🗑 Delete step')) : null);
}

function linksBlock(ctx, p) {
  const { store, ui } = ctx;
  const items = p.links.map((l) => {
    if (ui.editLink === l.id) {
      return h('li', { key: 'l-' + l.id },
        h('form', {
          class: 'row',
          onSubmit: (e) => {
            e.preventDefault();
            const f = e.target.elements;
            if (!cleanUrl(f.url.value)) { ctx.toast('Links must start with http:// or https://'); return; }
            if (store.dispatch('editLink', { projectId: p.id, linkId: l.id, title: f.title.value, url: f.url.value })) {
              ui.editLink = null; ctx.render();
            }
          },
        },
        h('input', { name: 'title', value: l.title, placeholder: 'Title' }),
        h('input', { name: 'url', value: l.url, placeholder: 'https://…', type: 'url' }),
        h('button', { class: 'btn primary small', type: 'submit' }, 'Save'),
        h('button', { class: 'btn small', type: 'button', onClick: () => { ui.editLink = null; ctx.render(); } }, 'Cancel')));
    }
    return h('li', { key: 'l-' + l.id, class: 'row' },
      cleanUrl(l.url) ? h('a', { href: cleanUrl(l.url), target: '_blank', rel: 'noopener noreferrer' }, l.title) : h('span', { class: 'muted' }, `${l.title} (link blocked)`),
      h('button', { class: 'icon', title: 'Edit link', onClick: () => { ui.editLink = l.id; ctx.render(); } }, '✎'),
      h('button', {
        class: 'icon', title: 'Remove link',
        onClick: () => { if (confirm(`Remove the link "${l.title}"?`)) store.dispatch('removeLink', { projectId: p.id, linkId: l.id }); },
      }, '🗑'));
  });
  return h('div', null,
    h('ul', { class: 'plain' }, items),
    h('form', {
      class: 'row',
      onSubmit: (e) => {
        e.preventDefault();
        const f = e.target.elements;
        if (!cleanUrl(f.url.value)) { ctx.toast('Links must start with http:// or https://'); return; }
        if (store.dispatch('addLink', { projectId: p.id, linkId: newId(), title: f.title.value, url: f.url.value })) {
          f.title.value = ''; f.url.value = '';
        }
      },
    },
    h('input', { name: 'title', placeholder: 'Link title', key: 'nl-title' }),
    h('input', { name: 'url', placeholder: 'https://…', type: 'url', key: 'nl-url' }),
    h('button', { class: 'btn small', type: 'submit' }, '+ Add link')));
}

function filesBlock(ctx, p) {
  const { store } = ctx;
  return h('div', {
    class: 'dropzone',
    onDragover: (e, el) => { e.preventDefault(); el.classList.add('over'); },
    onDragleave: (e, el) => el.classList.remove('over'),
    onDrop: (e, el) => { e.preventDefault(); el.classList.remove('over'); ctx.ui.dropOver = false; ctx.render(); uploadFiles(ctx, p.id, [...e.dataTransfer.files]); },
  },
  h('ul', { class: 'plain' }, p.files.map((f) => h('li', { key: 'f-' + f.id, class: 'row' },
    h('button', { class: 'link', onClick: () => openFile(ctx, f) }, f.name),
    h('span', { class: 'muted small' }, fmtSize(f.size)),
    h('button', {
      class: 'icon', title: 'Remove file',
      onClick: () => {
        if (confirm(`Remove "${f.name}"?\n\nNote: old versions are kept, so this does not free space.`)) {
          store.dispatch('removeFile', { projectId: p.id, fileId: f.id });
        }
      },
    }, '🗑')))),
  h('label', { class: 'btn small file-btn' }, '+ Add file',
    h('input', {
      type: 'file', multiple: true, class: 'visually-hidden',
      onChange: (e, el) => { const files = [...el.files]; el.value = ''; uploadFiles(ctx, p.id, files); },
    })),
  h('span', { class: 'muted small' }, ' or drag files here (max 25 MB)'));
}

function historyBlock(ctx, p) {
  const { store, ui } = ctx;
  const events = Object.values(store.view.history).flat()
    .filter((e) => e.projectId === p.id)
    .sort((a, b) => (a.at < b.at ? 1 : -1));
  const shown = events.slice(0, ui.historyLimit || 30);
  const loaded = new Set(Object.keys(store.view.history));
  const older = store.availableMonths().find((m) => !loaded.has(m));
  return h('div', null,
    h('ul', { class: 'history' }, shown.map((e) => h('li', { key: 'h-' + e.id },
      h('span', { class: 'muted small' }, `${fmtDay(indiaDate(e.at))} ${fmtTime(e.at)}`),
      ' ', h('strong', null, HISTORY_WORDS[e.kind] || e.kind), e.detail ? ` — ${e.detail}` : ''))),
    events.length > shown.length
      ? h('button', { class: 'btn small', onClick: () => { ui.historyLimit = (ui.historyLimit || 30) + 50; ctx.render(); } }, 'Show more')
      : older ? h('button', { class: 'btn small', onClick: () => store.loadMonth(older) }, `Load ${older}`) : null);
}

/**
 * The big Notes box, with its own save sign underneath:
 *   "Typing…" → "Saving…" → "Saved ✓ 2:45 pm" (or "Not saved yet — no connection").
 */
/**
 * "Today's update": one box that connects the plan (next step) and the diary (what I did).
 *   - shows the next step on top
 *   - what did you do? → a work note, linked to that step
 *   - [✓ This step is done] → ticks it, and asks "What's next?"
 *   - one Save (Enter) does all of it, with one Undo
 */
/**
 * The write box ("What did you do?"). It sits INSIDE the step it is about (the next step, or the step you clicked),
 * so the step and its update are one thing. With no open step (or "whole project") it sits under the steps.
 * Returns { stepId, box }: stepId = the step it belongs in (null = under the steps).
 */
function updateBox(ctx, p) {
  const { ui } = ctx;
  const today = todayIndia();
  const nextDue = p.state === 'active' ? nextStep(p, today, { dueOnly: true }) : null;
  const openSteps = p.state === 'active' ? p.steps.filter((s) => !s.done) : [];
  const u = updateState(ui, p);
  const key = 'wn-' + p.id;
  const editing = u.editing ? p.workNotes.find((n) => n.id === u.editing) : null;
  if (u.editing && !editing) u.editing = null; // deleted meanwhile
  const chosen = u.about && u.about !== 'project' ? openSteps.find((s) => s.id === u.about) : null;
  const due = editing || u.about === 'project' ? null : chosen || nextDue;
  // "Save" = note only; "Save + done" (or Ctrl/⌘+Enter on a quick note) = note and tick the step it is about.
  const save = (ed, done = false) => {
    const tick = !!(due && done);
    if (u.uploading) { ctx.toast('A photo is still uploading — save again in a moment', 2500); return; }
    const r = readDraft(u, ed);
    if (r.tooBig) { ctx.toast('This update is too big (over 100 KB). Make the table smaller, or add it as a file.', 5000); return; }
    const html = r.rich ? r.html : undefined;
    if (editing) { // ✎ changing a saved update
      const before = (p.files || []).filter((f) => f.noteId === editing.id).length;
      const text = r.text || (before + r.photos.length ? `📷 ${before + r.photos.length} photo${before + r.photos.length > 1 ? 's' : ''}` : '');
      if (!text) { ctx.toast('The update is empty — use ✕ to delete it', 2500); return; }
      const steps = [];
      if (text !== editing.text || (html || null) !== (editing.html || null)) steps.push(['editWorkNote', { projectId: p.id, noteId: editing.id, text, ...(html ? { html } : {}) }]);
      for (const ph of r.photos) steps.push(['addFile', { projectId: p.id, ...photoArgs(ph), noteId: editing.id }]);
      if (steps.length && !ctx.actMany(p.id, steps, 'Update changed')) return;
      u.editing = null; u.about = null;
      clearDraft(u, ed);
      ctx.render();
      return;
    }
    if (!r.text && !tick && !r.photos.length) return;
    const steps = [];
    const noteId = newId();
    const noteText = r.text || (r.photos.length ? r.photoWord : '');
    if (noteText) steps.push(['addWorkNote', { projectId: p.id, noteId, text: noteText, ...(html ? { html } : {}), stepId: due ? due.id : null }]);
    for (const ph of r.photos) steps.push(['addFile', { projectId: p.id, ...photoArgs(ph), noteId }]);
    if (tick) steps.push(['tickStep', { projectId: p.id, stepId: due.id }]);
    const n = r.photos.length;
    const bits = [r.text ? 'note saved' : null, n ? `${n} photo${n > 1 ? 's' : ''}` : null, tick ? `✓ ${due.text}` : null].filter(Boolean);
    const result = ctx.actMany(p.id, steps, bits.join(' · '));
    if (result) {
      clearDraft(u, ed);
      u.note = ''; u.about = null; // back to the next step
      ctx.render();
      if (tick) ctx.afterTick(p.id, 'detail', result.undo); // keeps the Undo button
    }
  };
  if (p.state !== 'active') return { stepId: null, box: null };
  const cancelEdit = () => { u.editing = null; clearDraft(u, findEditor(key)); ctx.render(); };
  const hint = !HAS_KEYBOARD ? '' : editing ? `${MOD}+Enter = Save the change` : u.rich ? `Enter = new line · ${MOD}+Enter = Save` : due ? `Enter = Save · Shift+Enter = new line · ${MOD}+Enter = Save + done` : 'Enter = Save · Shift+Enter = new line';
  const box = h('form', {
    class: 'update-form loose' + (editing ? ' editing' : ''), key: 'update-' + p.id,
    onSubmit: (e) => { e.preventDefault(); save(findEditor(key)); },
  },
  editing ? h('div', { class: 'edit-banner' }, h('span', null, `✎ Changing your update of ${fmtDay(indiaDate(editing.createdAt))} ${fmtTime(editing.createdAt)}`),
    h('button', { class: 'link small', type: 'button', onClick: cancelEdit }, '✕ Cancel')) : null,
  editing && p.steps.length && !isMainProject(ctx.store.view.data, p) ? h('div', { class: 'about-row' }, h('span', { class: 'about-label' }, '📝 This update is about:'), // ✎ saved under the wrong step: move it (owner, 24 Oct)
    p.steps.filter((st) => !st.done || st.id === editing.stepId || st.doneAt).slice(0, 10).map((st) => h('button', {
      class: 'chip' + (editing.stepId === st.id ? ' on' : ''), type: 'button', key: 'mv-' + st.id, title: st.text,
      onClick: () => { if (ctx.act('setNoteStep', { projectId: p.id, noteId: editing.id, stepId: st.id }, `Update moved to “${st.text}”`)) ctx.render(); },
    }, (st.done ? '✓ ' : '') + (st.text.length > 28 ? st.text.slice(0, 26) + '…' : st.text))),
    h('button', { class: 'chip' + (editing.stepId ? '' : ' on'), type: 'button', onClick: () => { if (ctx.act('setNoteStep', { projectId: p.id, noteId: editing.id, stepId: null }, 'Update moved to the whole task')) ctx.render(); } }, `Whole ${kindWord(ctx, p)}`)) : null,
  !editing && openSteps.length && !isMainProject(ctx.store.view.data, p) ? h('div', { class: 'about-row' }, h('span', { class: 'about-label' }, '📝 Writing about:'), // (a 📂 project has no steps of its own; owner 24 Oct: "About:" was easy to miss)
    openSteps.slice(0, 8).map((st) => h('button', {
      class: 'chip' + (due && due.id === st.id ? ' on' : ''), type: 'button', key: 'ab-' + st.id, title: st.text,
      onClick: () => { u.about = st.id; ctx.render(); focusUpdate(p); },
    }, st.text.length > 28 ? st.text.slice(0, 26) + '…' : st.text)),
    h('button', { class: 'chip' + (due ? '' : ' on'), type: 'button', onClick: () => { u.about = 'project'; ctx.render(); focusUpdate(p); } }, `Whole ${kindWord(ctx, p)}`)) : null,
  ...richArea(ctx, u, {
    key, placeholder: editing ? 'What happened?' : due ? `What happened on “${due.text.length > 40 ? due.text.slice(0, 38) + '…' : due.text}”?` : 'What happened today?', title: HAS_KEYBOARD ? 'Key: W' : null, files: p.files,
    otherFiles: (others) => uploadFiles(ctx, p.id, others), // a copied file (not a photo) goes to the task's files
    onKey: (e, el) => {
      if (e.key === 'Escape' && editing) { e.preventDefault(); cancelEdit(); return; }
      const act = enterAction({ key: e.key, shift: e.shiftKey, mod: e.metaKey || e.ctrlKey, inBlock: cursorInBlock(el), rich: editorIsRich(el) });
      if (!act) return;
      e.preventDefault();
      save(el, act === 'saveDone');
    },
  }),
  h('div', { class: 'row' },
    h('button', { class: 'btn small', type: 'submit' }, editing ? 'Save change' : 'Save'),
    due ? h('button', { class: 'btn primary small', type: 'button', title: `Save the note and tick "${due.text}" (${MOD}+Enter)`, onClick: () => save(findEditor(key), true) }, `✓ Save + tick “${due.text.length > 24 ? due.text.slice(0, 22) + '…' : due.text}”`) : null, // (says which step it ticks: owner, 24 Oct)
    editing ? h('button', { class: 'btn small', type: 'button', onClick: cancelEdit }, 'Cancel') : null,
    h('span', { class: 'muted small key-tip' }, hint)));
  return { stepId: due ? due.id : null, box };
}

/** All work notes, newest first (each says which step it was about). */
function notesLog(ctx, p, notesShown) {
  const { store, ui } = ctx;
  if (!p.workNotes.length) return null;
  return h('div', null,
    h('ul', { class: 'notes' }, p.workNotes.slice(0, notesShown).map((n) => {
      const st = n.stepId && p.steps.find((x) => x.id === n.stepId);
      return h('li', { key: 'n-' + n.id },
        h('span', { class: 'muted small' }, `${fmtDay(indiaDate(n.createdAt))} ${fmtTime(n.createdAt)}`),
        n.html ? h('div', { class: 'note-rich' }, noteBody(ctx, p, n)) // a table, list or photos: shown, ✎ opens it in the write box
          // a note of several lines (a 🔌 app note, a team note…): a one-line box would glue its lines together, so it is only shown
          : String(n.text).includes('\n') ? h('div', { class: 'note-rich note-lines', key: 'nt-' + n.id }, n.text)
            : autoField('input', { value: n.text, 'aria-label': 'Work note', key: 'nt-' + n.id, 'data-mention': '1' },
              (v) => { if (v.trim() && v !== n.text) store.dispatch('editWorkNote', { projectId: p.id, noteId: n.id, text: v }); }), // only a real change is saved
        (n.html || String(n.text).includes('\n')) && !n.team && p.state === 'active' ? h('button', { class: 'link small', type: 'button', title: 'Change this update', onClick: () => startEditNote(ctx, p, n) }, '✎') : null,
        st ? h('span', { class: 'tag on-step', title: 'This note is about this step' }, `on: ${st.text}`) : null,
        n.mail ? linkChip(n.link) : null, // a reply in an email thread (from Outlook): open that email
        ...notePhotos(p, n).map((f) => h('button', { class: 'tag photo', key: 'nf-' + f.id, title: 'Open photo', onClick: () => openFile(ctx, f) }, '📷')),
        n.team || String(n.id).startsWith('tn') ? null : h('button', {
          class: 'icon', title: 'Delete note',
          onClick: () => ctx.act('deleteWorkNote', { projectId: p.id, noteId: n.id }, 'Note deleted'),
        }, '🗑'));
    })),
    p.workNotes.length > notesShown
      ? h('button', { class: 'link small', onClick: () => { ui.notesLimit = notesShown + 20; ctx.render(); } }, `Show older notes (${p.workNotes.length - notesShown})`) : null);
}

/** "Status: one line on where it stands" under the project name. Grey and asks for an update after 7 days. */
/** The project's short description, in grey under the name. Click to change it; it saves by itself. */
function aboutLine(ctx, p) {
  return autoField('textarea', {
    class: 'about-input' + (p.about ? '' : ' empty'), value: p.about || '', key: 'about-' + p.id, rows: Math.min(8, Math.max(1, Math.ceil((p.about || '').length / 80))), maxlength: ABOUT_MAX, oneLine: true,
    placeholder: '+ Add a short description', 'aria-label': `Short description of this ${kindWord(ctx, p)}`, title: 'Click to change the short description',
  }, (v) => ctx.store.dispatch('setProjectField', { projectId: p.id, field: 'about', value: v }));
}

function statusLine(ctx, p) {
  const { store } = ctx;
  const today = todayIndia();
  const age = p.status && p.statusAt ? Math.max(0, daysBetween(indiaDate(p.statusAt), today)) : null; // (a clock set wrong never shows a minus)
  const old = age !== null && age >= STATUS_OLD_DAYS;
  return h('div', { class: 'status-line' + (old ? ' old' : '') + (p.status ? '' : ' empty'), key: 'status-' + p.id },
    h('span', { class: 'status-label' }, 'Status'),
    autoField('input', {
      class: 'status-input', value: p.status || '', key: 'st-in-' + p.id, maxlength: 200, 'aria-label': `Status: one line on where this ${kindWord(ctx, p)} stands`,
      placeholder: 'add one line on where it stands…',
    }, (v) => store.dispatch('setProjectField', { projectId: p.id, field: 'status', value: v })),
    p.status ? h('span', { class: 'muted small status-age' }, age === 0 ? 'updated today' : old ? `${age} days old — update status?` : `${age} day${age === 1 ? '' : 's'} ago`) : null);
}

/** Snooze form (number of days) or, when snoozed, the "back on …" line with Wake up now. */
function snoozeBar(ctx, p) {
  const { ui } = ctx;
  const today = todayIndia();
  if (p.state !== 'active') return null;
  const reason = restReason(p, today);
  if (reason === 'onlyDays' && ui.snoozeOpen !== p.id) { // a "📅 Only on" rest day: rests like a snooze (a real snooze can still go on top)
    return h('div', { class: 'banner snoozed-banner', key: 'snz-' + p.id },
      `📅 Resting — comes back ${WEEKDAYS[weekdayOf(restUntil(p, today))]} ${fmtDay(restUntil(p, today))} (${onlyDaysLabel(p.onlyDays)} only)`);
  }
  if (reason && reason !== 'onlyDays') {
    if (reason === 'remind') { // resting because every step is set to "remind me"
      return h('div', { class: 'banner snoozed-banner', key: 'snz-' + p.id },
        `⏰ All steps are set to remind you — back on Today on ${fmtDay(restUntil(p, today))}.`);
    }
    return h('div', { class: 'banner snoozed-banner', key: 'snz-' + p.id },
      `💤 Snoozed — comes back to Today on ${fmtDay(restUntil(p, today))}${onlyDaysOf(p).length ? ` (${onlyDaysLabel(p.onlyDays)} only)` : ''}.`,
      h('button', { class: 'btn small', onClick: () => ctx.act('wake', { projectId: p.id }, `Back on Today: ${p.name}`) }, '⏰ Wake up now'));
  }
  if (ui.snoozeOpen !== p.id) return null;
  const go = (days) => {
    const n = Math.round(Number(days));
    if (!(n >= 1 && n <= MAX_SNOOZE_DAYS)) { ctx.toast(`Type a number of days from 1 to ${MAX_SNOOZE_DAYS}`); return; }
    if (ctx.act('snooze', { projectId: p.id, days: n }, `💤 ${p.name} snoozed for ${n} day${n === 1 ? '' : 's'} (back ${fmtDay(addDays(today, n))})`)) { ui.snoozeOpen = null; ctx.render(); }
  };
  return h('form', {
    class: 'snooze-form', key: 'snzf-' + p.id,
    onSubmit: (e) => { e.preventDefault(); go(e.target.elements.days.value); },
  },
  h('span', null, '💤 Snooze for'),
  h('input', { name: 'days', type: 'number', min: 1, max: MAX_SNOOZE_DAYS, value: ui.snoozeDays || 3, key: 'snooze-' + p.id, 'aria-label': 'Days', onInput: (e, el) => { ui.snoozeDays = el.value; } }),
  h('span', null, 'days'),
  h('button', { class: 'btn primary small', type: 'submit' }, 'Snooze'),
  [1, 3, 7, 14].map((n) => h('button', { class: 'chip', type: 'button', key: 'sn' + n, onClick: () => go(n) }, String(n))),
  h('button', { class: 'link small', type: 'button', onClick: () => { ui.snoozeOpen = null; ctx.render(); } }, 'Cancel'));
}


/** "📅 Only on": a row of day chips (Mon … Sun, tap to turn on/off), "Every day" to clear, and "🔔 Remind me at" (a phone reminder on those days). */
export const CHIP_DAYS = [1, 2, 3, 4, 5, 6, 0]; // Monday first
function onlyDaysBar(ctx, p) {
  const { ui } = ctx;
  if (ui.onlyDaysOpen !== p.id) return null;
  const days = onlyDaysOf(p);
  const set = (next) => ctx.act('setOnlyDays', { projectId: p.id, days: next },
    next.length && next.length < 7 ? `📅 ${p.name}: only on ${onlyDaysLabel(next)}` : `📅 ${p.name}: every day`);
  const toggle = (n) => { set(days.includes(n) ? days.filter((x) => x !== n) : [...days, n]); ctx.render(); };
  return h('div', { class: 'only-days', key: 'od-' + p.id, role: 'group', 'aria-label': 'Comes up only on these days' },
    h('span', null, '📅 Only on'),
    CHIP_DAYS.map((n) => h('button', {
      class: 'chip day-chip' + (days.includes(n) ? ' on' : ''), type: 'button', key: 'od' + n,
      'aria-pressed': String(days.includes(n)), onClick: () => toggle(n),
    }, WEEKDAYS[n])),
    h('button', { class: 'chip' + (days.length ? '' : ' on'), type: 'button', key: 'od-all', onClick: () => { if (days.length) set([]); ctx.render(); } }, 'Every day'),
    h('label', { class: 'remind-at' }, '🔔 Remind me at',
      h('input', {
        type: 'time', value: p.remindAt || '', key: 'remind-at-' + p.id, 'aria-label': 'Phone reminder time (empty = no reminder)',
        onChange: (e, el) => {
          const time = el.value || null;
          ctx.act('setRemindAt', { projectId: p.id, time }, time ? `🔔 ${p.name}: reminder at ${time}` : `🔔 ${p.name}: no reminder`);
          ctx.render();
        },
      })),
    h('button', { class: 'link small', type: 'button', onClick: () => { ui.onlyDaysOpen = null; ctx.render(); } }, 'Done'));
}

/** "🔔 Remind me once": Today at [16:00], Tomorrow at [09:30], or a date + time; Clear when one is set. */
function remindOnceBar(ctx, p) {
  const { ui } = ctx;
  if (ui.remindOnceOpen !== p.id) return null;
  const now = indiaDateTime();
  const today = now.slice(0, 10);
  const pick = ui.remindPick || (ui.remindPick = { date: today, time: '16:00' });
  const set = (at) => {
    if (at && at < now) { ctx.toast('That time has already passed today'); return; }
    if (ctx.act('setRemindOnce', { projectId: p.id, at }, at ? `🔔 ${p.name}: reminder ${at.slice(0, 10) === today ? 'today' : at.slice(0, 10)} at ${at.slice(11)}` : `🔔 ${p.name}: reminder removed`)) { ui.remindOnceOpen = null; }
    ctx.render();
  };
  const timeBox = (k, v) => h('input', { type: 'time', value: v, key: `ro-${k}-${p.id}`, 'aria-label': 'Time', onInput: (e, el) => { ui.remindTimes = { ...(ui.remindTimes || {}), [k]: el.value }; } });
  const tt = ui.remindTimes || {};
  // the time typed is read when the button is pressed (typing does not redraw, so a value kept from drawing would be old)
  const typed = (k, dflt) => (ui.remindTimes || {})[k] || dflt;
  return h('div', { class: 'only-days remind-once', key: 'ro-' + p.id, role: 'group', 'aria-label': 'Remind me once' },
    h('span', null, '🔔 Remind me once'),
    h('span', { class: 'remind-at' }, h('button', { class: 'chip', type: 'button', onClick: () => set(`${today} ${typed('today', '16:00')}`) }, 'Today at'), timeBox('today', tt.today || '16:00')),
    h('span', { class: 'remind-at' }, h('button', { class: 'chip', type: 'button', onClick: () => set(`${addDays(today, 1)} ${typed('tomorrow', '09:30')}`) }, 'Tomorrow at'), timeBox('tomorrow', tt.tomorrow || '09:30')),
    h('span', { class: 'remind-at' },
      h('input', { type: 'date', min: today, value: pick.date, key: 'ro-date-' + p.id, 'aria-label': 'Date', onInput: (e, el) => { pick.date = el.value; } }),
      h('input', { type: 'time', value: pick.time, key: 'ro-time-' + p.id, 'aria-label': 'Time', onInput: (e, el) => { pick.time = el.value; } }),
      h('button', { class: 'btn primary small', type: 'button', onClick: () => { if (pick.date && pick.time) set(`${pick.date} ${pick.time}`); } }, 'Set')),
    p.remindOnce ? h('button', { class: 'link small', type: 'button', onClick: () => set(null) }, 'Clear') : null,
    h('button', { class: 'link small', type: 'button', onClick: () => { ui.remindOnceOpen = null; ctx.render(); } }, 'Cancel'));
}

/**
 * Giving a 📂 project: its tasks go with it. Ticked = goes; untick the ones you do yourself (they stay with you, also
 * later). A task given to someone else on its own stays with them (shown, no box).
 */
function giveTaskList(ctx, p) {
  const { ui } = ctx;
  const kids = projectTasks(ctx.store.view.data, p.id).filter((c) => c.state !== 'finished'); // (its projects' tasks go too)
  if (!ui.giveKeep || ui.giveKeepFor !== p.id) { ui.giveKeep = new Set(kids.filter((c) => c.teamOff).map((c) => c.id)); ui.giveKeepFor = p.id; } // (this project's, never another's)
  if (!kids.length) return h('p', { class: 'muted small' }, 'No tasks in it yet. Tasks you add later go to the same person.');
  const keep = ui.giveKeep;
  return h('div', { class: 'give-tasks' },
    h('span', { class: 'muted small' }, 'Its tasks go too. Untick the ones you do yourself:'),
    kids.map((c) => {
      const other = c.team && !(c.team.viaProject === p.id);
      return h('label', { class: 'check small give-task', key: 'gt-' + c.id },
        other ? h('span', { class: 'quick-tick-space', 'aria-hidden': 'true' })
          : h('input', { type: 'checkbox', checked: keep.has(c.id) ? undefined : true, onChange: (e, el) => { if (el.checked) keep.delete(c.id); else keep.add(c.id); ctx.render(); } }),
        ' ', c.name, other ? h('span', { class: 'muted' }, ` — stays with ${c.team.name}`) : keep.has(c.id) ? h('span', { class: 'muted' }, ' — stays with you') : null);
    }),
    h('span', { class: 'muted small' }, 'Tasks you add to it later go to the same person.'));
}

/** worktask.in: "Given to Valar" (with Change / Take back), or the people to choose from after "👥 Give project". */
function teamBar(ctx, p) {
  const { ui } = ctx;
  if (!ctx.onServer || p.state !== 'active') return null;
  if (p.team && ui.giveOpen !== p.id) return null; // shown as the 👥 chip now
  if (ui.giveOpen !== p.id) return null;
  const people = ctx.teamPeople();
  const busy = ctx.teamBusy && ctx.teamBusy(p.id); // sending: a second tap must not give it twice
  return h('div', { class: 'banner team-banner', key: 'tg-' + p.id },
    h('span', null, p.team ? `👥 Change person (now ${p.team.name}):` : `👥 Give "${p.name}" to:`),
    isMainProject(ctx.store.view.data, p) ? giveTaskList(ctx, p) : null,
    h('label', { class: 'check small', title: 'They must add a photo before tapping Finished on each step' },
      h('input', { type: 'checkbox', checked: !!ui.givePhoto, onChange: (e, el) => ctx.setGivePhoto(el.checked) }), ' 📷 Photo needed to finish'),
    h('label', { class: 'check small', title: 'They add an entry (a line + photos) whenever something happens, e.g. a material order follow-up — no daily update, never late' },
      h('input', { type: 'checkbox', checked: !!ui.giveRecord, onChange: (e, el) => ctx.setGiveRecord && ctx.setGiveRecord(el.checked) }), ' 📒 Record (entries, not a daily update)'),
    people === null ? h('span', { class: 'muted small' }, 'Loading…')
      : people.length ? people.map((u) => h('button', { class: 'chip', key: 'tp-' + u.id, disabled: busy ? true : undefined, onClick: () => ctx.giveProject(p, u) }, u.name))
        : h('a', { class: 'small', href: '#team' }, 'Add a person first (Team → People)'),
    p.team ? h('button', { class: 'btn small', onClick: () => { if (confirm(takeBackQuestion(ctx.store.view.data, p))) { ui.giveOpen = null; ctx.takeBackProject(p); } } }, 'Take back') : null,
    h('button', { class: 'link small', onClick: () => { ui.giveOpen = null; ui.givePhoto = false; ui.giveRecord = false; ui.giveKeep = null; ui.giveKeepFor = null; ctx.render(); } }, 'Cancel'));
}

/** Take back: a 📂 project brings back the tasks that went with it (tasks given on their own stay). */
export function takeBackQuestion(data, p) {
  if (!isMainProject(data, p)) return `Take "${p.name}" back from ${p.team.name}? Their open steps are removed from their list.`;
  const n = projectTasks(data, p.id).filter((c) => c.team && c.team.viaProject === p.id).length; // (its projects' tasks went with it too)
  return `Take "${p.name}" back from ${p.team.name}?${n ? ` The ${n} task${n > 1 ? 's' : ''} that went with it come${n > 1 ? '' : 's'} back too.` : ''} Tasks given to someone on their own stay with them.`;
}

const notesTimers = {}; // one save timer per project, kept across screen updates

function notesBox(ctx, p) {
  const { store, ui } = ctx;
  const ns = (ui.notesSave ||= {});
  const st = ns[p.id] || {};
  const current = () => (store.view.data.projects.find((x) => x.id === p.id) || {}).notes;
  const save = (el) => {
    clearTimeout(notesTimers[p.id]);
    const was = ns[p.id] || {};
    if (el.value === current() && was.state !== 'typing') return; // nothing new
    const changed = store.dispatch('setProjectField', { projectId: p.id, field: 'notes', value: el.value });
    ns[p.id] = { state: changed || el.value === current() ? 'sent' : 'blocked', at: new Date().toISOString() };
    ctx.render();
  };
  let sign;
  if (st.state === 'typing') sign = h('span', { class: 'save-sign muted' }, 'Typing… (saves by itself)');
  else if (st.state === 'blocked' || (st.state === 'sent' && store.status === 'offline')) sign = h('span', { class: 'save-sign bad' }, 'Not saved yet — no connection. Kept on this device.');
  else if (st.state === 'sent' && (store.status === 'saving' || store.pending.length)) sign = h('span', { class: 'save-sign muted' }, 'Saving…');
  else if (st.state === 'sent' && store.status === 'saved') sign = h('span', { class: 'save-sign ok' }, `Saved ✓ ${fmtTime(st.at)}`);
  else sign = h('span', { class: 'save-sign muted' }, p.notes ? 'Saved ✓' : 'Saves by itself as you type');
  return h('div', null,
    h('textarea', {
      class: 'notes-box', value: p.notes, rows: 4, placeholder: `Free notes for this ${kindWord(ctx, p)}`, key: 'notes-' + p.id, 'data-mention': '1',
      onInput: (e, el) => {
        if ((ns[p.id] || {}).state !== 'typing') { ns[p.id] = { state: 'typing' }; ctx.render(); }
        clearTimeout(notesTimers[p.id]);
        notesTimers[p.id] = setTimeout(() => save(el), 900);
      },
      onChange: (e, el) => save(el),
      onFocusout: (e, el) => save(el),
    }),
    h('div', { class: 'save-row', key: 'notes-sign-' + p.id }, sign));
}

function tagName(data, p) {
  const t = p.tagId && (data.tags || []).find((x) => x.id === p.tagId);
  return t ? t.name : '';
}

/** ⏱ Today 1h 20m · This week 4h · Total 12h  · + Add time · entries */
function timeLine(ctx, p, today) {
  const { store, ui } = ctx;
  const timer = store.view.data.timer;
  const logs = p.timeLogs || [];
  const timed = timerOn(store.view.data);
  if (!timed && !logs.length) return null; // the timer is switched off
  if (!logs.length && !(timer && timer.projectId === p.id)) {
    return h('div', { class: 'time-line', key: 'time-' + p.id },
      h('button', { class: 'link small', onClick: () => addTimePrompt(ctx, p) }, '⏱ + Add time'));
  }
  const total = minutesBetween(p, '0000-01-01', today, timer);
  const parts = [
    `Today ${fmtMinutes(minutesBetween(p, today, today, timer))}`,
    `This week ${fmtMinutes(minutesBetween(p, weekStart(today), today, timer))}`,
    `Total ${fmtMinutes(total)}`,
  ];
  const open = ui.showTime === p.id;
  return h('div', { class: 'time-line', key: 'time-' + p.id },
    h('span', null, `⏱ ${parts.join(' · ')}`),
    h('button', { class: 'link small', onClick: () => addTimePrompt(ctx, p) }, '+ Add time'),
    logs.length ? h('button', { class: 'link small', onClick: () => { ui.showTime = open ? null : p.id; ctx.render(); } }, open ? 'Hide entries' : 'Entries') : null,
    open ? h('ul', { class: 'time-entries' }, [...logs].sort((a, b) => (a.start < b.start ? 1 : -1)).slice(0, 15).map((t) => h('li', { key: 'tl-' + t.id },
      h('span', null, `${fmtDay(indiaDate(t.start))} ${t.manual ? '' : fmtTime(t.start)}`),
      h('strong', null, fmtMinutes(t.minutes)),
      t.manual ? h('span', { class: 'muted small' }, 'added') : null,
      t.capped ? h('span', { class: 'tag late' }, 'cut to 10 h') : null,
      h('button', { class: 'icon', title: 'Remove this entry', onClick: () => ctx.act('removeTime', { projectId: p.id, logId: t.id }, `Removed ${fmtMinutes(t.minutes)}`) }, '🗑')))) : null);
}

function addTimePrompt(ctx, p) {
  const v = prompt(`Add time to "${p.name}" (worked today, not timed).\n\nMinutes, or hours like 1.5h:`, '30');
  if (v === null) return;
  const minutes = parseDuration(v); // the whole answer must be read ("2 hours" is not 2 minutes)
  if (!minutes) { ctx.toast('Type a number of minutes, like 45, or hours like 1.5h'); return; }
  ctx.act('addTime', { projectId: p.id, minutes }, `⏱ Added ${fmtMinutes(minutes)} to ${p.name}`);
}


/** Everyone linked to this project's open steps; tap a name to see all their pending work. */
function peopleChips(ctx, p) {
  const data = ctx.store.view.data;
  const people = data.people || [];
  if (!people.length) return null;
  const counts = new Map();
  for (const s of p.steps) {
    if (s.done) continue;
    for (const person of people) if (stepLinkedTo(s, person, people)) counts.set(person.id, (counts.get(person.id) || 0) + 1);
  }
  if (!counts.size) return null;
  return h('div', { class: 'people-chips', key: 'pc-' + p.id },
    [...counts.entries()].map(([id, n]) => {
      const person = people.find((x) => x.id === id);
      const st = personStatus(data, person);
      return h('button', { class: 'person-chip', key: 'pcc-' + id, title: `See all pending work with ${person.name}`, onClick: () => ctx.openPerson(id) },
        h('span', { class: `dot ${st.colour}` }), `👤 ${person.name}`, h('span', { class: 'count-pill' }, String(n)));
    }));
}

function section(title, ...children) {
  return h('section', { class: 'block' }, h('h3', null, title), ...children);
}

/** "Steps  ·  X ticks the next one" — the key shown where it is used (computer only). */
function stepsTitle() {
  return HAS_KEYBOARD ? h('span', { title: 'Press X to tick the next one' }, 'Steps') : 'Steps';
}

/** Pause / Finish (or Unpause / Reopen / Delete) — always visible at the top. */
function stateButtons(ctx, p) {
  const { store, ui } = ctx;
  if (p.state === 'active') {
    const t = store.view.data.timer;
    const running = t && t.projectId === p.id;
    const timed = timerOn(store.view.data);
    return [
      running
        ? h('button', { class: 'btn timer-on', title: 'Stop the timer', onClick: () => ctx.stopTimer() }, `⏸ ${ctx.clockText(t.start)}`)
        : timed && !p.misc ? h('button', { class: 'btn', title: `Start timing your work on this ${kindWord(ctx, p)}`, onClick: () => ctx.startTimer(p) }, '▶ Start') : null,
      // 💤 Snooze on the page itself (the owner uses it daily; also in the ⋯ menu)
      !p.misc && (!isSnoozed(p, todayIndia()) || restReason(p, todayIndia()) === 'onlyDays') ? h('button', {
        class: 'btn', title: 'Hide it from Today for some days',
        onClick: () => { ui.snoozeOpen = p.id; ctx.render(); setTimeout(() => { const n = document.querySelector(`[data-key="snooze-${p.id}"]`); if (n) { n.focus(); n.select(); } }, 30); },
      }, '💤 Snooze') : null,
      p.misc ? null : h('button', { class: 'btn', onClick: () => ctx.act('finish', { projectId: p.id }, `Finished: ${p.name} (moved to Finished)`) }, `Finish ${kindWord(ctx, p)}`),
      menuButton(ctx, p),
      navButtons(ctx),
    ];
  }
  if (p.state === 'paused') {
    return [
      h('button', { class: 'btn primary', onClick: () => store.dispatch('unpause', { projectId: p.id }) }, 'Unpause'),
      p.misc ? null : h('button', { class: 'btn', onClick: () => ctx.act('finish', { projectId: p.id }, `Finished: ${p.name} (moved to Finished)`) }, `Finish ${kindWord(ctx, p)}`),
      p.misc ? null : deleteButton(ctx, p),
      navButtons(ctx),
    ];
  }
  return [
    navButtons(ctx),
    h('button', { class: 'btn primary', onClick: () => store.dispatch('reopen', { projectId: p.id }) }, 'Reopen'),
    h('button', {
      class: 'btn danger',
      onClick: () => {
        if (!confirm(`Delete "${p.name}" for good?`) || !confirm('Are you really sure? Its files are removed. Its Diary lines stay.')) return;
        ctx.act('deleteProject', { projectId: p.id }, `Deleted: ${p.name}`, 8000);
        ui.selected = null; ui.mobile = 'list'; ctx.render();
      },
    }, 'Delete'),
  ];
}

/** ‹ › (and ↩ back to where you came from): the neighbours in the list you are in. Keys: ← → and Backspace. */
function navButtons(ctx) {
  const prev = ctx.neighbourProject(-1), next = ctx.neighbourProject(1);
  return h('span', { class: 'nav-pn' },
    ctx.canGoBack() ? h('button', { class: 'btn icon-btn', title: 'Back to where you came from (Backspace)', 'aria-label': 'Back', onClick: () => ctx.goBack() }, '↩') : null,
    h('button', { class: 'btn icon-btn', disabled: prev ? undefined : true, 'aria-label': 'Previous', title: prev ? `Previous: ${prev.name} (←)` : 'First in this list', onClick: () => prev && ctx.openInList(prev.id) }, '‹'),
    h('button', { class: 'btn icon-btn', disabled: next ? undefined : true, 'aria-label': 'Next', title: next ? `Next: ${next.name} (→)` : 'Last in this list', onClick: () => next && ctx.openInList(next.id) }, '›'));
}

function menuButton(ctx, p) {
  const { ui } = ctx;
  return h('button', { class: 'btn icon-btn' + (ui.projMenu === p.id ? ' on' : ''), title: 'More: snooze, pause, team, time, delete', 'aria-label': 'More actions', 'aria-expanded': String(ui.projMenu === p.id),
    onClick: () => { ui.projMenu = ui.projMenu === p.id ? null : p.id; ctx.render(); } }, '⋯');
}

/** The ⋯ menu: everything that is not needed every day. */
function projectMenu(ctx, p) {
  const { store, ui } = ctx;
  if (ui.projMenu !== p.id) return null;
  const today = todayIndia();
  const go = (fn) => () => { ui.projMenu = null; fn(); ctx.render(); };
  const timed = timerOn(store.view.data) || (p.timeLogs || []).length;
  const item = (label, fn, cls = '') => h('button', { class: 'menu-row' + cls, onClick: go(fn) }, label);
  return h('div', { class: 'proj-menu', key: 'pm-' + p.id, role: 'menu' },
    p.state === 'active' && (!isSnoozed(p, today) || restReason(p, today) === 'onlyDays') ? item('💤 Snooze…', () => { ui.snoozeOpen = p.id; setTimeout(() => { const n = document.querySelector(`[data-key="snooze-${p.id}"]`); if (n) { n.focus(); n.select(); } }, 30); }) : null,
    p.state === 'active' && ctx.onServer && !p.misc ? item(p.team ? `👥 Change person (now ${p.team.name})` : `👥 Give ${kindWord(ctx, p)} to…`, () => { ui.giveOpen = p.id; ui.givePhoto = p.team ? !!p.team.needsPhoto : false; ui.giveRecord = p.team ? !!p.team.record : false; }) : null,
    p.state === 'active' && ctx.onServer && p.team ? item('↩ Take back from ' + p.team.name, () => { if (confirm(takeBackQuestion(ctx.store.view.data, p))) ctx.takeBackProject(p); }) : null,
    p.state === 'active' ? item('📅 Only on…', () => { ui.onlyDaysOpen = p.id; }) : null,
    p.state === 'active' ? item('🔔 Remind me once…', () => { ui.remindOnceOpen = p.id; }) : null,
    p.state === 'active' ? item('⏸ Pause', () => ctx.act('pause', { projectId: p.id }, `Paused: ${p.name}`)) : null,
    timed ? item('⏱ Add time', () => addTimePrompt(ctx, p)) : null,
    item('✎ Tag, priority, target date', () => { ui.editMeta = true; }),
    // 📂 a task can be in several projects; a project can be inside other projects too (never 📂 Misc)
    p.misc ? null : item(isMainProject(store.view.data, p) ? '📂 Put inside a project…' : '📂 Add to a project…', () => openMainBox(ctx, p, 'parent')),
    p.misc ? null : item(`🗑 Delete ${kindWord(ctx, p)}`, () => { // (📂 Misc stays: it holds every task in no other project)
      if (!confirm(deleteQuestion(ctx.store.view.data, p))) return;
      ctx.act('deleteProject', { projectId: p.id }, `Deleted: ${p.name}`, 10000);
      ui.selected = null; ui.mobile = 'list';
    }, ' danger'));
}

/** A 📂 project has tasks, not steps (steps live in its tasks). Steps it had from before show here, each can become a task in it. */
function oldStepsBlock(ctx, p, openSteps) {
  if (!openSteps.length) return null;
  const { store } = ctx;
  const makeTask = (st) => {
    const id = newId();
    if (!store.dispatch('stepToProject', { projectId: p.id, stepId: st.id, newProjectId: id })) return;
    store.dispatch('addToProject', { projectId: id, parentId: p.id });
    ctx.toast(`New task in 📂 ${p.name}: ${st.text}`);
    ctx.render();
  };
  return section(`Steps from before (${openSteps.length})`,
    h('p', { class: 'muted small' }, 'A project holds tasks; steps belong in its tasks. Make each of these a task in this project:'),
    h('ul', { class: 'old-steps', key: 'oldsteps-' + p.id }, openSteps.map((st) => h('li', { key: 'os-' + st.id, class: 'old-step' },
      h('span', null, st.text),
      h('button', { class: 'btn small', type: 'button', onClick: () => makeTask(st) }, '↗ Make it a task')))));
}

/** One line of small chips: who has it, tag, priority, target, steps done, time, people. Tap one to change it. */
function infoChips(ctx, p, today) {
  const { store, ui } = ctx;
  const data = store.view.data;
  const overdue = isOverdue(p, today);
  const editMeta = () => { ui.editMeta = !ui.editMeta; ctx.render(); };
  const chip = (text, title, onClick, cls = '') => onClick
    ? h('button', { class: 'info-chip' + cls, title, onClick }, text)
    : h('span', { class: 'info-chip static' + cls, title }, text);
  const out = [];
  if (p.team) {
    const via = p.team.viaProject && store.view.data.projects.find((x) => x.id === p.team.viaProject);
    out.push(chip(`👥 ${p.team.name}${via ? ` (with 📂 ${via.name})` : ''}`, p.state === 'active' ? (via ? `Went with 📂 ${via.name} — tap to change person or take back` : 'Given to the team — tap to change person or take back') : 'Given to the team (off their list while not active)',
      p.state === 'active' ? () => { ui.giveOpen = ui.giveOpen === p.id ? null : p.id; ui.givePhoto = !!p.team.needsPhoto; ui.giveRecord = !!p.team.record; ctx.render(); } : null, ' team'));
    const tp = ctx.teamProgress ? ctx.teamProgress(p.id) : null;
    if (tp && (tp.lastUpdate || tp.stuck)) {
      const when = !tp.lastUpdate ? 'no update yet' : tp.lastUpdate === today ? 'updated today' : `last update ${fmtDay(tp.lastUpdate)}`;
      out.push(chip(tp.stuck ? `⚠️ stuck · ${when}` : when, 'Their last daily update', null, tp.stuck ? ' bad' : tp.lastUpdate === today ? ' good' : ''));
    }
  }
  if (remindOnceChip(p)) out.push(chip(remindOnceChip(p), 'A one-time phone reminder — tap to change', () => { ui.remindOnceOpen = ui.remindOnceOpen === p.id ? null : p.id; ctx.render(); }));
  if (onlyDaysChip(p)) {
    out.push(chip(onlyDaysChip(p), 'Comes up only on these days / phone reminder — tap to change',
      () => { ui.onlyDaysOpen = ui.onlyDaysOpen === p.id ? null : p.id; ctx.render(); }));
  }
  // 🔁 how often it should move (its dot follows it); a 📂 project's choice goes to everything inside it
  if (!p.misc && p.state !== 'finished') out.push(chip(`🔁 ${everyText(moveEveryOf(p))}`, `${colourWhy(p, today)} — tap to change how often it should move`, () => { ui.everyOpen = ui.everyOpen === p.id ? null : p.id; ctx.render(); }));
  if (tagName(data, p)) out.push(chip(`🏷 ${tagName(data, p)}`, 'Tag — tap to change', editMeta));
  out.push(chip(p.priority[0].toUpperCase() + p.priority.slice(1), 'Priority — tap to change', editMeta, p.priority === 'high' ? ' bad' : ''));
  // finished: the day it ended, not a target any more (owner, 24 Oct)
  if (p.state === 'finished') out.push(chip(`✓ Finished ${p.stateChangedAt ? fmtDay(indiaDate(p.stateChangedAt)) : ''}`.trim(), 'The day it was finished', null, ' good'));
  else out.push(chip(p.deadline ? `${overdue ? 'Overdue' : 'Target'} ${fmtDay(p.deadline)}` : '+ Target date', 'Target date — tap to change', editMeta, overdue ? ' bad' : ''));
  if (p.steps.length && !isMainProject(ctx.store.view.data, p)) out.push(chip(`✓ ${p.steps.filter((x) => x.done).length} of ${p.steps.length} step${p.steps.length === 1 ? '' : 's'} done`, 'Steps done', null));
  const timer = store.view.data.timer;
  const logs = p.timeLogs || [];
  const timed = timerOn(data);
  if (timed || logs.length) {
    const total = minutesBetween(p, '0000-01-01', today, timer);
    out.push(total ? chip(`⏱ ${fmtMinutes(total)}`, `Time on this ${kindWord(ctx, p)} — tap for details`, () => { ui.showTime = ui.showTime === p.id ? null : p.id; ctx.render(); })
      : chip('⏱ Add time', 'Add time worked (not timed)', () => addTimePrompt(ctx, p)));
  }
  return h('div', { class: 'info-chips', key: 'ic-' + p.id }, out, peopleChips(ctx, p), everyPicker(ctx, p));
}

/** "Move every…": 1, 2, 3, 5, 7, 14, 30 days (the one now is marked). On a 📂 project it says it goes to its tasks too. */
export function everyPicker(ctx, p) {
  const { ui, store } = ctx;
  if (ui.everyOpen !== p.id) return null;
  const now = moveEveryOf(p);
  const main = isMainProject(store.view.data, p);
  const set = (n) => {
    ui.everyOpen = null;
    if (store.dispatch('setMoveEvery', { projectId: p.id, days: n }) && ctx.toast) ctx.toast(`${p.name}: should move ${everyText(n)}${main ? ' (and everything inside it)' : ''}`);
    ctx.render();
  };
  return h('div', { class: 'every-picker', key: 'every-' + p.id, role: 'group', 'aria-label': 'How often should it move?' },
    h('span', { class: 'muted small' }, main ? 'Move every (for everything inside too):' : 'Should move every:'),
    MOVE_EVERY_PICKS.map((n) => h('button', {
      class: 'chip' + (n === now ? ' on' : ''), type: 'button', key: 'ev-' + n, 'aria-pressed': String(n === now), onClick: () => set(n),
    }, n === 1 ? '1 day' : `${n} days`)));
}

/** 🗑 Delete for any project: one question, then an Undo button for a few seconds. */
function deleteButton(ctx, p) {
  const { ui } = ctx;
  return h('button', {
    class: 'btn icon-btn danger-soft', title: `Delete this ${kindWord(ctx, p)}`, 'aria-label': `Delete this ${kindWord(ctx, p)}`,
    onClick: () => {
      if (!confirm(deleteQuestion(ctx.store.view.data, p))) return;
      ctx.act('deleteProject', { projectId: p.id }, `Deleted: ${p.name}`, 10000);
      ui.selected = null; ui.mobile = 'list'; ctx.render();
    },
  }, '🗑');
}

function metaLine(ctx, p, today) {
  const { store, ui } = ctx;
  const data = store.view.data;
  const pri = p.priority[0].toUpperCase() + p.priority.slice(1);
  const overdue = isOverdue(p, today);
  if (!ui.editMeta) {
    return h('button', { class: 'meta-line', key: 'meta-' + p.id, title: 'Change tag, priority or target date', onClick: () => { ui.editMeta = true; ctx.render(); } },
      tagName(data, p) ? [h('span', { class: 'tag tag-chip' }, `🏷 ${tagName(data, p)}`), ' · '] : '',
      h('span', { class: p.priority === 'high' ? 'meta-high' : '' }, pri),
      p.deadline ? [' · ', h('span', { class: overdue ? 'late' : '' }, `${overdue ? 'Overdue' : 'Target'} ${fmtDay(p.deadline)}`)] : ' · No target date',
      h('span', { class: 'meta-edit', 'aria-hidden': 'true' }, ' ✎'));
  }
  return h('div', { class: 'fields', key: 'fields-' + p.id },
    h('label', null, 'Tag ',
      h('select', {
        value: p.tagId || '',
        onChange: (e, el) => {
          if (el.value === '__new') {
            const name = prompt('New tag:');
            if (name && name.trim()) {
              const tagId = newId();
              if (store.dispatch('addTag', { tagId, name: name.trim() })) store.dispatch('setProjectField', { projectId: p.id, field: 'tagId', value: tagId });
              else ctx.toast(`"${name.trim()}" already exists`);
            }
            ctx.render();
            return;
          }
          store.dispatch('setProjectField', { projectId: p.id, field: 'tagId', value: el.value || null });
        },
      },
      h('option', { value: '' }, 'No tag'),
      (data.tags || []).map((t) => h('option', { value: t.id }, t.name)),
      h('option', { value: '__new' }, '+ New tag…'))),
    h('label', null, 'Priority ',
      h('select', {
        value: p.priority,
        onChange: (e, el) => store.dispatch('setProjectField', { projectId: p.id, field: 'priority', value: el.value }),
      }, PRIORITIES.map((x) => h('option', { value: x }, x[0].toUpperCase() + x.slice(1))))),
    h('label', { class: overdue ? 'late' : '' }, 'Target date ',
      h('input', {
        type: 'date', value: p.deadline || '',
        onChange: (e, el) => store.dispatch('setProjectField', { projectId: p.id, field: 'deadline', value: el.value || null }),
      })),
    h('button', { class: 'btn small primary', onClick: () => { ui.editMeta = false; ctx.render(); } }, 'Done'));
}

/** "✉ Open mail" / "↗ Open page": goes back to the mail or web page a step came from (added with the Chrome button). */
export function isMailLink(link) {
  const url = link && cleanUrl(link.url);
  return !!url && /(^|\.)(outlook\.office\.com|outlook\.office365\.com|outlook\.live\.com|mail\.google\.com)$/.test(new URL(url).hostname);
}

/** Links and files as small chips near the top of the page (🔗 title / 📎 file name); the full lists stay under More. */
function quickLinks(ctx, p) {
  const links = (p.links || []).filter((l) => cleanUrl(l.url));
  const files = p.files || [];
  if (!links.length && !files.length) return null;
  return h('div', { class: 'quick-links', key: 'ql-' + p.id },
    links.map((l) => h('a', { class: 'tag quick-link', key: 'ql-l-' + l.id, href: cleanUrl(l.url), target: '_blank', rel: 'noopener noreferrer', title: l.url }, `🔗 ${l.title || l.url}`)),
    files.map((f) => h('button', { class: 'tag quick-link', key: 'ql-f-' + f.id, type: 'button', title: `Open ${f.name}`, onClick: () => openFile(ctx, f) }, `📎 ${f.name}`)));
}

export function linkChip(link, label = null) {
  const url = link && cleanUrl(link.url);
  if (!url) return null;
  return h('a', { class: 'tag link-chip', href: url, target: '_blank', rel: 'noopener noreferrer', title: link.title || url, key: 'lk' }, label || (isMailLink(link) ? '✉ Open mail' : '↗ Open page'));
}

/**
 * Nothing open on the right (a computer): today at a glance instead of an empty side (owner, 24 Oct) —
 * how many are on track, the red / yellow ones with why (tap to open), and how to open or add one.
 */
export function todayGlance(ctx) {
  const data = ctx.store.view.data;
  const today = todayIndia();
  const list = todayList(data, today);
  const by = (c) => list.filter((x) => dotColour(x, today) === c);
  const red = by('red'), yellow = by('yellow'), green = by('green');
  const need = [...red, ...yellow].slice(0, 6);
  return h('div', { class: 'empty today-glance', key: 'glance' },
    list.length ? [
      h('h3', { key: 'gh' }, '☀︎ Today at a glance'),
      h('p', { class: 'glance-counts', key: 'gc' }, h('span', { class: 'dot red' }), ` ${red.length}  `, h('span', { class: 'dot yellow' }), ` ${yellow.length}  `, h('span', { class: 'dot green' }), ` ${green.length} on track`), // (the menu's order: red first, owner 24 Oct)
      need.length ? h('ul', { class: 'glance-list', key: 'gl' }, need.map((x) => h('li', { key: 'g-' + x.id },
        h('button', { class: 'link', type: 'button', onClick: () => (ctx.openProject ? ctx.openProject(x.id) : null) }, x.name), ' ',
        h('span', { class: 'tag ' + (dotColour(x, today) === 'red' ? 'late' : 'stale') }, colourShort(x, today))))) : h('p', { class: 'muted', key: 'ok' }, 'Everything is on track 🎉'),
    ] : null,
    h('p', { class: 'muted small', key: 'gp' }, 'Pick a task on the left, or add one with "+ New task".'));
}

export function renderDetail(ctx) {
  const { store, ui } = ctx;
  const p = store.view.data.projects.find((x) => x.id === ui.selected);
  if (!p) return todayGlance(ctx);
  const today = todayIndia();
  const colour = dotColour(p, today);
  const openSteps = p.steps.filter((s) => !s.done);
  const doneSteps = p.steps.filter((s) => s.done).sort((a, b) => (a.doneAt < b.doneAt ? 1 : -1));
  const opened = ui.openParts || (ui.openParts = {});
  // Extra parts show when they have something in them, or after their "+" button is tapped.
  const show = {
    notes: opened.notes || !!p.notes.trim(),
    links: opened.links || p.links.length > 0,
    files: opened.files || p.files.length > 0,
    history: !!opened.history,
  };
  for (const name of Object.keys(show)) if (show[name]) opened[name] = true; // keep it open even if emptied
  const openPart = (name) => { opened[name] = true; ui.showMore = true; ctx.render(); };
  const chip = (name, label) => (show[name] ? null : h('button', { class: 'chip', onClick: () => openPart(name) }, label));
  const notesShown = ui.notesLimit || 3;
  const upd = updateBox(ctx, p);
  // Green: offer the next task that still needs you, right here.
  const np = p.state === 'active' && colour === 'green' && ctx.nextOpenProject ? ctx.nextOpenProject(p.id) : null;

  const hasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  return h('div', {
    class: 'detail-inner' + (ui.dropOver ? ' drop-over' : ''), key: 'detail-' + p.id,
    // drop a file anywhere: photos go on Today's update, other files go to Files
    onDragover: (e) => { if (!hasFiles(e)) return; e.preventDefault(); if (!ui.dropOver) { ui.dropOver = true; ctx.render(); } },
    onDragleave: (e, el) => { if (ui.dropOver && !el.contains(e.relatedTarget)) { ui.dropOver = false; ctx.render(); } },
    onDrop: async (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      ui.dropOver = false;
      const files = [...e.dataTransfer.files];
      // the update box is only there on an active task: on a paused / finished one photos go to Files (as a paste does)
      const photos = p.state === 'active' ? files.filter(isPhoto) : []; // (an iPhone photo too)
      const others = files.filter((f) => !photos.includes(f));
      ctx.render();
      if (photos.length) {
        focusUpdate(p);
        await addUpdatePhotos(ctx, p, photos);
      }
      if (others.length) { opened.files = true; ui.showMore = true; await uploadFiles(ctx, p.id, others); ctx.render(); }
    },
  },
    h('div', { class: 'detail-top' },
      h('button', { class: 'icon back', 'aria-label': 'Back to list', onClick: () => { ui.mobile = 'list'; ctx.render(); } }, '←'),
      h('span', { class: `dot ${colour}`, title: colourWhy(p, today) }), // why it has this colour
      p.misc ? h('h2', { class: 'misc-title' }, `📂 ${IN_NO_PROJECT}`) : autoField('input', { class: 'title-input', value: p.name, 'aria-label': `${kindWord(ctx, p) === 'task' ? 'Task' : 'Project'} name`, title: `Click to change the ${kindWord(ctx, p)} name`, key: 'name-' + p.id },
        (v) => store.dispatch('setProjectField', { projectId: p.id, field: 'name', value: v })),
      p.misc ? null : h('button', {
        class: 'icon edit-title', title: `Change the ${kindWord(ctx, p)} name`, 'aria-label': `Change the ${kindWord(ctx, p)} name`,
        onClick: () => { const n = document.querySelector(`[data-key="name-${p.id}"]`); if (n) { n.focus(); n.select(); } },
      }, '✎'),
      h('div', { class: 'state-buttons' }, stateButtons(ctx, p))),
    aboutLine(ctx, p),
    colour === 'red' || colour === 'yellow' ? h('div', { class: 'why-line ' + colour, key: 'why-' + p.id }, `${colour === 'red' ? '🔴' : '🟡'} ${colourWhy(p, today)}`) : null, // why it is not green, in words (owner, 24 Oct)
    p.misc ? null : stageLine(ctx, p), // (📂 In no project only holds tasks: no stage, priority, target, time or status — owner 24 Oct) the Stage chip near the top: ⚪ Not started · 🔵 In progress · 🟠 Waiting: … · ✅ Done (tap to change)
    projectMenu(ctx, p),
    mainBox(ctx, p, 'parent'),
    snoozeBar(ctx, p),
    onlyDaysBar(ctx, p),
    remindOnceBar(ctx, p),
    teamBar(ctx, p),
    p.misc ? null : infoChips(ctx, p, today),
    quickLinks(ctx, p), // its links and files near the top: one click opens (owner asked, 22 Oct)
    projectEmailCards(ctx, p, today), // from an email: who wrote, the newest lines, and the reply (✉ Reply ready)
    ui.editMeta ? metaLine(ctx, p, today) : null,
    ui.showTime === p.id ? timeLine(ctx, p, today) : null,
    teamMessages(ctx, p),
    p.misc ? null : statusLine(ctx, p),
    p.state !== 'active' ? h('p', { class: 'banner' }, p.state === 'paused' ? `This ${kindWord(ctx, p)} is paused. It is hidden from Today.` : `This ${kindWord(ctx, p)} is finished.`) : null,
    mainChip(ctx, p), // 📂 Kilns › 📂 Supplier approval › (the projects this task is in)
    subProjectsBlock(ctx, p, today), // a 📂 project: TASKS (N)

    isMainProject(store.view.data, p) ? oldStepsBlock(ctx, p, openSteps) : section(stepsTitle(),
      h('ul', { class: 'steps sortable-steps', key: 'steps-' + p.id, 'data-project': p.id },
        openSteps.map((s) => stepRow(ctx, p, s, null, !!upd.box && upd.stepId === s.id))),
      p.state === 'finished' ? null : h('form', { // finished: no next step to add (owner, 24 Oct; Reopen first)
        class: 'row add-step',
        onSubmit: (e) => {
          e.preventDefault();
          const input = e.target.elements.text;
          const text = input.value.trim();
          const waiting = (ui.stepPhotos || {})[p.id] || [];
          if (!text) { if (waiting.length) ctx.toast('Type the step first, then press Enter', 2500); return; }
          if (waiting.some((x) => !x.args)) { ctx.toast('A photo is still uploading — press Enter again in a moment', 2500); return; }
          const stepId = newId();
          const ok = waiting.length
            ? ctx.actMany(p.id, [['addStep', { projectId: p.id, stepId, text }], ...waiting.map((x) => ['addFile', { projectId: p.id, ...x.args, stepId }])], `+ ${text} · 📷 ${waiting.length}`)
            : store.dispatch('addStep', { projectId: p.id, stepId, text });
          if (ok) { input.value = ''; if (ui.stepPhotos) delete ui.stepPhotos[p.id]; if (waiting.length) ctx.render(); }
          input.focus();
        },
      },
      h('input', { name: 'text', placeholder: openSteps.length ? '+ Add a step (type @ for a person)' : '+ Add the next step…', title: HAS_KEYBOARD ? 'Key: S' : null, key: 'add-step-' + p.id, enterkeyhint: 'enter', 'data-mention': '1', autocomplete: 'off' })),
      ((ui.stepPhotos || {})[p.id] || []).length ? h('div', { class: 'step-photos step-wait-photos', key: 'swp-' + p.id }, // 📷 pasted here: they go with the step
        ui.stepPhotos[p.id].map((x, i) => h('span', { class: 'step-wait-photo', key: 'sw-' + i },
          x.url ? h('img', { class: 'rich-photo', src: x.url, alt: 'Photo for the new step' }) : '📷', x.args ? null : h('span', { class: 'muted small' }, ' uploading…'),
          h('button', { class: 'link small', type: 'button', title: 'Leave this photo out', onClick: () => { ui.stepPhotos[p.id].splice(i, 1); ctx.render(); } }, '✕'))),
        h('span', { class: 'muted small' }, 'goes with the step — type it and press Enter')) : null,
      doneSteps.length ? h('details', { class: 'done-steps', key: 'done-' + p.id, open: ui.showDone ? true : undefined },
        h('summary', { onClick: (e) => { e.preventDefault(); ui.showDone = !ui.showDone; if (ctx.rememberUi) ctx.rememberUi(); ctx.render(); } }, `Done (${doneSteps.length})`),
        ui.showDone ? h('ul', { class: 'steps' }, doneSteps.slice(0, ui.doneLimit || 10).map((s) => stepRow(ctx, p, s))) : null,
        ui.showDone && doneSteps.length > (ui.doneLimit || 10)
          ? h('button', { class: 'link small', onClick: () => { ui.doneLimit = (ui.doneLimit || 10) + 30; ctx.render(); } }, `Show older (${doneSteps.length - (ui.doneLimit || 10)})`) : null) : null),
    emailThreadBlock(ctx, p), // a task made from an email: EMAIL THREAD (📧 them / ↩ you)

    projectDiary(ctx, p, upd),

    // Calm page: work notes, notes, links, files and history wait under "More" (opened once, it stays open).
    moreFold(ctx, p, [
      p.workNotes.length ? section('Work notes', notesLog(ctx, p, notesShown)) : null,
      show.notes ? section('Notes', notesBox(ctx, p)) : null,
      show.links ? section('Links', linksBlock(ctx, p)) : null,
      show.files ? section('Files', filesBlock(ctx, p)) : null,
      show.history ? section('History', historyBlock(ctx, p)) : null,
      show.notes && show.links && show.files && show.history ? null : h('div', { class: 'chips', key: 'chips-' + p.id },
        chip('notes', '+ Notes'), chip('links', '+ Link'), chip('files', '+ File'), chip('history', 'History')),
    ]),
    np ? h('div', { class: 'next-project bottom', key: 'np-' + p.id },
      h('span', null, '✓ Green for today'),
      h('button', { class: 'btn primary small', onClick: () => ctx.openNextOpen(np.id) },
        h('span', { class: `dot ${dotColour(np, today)}` }), ` Next task: ${np.name} →`)) : null);
}


/** One line of the diary: icon, who, what (and extras like the task it is about, photos, ✎ ✕). */
function diaryLine(icon, who, text, extra = []) {
  return h('div', { class: 'diary-line' }, h('span', { class: 'diary-icon' }, icon),
    h('div', { class: 'diary-text' }, who ? h('strong', null, who) : null, who ? ' ' : null, text, ...extra));
}

/**
 * 📅 What's happening — one diary for EVERY project, newest day first: your updates, ticked tasks, time,
 * the team's updates (with photos) and messages. A working day with nothing in it says "Nothing happened".
 * The week strip on top: green = something happened, red = nothing, grey = Sunday. One box to write today's update.
 */
function projectDiary(ctx, p, upd) {
  const { store, ui } = ctx;
  const today = todayIndia();
  const t = ctx.onServer && ctx.teamDaily ? ctx.teamDaily(p) : null;
  const td = t && t.data ? t.data : null;
  const fillBy = (td && td.fillBy) || '18:00';
  const created = p.createdAt ? indiaDate(p.createdAt) : today;
  const shownDays = ui.projDiaryDays && ui.projDiaryDays.projectId === p.id ? ui.projDiaryDays.n : 14; // its own setting: the main Diary keeps a number in ui.diaryDays
  const filter = ui.diaryTask && ui.diaryTask.projectId === p.id ? ui.diaryTask.stepId : null;
  const stepText = new Map(p.steps.map((x) => [x.id, x.text]));
  const taskStep = new Map((td ? td.tasks : []).map((x) => [x.id, x.stepRef]));
  const iso = (v) => (v.includes('T') ? v : v.replace(' ', 'T') + '+05:30'); // server times are India time
  const about = (stepId) => (stepId && stepText.has(stepId) ? h('span', { class: 'muted small' }, ` · step: ${stepText.get(stepId)}`) : null); // (owner, 24 Oct: say it is the step it was about)
  const entries = [];
  for (const n of p.workNotes) {
    const files = notePhotos(p, n);
    const team = n.text.startsWith('👥 ');
    entries.push({
      day: indiaDate(n.createdAt), at: n.createdAt, work: !n.app && !/^👥 Marked done (in Work Task|by the team)/.test(String(n.text)), stepId: n.stepId,
      // a 🔌 note from an outside app (connect.php) is the app's words, not yours
      node: diaryLine(team ? '👥' : n.app ? '🔌' : '📝', team ? null : n.app ? (p.fromApp || 'App') : 'You', team ? n.text.slice(3) : noteBody(ctx, p, n), [
        about(n.stepId),
        ...files.map((f) => h('button', { class: 'link small', type: 'button', key: 'f-' + f.id, onClick: () => openFile(ctx, f) }, ` 📷 ${f.name}`)),
        team ? null : h('button', { class: 'link small', type: 'button', title: 'Change this update', onClick: () => (p.state === 'active' ? startEditNote(ctx, p, n) : promptEditNote(ctx, p, n)) }, ' ✎'),
        team ? null : h('button', { class: 'link small', type: 'button', title: 'Delete this update', onClick: () => { if (confirm('Delete this update?')) ctx.act('deleteWorkNote', { projectId: p.id, noteId: n.id }, 'Update deleted'); } }, ' ✕'),
      ]),
    });
  }
  for (const e of Object.values(store.view.history).flat()) {
    if (e.projectId !== p.id) continue;
    if (e.kind === 'step_ticked') entries.push({ day: indiaDate(e.at), at: e.at, work: true, stepId: e.stepId, node: diaryLine('✓', 'You', `ticked “${e.detail}”`) });
    else if (e.kind === 'time_logged' || e.kind === 'time_added') entries.push({ day: indiaDate(e.at), at: e.at, work: true, node: diaryLine('⏱', 'You', `worked ${e.detail}`) });
  }
  for (const u of td ? td.updates : []) {
    const words = { stuck: ' · Stuck', finished: ' · Finished' }[u.state] || '';
    entries.push({
      day: u.day, at: iso(u.at), work: u.state !== 'stuck', stepId: taskStep.get(u.taskId),
      node: diaryLine('👥', u.by, `“${u.note}”${words}`, [
        about(taskStep.get(u.taskId)),
        ...(u.photos || []).map((pid) => {
          const src = ctx.teamPhoto ? ctx.teamPhoto(pid) : null;
          return src ? h('img', { class: 'diary-photo', src, alt: 'Photo', key: 'tp-' + pid, onClick: () => window.open(src, '_blank', 'noopener') }) : h('span', { class: 'muted small', key: 'tp-' + pid }, ' 📷');
        }),
      ]),
    });
  }
  for (const c of td ? td.comments || [] : []) {
    if (c.unread) continue; // new ones are in the message box at the top (not twice)
    const src = c.photo && ctx.teamMsgPhoto ? ctx.teamMsgPhoto(c.id) : null;
    entries.push({ day: c.at.slice(0, 10), at: iso(c.at), work: false, stepId: taskStep.get(c.taskId), node: diaryLine('💬', c.mine ? 'You' : c.by, c.text ? `“${c.text}”` : '', [
      c.photo ? (src ? h('img', { class: 'diary-photo', src, alt: 'Photo', key: 'mp-' + c.id, onClick: () => window.open(src, '_blank', 'noopener') }) : h('span', { class: 'muted small', key: 'mp-' + c.id }, ' 📷 Photo')) : null,
      about(taskStep.get(c.taskId))]) });
  }
  const byDay = new Map();
  for (const e of entries) { if (!byDay.has(e.day)) byDay.set(e.day, []); byDay.get(e.day).push(e); }
  const workOn = (day) => (p.teamDays || []).includes(day) || (byDay.get(day) || []).some((e) => e.work); // (team days saved with the project too)
  const weekday = (day) => new Date(day + 'T00:00:00Z').getUTCDay();
  const nowHm = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
  const W = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  // paused or finished: no update is asked for from that day (owner, 24 Oct: never "Waiting for today's update")
  const stoppedFrom = p.state !== 'active' ? (p.stateChangedAt ? indiaDate(p.stateChangedAt) : today) : null;
  const stopWord = p.state === 'finished' ? '✓ Finished' : '⏸ Paused';
  const WHAT = { ok: 'work done', miss: 'no progress', off: 'Sunday — off', wait: 'waiting for today\'s update', none: 'before the project started', stop: stopWord.slice(2).toLowerCase(), held: 'its tasks have the updates' };
  const holder = isMainProject(ctx.store.view.data, p) && !p.steps.some((s) => !s.done); // its tasks have the updates (the strip says so too, owner 24 Oct)
  const LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const week = [];
  for (let i = 6; i >= 0; i--) {
    const day = addDays(today, -i);
    const state = day < created ? 'none' : workOn(day) ? 'ok' : stoppedFrom && day >= stoppedFrom ? 'stop' : holder ? 'held' : weekday(day) === 0 ? 'off' : day === today && nowHm < fillBy ? 'wait' : 'miss';
    week.push(h('span', { class: `wk ${state === 'stop' || state === 'held' ? 'none' : state}`, key: 'wk-' + day, title: `${W[weekday(day)]} ${fmtDay(day)}: ${WHAT[state]}` }, W[weekday(day)][0]));
  }
  let start = addDays(today, -(shownDays - 1));
  if (created > start) start = created;
  const needMonth = start.slice(0, 7);
  if (!store.view.history[needMonth] && store.availableMonths().includes(needMonth) && !(ui.monthLoading ||= {})[needMonth]) {
    ui.monthLoading[needMonth] = true; // your own ticks and time on those days (the page draws again when they arrive)
    Promise.resolve(store.loadMonth(needMonth)).catch(() => { ui.monthLoading[needMonth] = false; });
  }
  const days = [];
  for (let day = today; day >= start; day = addDays(day, -1)) days.push(day);
  return h('section', { class: 'block diary', key: 'diary-' + p.id },
    h('div', { class: 'diary-head' }, h('h3', null, "📅 What's happening"), h('div', { class: 'week', title: 'Last 7 days' }, week)),
    upd.box,
    filter ? h('div', { class: 'diary-filter' }, `Only: ${stepText.get(filter) || 'this task'} `,
      h('button', { class: 'link small', type: 'button', onClick: () => { ui.diaryTask = null; ctx.render(); } }, '✕ show all')) : null,
    h('ul', { class: 'diary-days' }, days.map((day) => {
      const list = (byDay.get(day) || []).filter((e) => !filter || e.stepId === filter).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
      let empty = null;
      if (!list.some((e) => e.work)) { // nothing that counts as work (maybe a Stuck or a message): the day's tag too
        if (stoppedFrom && day >= stoppedFrom) empty = list.length ? null : day === today ? h('span', { class: 'day-tag off' }, stopWord) : h('span', { class: 'muted small' }, '—');
        else if (holder) empty = list.length ? null : h('span', { class: 'muted small' }, '—'); // a 📂 project with no step of its own: no update of its own is asked for
        else if ((p.teamDays || []).includes(day)) empty = h('span', { class: 'day-tag team' }, '👥 Team worked');
        else if (weekday(day) === 0) empty = h('span', { class: 'day-tag off' }, 'Off');
        else if (day === today && nowHm < fillBy) empty = h('span', { class: 'day-tag wait' }, 'Waiting for today\'s update');
        else if (p.team && !(td && td.from && day >= td.from)) empty = h('span', { class: 'muted small' }, t && t.days >= 120 && !t.loading ? '—' : '…'); // still loading (— older than the team history kept)
        else empty = [h('span', { class: 'day-tag miss' }, 'No progress'), h('span', { class: 'muted small' }, ' no update from anyone')];
      }
      return h('li', { class: 'diary-day', key: 'dd-' + day },
        h('div', { class: 'diary-date' }, h('strong', null, day === today ? 'Today' : LONG[weekday(day)]),
          h('span', { class: 'muted small' }, day === today ? `${W[weekday(day)]} ${fmtDay(day)}` : fmtDay(day))),
        h('div', { class: 'diary-items' }, list.map((e) => h('div', { class: 'diary-entry', key: 'de-' + e.at + (e.kind || '') }, e.node,
          e.at ? h('span', { class: 'diary-time' }, fmtTime(e.at)) : null)), empty));
    })),
    start > created ? h('button', {
      class: 'link small', type: 'button',
      onClick: () => {
        ui.projDiaryDays = { projectId: p.id, n: shownDays + 14 };
        if (ctx.moreDaily && td && td.from && addDays(today, -(shownDays + 13)) < td.from) ctx.moreDaily(p); // the team's older updates too
        const loaded = new Set(Object.keys(store.view.history));
        const older = store.availableMonths().find((m) => !loaded.has(m));
        if (older && addDays(today, -(shownDays + 13)).slice(0, 7) <= older) store.loadMonth(older); // the older days' ticks
        ctx.render();
      },
    }, 'Show older days') : null);
}

/** "▸ More — 3 work notes · notes · 2 files": the less-used parts of a project, folded. */
function moreFold(ctx, p, parts) {
  const { ui } = ctx;
  const bits = [
    p.workNotes.length ? `${p.workNotes.length} work note${p.workNotes.length === 1 ? '' : 's'}` : null,
    p.notes.trim() ? 'notes' : null,
    p.links.length ? `${p.links.length} link${p.links.length === 1 ? '' : 's'}` : null,
    p.files.length ? `${p.files.length} file${p.files.length === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  const open = !!ui.showMore;
  return h('div', { class: 'more-fold', key: 'more-' + p.id },
    h('button', {
      class: 'more-toggle', 'aria-expanded': String(open),
      onClick: () => { ui.showMore = !open; if (ctx.rememberUi) ctx.rememberUi(); ctx.render(); },
    }, h('span', { class: 'more-arrow' }, open ? '▾' : '▸'), ' More', bits.length ? h('span', { class: 'muted small' }, ` — ${bits.join(' · ')}`) : h('span', { class: 'muted small' }, ' — notes, links, files, history')),
    open ? h('div', { class: 'more-body' }, parts) : null);
}
