// People: the list of people (middle column) and one person's page (right column).
// A step is linked to a person when its text or note has "@Name", or "Waiting on" is that person.

import { h, fmtDay, fmtTime } from './dom.js';
import { mentionedPeople, initials, indiaDate, personSteps, personStatus, waitingDays, todayIndia, stepLinkedTo, awakeProjects, addDays } from '../rules.js';
import { newId } from '../ops.js';

export function openCount(data, person) {
  const { waiting, discuss } = personSteps(data, person);
  return waiting.length + discuss.length;
}

const ORDER = { red: 0, orange: 1, green: 2 };

/** People sorted for following up: red first, then orange, then green; by name inside. */
export function peopleByFollowUp(data, today = todayIndia()) {
  return (data.people || [])
    .map((person) => ({ person, st: personStatus(data, person, today) }))
    .sort((a, b) => ORDER[a.st.colour] - ORDER[b.st.colour] || a.person.name.localeCompare(b.person.name));
}

function statusWords(st) {
  if (!st.open) return 'Nothing open';
  const bits = [];
  if (st.waiting) bits.push(`Waiting ${st.maxWait ? st.maxWait + ' day' + (st.maxWait > 1 ? 's' : '') : 'since today'}`);
  if (st.discuss) bits.push(`${st.discuss} to discuss`);
  if (st.late) bits.push('date passed');
  return bits.join(' · ');
}

export function renderPeopleList(ctx) {
  const { store, ui } = ctx;
  const data = store.view.data;
  const people = data.people || [];
  return h('div', { class: 'people' },
    h('form', {
      class: 'row people-add',
      onSubmit: (e) => {
        e.preventDefault();
        const input = e.target.elements.name;
        const name = input.value.replace(/^@+/, '').trim();
        if (!name) return;
        const personId = newId();
        if (store.dispatch('addPerson', { personId, name })) { input.value = ''; ctx.selectPerson(personId); }
        else ctx.toast(`"${name}" is already in People`);
      },
    },
    h('input', { name: 'name', placeholder: 'Add a person (name)', key: 'new-person', autocomplete: 'off' }),
    h('button', { class: 'btn primary small', type: 'submit' }, 'Add')),
    people.length ? null : h('p', { class: 'empty-list' }, 'No people yet. Add a name above, or type @ and a name in any step.'),
    h('ul', { class: 'plist people-list', key: 'people-list' }, peopleByFollowUp(data).map(({ person, st }) => (
      h('li', { key: 'pp-' + person.id, 'data-id': person.id, class: 'prow' + (ui.person === person.id ? ' current' : '') },
        h('button', { class: 'prow-btn', onClick: () => ctx.selectPerson(person.id) },
          h('span', { class: `dot ${st.colour}`, 'aria-label': st.colour }),
          h('span', { class: 'avatar' }, initials(person.name)),
          h('span', { class: 'prow-text' },
            h('span', { class: 'prow-name' }, person.name, st.open ? h('span', { class: 'count-pill' }, String(st.open)) : null),
            h('span', { class: 'prow-next' + (st.colour === 'red' ? ' warn' : '') }, statusWords(st)))))))));
}

function stepItem(ctx, { project, step }) {
  const { store } = ctx;
  return h('li', { key: 'ps-' + step.id, class: 'person-step' + (step.done ? ' done' : '') },
    h('input', {
      type: 'checkbox', checked: step.done, 'aria-label': step.done ? 'Un-tick step' : 'Tick step',
      onChange: () => store.dispatch(step.done ? 'untickStep' : 'tickStep', { projectId: project.id, stepId: step.id }),
    }),
    h('span', { class: 'person-step-text' }, step.text,
      step.waiting && !step.done ? h('span', { class: 'muted small' }, ` · waiting ${waitingDays(step)}d`) : null,
      step.dueDate && !step.done ? h('span', { class: 'muted small' }, ` · by ${fmtDay(step.dueDate)}`) : null,
      step.done && step.doneAt ? h('span', { class: 'muted small' }, ` · ${fmtDay(indiaDate(step.doneAt))}`) : null),
    step.waiting && !step.done ? h('button', { class: 'row-act draft', title: 'AI writes a short follow-up message', onClick: () => ctx.draftFollowUp(project, step) }, '✍ Draft') : null,
    h('button', { class: 'tag link-tag', title: 'Open project', onClick: () => ctx.openProject(project.id) }, project.name));
}

function list(title, items, ctx, empty) {
  return h('section', { class: 'block' },
    h('h3', null, `${title} (${items.length})`),
    items.length ? h('ul', { class: 'person-steps' }, items.map((it) => stepItem(ctx, it))) : h('p', { class: 'muted small' }, empty));
}

/**
 * "Add a task with Ravi": write it, pick "I do it" (@Ravi) or "Waiting on Ravi", optionally when, then tap a project.
 * It is saved as a step in that project, so it shows on the project and on this page.
 */
function taskBox(ctx, person) {
  const { store, ui } = ctx;
  const data = store.view.data;
  const people = data.people || [];
  if (!ui.personTask || ui.personTask.personId !== person.id) ui.personTask = { personId: person.id, mode: 'me', when: 0, find: '' };
  const t = ui.personTask;
  const first = person.name.split(/\s+/)[0];
  const today = todayIndia();
  const input = () => document.querySelector('.person-task [name=task]');
  const textNow = () => (input()?.value || '').replace(/\s+/g, ' ').trim();
  const keep = () => { t.text = input()?.value || t.text || ''; };
  const mine = (p) => p.steps.some((st) => stepLinkedTo(st, person, people));
  const all = awakeProjects(data, today);
  const find = t.find.trim().toLowerCase();
  const ordered = [...all.filter(mine), ...all.filter((p) => !mine(p)).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))];
  const list = (find ? ordered.filter((p) => p.name.toLowerCase().includes(find)) : ordered).slice(0, find ? 8 : 5);
  const add = (projectId, projectName) => {
    let text = textNow();
    if (!text) { ctx.toast(`Write the task with ${first} first`); input()?.focus(); return; }
    if (t.mode === 'me' && !text.toLowerCase().includes('@' + person.name.toLowerCase())) text += ` @${person.name}`;
    const stepId = newId();
    if (!store.dispatch('addStep', { projectId, stepId, text })) return;
    if (t.mode === 'wait') {
      store.dispatch('setStepField', { projectId, stepId, field: 'waitingOn', value: person.name });
      store.dispatch('setStepField', { projectId, stepId, field: 'waiting', value: true });
    }
    if (t.when) store.dispatch('remindStep', { projectId, stepId, date: addDays(today, t.when) });
    ctx.toast(`Added to ${projectName}: ${textNow()}${t.mode === 'wait' ? ` · waiting on ${first}` : ''}${t.when ? ` · comes back ${fmtDay(addDays(today, t.when))}` : ''}`, 3500);
    t.text = ''; t.find = ''; t.when = 0;
    if (input()) input().value = '';
    ctx.render();
    input()?.focus();
  };
  const newProject = () => {
    if (!textNow()) { ctx.toast(`Write the task with ${first} first`); input()?.focus(); return; }
    const name = (prompt('Name of the new project:', '') || '').trim();
    if (!name) return;
    const projectId = newId();
    if (store.dispatch('createProject', { projectId, name, groupId: data.groups[0] && data.groups[0].id })) add(projectId, name);
  };
  const chip = (on, label, onClick, title) => h('button', { class: 'chip' + (on ? ' on' : ''), type: 'button', title, onClick: () => { keep(); onClick(); ctx.render(); } }, label);
  return h('form', {
    class: 'person-task block', key: 'ptask-' + person.id,
    onSubmit: (e) => { e.preventDefault(); if (list[0]) add(list[0].id, list[0].name); },
  },
  h('div', { class: 'person-task-head small' }, `Add a task with ${first}`, h('span', { class: 'muted' }, ' · Enter = add to the first project')),
  h('input', { name: 'task', key: 'person-task-input', value: t.text || '', autocomplete: 'off', placeholder: `e.g. Send the burner quote by Thursday`, 'aria-label': `Task with ${first}`,
    onInput: (e, el) => { t.text = el.value; } }), // kept, so a redraw never wipes what you typed
  h('div', { class: 'person-task-row' },
    chip(t.mode === 'me', 'I do it', () => { t.mode = 'me'; }, `Your task; ${first} is @mentioned`),
    chip(t.mode === 'wait', `Waiting on ${first}`, () => { t.mode = 'wait'; }, `${first} has to do it: shows Waiting with a day count`),
    h('span', { class: 'muted small' }, '· When:'),
    [[0, 'Today'], [1, 'Tomorrow'], [7, '1 week']].map(([d, label]) => chip(t.when === d, label, () => { t.when = d; },
      d ? `Hide it until ${fmtDay(addDays(today, d))}, then it comes back first` : 'From today'))),
  h('div', { class: 'muted small' }, `In project (${first}'s projects first):`),
  h('div', { class: 'person-task-row' },
    list.map((p, i) => h('button', { class: 'chip' + (i === 0 ? ' first' : ''), type: 'button', key: 'ptp-' + p.id, onClick: () => add(p.id, p.name) }, p.name)),
    h('input', { class: 'person-task-find', key: 'ptask-find', value: t.find, autocomplete: 'off', placeholder: 'Search…', 'aria-label': 'Search projects',
      onInput: (e, el) => { keep(); t.find = el.value; ctx.render(); } }),
    h('button', { class: 'chip', type: 'button', onClick: newProject }, '+ New project')));
}

export function renderPerson(ctx) {
  const { store, ui } = ctx;
  const data = store.view.data;
  const people = data.people || [];
  const person = people.find((x) => x.id === ui.person);
  if (!person) {
    return h('div', { class: 'empty' }, h('p', null, 'Pick a person on the left.'),
      h('p', null, 'Tip: type @ and a name in any step to link it to a person.'));
  }
  const { waiting, discuss, done } = personSteps(data, person);
  const notes = [];
  for (const p of data.projects) {
    for (const n of p.workNotes) if (mentionedPeople(n.text, people).has(person.id)) notes.push({ project: p, note: n });
  }
  notes.sort((a, b) => (a.note.createdAt < b.note.createdAt ? 1 : -1));
  const first = person.name.split(/\s+/)[0];

  return h('div', { class: 'detail-inner', key: 'person-' + person.id },
    h('div', { class: 'detail-top' },
      h('button', { class: 'icon back', 'aria-label': 'Back to list', onClick: () => { ui.mobile = 'list'; ctx.render(); } }, '←'),
      h('span', { class: `dot ${personStatus(data, person).colour}` }),
      h('span', { class: 'avatar big' }, initials(person.name)),
      h('input', {
        class: 'title-input', value: person.name, 'aria-label': 'Name', key: 'person-name-' + person.id,
        // Saved only when leaving the box: a rename rewrites every @name, so half-typed names must not be saved.
        onChange: (e, el) => {
          if (!el.value.trim()) { el.value = person.name; return; }
          if (!store.dispatch('renamePerson', { personId: person.id, name: el.value })) el.value = person.name;
        },
        onKeydown: (e, el) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } },
      }),
      h('div', { class: 'state-buttons' },
        h('button', { class: 'btn primary small', title: 'Copy or send everything pending with this person', onClick: () => ctx.openPersonMessage(person) }, '📋 Send pending list'),
        ctx.canGoBack() ? h('button', { class: 'btn small', title: 'Back (Backspace)', onClick: () => ctx.goBack() }, '← Back') : null,
        (() => { const pv = ctx.neighbourPerson(-1); return h('button', { class: 'btn small', disabled: pv ? undefined : true, title: pv ? `Previous: ${pv.name} (←)` : '', onClick: () => pv && ctx.selectPerson(pv.id) }, '‹'); })(),
        (() => { const nx = ctx.neighbourPerson(1); return h('button', { class: 'btn small', disabled: nx ? undefined : true, title: nx ? `Next person with open work: ${nx.name} (→)` : 'No more people with open work', onClick: () => nx && ctx.selectPerson(nx.id) }, nx ? `${nx.name.split(' ')[0]} ›` : '›'); })(),
        h('button', {
          class: 'btn danger',
          onClick: () => {
            if (!confirm(`Remove ${person.name} from People?\n\nSteps keep the text "@${person.name}", but are no longer linked.`)) return;
            store.dispatch('deletePerson', { personId: person.id });
            ui.person = null; ui.mobile = 'list'; ctx.render();
          },
        }, 'Remove'))),
    h('div', { class: 'person-contact' },
      h('label', null, '📞 ', h('input', {
        key: 'pphone-' + person.id, type: 'tel', value: person.phone ? '+' + person.phone : '', placeholder: 'WhatsApp number', 'aria-label': 'WhatsApp number', autocomplete: 'off',
        onChange: (e, el) => {
          if (el.value.trim() === (person.phone ? '+' + person.phone : '')) return;
          if (!store.dispatch('setPersonContact', { personId: person.id, phone: el.value })) { ctx.toast('That does not look like a phone number'); el.value = person.phone ? '+' + person.phone : ''; }
          else ctx.toast(el.value.trim() ? `Saved — WhatsApp now goes straight to ${first}` : 'Number removed', 2000);
        },
      })),
      h('label', null, '✉ ', h('input', {
        key: 'pemail-' + person.id, type: 'email', value: person.email || '', placeholder: 'Email', 'aria-label': 'Email', autocomplete: 'off',
        onChange: (e, el) => {
          if (el.value.trim() === (person.email || '')) return;
          if (!store.dispatch('setPersonContact', { personId: person.id, email: el.value })) { ctx.toast('That does not look like an email address'); el.value = person.email || ''; }
          else ctx.toast(el.value.trim() ? `Saved — Outlook now writes to ${first}` : 'Email removed', 2000);
        },
      }))),
    h('p', { class: 'meta-line static' }, 'Linked by @name in steps, or by "Waiting on".'),
    taskBox(ctx, person),
    list(`Waiting on ${first}`, waiting, ctx, `Nothing waiting on ${first}. Tick "Waiting" on a step and pick ${first}.`),
    list(`To discuss with ${first}`, discuss, ctx, `Nothing to discuss. Type @${first} in any step.`),
    notes.length ? h('section', { class: 'block' }, h('h3', null, `Notes about ${first}`),
      h('ul', { class: 'history' }, notes.slice(0, 8).map(({ project, note }) => h('li', { key: 'pn-' + note.id },
        h('span', { class: 'muted small' }, `${fmtDay(indiaDate(note.createdAt))} ${fmtTime(note.createdAt)}`), ' ',
        h('button', { class: 'link', onClick: () => ctx.openProject(project.id) }, project.name), `: ${note.text}`)))) : null,
    done.length ? h('section', { class: 'block' }, h('h3', null, 'Done recently'),
      h('ul', { class: 'person-steps' }, done.slice(0, 8).map((it) => stepItem(ctx, it)))) : null);
}
