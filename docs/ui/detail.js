// The right column: everything about one project, all editable in place.

import { h, fmtDay, fmtTime, fmtSize, keyHint, withKey, HAS_KEYBOARD } from './dom.js';
import { dotColour, todayIndia, isOverdue, indiaDate, waitingDays, lastWorkDate, nextStep, stepLinkedTo, personStatus, minutesBetween, fmtMinutes, weekStart } from '../rules.js';
import { WAIT_RED_DAYS } from '../config.js';
import { newId, PRIORITIES, cleanUrl } from '../ops.js';
import { uploadFiles, openFile, uploadBlob } from './files.js';

const REPEAT_WORD = { daily: 'every day', weekly: 'every week', monthly: 'every month' };
const COLOUR_WORD = { green: 'Done for today', yellow: 'Opened today', red: 'Not looked at today', grey: 'Paused or finished' };
const HISTORY_WORDS = {
  created: 'Project created', edited: 'Changed', renamed: 'Renamed', group_changed: 'Moved to group',
  step_added: 'Step added', step_edited: 'Step changed', step_ticked: 'Step done', step_unticked: 'Step un-ticked',
  step_deleted: 'Step deleted', note_added: 'Work note', note_edited: 'Work note changed', note_deleted: 'Work note deleted',
  paused: 'Paused', unpaused: 'Unpaused', finished: 'Finished', reopened: 'Reopened',
  file_added: 'File added', file_removed: 'File removed', deleted: 'Deleted', reviewed: 'OK for today',
};

/** Text box that saves on its own: after a short pause in typing, and when leaving the box. */
function autoField(tag, props, onSave) {
  let timer = null;
  const save = (el) => { clearTimeout(timer); onSave(el.value); };
  return h(tag, {
    ...props,
    onInput: (e, el) => { clearTimeout(timer); timer = setTimeout(() => save(el), 900); },
    onChange: (e, el) => save(el),
    onFocusout: (e, el) => save(el),
    onKeydown: tag === 'input' ? (e, el) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } } : undefined,
  });
}

/** Notes written about this step (newest 2), shown under it. */
function stepNotes(p, s) {
  const notes = p.workNotes.filter((n) => n.stepId === s.id).slice(0, 2);
  if (!notes.length) return null;
  return h('div', { class: 'step-notes' }, notes.map((n) => h('div', { key: 'sn-' + n.id }, `📝 ${fmtDay(indiaDate(n.createdAt))}: ${n.text}`)));
}

function stepRow(ctx, p, s) {
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
  return h('li', { class: 'step' + (s.done ? ' done' : '') + (s.snoozedUntil && s.snoozedUntil > today && !s.done ? ' later' : ''), key: 's-' + s.id, 'data-id': s.id },
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
        : autoField('input', { class: 'step-text', value: s.text, 'aria-label': 'Step', key: 'st-' + s.id, 'data-mention': '1' },
          (v) => store.dispatch('setStepField', { projectId: p.id, stepId: s.id, field: 'text', value: v })),
      ...tags,
      s.done ? null : h('button', {
        class: 'icon', title: 'Write what happened on this step', 'aria-label': `Update on ${s.text}`,
        onClick: () => {
          const u = ((ui.update ||= {})[p.id] ||= { done: false, note: '', next: '' });
          u.about = s.id; u.done = false;
          ctx.render();
          setTimeout(() => {
            const n = document.querySelector(`[data-key="wn-${p.id}"]`);
            if (n) { n.scrollIntoView({ block: 'center' }); n.focus(); }
          }, 30);
        },
      }, '📝'),
      h('button', {
        class: 'icon', title: 'More', 'aria-label': 'More about this step',
        onClick: () => { ui.openStep = open ? null : s.id; ctx.render(); },
      }, open ? '▴' : '⋯')),
    stepNotes(p, s),
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
    onDrop: (e, el) => { e.preventDefault(); el.classList.remove('over'); uploadFiles(ctx, p.id, [...e.dataTransfer.files]); },
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
function todaysUpdate(ctx, p, notesShown) {
  const { store, ui } = ctx;
  const today = todayIndia();
  const nextDue = p.state === 'active' ? nextStep(p, today, { dueOnly: true }) : null;
  const openSteps = p.state === 'active' ? p.steps.filter((s) => !s.done) : [];
  const u = ((ui.update ||= {})[p.id] ||= { done: false, note: '', next: '' });
  // Which step is this update about? The next step by default; any open step via the picker or a step's 📝; or the whole project.
  const chosen = u.about && u.about !== 'project' ? openSteps.find((s) => s.id === u.about) : null;
  const due = u.about === 'project' ? null : chosen || nextDue;
  if (u.done && (!due || u.stepId !== due.id)) u.done = false; // "done" only counts for the step it was ticked for
  const save = (form) => {
    const f = form.elements;
    const text = f.note.value.trim();
    const next = f.next ? f.next.value.trim() : '';
    const tick = !!(due && u.done);
    const photos = u.photos || [];
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
      u.done = false; u.note = ''; u.next = ''; u.photos = []; u.about = null; // back to the next step
      ctx.render();
      if (tick && !next) ctx.afterTick(p.id, 'detail', result.undo); // keeps the Undo button
    }
  };
  const nextBox = !openSteps.length || u.done;
  const picker = openSteps.length > 1 || (openSteps.length && u.about === 'project')
    ? h('select', {
      class: 'about-select', key: 'about-' + p.id, value: u.about === 'project' ? 'project' : due ? due.id : 'project', 'aria-label': 'Which step is this update about?',
      onChange: (e, el) => { u.about = el.value; u.done = false; ctx.render(); setTimeout(() => { const n = document.querySelector(`[data-key="wn-${p.id}"]`); if (n) n.focus(); }, 30); },
    },
    openSteps.map((s) => h('option', { value: s.id }, `${s.id === (nextDue || {}).id ? '→ ' : ''}${s.text}`)),
    h('option', { value: 'project' }, 'Whole project (no step)'))
    : null;
  return h('div', { class: 'update' },
    h('div', { class: 'update-next' + (due || u.about === 'project' ? '' : ' none') },
      due ? [due === nextDue ? '→ Next: ' : '📝 About: ', h('strong', null, due.text), due.waiting ? h('span', { class: 'tag waiting' }, due.waitingOn ? `Waiting: ${due.waitingOn}` : 'Waiting') : null]
        : u.about === 'project' ? '📝 About: the whole project'
          : 'No next step yet — write what you did and add the next step below.',
      picker ? h('span', { class: 'about-pick' }, 'change: ', picker) : null),
    h('form', {
      class: 'update-form', key: 'update-' + p.id,
      onSubmit: (e) => { e.preventDefault(); save(e.target); },
    },
    h('input', {
      name: 'note', key: 'wn-' + p.id, autocomplete: 'off', enterkeyhint: 'done', 'data-mention': '1', value: u.note,
      placeholder: withKey(due ? 'What did you do on this step?' : 'What did you do today?', 'W'),
      onInput: (e, el) => { u.note = el.value; }, // half-typed text survives switching projects
    }),
    due ? h('label', { class: 'check update-done' },
      h('input', { type: 'checkbox', checked: u.done, onChange: (e, el) => { u.done = el.checked; u.stepId = due.id; ctx.render(); if (el.checked) setTimeout(() => { const n = document.querySelector(`[data-key="wn-next-${p.id}"]`); if (n) n.focus(); }, 30); } }),
      ' This step is done') : null,
    nextBox ? h('input', {
      name: 'next', key: 'wn-next-' + p.id, autocomplete: 'off', enterkeyhint: 'done', 'data-mention': '1', value: u.next,
      onInput: (e, el) => { u.next = el.value; },
      placeholder: due ? "What's next? (optional)" : 'Next step (optional)',
    }) : null,
    (u.photos || []).length ? h('div', { class: 'photo-chips' }, u.photos.map((ph, i) => h('span', { class: 'tag photo', key: 'ph-' + ph.fileId },
      `📷 ${ph.name}`, h('button', { class: 'icon tiny-x', type: 'button', 'aria-label': 'Remove photo', onClick: () => { u.photos.splice(i, 1); ctx.render(); } }, '✕')))) : null,
    h('div', { class: 'row' },
      h('button', { class: 'btn primary small', type: 'submit' }, 'Save update'),
      h('label', { class: 'btn small photo-btn', title: 'Take a photo or choose one' }, '📷 Photo',
        h('input', {
          type: 'file', accept: 'image/*', multiple: true, class: 'visually-hidden',
          onChange: async (e, el) => {
            const files = [...el.files];
            el.value = '';
            for (const f of files) {
              const up = await uploadBlob(ctx, f);
              if (up) { (u.photos ||= []).push(up); ctx.render(); }
            }
          },
        })),
      h('span', { class: 'muted small' }, 'Enter also saves'))),
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

/** ⏱ Today 1h 20m · This week 4h · Total 12h  · + Add time · entries */
function timeLine(ctx, p, today) {
  const { store, ui } = ctx;
  const timer = store.view.data.timer;
  const logs = p.timeLogs || [];
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
    return [
      running
        ? h('button', { class: 'btn timer-on', title: 'Stop the timer', onClick: () => ctx.stopTimer() }, `⏸ ${ctx.clockText(t.start)}`)
        : h('button', { class: 'btn', title: 'Start timing your work on this project', onClick: () => ctx.startTimer(p) }, '▶ Start'),
      !green ? h('button', { class: 'btn ok-btn', title: 'Looked at it, no more work today (key: o)', onClick: () => ctx.toggleOk(p) }, '✓ OK for today', keyHint('O')) : null,
      okOnly ? h('button', { class: 'btn small', title: 'Undo OK for today', onClick: () => ctx.toggleOk(p) }, 'Undo OK') : null,
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
      h('span', null, g ? g.name : ''), ' · ', h('span', { class: p.priority === 'high' ? 'meta-high' : '' }, pri),
      p.deadline ? [' · ', h('span', { class: overdue ? 'late' : '' }, `${overdue ? 'Overdue' : 'Target'} ${fmtDay(p.deadline)}`)] : ' · No target date',
      h('span', { class: 'meta-edit', 'aria-hidden': 'true' }, ' ✎'));
  }
  return h('div', { class: 'fields', key: 'fields-' + p.id },
    h('label', null, 'Group ',
      h('select', {
        value: p.groupId,
        onChange: (e, el) => store.dispatch('setProjectField', { projectId: p.id, field: 'groupId', value: el.value }),
      }, store.view.data.groups.map((x) => h('option', { value: x.id }, x.name)))),
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

  return h('div', { class: 'detail-inner', key: 'detail-' + p.id },
    h('div', { class: 'detail-top' },
      h('button', { class: 'icon back', 'aria-label': 'Back to list', onClick: () => { ui.mobile = 'list'; ctx.render(); } }, '←'),
      h('span', { class: `dot ${colour}`, title: COLOUR_WORD[colour] }),
      autoField('input', { class: 'title-input', value: p.name, 'aria-label': 'Project name', key: 'name-' + p.id },
        (v) => store.dispatch('setProjectField', { projectId: p.id, field: 'name', value: v })),
      h('div', { class: 'state-buttons' }, stateButtons(ctx, p))),
    navBar(ctx, p),
    metaLine(ctx, p, today),
    timeLine(ctx, p, today),
    peopleChips(ctx, p),
    p.state !== 'active' ? h('p', { class: 'banner' }, p.state === 'paused' ? 'This project is paused. It is hidden from Today.' : 'This project is finished.') : null,

    section(stepsTitle(),
      h('ul', { class: 'steps sortable-steps', key: 'steps-' + p.id, 'data-project': p.id },
        openSteps.map((s) => stepRow(ctx, p, s))),
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

    section("Today's update", todaysUpdate(ctx, p, notesShown)),

    show.notes ? section('Notes', notesBox(ctx, p)) : null,
    show.links ? section('Links', linksBlock(ctx, p)) : null,
    show.files ? section('Files', filesBlock(ctx, p)) : null,
    show.history ? section('History', historyBlock(ctx, p)) : null,
    show.notes && show.links && show.files && show.history ? null : h('div', { class: 'chips', key: 'chips-' + p.id },
      chip('notes', '+ Notes'), chip('links', '+ Link'), chip('files', '+ File'), chip('history', 'History')));
}
