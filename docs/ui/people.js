// People: the list of people (middle column) and one person's page (right column).
// A step is linked to a person when its text or note has "@Name", or "Waiting on" is that person.

import { h, fmtDay, fmtTime } from './dom.js';
import { mentionedPeople, initials, indiaDate, personSteps, personStatus, waitingDays, todayIndia } from '../rules.js';
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
    h('p', { class: 'meta-line static' }, 'Linked by @name in steps, or by "Waiting on".'),
    list(`Waiting on ${first}`, waiting, ctx, `Nothing waiting on ${first}. Tick "Waiting" on a step and pick ${first}.`),
    list(`To discuss with ${first}`, discuss, ctx, `Nothing to discuss. Type @${first} in any step.`),
    notes.length ? h('section', { class: 'block' }, h('h3', null, `Notes about ${first}`),
      h('ul', { class: 'history' }, notes.slice(0, 8).map(({ project, note }) => h('li', { key: 'pn-' + note.id },
        h('span', { class: 'muted small' }, `${fmtDay(indiaDate(note.createdAt))} ${fmtTime(note.createdAt)}`), ' ',
        h('button', { class: 'link', onClick: () => ctx.openProject(project.id) }, project.name), `: ${note.text}`)))) : null,
    done.length ? h('section', { class: 'block' }, h('h3', null, 'Done recently'),
      h('ul', { class: 'person-steps' }, done.slice(0, 8).map((it) => stepItem(ctx, it)))) : null);
}
