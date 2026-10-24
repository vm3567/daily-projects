// People: the list of people (middle column) and one person's page (right column).
// A step is linked to a person when its text or note has "@Name", or "Waiting on" is that person.

import { h, fmtDay, fmtTime } from './dom.js';
import { mentionedPeople, initials, indiaDate, personSteps, personStatus, waitingDays, todayIndia, stepLinkedTo, stepTargets, addDays, givenProjectsOf, nextStep, canGiveStep, givableSteps, teamMemberFor } from '../rules.js';
import { sentMarkOf, mailDate, teamOrder } from '../reports.js';
import { newId, cleanPhone } from '../ops.js';

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

/** A person's Work Task account and pending work (from the app; null when not linked or not on the server). */
const linkOf = (ctx, person) => (ctx.teamLink ? ctx.teamLink(person) : null);
/** "Sent today" mark: the server's for a Work Task person, else this app's own. */
const markOf = (ctx, person) => (ctx.sentMark ? ctx.sentMark(person) : sentMarkOf(person, null, todayIndia()));

/** What a person has on Work Task, for the list row: { projects, tasks } (the server's list, else the projects given here). */
export function teamCounts(data, person, link) {
  if (link && link.member) {
    const items = link.member.items || [];
    return { projects: items.filter((x) => x.kind === 'project').length, tasks: items.filter((x) => x.kind !== 'project').length };
  }
  return { projects: givenProjectsOf(data, person).length, tasks: 0 };
}

function statusWords(st, counts = { projects: 0, tasks: 0 }) {
  const extra = [counts.projects ? `${counts.projects} project${counts.projects === 1 ? '' : 's'}` : '', counts.tasks ? `${counts.tasks} task${counts.tasks === 1 ? '' : 's'}` : ''].filter(Boolean);
  if (!st.open) return extra.length ? extra.join(' · ') : 'Nothing open';
  const bits = [];
  if (st.waiting) bits.push(`Waiting ${st.maxWait ? st.maxWait + ' day' + (st.maxWait > 1 ? 's' : '') : 'since today'}`);
  if (st.discuss) bits.push(`${st.discuss} to discuss`);
  if (st.late) bits.push('date passed');
  return [...bits, ...extra].join(' · ');
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
        const signIn = e.target.elements.signin && e.target.elements.signin.checked;
        const email = e.target.elements.email ? e.target.elements.email.value.trim() : '';
        if (store.dispatch('addPerson', { personId, name })) {
          input.value = ''; ui.addSignIn = false;
          ctx.selectPerson(personId);
          // also a Work Task sign-in (user.save: name, username, first password, staff, email); the password is shown once
          const person = (store.view.data.people || []).find((x) => x.id === personId);
          if (signIn && person && ctx.giveSignIn) ctx.giveSignIn(person, email);
        } else ctx.toast(`"${name}" is already in People`);
      },
    },
    h('input', { name: 'name', placeholder: 'Add a person (name)', key: 'new-person', autocomplete: 'off' }),
    h('button', { class: 'btn primary small', type: 'submit' }, 'Add'),
    ctx.onServer ? h('label', { class: 'small people-signin', key: 'new-person-signin' },
      h('input', { type: 'checkbox', name: 'signin', checked: !!ui.addSignIn, onChange: (e, el) => { ui.addSignIn = el.checked; ctx.render(); } }),
      ' Also give them a Task List sign-in') : null,
    ctx.onServer && ui.addSignIn ? h('input', { name: 'email', type: 'email', key: 'new-person-email', placeholder: 'Email (optional, for the morning email)', autocomplete: 'off' }) : null),
    people.length || teamNotInPeople(ctx).length ? null : h('p', { class: 'empty-list' }, 'No people yet. Add a name above, or type @ and a name in any step.'),
    h('ul', { class: 'plist people-list', key: 'people-list' }, peopleByFollowUp(data).map(({ person, st }) => { const sent = markOf(ctx, person).time; return (
      h('li', { key: 'pp-' + person.id, 'data-id': person.id, class: 'prow' + (ui.person === person.id ? ' current' : ''), onContextmenu: (e) => ctx.openPersonMenu(person.id, e) },
        h('button', { class: 'prow-btn', onClick: () => ctx.selectPerson(person.id) },
          h('span', { class: `dot ${st.colour}`, 'aria-label': st.colour }),
          h('span', { class: 'avatar' }, initials(person.name)),
          h('span', { class: 'prow-text' },
            h('span', { class: 'prow-name' }, person.name, st.open ? h('span', { class: 'count-pill' }, String(st.open)) : null,
              sent ? h('span', { class: 'sent-mark small', title: `Pending list sent today at ${sent}` }, `✓ ${sent}`) : null),
            h('span', { class: 'prow-next' + (st.colour === 'red' ? ' warn' : '') }, statusWords(st, teamCounts(data, person, linkOf(ctx, person))))))));
    })),
    teamJoinBlock(ctx));
}

/** Your team members (a Task List sign-in) who are not in People yet: the list shows them, one tap adds them (owner, 24 Oct). */
export function teamNotInPeople(ctx) {
  const accounts = ctx.onServer && ctx.teamAccounts ? ctx.teamAccounts() : null;
  if (!accounts) return [];
  const people = ctx.store.view.data.people || [];
  return accounts.filter((u) => u && !u.owner && u.active !== false && !people.some((p) => teamMemberFor(p, [u])));
}
function teamJoinBlock(ctx) {
  const list = teamNotInPeople(ctx);
  if (!list.length) return null;
  return h('div', { class: 'team-join', key: 'team-join' },
    h('p', { class: 'muted small' }, 'In your team (they have a Task List sign-in), not in People yet:'),
    h('div', { class: 'row' }, list.map((u) => h('button', {
      class: 'chip', type: 'button', key: 'tj-' + u.id, title: `Add ${u.name} to People`,
      onClick: () => { const personId = newId(); if (ctx.store.dispatch('addPerson', { personId, name: u.name })) { ctx.toast(`${u.name} added to People`); ctx.selectPerson(personId); } },
    }, `+ ${u.name}`))));
}

/** The person's Work Task account, when this person is linked to one: { user, first, person }; else null. */
function giveTo(ctx, person, link) {
  return link && link.user && link.user.id && link.user.active !== false && ctx.giveSteps ? { user: link.user, first: person.name.split(/\s+/)[0], person } : null;
}

const teamTaskOf = (ctx) => (id) => (ctx.teamTask ? ctx.teamTask(id) : null);

function stepItem(ctx, { project, step }, give = null) {
  const { store } = ctx;
  const task = ctx.teamTask ? ctx.teamTask(step.id) : null;
  const onList = !step.done && task && task.status === 'open'; // already a team task: on their list
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
    onList ? h('span', { class: 'tag team-tag', title: `A team task for ${task.assignee ? task.assignee.name : 'the team'}` }, `👥 on ${task.assignee ? task.assignee.name.split(/\s+/)[0] : 'their'}'s list`)
      : give && canGiveStep(give.user, project, step, task)
        ? h('button', { class: 'row-act give', title: `Put this step on ${give.first}'s Task List (daily updates show on the task)`, onClick: () => ctx.giveSteps([{ project, step }], give.user, give.person) }, `→ Give to ${give.first}`)
        : null,
    h('button', { class: 'tag link-tag', title: 'Open task', onClick: () => ctx.openProject(project.id) }, project.name));
}

function list(title, items, ctx, empty, give = null) {
  const can = give ? givableSteps(items, give.user, teamTaskOf(ctx)) : [];
  return h('section', { class: 'block' },
    h('h3', null, `${title} (${items.length})`,
      can.length ? h('button', {
        class: 'btn small give-all', title: `Put these ${can.length} steps on ${give.first}'s Task List`,
        onClick: () => { if (confirm(`Give ${can.length} step${can.length === 1 ? '' : 's'} to ${give.person.name}? They go on ${give.first}'s Task List.`)) ctx.giveSteps(can, give.user, give.person); },
      }, `→ Give all ${can.length}`) : null),
    items.length ? h('ul', { class: 'person-steps' }, items.map((it) => stepItem(ctx, it, give))) : h('p', { class: 'muted small' }, empty));
}

/**
 * "Add a task with Ravi": write it, pick "I do it" (@Ravi) or "Waiting on Ravi", optionally when, then tap a project.
 * It is saved as a step in that project, so it shows on the project and on this page.
 */
function taskBox(ctx, person, give = null) {
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
  const all = stepTargets(data, today); // tasks only: a 📂 project holds tasks, not steps
  const find = t.find.trim().toLowerCase();
  const ordered = [...all.filter(mine), ...all.filter((p) => !mine(p)).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))];
  const list = (find ? ordered.filter((p) => p.name.toLowerCase().includes(find)) : ordered).slice(0, find ? 8 : 5);
  const add = (projectId, projectName) => {
    let text = textNow();
    if (!text) { ctx.toast(`Write the task with ${first} first`); input()?.focus(); return; }
    if (t.mode === 'give' && !give) t.mode = 'me'; // not linked to Work Task (any more)
    if ((t.mode === 'me' || t.mode === 'give') && !text.toLowerCase().includes('@' + person.name.toLowerCase())) text += ` @${person.name}`;
    const stepId = newId();
    if (!store.dispatch('addStep', { projectId, stepId, text })) return;
    if (t.mode === 'wait') {
      store.dispatch('setStepField', { projectId, stepId, field: 'waitingOn', value: person.name });
      store.dispatch('setStepField', { projectId, stepId, field: 'waiting', value: true });
    }
    if (t.when) store.dispatch('remindStep', { projectId, stepId, date: addDays(today, t.when) });
    if (t.mode === 'give') { // on their Work Task list right away
      const p = store.view.data.projects.find((x) => x.id === projectId);
      const st = p && p.steps.find((x) => x.id === stepId);
      if (p && st && canGiveStep(give.user, p, st, null)) ctx.giveSteps([{ project: p, step: st }], give.user, give.person);
      else if (p && p.team) ctx.toast(`${p.name} is given as a whole to ${p.team.name}: the step goes with it.`, 4000);
    }
    ctx.toast(`Added to ${projectName}: ${textNow()}${t.mode === 'wait' ? ` · waiting on ${first}` : ''}${t.when ? ` · comes back ${fmtDay(addDays(today, t.when))}` : ''}`, 3500);
    t.text = ''; t.find = ''; t.when = 0;
    if (input()) input().value = '';
    ctx.render();
    input()?.focus();
  };
  const newProject = () => {
    if (!textNow()) { ctx.toast(`Write the task with ${first} first`); input()?.focus(); return; }
    const name = (prompt('Name of the new task:', '') || '').trim();
    if (!name) return;
    const projectId = newId();
    if (store.dispatch('createProject', { projectId, name })) add(projectId, name);
  };
  const chip = (on, label, onClick, title) => h('button', { class: 'chip' + (on ? ' on' : ''), type: 'button', title, onClick: () => { keep(); onClick(); ctx.render(); } }, label);
  return h('form', {
    class: 'person-task block', key: 'ptask-' + person.id,
    onSubmit: (e) => { e.preventDefault(); if (list[0]) add(list[0].id, list[0].name); },
  },
  h('div', { class: 'person-task-head small' }, `Add a task with ${first}`, h('span', { class: 'muted' }, ' · Enter = add to the first task')),
  h('input', { name: 'task', key: 'person-task-input', value: t.text || '', autocomplete: 'off', placeholder: `e.g. Send the burner quote by Thursday`, 'aria-label': `Task with ${first}`,
    onInput: (e, el) => { t.text = el.value; } }), // kept, so a redraw never wipes what you typed
  h('div', { class: 'person-task-row' },
    chip(t.mode === 'me', 'I do it', () => { t.mode = 'me'; }, `Your task; ${first} is @mentioned`),
    chip(t.mode === 'wait', `Waiting on ${first}`, () => { t.mode = 'wait'; }, `${first} has to do it: shows Waiting with a day count`),
    give ? chip(t.mode === 'give', `${first} does it (their list)`, () => { t.mode = 'give'; }, `Added to the task AND given to ${first} on Task List right away`) : null,
    h('span', { class: 'muted small' }, '· When:'),
    [[0, 'Today'], [1, 'Tomorrow'], [7, '1 week']].map(([d, label]) => chip(t.when === d, label, () => { t.when = d; },
      d ? `Hide it until ${fmtDay(addDays(today, d))}, then it comes back first` : 'From today'))),
  h('div', { class: 'muted small' }, `In task (${first}'s tasks first):`),
  h('div', { class: 'person-task-row' },
    list.map((p, i) => h('button', { class: 'chip' + (i === 0 ? ' first' : ''), type: 'button', key: 'ptp-' + p.id, onClick: () => add(p.id, p.name) }, p.name)),
    h('input', { class: 'person-task-find', key: 'ptask-find', value: t.find, autocomplete: 'off', placeholder: 'Search…', 'aria-label': 'Search tasks',
      onInput: (e, el) => { keep(); t.find = el.value; ctx.render(); } }),
    h('button', { class: 'chip', type: 'button', onClick: newProject }, '+ New task')));
}

/** One Work Task row's grey / red / orange lines (the same look as the email). */
function itemLines(x) {
  return [
    x.kind === 'project' && x.about ? h('div', { class: 'wt-sub' }, x.about) : null,
    x.lateSince ? h('div', { class: 'wt-sub bad' }, `Late since ${mailDate(x.lateSince)}`) : null,
    x.stuck ? h('div', { class: 'wt-sub warn' }, 'Stuck') : null,
    x.now ? h('div', { class: 'wt-sub' }, `Now: ${x.now}`) : null,
    x.repeat ? h('div', { class: 'wt-sub' }, x.repeat) : null,
  ];
}

/**
 * "📁 Projects and tasks from Work Task": the server's list for this person (people.morning) as a table
 * (# | Work | Last update). When it cannot load (or no account): the projects given to them here.
 */
function teamSection(ctx, person, link) {
  const data = ctx.store.view.data;
  const first = person.name.split(/\s+/)[0];
  const today = todayIndia();
  if (link && link.member) {
    const items = teamOrder(link.member.items || []);
    const open = (x) => (x.projectRef && data.projects.some((p) => p.id === x.projectRef) ? () => ctx.openProject(x.projectRef) : null);
    return h('section', { class: 'block wt-block', key: 'wt-' + person.id },
      h('h3', null, `📁 Projects and tasks from the team (${items.length})`),
      items.length ? h('table', { class: 'wt-table' },
        h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'Work'), h('th', null, 'Last update'))),
        h('tbody', null, items.map((x, i) => {
          const go = open(x);
          return h('tr', { key: 'wt-' + (x.taskId || i), class: go ? 'wt-open' : '', onClick: go || undefined, title: go ? 'Open the project' : '' },
            h('td', null, String(i + 1)),
            h('td', null, h('b', null, (x.kind === 'project' ? '📁 ' : '') + (x.title || '')), ...itemLines(x)),
            h('td', { class: 'muted' }, x.lastUpdate && x.lastUpdate.day ? `${mailDate(x.lastUpdate.day)}: ${x.lastUpdate.note || ''}` : '—'));
        }))) : h('p', { class: 'muted small' }, `Nothing pending for ${first} on Task List.`));
  }
  const given = givenProjectsOf(data, person);
  const note = link && link.loading ? 'Loading Task List…' : link && link.failed ? 'Task List could not load — showing the projects given from here.' : '';
  if (!given.length && !note) return null;
  return h('section', { class: 'block wt-block', key: 'wt-' + person.id },
    h('h3', null, `📁 Projects given to ${person.name} (${given.length})`),
    note ? h('p', { class: 'muted small' }, note) : null,
    given.length ? h('ul', { class: 'person-steps' }, given.map((p) => {
      const next = nextStep(p, today);
      const tp = ctx.teamProgress ? ctx.teamProgress(p.id) : null;
      const done = p.steps.filter((x) => x.done).length;
      const bits = [p.steps.length ? `${done} of ${p.steps.length} steps done` : '', tp && tp.stuck ? '⚠️ stuck' : '',
        tp && tp.lastUpdate ? (tp.lastUpdate === today ? 'updated today' : `last update ${mailDate(tp.lastUpdate)}`) : '', p.state === 'paused' ? 'paused' : ''].filter(Boolean);
      return h('li', { key: 'gp-' + p.id, class: 'person-step given-project' },
        h('button', { class: 'link given-open', title: 'Open the project', onClick: () => ctx.openProject(p.id) }, h('b', null, `📁 ${p.name}`)),
        h('div', { class: 'muted small' }, next ? `Now: ${next.text}` : 'No open step', bits.length ? ` · ${bits.join(' · ')}` : ''));
    })) : null);
}

/** "Team account": the person's Work Task sign-in — email, new password, switch off / on, move all tasks. */
function teamAccountBox(ctx, person, link) {
  const { ui } = ctx;
  if (!ctx.onServer) return null;
  const first = person.name.split(/\s+/)[0];
  const u = link && link.user;
  if (!u) {
    return h('div', { class: 'block team-account', key: 'ta-' + person.id },
      h('span', { class: 'muted small' }, `No Task List sign-in for ${first}. `),
      ctx.giveSignIn ? h('button', { class: 'btn small', onClick: () => ctx.giveSignIn(person) }, '🔑 Give a Task List sign-in') : null);
  }
  const others = (ctx.teamAccounts ? ctx.teamAccounts() || [] : []).filter((x) => x.active && x.id !== u.id && !x.owner);
  return h('div', { class: 'block team-account', key: 'ta-' + person.id },
    h('div', { class: 'small' }, h('strong', null, 'Team account'), ` · @${u.username}`, u.active ? '' : ' · switched off',
      h('span', { class: 'muted' }, u.lastLogin ? ` · last signed in ${fmtDay(String(u.lastLogin).slice(0, 10))}` : ' · not signed in yet')),
    h('label', { class: 'small team-email' }, '✉ ', h('input', {
      key: 'ta-email-' + u.id, type: 'email', class: 'wide-input', value: u.email || '', placeholder: 'Email (for the pending list)', 'aria-label': 'Task List email', autocomplete: 'off',
      onChange: (e, el) => { if (el.value.trim() !== (u.email || '')) ctx.setTeamEmail(u, el.value); },
    })),
    h('div', { class: 'row' },
      h('button', { class: 'btn small', onClick: () => ctx.newPasswordFor(person, u) }, '🔑 New password'),
      h('button', { class: 'btn small', onClick: () => ctx.toggleTeamUser(u) }, u.active ? 'Switch off' : 'Switch on'),
      u.active ? h('button', { class: 'btn small', onClick: () => { ui.movingAll = ui.movingAll === u.id ? 0 : u.id; ctx.render(); } }, '↔ Move all tasks to…') : null),
    ui.movingAll === u.id ? h('div', { class: 'row' }, h('span', { class: 'small muted' }, `All of ${first}'s open tasks go to:`),
      others.map((x) => h('button', { class: 'chip', key: 'mv-' + x.id, onClick: () => { ui.movingAll = 0; ctx.moveAllTasks(u, x); } }, x.name)),
      h('button', { class: 'link', onClick: () => { ui.movingAll = 0; ctx.render(); } }, 'Cancel')) : null);
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
  const link = linkOf(ctx, person);
  const sent = markOf(ctx, person).time;
  const linked = !!(link && link.user);

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
        h('button', { class: 'btn primary small', title: 'Copy or send everything pending with this person', onClick: () => ctx.openPersonMessage(person) }, sent ? '📋 Send again' : '📋 Send pending list'),
        sent ? h('span', { class: 'sent-tag small', title: 'Pending list sent today' }, `✓ Sent today ${sent}`) : null,
        ctx.canGoBack() ? h('button', { class: 'btn small', title: 'Back (Backspace)', onClick: () => ctx.goBack() }, '← Back') : null,
        (() => { const pv = ctx.neighbourPerson(-1); return h('button', { class: 'btn small', disabled: pv ? undefined : true, title: pv ? `Previous: ${pv.name} (←)` : '', onClick: () => pv && ctx.selectPerson(pv.id) }, '‹'); })(),
        (() => { const nx = ctx.neighbourPerson(1); return h('button', { class: 'btn small', disabled: nx ? undefined : true, title: nx ? `Next person with open work: ${nx.name} (→)` : 'No more people with open work', onClick: () => nx && ctx.selectPerson(nx.id) }, nx ? `${nx.name.split(' ')[0]} ›` : '›'); })(),
        h('button', { // (kept apart from "Send pending list", so it is not hit by mistake: owner, 24 Oct)
          class: 'btn small danger person-remove', title: `Remove ${person.name} from People`,
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
          if (cleanPhone(el.value) === (person.phone || '')) { el.value = person.phone ? '+' + person.phone : ''; return; } // the same number, written another way: nothing to change
          if (!store.dispatch('setPersonContact', { personId: person.id, phone: el.value })) { ctx.toast('That does not look like a phone number'); el.value = person.phone ? '+' + person.phone : ''; }
          else ctx.toast(el.value.trim() ? `Saved — WhatsApp now goes straight to ${first}` : 'Number removed', 2000);
        },
      })),
      linked ? null : h('label', null, '✉ ', h('input', {
        key: 'pemail-' + person.id, type: 'email', value: person.email || '', placeholder: 'Email', 'aria-label': 'Email', autocomplete: 'off',
        onChange: (e, el) => {
          if (el.value.trim() === (person.email || '')) return;
          if (!store.dispatch('setPersonContact', { personId: person.id, email: el.value })) { ctx.toast('That does not look like an email address'); el.value = person.email || ''; }
          else ctx.toast(el.value.trim() ? `Saved — Outlook now writes to ${first}` : 'Email removed', 2000);
        },
      }))),
    teamAccountBox(ctx, person, link),
    h('p', { class: 'meta-line static linked-note' }, 'Linked by @name in steps, or by "Waiting on".'),
    teamSection(ctx, person, link),
    taskBox(ctx, person, giveTo(ctx, person, link)),
    list(`Waiting on ${first}`, waiting, ctx, `Nothing waiting on ${first}. Tick "Waiting" on a step and pick ${first}.`, giveTo(ctx, person, link)),
    list(`To discuss with ${first}`, discuss, ctx, `Nothing to discuss. Type @${first} in any step.`, giveTo(ctx, person, link)),
    notes.length ? h('section', { class: 'block' }, h('h3', null, `Notes about ${first}`),
      h('ul', { class: 'history' }, notes.slice(0, 8).map(({ project, note }) => h('li', { key: 'pn-' + note.id },
        h('span', { class: 'muted small' }, `${fmtDay(indiaDate(note.createdAt))} ${fmtTime(note.createdAt)}`), ' ',
        h('button', { class: 'link', onClick: () => ctx.openProject(project.id) }, project.name), `: ${note.text}`)))) : null,
    done.length ? h('section', { class: 'block' }, h('h3', null, 'Done recently'),
      h('ul', { class: 'person-steps' }, done.slice(0, 8).map((it) => stepItem(ctx, it)))) : null);
}
