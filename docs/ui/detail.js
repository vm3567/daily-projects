// The right column: everything about one project, all editable in place.
// See PLAN.md sections 3, 6-9, 11, 13, 15.

import { h, fmtDay, fmtTime, fmtSize } from './dom.js';
import { dotColour, todayIndia, isOverdue, indiaDate } from '../rules.js';
import { newId, PRIORITIES, cleanUrl } from '../ops.js';
import { uploadFiles, openFile } from './files.js';

const COLOUR_WORD = { green: 'Done today', orange: 'Not yet today', red: 'Needs you', grey: '' };
const HISTORY_WORDS = {
  created: 'Project created', edited: 'Changed', renamed: 'Renamed', group_changed: 'Moved to group',
  step_added: 'Step added', step_edited: 'Step changed', step_ticked: 'Step done', step_unticked: 'Step un-ticked',
  step_deleted: 'Step deleted', note_added: 'Work note', note_edited: 'Work note changed', note_deleted: 'Work note deleted',
  paused: 'Paused', unpaused: 'Unpaused', finished: 'Finished', reopened: 'Reopened',
  file_added: 'File added', file_removed: 'File removed', deleted: 'Deleted',
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
  if (s.waiting) tags.push(h('span', { class: 'tag waiting' }, s.waitingOn ? `Waiting: ${s.waitingOn}` : 'Waiting'));
  if (s.dueDate && !s.done) tags.push(h('span', { class: 'tag' + (s.dueDate < today ? ' late' : '') }, `by ${fmtDay(s.dueDate)}`));
  if (s.note && !open) tags.push(h('span', { class: 'tag' }, 'note'));
  return h('li', { class: 'step' + (s.done ? ' done' : ''), key: 's-' + s.id, 'data-id': s.id },
    h('div', { class: 'step-main' },
      s.done ? null : h('span', { class: 'grip', title: 'Drag to reorder', 'aria-hidden': 'true' }, '⋮⋮'),
      h('input', {
        type: 'checkbox', checked: s.done, 'aria-label': s.done ? 'Un-tick step' : 'Tick step',
        onChange: () => store.dispatch(s.done ? 'untickStep' : 'tickStep', { projectId: p.id, stepId: s.id }),
      }),
      s.done
        ? h('span', { class: 'step-text' }, s.text, h('span', { class: 'muted small' }, ` · ${fmtDay(s.doneAt ? indiaDate(s.doneAt) : '')}`))
        : autoField('input', { class: 'step-text', value: s.text, 'aria-label': 'Step', key: 'st-' + s.id },
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
      h('label', { class: 'check' },
        h('input', {
          type: 'checkbox', checked: s.waiting,
          onChange: (e, el) => store.dispatch('setStepField', { projectId: p.id, stepId: s.id, field: 'waiting', value: el.checked }),
        }), ' Waiting'),
      s.waiting ? autoField('input', { placeholder: 'Waiting on whom?', value: s.waitingOn, key: 'wo-' + s.id },
        (v) => store.dispatch('setStepField', { projectId: p.id, stepId: s.id, field: 'waitingOn', value: v })) : null,
      autoField('textarea', { placeholder: 'Small note for this step', value: s.note, rows: 2, key: 'sn-' + s.id },
        (v) => store.dispatch('setStepField', { projectId: p.id, stepId: s.id, field: 'note', value: v })),
      h('button', {
        class: 'btn danger small',
        onClick: () => { if (confirm(`Delete the step "${s.text}"?`)) store.dispatch('deleteStep', { projectId: p.id, stepId: s.id }); },
      }, '🗑 Delete step')) : null);
}

function aiPanel(ctx, p) {
  const { ui } = ctx;
  const ai = ui.ai && ui.ai.projectId === p.id ? ui.ai : null;
  const buttons = h('div', { class: 'ai-buttons' },
    h('button', { class: 'btn ai', onClick: () => ctx.aiSuggest(p) }, '✨ Suggest next step'),
    h('button', {
      class: 'btn ai',
      onClick: () => { ui.ai = { projectId: p.id, mode: 'breakdown', state: 'ask', goal: '' }; ctx.render(); },
    }, '✨ Break into steps'));
  if (!ai) return buttons;
  const closeBtn = h('button', { class: 'icon', 'aria-label': 'Close', onClick: () => { ui.ai = null; ctx.render(); } }, '✕');
  let body;
  if (ai.state === 'ask') {
    body = h('form', {
      class: 'row',
      onSubmit: (e) => { e.preventDefault(); const goal = e.target.elements.goal.value.trim(); if (goal) ctx.aiBreakdown(p, goal); },
    },
    h('input', { name: 'goal', placeholder: 'Goal, e.g. "Launch glaze article"', value: ai.goal, key: 'ai-goal', autofocus: true }),
    h('button', { class: 'btn primary', type: 'submit' }, 'Suggest'));
  } else if (ai.state === 'busy') body = h('p', { class: 'muted' }, 'Thinking…');
  else if (ai.state === 'error') body = h('p', { class: 'error' }, ai.error);
  else {
    body = h('div', null,
      h('ul', { class: 'ai-list' }, ai.steps.map((text, i) => h('li', { key: 'ai-' + i },
        h('label', { class: 'check' },
          h('input', {
            type: 'checkbox', checked: ai.picked[i],
            onChange: (e, el) => { ai.picked[i] = el.checked; },
          }), ' ', text)))),
      h('button', {
        class: 'btn primary',
        onClick: () => {
          const chosen = ai.steps.filter((t, i) => ai.picked[i]);
          for (const text of chosen) ctx.store.dispatch('addStep', { projectId: p.id, stepId: newId(), text });
          ui.ai = null;
          ctx.render();
          if (chosen.length) ctx.toast(`Added ${chosen.length} step${chosen.length > 1 ? 's' : ''}`);
        },
      }, 'Add selected'));
  }
  return h('div', { class: 'ai-panel' },
    h('div', { class: 'ai-head' }, h('strong', null, ai.mode === 'breakdown' ? '✨ Break into steps' : '✨ Next step ideas'), closeBtn),
    body,
    buttons);
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

function section(title, ...children) {
  return h('section', { class: 'block' }, h('h3', null, title), ...children);
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
  const stateButtons = [];
  if (p.state === 'active') {
    stateButtons.push(h('button', { class: 'btn', onClick: () => store.dispatch('pause', { projectId: p.id }) }, 'Pause'));
    stateButtons.push(h('button', {
      class: 'btn',
      onClick: () => { if (confirm(`Finish "${p.name}"? It moves to the Finished list.`)) store.dispatch('finish', { projectId: p.id }); },
    }, 'Finish'));
  } else if (p.state === 'paused') {
    stateButtons.push(h('button', { class: 'btn primary', onClick: () => store.dispatch('unpause', { projectId: p.id }) }, 'Unpause'));
    stateButtons.push(h('button', { class: 'btn', onClick: () => store.dispatch('finish', { projectId: p.id }) }, 'Finish'));
  } else {
    stateButtons.push(h('button', { class: 'btn primary', onClick: () => store.dispatch('reopen', { projectId: p.id }) }, 'Reopen'));
    stateButtons.push(h('button', {
      class: 'btn danger',
      onClick: () => {
        if (!confirm(`Delete "${p.name}" for good?`)) return;
        if (!confirm('Are you really sure? Its files are removed. Its Diary lines stay.')) return;
        store.dispatch('deleteProject', { projectId: p.id });
        ui.selected = null; ui.mobile = 'list'; ctx.render();
      },
    }, 'Delete'));
  }

  return h('div', { class: 'detail-inner', key: 'detail-' + p.id },
    h('div', { class: 'detail-top' },
      h('button', { class: 'icon back', 'aria-label': 'Back to list', onClick: () => { ui.mobile = 'list'; ctx.render(); } }, '←'),
      h('span', { class: `dot ${colour}`, title: COLOUR_WORD[colour] }),
      autoField('input', { class: 'title-input', value: p.name, 'aria-label': 'Project name', key: 'name-' + p.id },
        (v) => store.dispatch('setProjectField', { projectId: p.id, field: 'name', value: v })),
      h('div', { class: 'state-buttons' }, stateButtons)),
    p.state !== 'active' ? h('p', { class: 'banner' }, p.state === 'paused' ? 'This project is paused. It is hidden from Today.' : 'This project is finished.') : null,
    h('div', { class: 'fields' },
      h('label', null, 'Group ',
        h('select', {
          value: p.groupId,
          onChange: (e, el) => store.dispatch('setProjectField', { projectId: p.id, field: 'groupId', value: el.value }),
        }, store.view.data.groups.map((g) => h('option', { value: g.id }, g.name)))),
      h('label', null, 'Priority ',
        h('select', {
          value: p.priority,
          onChange: (e, el) => store.dispatch('setProjectField', { projectId: p.id, field: 'priority', value: el.value }),
        }, PRIORITIES.map((x) => h('option', { value: x }, x[0].toUpperCase() + x.slice(1))))),
      h('label', { class: isOverdue(p, today) ? 'late' : '' }, 'Deadline ',
        h('input', {
          type: 'date', value: p.deadline || '',
          onChange: (e, el) => store.dispatch('setProjectField', { projectId: p.id, field: 'deadline', value: el.value || null }),
        }),
        isOverdue(p, today) ? h('span', { class: 'tag late' }, 'Overdue') : null)),

    section('Steps',
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
      h('input', { name: 'text', placeholder: '+ Add step (press Enter)', key: 'add-step-' + p.id }),
      h('button', { class: 'btn small', type: 'submit' }, 'Add')),
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
          if (store.dispatch('addWorkNote', { projectId: p.id, noteId: newId(), text })) input.value = '';
        },
      },
      h('input', { name: 'note', placeholder: 'A short note, then press Enter', key: 'wn-' + p.id, enterkeyhint: 'done' }),
      h('button', { class: 'btn small', type: 'submit' }, 'Save')),
      h('ul', { class: 'notes' }, p.workNotes.slice(0, ui.notesLimit || 10).map((n) => h('li', { key: 'n-' + n.id },
        h('span', { class: 'muted small' }, `${fmtDay(indiaDate(n.createdAt))} ${fmtTime(n.createdAt)}`),
        autoField('input', { value: n.text, 'aria-label': 'Work note', key: 'nt-' + n.id },
          (v) => { if (v.trim()) store.dispatch('editWorkNote', { projectId: p.id, noteId: n.id, text: v }); }),
        h('button', {
          class: 'icon', title: 'Delete note',
          onClick: () => { if (confirm('Delete this note?')) store.dispatch('deleteWorkNote', { projectId: p.id, noteId: n.id }); },
        }, '🗑')))),
      p.workNotes.length > (ui.notesLimit || 10)
        ? h('button', { class: 'btn small', onClick: () => { ui.notesLimit = (ui.notesLimit || 10) + 20; ctx.render(); } }, 'Show more notes') : null),

    section('Notes',
      autoField('textarea', { class: 'notes-box', value: p.notes, rows: 4, placeholder: 'Free notes for this project', key: 'notes-' + p.id },
        (v) => store.dispatch('setProjectField', { projectId: p.id, field: 'notes', value: v }))),
    section('Links', linksBlock(ctx, p)),
    section('Files', filesBlock(ctx, p)),
    section('History', historyBlock(ctx, p)));
}
