// The right column: everything about one project, all editable in place.

import { h, fmtDay, fmtTime, fmtSize, keyHint, withKey, HAS_KEYBOARD } from './dom.js';

const MOD = /Mac|iPhone|iPad/.test(globalThis.navigator ? navigator.platform || navigator.userAgent || '' : '') ? '⌘' : 'Ctrl';
import { dotColour, isSnoozed, daysBetween, addDays, todayIndia, isOverdue, indiaDate, waitingDays, lastWorkDate, nextStep, stepLinkedTo, personStatus, minutesBetween, fmtMinutes, weekStart } from '../rules.js';
import { WAIT_RED_DAYS } from '../config.js';
import { newId, PRIORITIES, cleanUrl, groupHasTimer, MAX_SNOOZE_DAYS } from '../ops.js';

const STATUS_OLD_DAYS = 7; // a status older than this turns grey and asks for an update
import { uploadFiles, openFile, uploadBlob } from './files.js';

const REPEAT_WORD = { daily: 'every day', weekly: 'every week', monthly: 'every month' };
const COLOUR_WORD = { green: 'Done for today', yellow: 'Opened today', red: 'Not looked at today', grey: 'Paused or finished' };
const HISTORY_WORDS = {
  created: 'Project created', edited: 'Changed', renamed: 'Renamed', group_changed: 'Moved to group',
  step_added: 'Step added', step_edited: 'Step changed', step_ticked: 'Step done', step_unticked: 'Step un-ticked',
  step_deleted: 'Step deleted', note_added: 'Work note', note_edited: 'Work note changed', note_deleted: 'Work note deleted',
  paused: 'Paused', unpaused: 'Unpaused', finished: 'Finished', reopened: 'Reopened',
  file_added: 'File added', file_removed: 'File removed', deleted: 'Deleted', reviewed: 'OK for today',
  snoozed: 'Snoozed', woke: 'Woken up', time_added: 'Time added', time_logged: 'Time logged',
  group_added: 'Group added', group_renamed: 'Group renamed', group_deleted: 'Group deleted',
};

/** Text box that saves on its own: after a short pause in typing, and when leaving the box. */
function autoField(tag, props, onSave, onEnter = null) {
  let timer = null;
  const save = (el) => { clearTimeout(timer); onSave(el.value); };
  return h(tag, {
    ...props,
    onInput: (e, el) => { clearTimeout(timer); timer = setTimeout(() => save(el), 900); },
    onChange: (e, el) => save(el),
    onFocusout: (e, el) => save(el),
    onKeydown: tag === 'input' ? (e, el) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); if (onEnter) onEnter(); } } : undefined,
  });
}

function updateState(ui, p) {
  return ((ui.update ||= {})[p.id] ||= { note: '', next: '' });
}

/** Upload photos for the write box. Counts uploads in progress, so Save can wait for them. */
async function addUpdatePhotos(ctx, p, files) {
  const u = updateState(ctx.ui, p);
  u.uploading = (u.uploading || 0) + files.length;
  ctx.render();
  for (const f of files) {
    try {
      const up = await uploadBlob(ctx, f);
      if (up) (u.photos ||= []).push(up);
    } finally {
      u.uploading = Math.max(0, (u.uploading || 1) - 1);
      ctx.render();
    }
  }
}

/** Put the cursor in Today's update ("What did you do on this step?"). */
function focusUpdate(p) {
  setTimeout(() => {
    const n = document.querySelector(`[data-key="wn-${p.id}"]`);
    if (n) { n.scrollIntoView({ block: 'center' }); n.focus(); }
  }, 30);
}

/** Notes written about this step (newest 2), shown under it. */
function stepNotes(p, s) {
  const notes = p.workNotes.filter((n) => n.stepId === s.id).slice(0, 2);
  if (!notes.length) return null;
  return h('div', { class: 'step-notes' }, notes.map((n) => h('div', { key: 'sn-' + n.id }, `📝 ${fmtDay(indiaDate(n.createdAt))}: ${n.text}`)));
}

function stepRow(ctx, p, s, box = null) {
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
  if (s.repeat && !s.done) tags.push(h('span', { class: 'tag repeat', title: 'Repeats' }, `↻ ${REPEAT_WORD[s.repeat]}`));
  if (s.snoozedUntil && s.snoozedUntil > today && !s.done) tags.push(h('span', { class: 'tag' }, `from ${fmtDay(s.snoozedUntil)}`));
  const aboutThis = () => { const u = updateState(ui, p); if (u.about !== s.id) { u.about = s.id; ctx.render(); } };
  return h('li', { class: 'step' + (box ? ' has-update' : '') + (s.done ? ' done' : '') + (s.snoozedUntil && s.snoozedUntil > today && !s.done ? ' later' : ''), key: 's-' + s.id, 'data-id': s.id },
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
        ? h('span', { class: 'step-text' }, s.text, h('span', { class: 'muted small' }, ` · ${fmtDay(s.doneAt ? indiaDate(s.doneAt) : '')}`))
        : autoField('input', {
          class: 'step-text', value: s.text, 'aria-label': 'Step', key: 'st-' + s.id, 'data-mention': '1',
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
      h('button', {
        class: 'icon', title: 'More', 'aria-label': 'More about this step',
        onClick: () => { ui.openStep = open ? null : s.id; ctx.render(); },
      }, open ? '▴' : '⋯')),
    stepNotes(p, s),
    box,
    open ? h('div', { class: 'step-extra' },
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
      h('button', {
        class: 'btn danger small',
        onClick: () => ctx.act('deleteStep', { projectId: p.id, stepId: s.id }, `Step deleted: ${s.text}`),
      }, '🗑 Delete step')) : null);
}

/** ✨ AI steps panel: suggested next steps, in order. Untick or remove any, edit the words, then add. */
function aiPanel(ctx, p) {
  const { ui, store } = ctx;
  const ai = ui.ai && ui.ai.projectId === p.id ? ui.ai : null;
  if (!ai) return null;
  const close = () => { ui.ai = null; ctx.render(); };
  const head = h('div', { class: 'ai-head' }, h('strong', null, '✨ AI suggested steps'),
    h('button', { class: 'icon', 'aria-label': 'Close', onClick: close }, '✕'));
  let body;
  if (ai.state === 'nokey') {
    body = h('div', null,
      h('p', null, 'Add your Claude or Gemini key in Settings first.'),
      h('button', { class: 'btn primary small', onClick: () => { ui.ai = null; ctx.goSettings(); } }, 'Open Settings'));
  } else if (ai.state === 'busy') {
    body = h('p', { class: 'muted' }, 'Reading the project and thinking…');
  } else if (ai.state === 'error') {
    body = h('div', null, h('p', { class: 'error' }, ai.error),
      h('button', { class: 'btn small', onClick: () => ctx.aiSteps(p) }, '↻ Try again'));
  } else if (ai.state === 'list') {
    const count = ai.steps.filter((t, i) => ai.picked[i] && t.trim()).length;
    body = h('div', null,
      h('p', { class: 'muted small' }, 'Top = the very next step. Untick or ✕ what you don\'t want, or change the words.'),
      h('ol', { class: 'ai-list' }, ai.steps.map((text, i) => h('li', { key: 'ai-' + i, class: ai.picked[i] ? '' : 'off' },
        h('input', {
          type: 'checkbox', checked: ai.picked[i], 'aria-label': 'Use this step',
          onChange: (e, el) => { ai.picked[i] = el.checked; ctx.render(); },
        }),
        h('input', {
          class: 'ai-text', value: text, key: 'ai-t-' + i, 'aria-label': `Suggested step ${i + 1}`,
          onInput: (e, el) => { ai.steps[i] = el.value; },
        }),
        i === 0 ? h('span', { class: 'tag next-tag' }, 'Next') : null,
        h('button', {
          class: 'icon', title: 'Remove this suggestion', 'aria-label': 'Remove this suggestion',
          onClick: () => { ai.steps.splice(i, 1); ai.picked.splice(i, 1); if (!ai.steps.length) ui.ai = null; ctx.render(); },
        }, '✕')))),
      h('div', { class: 'row' },
        h('button', {
          class: 'btn primary', disabled: count ? undefined : true,
          onClick: () => {
            const chosen = ai.steps.filter((t, i) => ai.picked[i] && t.trim()).map((t) => t.trim());
            let added = 0;
            for (const text of chosen) if (store.dispatch('addStep', { projectId: p.id, stepId: newId(), text })) added++;
            ui.ai = null;
            ctx.render();
            if (added) ctx.toast(`Added ${added} step${added > 1 ? 's' : ''} to ${p.name}`);
          },
        }, count ? `Add ${count} step${count > 1 ? 's' : ''}` : 'Pick at least one'),
        h('button', { class: 'btn', onClick: () => ctx.aiSteps(p) }, '↻ New ideas'),
        h('span', { class: 'muted small' }, ai.provider === 'gemini' ? 'by Gemini' : 'by Claude')));
  }
  return h('div', { class: 'ai-panel', key: 'ai-panel-' + p.id }, head, body);
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
        if (confirm(`Remove "${f.name}"?\n\nNote: GitHub keeps old versions, so this does not free space.`)) {
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
  const chosen = u.about && u.about !== 'project' ? openSteps.find((s) => s.id === u.about) : null;
  const due = u.about === 'project' ? null : chosen || nextDue;
  // "Save" = note only; "Save + done" (or Ctrl/⌘+Enter) = note and tick the step it is about.
  const save = (form, done = false) => {
    const f = form.elements;
    const text = f.note.value.trim();
    const next = f.next ? f.next.value.trim() : '';
    const tick = !!(due && done);
    const photos = u.photos || [];
    if (u.uploading) { ctx.toast('A photo is still uploading — save again in a moment', 2500); return; }
    if (!text && !tick && !next && !photos.length) return;
    const steps = [];
    const noteId = newId();
    const noteText = text || (photos.length ? `📷 ${photos.length} photo${photos.length > 1 ? 's' : ''}` : '');
    if (noteText) steps.push(['addWorkNote', { projectId: p.id, noteId, text: noteText, stepId: due ? due.id : null }]);
    for (const ph of photos) steps.push(['addFile', { projectId: p.id, ...ph, noteId }]);
    if (tick) steps.push(['tickStep', { projectId: p.id, stepId: due.id }]);
    if (next) steps.push(['addStep', { projectId: p.id, stepId: newId(), text: next }]);
    const bits = [text ? 'note saved' : null, photos.length ? `${photos.length} photo${photos.length > 1 ? 's' : ''}` : null, tick ? `✓ ${due.text}` : null, next ? `next: ${next}` : null].filter(Boolean);
    const result = ctx.actMany(p.id, steps, bits.join(' · '));
    if (result) {
      f.note.value = '';
      if (f.next) f.next.value = '';
      u.note = ''; u.next = ''; u.photos = []; u.about = null; // back to the next step
      ctx.render();
      if (tick && !next) ctx.afterTick(p.id, 'detail', result.undo); // keeps the Undo button
    }
  };
  const addPhotos = (files) => addUpdatePhotos(ctx, p, files);
  if (p.state !== 'active') return { stepId: null, box: null };
  const box = h('form', {
    class: 'update-form' + (due ? ' in-step' : ' loose'), key: 'update-' + p.id,
    onSubmit: (e) => { e.preventDefault(); save(e.target); },
  },
  due ? null : h('div', { class: 'update-label' },
    u.about === 'project' && openSteps.length
      ? ['📝 About the whole project · ', h('button', { class: 'link small', type: 'button', onClick: () => { u.about = null; ctx.render(); } }, 'back to the next step')]
      : 'No next step yet — write what you did, and add the next step.'),
  h('input', {
    name: 'note', key: 'wn-' + p.id, autocomplete: 'off', enterkeyhint: 'done', 'data-mention': '1', value: u.note,
    placeholder: withKey(due ? 'What did you do on this step today?' : 'What did you do today?', 'W'),
    onInput: (e, el) => { u.note = el.value; }, // half-typed text survives switching projects
    onKeydown: (e, el) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(el.form, true); } },
    onPaste: (e) => { // a pasted screenshot becomes a photo on this update
      const files = [...((e.clipboardData && e.clipboardData.files) || [])].filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      addPhotos(files);
    },
  }),
  openSteps.length ? null : h('input', {
    name: 'next', key: 'wn-next-' + p.id, autocomplete: 'off', enterkeyhint: 'done', 'data-mention': '1', value: u.next,
    onInput: (e, el) => { u.next = el.value; },
    placeholder: 'Next step (optional)',
  }),
  u.uploading ? h('div', { class: 'muted small' }, `📷 Uploading ${u.uploading} photo${u.uploading > 1 ? 's' : ''}…`) : null,
  (u.photos || []).length ? h('div', { class: 'photo-chips' }, u.photos.map((ph, i) => h('span', { class: 'tag photo', key: 'ph-' + ph.fileId },
    `📷 ${ph.name}`, h('button', { class: 'icon tiny-x', type: 'button', 'aria-label': 'Remove photo', onClick: () => { u.photos.splice(i, 1); ctx.render(); } }, '✕')))) : null,
  h('div', { class: 'row' },
    h('button', { class: 'btn small', type: 'submit' }, 'Save'),
    due ? h('button', { class: 'btn primary small', type: 'button', title: `Save the note and tick "${due.text}" (${MOD}+Enter)`, onClick: (e, el) => save(el.form, true) }, '✓ Save + done') : null,
    h('label', { class: 'btn small photo-btn', title: 'Take a photo or choose one' }, '📷 Photo',
      h('input', {
        type: 'file', accept: 'image/*', multiple: true, class: 'visually-hidden',
        onChange: async (e, el) => { const files = [...el.files]; el.value = ''; addPhotos(files); },
      })),
    h('span', { class: 'muted small' }, HAS_KEYBOARD ? (due ? `Enter = Save · ${MOD}+Enter = Save + done` : 'Enter = Save') : ''),
    due ? h('button', { class: 'link small push-right', type: 'button', title: 'Write about the project, not one step', onClick: () => { u.about = 'project'; ctx.render(); focusUpdate(p); } }, 'whole project') : null));
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
        autoField('input', { value: n.text, 'aria-label': 'Work note', key: 'nt-' + n.id, 'data-mention': '1' },
          (v) => { if (v.trim()) store.dispatch('editWorkNote', { projectId: p.id, noteId: n.id, text: v }); }),
        st ? h('span', { class: 'tag on-step', title: 'This note is about this step' }, `on: ${st.text}`) : null,
        ...p.files.filter((f) => f.noteId === n.id).map((f) => h('button', { class: 'tag photo', key: 'nf-' + f.id, title: 'Open photo', onClick: () => openFile(ctx, f) }, '📷')),
        h('button', {
          class: 'icon', title: 'Delete note',
          onClick: () => ctx.act('deleteWorkNote', { projectId: p.id, noteId: n.id }, 'Note deleted'),
        }, '🗑'));
    })),
    p.workNotes.length > notesShown
      ? h('button', { class: 'link small', onClick: () => { ui.notesLimit = notesShown + 20; ctx.render(); } }, `Show older notes (${p.workNotes.length - notesShown})`) : null);
}

/** "Status: one line on where it stands" under the project name. Grey and asks for an update after 7 days. */
function statusLine(ctx, p) {
  const { store } = ctx;
  const today = todayIndia();
  const age = p.status && p.statusAt ? daysBetween(indiaDate(p.statusAt), today) : null;
  const old = age !== null && age >= STATUS_OLD_DAYS;
  return h('div', { class: 'status-line' + (old ? ' old' : '') + (p.status ? '' : ' empty'), key: 'status-' + p.id },
    h('span', { class: 'status-label' }, 'Status'),
    autoField('input', {
      class: 'status-input', value: p.status || '', key: 'st-in-' + p.id, maxlength: 200, 'aria-label': 'Status: one line on where this project stands',
      placeholder: 'One line on where it stands (e.g. Waiting for mould, test next week)',
    }, (v) => store.dispatch('setProjectField', { projectId: p.id, field: 'status', value: v })),
    p.status ? h('span', { class: 'muted small status-age' }, age === 0 ? 'updated today' : old ? `${age} days old — update status?` : `${age} day${age === 1 ? '' : 's'} ago`) : null);
}

/** Snooze form (number of days) or, when snoozed, the "back on …" line with Wake up now. */
function snoozeBar(ctx, p) {
  const { ui } = ctx;
  const today = todayIndia();
  if (p.state !== 'active') return null;
  if (isSnoozed(p, today)) {
    return h('div', { class: 'banner snoozed-banner', key: 'snz-' + p.id },
      `💤 Snoozed — comes back to Today on ${fmtDay(p.snoozedUntil)}.`,
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
      class: 'notes-box', value: p.notes, rows: 4, placeholder: 'Free notes for this project', key: 'notes-' + p.id, 'data-mention': '1',
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

function tagName(g, p) {
  const t = g && p.tagId && (g.tags || []).find((x) => x.id === p.tagId);
  return t ? t.name : '';
}

/** ⏱ Today 1h 20m · This week 4h · Total 12h  · + Add time · entries */
function timeLine(ctx, p, today) {
  const { store, ui } = ctx;
  const timer = store.view.data.timer;
  const logs = p.timeLogs || [];
  const timed = groupHasTimer(store.view.data.groups.find((g) => g.id === p.groupId));
  if (!timed && !logs.length) return null; // no timer in this group (e.g. Personal)
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
  const txt = v.trim().toLowerCase();
  const minutes = txt.endsWith('h') ? Math.round(parseFloat(txt) * 60) : Math.round(parseFloat(txt));
  if (!(minutes > 0)) { ctx.toast('Type a number of minutes, like 45, or hours like 1.5h'); return; }
  ctx.act('addTime', { projectId: p.id, minutes }, `⏱ Added ${fmtMinutes(minutes)} to ${p.name}`);
}

/** ← Back · ‹ previous · next › (in the list you are in). Keys: ⌫, ← → ; phone: swipe. */
function navBar(ctx, p) {
  const prev = ctx.neighbourProject(-1);
  const next = ctx.neighbourProject(1);
  if (!prev && !next && !ctx.canGoBack()) return null;
  return h('div', { class: 'nav-bar', key: 'nav-' + p.id },
    ctx.canGoBack() ? h('button', { class: 'btn small', title: 'Back to where you came from (Backspace)', onClick: () => ctx.goBack() }, '← Back') : h('span'),
    h('div', { class: 'nav-pn' },
      h('button', { class: 'btn small', disabled: prev ? undefined : true, title: prev ? `Previous: ${prev.name} (←)` : 'First in this list', onClick: () => prev && ctx.openInList(prev.id) }, '‹ Prev'),
      h('button', { class: 'btn small', disabled: next ? undefined : true, title: next ? `Next: ${next.name} (→)` : 'Last in this list', onClick: () => next && ctx.openInList(next.id) }, 'Next ›')));
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
  return HAS_KEYBOARD ? h('span', null, 'Steps', h('span', { class: 'h3-hint' }, ' · press ', h('kbd', { class: 'hint' }, 'X'), ' to tick the next one')) : 'Steps';
}

/** Pause / Finish (or Unpause / Reopen / Delete) — always visible at the top. */
function stateButtons(ctx, p) {
  const { store, ui } = ctx;
  if (p.state === 'active') {
    const today = todayIndia();
    const green = dotColour(p, today) === 'green';
    const okOnly = p.okDate === today && lastWorkDate(p) !== today;
    const t = store.view.data.timer;
    const running = t && t.projectId === p.id;
    const timed = groupHasTimer(store.view.data.groups.find((g) => g.id === p.groupId));
    return [
      running
        ? h('button', { class: 'btn timer-on', title: 'Stop the timer', onClick: () => ctx.stopTimer() }, `⏸ ${ctx.clockText(t.start)}`)
        : timed ? h('button', { class: 'btn', title: 'Start timing your work on this project', onClick: () => ctx.startTimer(p) }, '▶ Start') : null,
      !green && !isSnoozed(p, today) ? h('button', { class: 'btn ok-btn', title: 'Looked at it, no more work today (key: o)', onClick: () => ctx.toggleOk(p) }, '✓ OK for today', keyHint('O')) : null,
      okOnly ? h('button', { class: 'btn small', title: 'Undo OK for today', onClick: () => ctx.toggleOk(p) }, 'Undo OK') : null,
      isSnoozed(p, today) ? null : h('button', {
        class: 'btn' + (ui.snoozeOpen === p.id ? ' on' : ''), title: 'Hide from Today for some days',
        onClick: () => { ui.snoozeOpen = ui.snoozeOpen === p.id ? null : p.id; ctx.render(); setTimeout(() => { const n = document.querySelector(`[data-key="snooze-${p.id}"]`); if (n) { n.focus(); n.select(); } }, 30); },
      }, '💤 Snooze'),
      h('button', { class: 'btn', onClick: () => ctx.act('pause', { projectId: p.id }, `Paused: ${p.name}`) }, 'Pause'),
      h('button', {
        class: 'btn',
        onClick: () => ctx.act('finish', { projectId: p.id }, `Finished: ${p.name} (moved to Finished)`),
      }, 'Finish'),
    ];
  }
  if (p.state === 'paused') {
    return [
      h('button', { class: 'btn primary', onClick: () => store.dispatch('unpause', { projectId: p.id }) }, 'Unpause'),
      h('button', { class: 'btn', onClick: () => ctx.act('finish', { projectId: p.id }, `Finished: ${p.name} (moved to Finished)`) }, 'Finish'),
    ];
  }
  return [
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

function metaLine(ctx, p, today) {
  const { store, ui } = ctx;
  const g = store.view.data.groups.find((x) => x.id === p.groupId);
  const pri = p.priority[0].toUpperCase() + p.priority.slice(1);
  const overdue = isOverdue(p, today);
  if (!ui.editMeta) {
    return h('button', { class: 'meta-line', key: 'meta-' + p.id, title: 'Change group, priority or target date', onClick: () => { ui.editMeta = true; ctx.render(); } },
      h('span', null, g ? g.name : ''),
      tagName(g, p) ? [' · ', h('span', { class: 'tag tag-chip' }, `🏷 ${tagName(g, p)}`)] : '',
      ' · ', h('span', { class: p.priority === 'high' ? 'meta-high' : '' }, pri),
      p.deadline ? [' · ', h('span', { class: overdue ? 'late' : '' }, `${overdue ? 'Overdue' : 'Target'} ${fmtDay(p.deadline)}`)] : ' · No target date',
      h('span', { class: 'meta-edit', 'aria-hidden': 'true' }, ' ✎'));
  }
  return h('div', { class: 'fields', key: 'fields-' + p.id },
    h('label', null, 'Group ',
      h('select', {
        value: p.groupId,
        onChange: (e, el) => store.dispatch('setProjectField', { projectId: p.id, field: 'groupId', value: el.value }),
      }, store.view.data.groups.map((x) => h('option', { value: x.id }, x.name)))),
    h('label', null, 'Tag ',
      h('select', {
        value: p.tagId || '',
        onChange: (e, el) => {
          if (el.value === '__new') {
            const name = prompt(`New tag for the group "${g ? g.name : ''}":`);
            if (name && name.trim() && g) {
              const tagId = newId();
              if (store.dispatch('addTag', { groupId: g.id, tagId, name: name.trim() })) store.dispatch('setProjectField', { projectId: p.id, field: 'tagId', value: tagId });
              else ctx.toast(`"${name.trim()}" already exists in ${g.name}`);
            }
            ctx.render();
            return;
          }
          store.dispatch('setProjectField', { projectId: p.id, field: 'tagId', value: el.value || null });
        },
      },
      h('option', { value: '' }, 'No tag'),
      ((g && g.tags) || []).map((t) => h('option', { value: t.id }, t.name)),
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

export function renderDetail(ctx) {
  const { store, ui } = ctx;
  const p = store.view.data.projects.find((x) => x.id === ui.selected);
  if (!p) {
    return h('div', { class: 'empty' }, h('p', null, 'Pick a project on the left,'), h('p', null, 'or add one with "+ New project".'));
  }
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
  const openPart = (name) => { opened[name] = true; ctx.render(); };
  const chip = (name, label) => (show[name] ? null : h('button', { class: 'chip', onClick: () => openPart(name) }, label));
  const notesShown = ui.notesLimit || 3;
  const upd = updateBox(ctx, p);
  // The project is green: offer the next project that still needs you, right here.
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
      const photos = files.filter((f) => f.type.startsWith('image/'));
      const others = files.filter((f) => !f.type.startsWith('image/'));
      ctx.render();
      if (photos.length) {
        focusUpdate(p);
        await addUpdatePhotos(ctx, p, photos);
      }
      if (others.length) { opened.files = true; await uploadFiles(ctx, p.id, others); ctx.render(); }
    },
  },
    h('div', { class: 'detail-top' },
      h('button', { class: 'icon back', 'aria-label': 'Back to list', onClick: () => { ui.mobile = 'list'; ctx.render(); } }, '←'),
      h('span', { class: `dot ${colour}`, title: COLOUR_WORD[colour] }),
      autoField('input', { class: 'title-input', value: p.name, 'aria-label': 'Project name', key: 'name-' + p.id },
        (v) => store.dispatch('setProjectField', { projectId: p.id, field: 'name', value: v })),
      h('div', { class: 'state-buttons' }, stateButtons(ctx, p))),
    snoozeBar(ctx, p),
    navBar(ctx, p),
    statusLine(ctx, p),
    metaLine(ctx, p, today),
    timeLine(ctx, p, today),
    peopleChips(ctx, p),
    p.state !== 'active' ? h('p', { class: 'banner' }, p.state === 'paused' ? 'This project is paused. It is hidden from Today.' : 'This project is finished.') : null,

    section(stepsTitle(),
      np ? h('div', { class: 'next-project', key: 'np-' + p.id },
        h('span', null, '✓ Green for today.'),
        h('button', { class: 'btn primary small', onClick: () => ctx.openNextOpen(np.id) },
          h('span', { class: `dot ${dotColour(np, today)}` }), ` Next: ${np.name} →`)) : null,
      h('ul', { class: 'steps sortable-steps', key: 'steps-' + p.id, 'data-project': p.id },
        openSteps.map((s) => stepRow(ctx, p, s, s.id === upd.stepId ? upd.box : null))),
      upd.stepId ? null : upd.box,
      openSteps.length ? null : h('p', { class: 'warn' }, 'No next step — add one'),
      h('form', {
        class: 'row add-step',
        onSubmit: (e) => {
          e.preventDefault();
          const input = e.target.elements.text;
          const text = input.value.trim();
          if (!text) return;
          if (store.dispatch('addStep', { projectId: p.id, stepId: newId(), text })) input.value = '';
          input.focus();
        },
      },
      h('input', { name: 'text', placeholder: withKey(openSteps.length ? '+ Add step (type @ for a person)' : `What's next for "${p.name}"?`, 'S'), key: 'add-step-' + p.id, enterkeyhint: 'enter', 'data-mention': '1', autocomplete: 'off' }),
      h('button', {
        class: 'btn ai small', type: 'button', title: 'AI reads this project and suggests the next steps (key: i)',
        onClick: () => { if (ui.ai && ui.ai.projectId === p.id) { ui.ai = null; ctx.render(); } else ctx.aiSteps(p); },
      }, '✨ AI steps', keyHint('I'))),
      aiPanel(ctx, p),
      doneSteps.length ? h('details', { class: 'done-steps', key: 'done-' + p.id, open: ui.showDone ? true : undefined },
        h('summary', { onClick: (e) => { e.preventDefault(); ui.showDone = !ui.showDone; ctx.render(); } }, `Done (${doneSteps.length})`),
        ui.showDone ? h('ul', { class: 'steps' }, doneSteps.map((s) => stepRow(ctx, p, s))) : null) : null),

    p.workNotes.length ? section('Work notes', notesLog(ctx, p, notesShown)) : null,

    show.notes ? section('Notes', notesBox(ctx, p)) : null,
    show.links ? section('Links', linksBlock(ctx, p)) : null,
    show.files ? section('Files', filesBlock(ctx, p)) : null,
    show.history ? section('History', historyBlock(ctx, p)) : null,
    show.notes && show.links && show.files && show.history ? null : h('div', { class: 'chips', key: 'chips-' + p.id },
      chip('notes', '+ Notes'), chip('links', '+ Link'), chip('files', '+ File'), chip('history', 'History')));
}
