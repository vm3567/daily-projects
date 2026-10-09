// The right column: everything about one project, all editable in place.
// See PLAN.md sections 3, 6-9, 11, 13, 15.

import { h, fmtDay, fmtTime, fmtSize, keyHint, withKey, HAS_KEYBOARD } from './dom.js';
import { dotColour, todayIndia, isOverdue, indiaDate, waitingDays, lastWorkDate } from '../rules.js';
import { WAIT_RED_DAYS } from '../config.js';
import { newId, PRIORITIES, cleanUrl } from '../ops.js';
import { uploadFiles, openFile } from './files.js';

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
      h('button', {
        class: 'icon', title: 'More', 'aria-label': 'More about this step',
        onClick: () => { ui.openStep = open ? null : s.id; ctx.render(); },
      }, open ? '▴' : '⋯')),
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
      h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, l.title),
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
    return [
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
    metaLine(ctx, p, today),
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

    section('What did you do today?',
      h('form', {
        class: 'row',
        onSubmit: (e) => {
          e.preventDefault();
          const input = e.target.elements.note;
          const text = input.value.trim();
          if (!text) return;
          if (store.dispatch('addWorkNote', { projectId: p.id, noteId: newId(), text })) { input.value = ''; ctx.toast('Note saved'); }
        },
      },
      h('input', { name: 'note', placeholder: withKey('A short note, then press Enter', 'W'), key: 'wn-' + p.id, enterkeyhint: 'done', 'data-mention': '1', autocomplete: 'off' })),
      h('ul', { class: 'notes' }, p.workNotes.slice(0, notesShown).map((n) => h('li', { key: 'n-' + n.id },
        h('span', { class: 'muted small' }, `${fmtDay(indiaDate(n.createdAt))} ${fmtTime(n.createdAt)}`),
        autoField('input', { value: n.text, 'aria-label': 'Work note', key: 'nt-' + n.id, 'data-mention': '1' },
          (v) => { if (v.trim()) store.dispatch('editWorkNote', { projectId: p.id, noteId: n.id, text: v }); }),
        h('button', {
          class: 'icon', title: 'Delete note',
          onClick: () => ctx.act('deleteWorkNote', { projectId: p.id, noteId: n.id }, 'Note deleted'),
        }, '🗑')))),
      p.workNotes.length > notesShown
        ? h('button', { class: 'link small', onClick: () => { ui.notesLimit = notesShown + 20; ctx.render(); } }, `Show older notes (${p.workNotes.length - notesShown})`) : null),

    show.notes ? section('Notes', notesBox(ctx, p)) : null,
    show.links ? section('Links', linksBlock(ctx, p)) : null,
    show.files ? section('Files', filesBlock(ctx, p)) : null,
    show.history ? section('History', historyBlock(ctx, p)) : null,
    show.notes && show.links && show.files && show.history ? null : h('div', { class: 'chips', key: 'chips-' + p.id },
      chip('notes', '+ Notes'), chip('links', '+ Link'), chip('files', '+ File'), chip('history', 'History')));
}
