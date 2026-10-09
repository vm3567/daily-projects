// Daily Projects — main app: start-up, menu, project list, Today box, Diary, Settings, key screen.

import { h, morph, installEvents, fmtDay, fmtLongDay, fmtTime } from './ui/dom.js';
import { renderDetail } from './ui/detail.js';
import { renderPeopleList, renderPerson, peopleByFollowUp } from './ui/people.js';
import { installMentions } from './ui/mention.js';
import { closeViewer } from './ui/files.js';
import { Store } from './store.js';
import { GitHubRepo } from './github.js';
import { MockRepo } from './mockrepo.js';
import { device } from './device.js';
import { DATA_OWNER, DATA_REPO, DATA_BRANCH, REFRESH_MS, AI_DAILY_LIMIT, BRIEF_CLAIM_MINUTES, WAIT_RED_DAYS } from './config.js';
import { dotColour, nextStep, todayIndia, isSundayIndia, colourCounts, isOverdue, indiaDate, waitingDays } from './rules.js';
import { newId } from './ops.js';
import * as ai from './ai.js';

const root = document.getElementById('app');
const isMock = new URLSearchParams(location.search).has('mock')
  && ['localhost', '127.0.0.1'].includes(location.hostname);

const saved = device.ui();
const ui = {
  view: saved.view || 'today', // today | all | group:<id> | paused | finished | diary | settings
  selected: saved.selected || null,
  search: '',
  mobile: 'list', // list | detail (phone only)
  menuOpen: false,
  briefFolded: !!saved.briefFolded,
  sort: saved.sort === 'red' ? 'red' : 'mine', // 'mine' = my drag order, 'red' = red first
  adding: false,
  openStep: null,
  showDone: false,
  ai: null,
  brief: { busy: false, error: '' },
  diaryDays: 14,
};

let store = null;
let toastTimer = null;

function toast(text, ms = 3500) {
  const t = document.getElementById('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

function rememberUi() {
  device.setUi({ view: ui.view, selected: ui.selected, briefFolded: ui.briefFolded, sort: ui.sort });
}

const ctx = {
  get store() { return store; },
  ui,
  toast,
  render: () => render(),
  aiSuggest: (p) => runAi(p, 'next'),
  aiBreakdown: (p, goal) => runAi(p, 'breakdown', goal),
  hasAiKey: () => !!(store && aiReady().key),
  selectPerson: (id) => { ui.person = id; ui.mobile = 'detail'; render(); const d = document.getElementById('detail'); if (d) d.scrollTop = 0; },
  openProject: (id) => {
    const p = store.view.data.projects.find((x) => x.id === id);
    if (!p) return;
    ui.view = p.state === 'active' ? 'all' : p.state; // 'paused' or 'finished'
    ui.search = '';
    rememberUi();
    select(id);
  },
};

// ---------------------------------------------------------------- AI

function aiReady() {
  const provider = store.view.data.settings.aiProvider || 'claude';
  return { provider, key: device.aiKey(provider) };
}

/** Count one AI use. Returns false if the daily limit is reached. */
function useAi() {
  const u = store.view.data.aiUsage;
  if (u.date === todayIndia() && u.count >= AI_DAILY_LIMIT) return false;
  return !!store.dispatch('incrementAiUsage', {});
}

async function runAi(p, mode, goal = '') {
  const { provider, key } = aiReady();
  if (!key) { ui.ai = { projectId: p.id, mode, state: 'error', error: 'Add an AI key in Settings.' }; render(); return; }
  if (!useAi()) { ui.ai = { projectId: p.id, mode, state: 'error', error: 'Daily AI limit reached — try tomorrow.' }; render(); return; }
  ui.ai = { projectId: p.id, mode, state: 'busy', goal };
  render();
  try {
    const steps = mode === 'breakdown'
      ? await ai.breakIntoSteps(provider, key, p, goal)
      : await ai.suggestNextSteps(provider, key, p);
    ui.ai = { projectId: p.id, mode, state: 'list', steps, picked: steps.map(() => mode === 'breakdown'), goal };
  } catch (e) {
    ui.ai = { projectId: p.id, mode, state: 'error', error: e.message };
  }
  render();
}

function claimIsFresh(b) {
  return b.status === 'pending' && (Date.now() - Date.parse(b.claimedAt)) / 60000 < BRIEF_CLAIM_MINUTES;
}

function briefKind() {
  return isSundayIndia() ? 'weekly' : 'morning';
}

/** Make today's Morning plan (or Sunday's Weekly review) if no device has made it yet. */
async function makeBrief(force = false) {
  if (!store || !store.base || ui.brief.busy) return;
  if (!force && ui.brief.error) return; // after a failure, only retry when ↻ is tapped (saves AI uses)
  const kind = briefKind();
  const today = todayIndia();
  const b = store.view.data.aiBriefs[kind];
  if (!force && b && b.date === today && (b.status === 'ready' || claimIsFresh(b))) return;
  const { provider, key } = aiReady();
  if (!key) return;
  if (!store.view.data.projects.some((p) => p.state === 'active')) return;
  if (store.view.data.aiUsage.date === today && store.view.data.aiUsage.count >= AI_DAILY_LIMIT) {
    if (force) toast('Daily AI limit reached — try tomorrow.');
    return;
  }
  ui.brief = { busy: true, error: '' };
  render();
  try {
    const claim = store.dispatch('claimBrief', { kind, date: today, force });
    if (!claim) return;
    await store.flush();
    const now = store.view.data.aiBriefs[kind];
    if (!now || now.claimId !== claim.id) return; // another device is making it
    if (!useAi()) return;
    if (kind === 'weekly') await store.loadAllHistory();
    const content = kind === 'weekly'
      ? await ai.weeklyReview(provider, key, store.view.data, store.view.history)
      : await ai.morningPlan(provider, key, store.view.data);
    store.dispatch('setBriefReady', { kind, date: today, content });
  } catch (e) {
    ui.brief.error = e.message;
  } finally {
    ui.brief.busy = false;
    render();
  }
}

// ---------------------------------------------------------------- lists

function groupName(id) {
  const g = store.view.data.groups.find((x) => x.id === id);
  return g ? g.name : '';
}

function matches(p, q) {
  const hay = [p.name, p.notes, ...p.steps.map((s) => `${s.text} ${s.note} ${s.waitingOn}`), ...p.workNotes.map((n) => n.text)]
    .join('\n').toLowerCase();
  return hay.includes(q);
}

function visibleProjects() {
  const all = store.view.data.projects;
  const q = ui.search.trim().toLowerCase();
  if (q) return all.filter((p) => matches(p, q));
  if (ui.view === 'today' || ui.view === 'all') return all.filter((p) => p.state === 'active');
  if (ui.view === 'paused') return all.filter((p) => p.state === 'paused');
  if (ui.view === 'finished') return all.filter((p) => p.state === 'finished');
  if (ui.view.startsWith('group:')) {
    const id = ui.view.slice(6);
    return all.filter((p) => p.groupId === id && p.state === 'active');
  }
  return [];
}

function viewTitle() {
  if (ui.search.trim()) return `Search: "${ui.search.trim()}"`;
  if (ui.view.startsWith('group:')) return groupName(ui.view.slice(6));
  return { today: 'Today', all: 'All projects', paused: 'Paused', finished: 'Finished', diary: 'Diary', settings: 'Settings', people: 'People' }[ui.view];
}

function go(view) {
  ui.view = view;
  ui.search = '';
  ui.menuOpen = false;
  ui.mobile = 'list';
  rememberUi();
  render();
}

function select(id) {
  if (ui.selected !== id) {
    ui.selected = id;
    ui.openStep = null;
    ui.showDone = false;
    ui.historyLimit = 30;
    ui.notesLimit = 3;
    ui.openParts = {};
    ui.editMeta = false;
    if (ui.ai && ui.ai.projectId !== id) ui.ai = null;
  }
  ui.mobile = 'detail';
  rememberUi();
  render();
  document.getElementById('detail').scrollTop = 0;
}

// ---------------------------------------------------------------- menu

function renderMenu() {
  const { data } = store.view;
  const active = data.projects.filter((p) => p.state === 'active');
  const count = (f) => data.projects.filter(f).length;
  const item = (view, label, n, extra) => h('li', { key: 'm-' + view },
    h('button', { class: 'menu-item' + (ui.view === view && !ui.search ? ' current' : ''), onClick: () => go(view) },
      h('span', null, label), n !== undefined ? h('span', { class: 'count' }, String(n)) : null),
    extra || null);
  const today = todayIndia();
  const counts = colourCounts(data, today);

  return h('nav', { class: 'menu-inner' },
    h('div', { class: 'brand' }, h('img', { src: 'icons/icon-192.png', alt: '', width: 28, height: 28 }), h('span', null, 'Daily Projects')),
    h('input', {
      class: 'search', type: 'search', placeholder: 'Search…', value: ui.search, key: 'search-desktop', 'aria-label': 'Search',
      onInput: (e, el) => { ui.search = el.value; render(); },
    }),
    h('ul', { class: 'menu-list' },
      item('today', 'Today', active.length),
      h('li', { class: 'menu-dots', key: 'dots' },
        h('span', { class: 'dot red' }), String(counts.red), ' ',
        h('span', { class: 'dot orange' }), String(counts.orange), ' ',
        h('span', { class: 'dot green' }), String(counts.green)),
      item('all', 'All projects', active.length),
      h('li', { class: 'menu-head', key: 'groups-head' }, 'Groups'),
      data.groups.map((g) => item('group:' + g.id, g.name, count((p) => p.groupId === g.id && p.state === 'active'),
        h('button', {
          class: 'icon tiny', title: `Rename or delete "${g.name}"`,
          onClick: () => editGroup(g),
        }, '✎'))),
      h('li', { key: 'add-group' }, h('button', { class: 'menu-item add', onClick: addGroup }, '+ Group')),
      h('li', { class: 'menu-sep', key: 'sep' }),
      item('paused', 'Paused', count((p) => p.state === 'paused')),
      item('finished', 'Finished', count((p) => p.state === 'finished')),
      item('people', 'People', (data.people || []).length),
      item('diary', 'Diary'),
      item('settings', 'Settings')),
    h('button', { class: 'keys-hint', onClick: () => { ui.showKeys = true; ui.menuOpen = false; render(); } }, 'Keyboard shortcuts: press ?'));
}

function addGroup() {
  const name = prompt('Name of the new group:');
  if (name && name.trim()) store.dispatch('addGroup', { groupId: newId(), name: name.trim() });
}

function editGroup(g) {
  const used = store.view.data.projects.some((p) => p.groupId === g.id);
  const name = prompt(`Rename the group "${g.name}".${used ? '' : '\n\nTo delete this empty group, type DELETE.'}`, g.name);
  if (name === null) return;
  if (!used && name.trim() === 'DELETE') {
    if (store.view.data.groups.length <= 1) { toast('You need at least one group.'); return; }
    store.dispatch('deleteGroup', { groupId: g.id });
    if (ui.view === 'group:' + g.id) go('today');
    return;
  }
  if (name.trim() === 'DELETE') { toast('Only an empty group can be deleted. Move its projects first.'); return; }
  store.dispatch('renameGroup', { groupId: g.id, name: name.trim() });
}

// ---------------------------------------------------------------- Today box

function renderBrief() {
  const kind = briefKind();
  const today = todayIndia();
  const b = store.view.data.aiBriefs[kind];
  const title = kind === 'weekly' ? 'Weekly review' : 'Morning plan';
  const ready = b && b.date === today && b.status === 'ready' && b.content;
  const { key } = aiReady();
  if (!key && !ready) return null; // no AI on this device yet: don't take space
  let body;
  if (ui.brief.error && !ui.brief.busy) body = h('p', { class: 'error' }, `${ui.brief.error} Tap ↻ to try again.`);
  else if (ui.brief.busy || (b && b.date === today && claimIsFresh(b))) body = h('p', { class: 'muted' }, 'Making today\'s plan…');
  else if (!ready) {
    body = h('p', { class: 'muted' }, key
      ? 'No plan yet. Tap ↻ to make one.'
      : 'No plan yet — open on a device with an AI key, or add a key in Settings.');
  } else if (kind === 'weekly') {
    const part = (label, list) => (list.length ? h('div', null, h('strong', null, label), h('ul', null, list.map((t) => h('li', null, t)))) : null);
    body = h('div', null, part('What moved', b.content.moved || []), part('What is stuck', b.content.stuck || []), part('What to fix', b.content.fix || []));
  } else {
    const items = b.content.items || [];
    body = items.length
      ? h('ol', null, items.map((it) => h('li', null,
        it.projectId && store.view.data.projects.some((p) => p.id === it.projectId)
          ? h('button', { class: 'link', onClick: () => select(it.projectId) }, it.text)
          : it.text)))
      : h('p', { class: 'muted' }, 'Nothing planned.');
  }
  return h('div', { class: 'brief', key: 'brief' },
    h('div', { class: 'brief-head' },
      h('button', {
        class: 'link brief-toggle', 'aria-expanded': String(!ui.briefFolded),
        onClick: () => { ui.briefFolded = !ui.briefFolded; rememberUi(); render(); },
      }, `${ui.briefFolded ? '▸' : '▾'} ✨ ${title}`),
      key ? h('button', { class: 'icon', title: 'Make again (1 AI use)', onClick: () => makeBrief(true) }, '↻') : null),
    ui.briefFolded ? null : body);
}

// ---------------------------------------------------------------- project list

function projectRow(p, today) {
  const colour = dotColour(p, today);
  const ns = nextStep(p);
  const canTick = ns && p.state === 'active';
  return h('li', { key: 'p-' + p.id, 'data-id': p.id, class: 'prow' + (ui.selected === p.id ? ' current' : '') },
    canTick
      ? h('input', {
        type: 'checkbox', class: 'quick-tick', key: 'qt-' + p.id + '-' + ns.id,
        title: `Tick: ${ns.text}`, 'aria-label': `Tick next step of ${p.name}: ${ns.text}`,
        onChange: (e, el) => quickTick(p, ns, el),
      })
      : h('span', { class: 'quick-tick-space', 'aria-hidden': 'true' }),
    h('button', { class: 'prow-btn', onClick: () => select(p.id) },
      h('span', { class: `dot ${colour}`, 'aria-label': colour }),
      h('span', { class: 'prow-text' },
        h('span', { class: 'prow-name' }, p.name,
          p.state !== 'active' ? h('span', { class: 'tag' }, p.state) : null,
          p.priority === 'high' ? h('span', { class: 'tag high' }, 'High') : null),
        h('span', { class: 'prow-next' + (ns ? '' : ' warn') }, ns ? `Next: ${ns.text}` : 'No next step — add one',
          ns && ns.waiting ? waitingTag(ns) : null,
          p.deadline
            ? h('span', { class: 'tag' + (isOverdue(p, today) ? ' late' : '') }, isOverdue(p, today) ? `Overdue · ${fmtDay(p.deadline)}` : `Target ${fmtDay(p.deadline)}`)
            : null))),
    canDrag() ? h('span', { class: 'grip', 'aria-hidden': 'true', title: 'Drag to reorder' }, '⋮⋮') : null);
}

/** "Waiting: Ravi · 4d" — red once it is time to chase. */
function waitingTag(step) {
  const d = waitingDays(step);
  const who = step.waitingOn ? `Waiting: ${step.waitingOn}` : 'Waiting';
  return h('span', { class: 'tag waiting' + (d >= WAIT_RED_DAYS ? ' late' : '') }, d ? `${who} · ${d}d` : who);
}

/** Today screen: people to contact (red, then orange). Tap a name to open their page. */
function followUpRow() {
  const list = peopleByFollowUp(store.view.data).filter((x) => x.st.colour !== 'green');
  if (!list.length) return null;
  return h('div', { class: 'follow-up', key: 'follow-up' },
    h('div', { class: 'follow-up-title' }, 'Follow up today'),
    h('div', { class: 'follow-up-chips' }, list.map(({ person, st }) => h('button', {
      class: 'person-chip', key: 'fu-' + person.id,
      title: st.colour === 'red' ? 'Time to contact' : 'Something open',
      onClick: () => { ui.view = 'people'; ui.search = ''; rememberUi(); ctx.selectPerson(person.id); },
    }, h('span', { class: `dot ${st.colour}` }), `${person.name} (${st.open})`))));
}

function canDrag() {
  return !ui.search && ui.sort === 'mine';
}

/** Tick a project's next step straight from the list. */
function quickTick(p, step, el) {
  el.checked = true;
  const op = store.dispatch('tickStep', { projectId: p.id, stepId: step.id });
  if (!op) { el.checked = false; return; }
  const after = store.view.data.projects.find((x) => x.id === p.id);
  const next = after && nextStep(after);
  toast(next ? `✓ ${step.text}. Next: ${next.text}` : `✓ ${step.text}. Add the next step for "${p.name}".`, 4500);
}

const COLOUR_ORDER = { red: 0, orange: 1, green: 2, grey: 3 };
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

/** "Red first": red, then orange, then green; high priority first within each; else my order. */
function sortForView(list, today) {
  if (ui.sort !== 'red' || ui.search) return list;
  return list
    .map((p, i) => ({ p, i, c: COLOUR_ORDER[dotColour(p, today)], r: PRIORITY_ORDER[p.priority] ?? 1 }))
    .sort((a, b) => a.c - b.c || a.r - b.r || a.i - b.i)
    .map((x) => x.p);
}

function sortSwitch() {
  const opt = (value, label) => h('button', {
    class: 'seg' + (ui.sort === value ? ' on' : ''), 'aria-pressed': String(ui.sort === value),
    onClick: () => { ui.sort = value; rememberUi(); render(); },
  }, label);
  return h('div', { class: 'segmented', role: 'group', 'aria-label': 'Order' }, opt('mine', 'My order'), opt('red', 'Red first'));
}

/** "3 of 7 done today" with a thin bar. */
function progressLine(today) {
  const active = store.view.data.projects.filter((p) => p.state === 'active');
  if (!active.length) return null;
  const done = active.filter((p) => dotColour(p, today) === 'green').length;
  const pct = Math.round((done / active.length) * 100);
  const bar = h('div', { class: 'progress-bar' }, h('div', { class: 'progress-fill', key: 'pf' }));
  bar.firstChild.style.width = `${pct}%`; // set through the style object (allowed by the page's safety rules)
  return h('div', { class: 'progress', key: 'progress' },
    h('div', { class: 'progress-text' },
      h('strong', null, `${done} of ${active.length}`), done === active.length ? ' done today — all green! 🎉' : ' done today'),
    bar);
}

function newProjectForm() {
  if (!ui.adding) {
    return h('button', { class: 'btn primary new-project', onClick: () => { ui.adding = true; render(); focusKey('new-name'); } }, '+ New project');
  }
  const defaultGroup = ui.view.startsWith('group:') ? ui.view.slice(6) : store.view.data.groups[0]?.id;
  return h('form', {
    class: 'new-form',
    onSubmit: (e) => {
      e.preventDefault();
      const f = e.target.elements;
      const name = f.name.value.trim();
      if (!name) return;
      const projectId = newId();
      if (store.dispatch('createProject', { projectId, name, groupId: f.group.value })) {
        ui.adding = false;
        if (ui.view !== 'today' && ui.view !== 'all' && !ui.view.startsWith('group:')) ui.view = 'today';
        select(projectId);
        focusKey('add-step-' + projectId);
      }
    },
  },
  h('input', { name: 'name', placeholder: 'Project name', key: 'new-name', autocomplete: 'off' }),
  h('select', { name: 'group', value: defaultGroup }, store.view.data.groups.map((g) => h('option', { value: g.id }, g.name))),
  h('button', { class: 'btn primary', type: 'submit' }, 'Add'),
  h('button', { class: 'btn', type: 'button', onClick: () => { ui.adding = false; render(); } }, 'Cancel'));
}

function statusText() {
  const s = store ? store.status : 'loading';
  if (s === 'saving') return h('span', { class: 'status' }, 'Saving…');
  if (s === 'saved') return h('span', { class: 'status ok' }, 'Saved ✓');
  if (s === 'offline') return h('span', { class: 'status bad' }, 'No connection');
  if (s === 'error') return h('span', { class: 'status bad' }, store.message || 'Error');
  if (s === 'auth') return h('span', { class: 'status bad' }, 'Key problem');
  return h('span', { class: 'status' }, 'Loading…');
}

function renderListColumn() {
  const today = todayIndia();
  const head = h('div', { class: 'list-head' },
    h('button', { class: 'icon menu-btn', 'aria-label': 'Menu', onClick: () => { ui.menuOpen = true; render(); } }, '☰'),
    h('h2', null, viewTitle()),
    statusText(),
    h('button', { class: 'icon', title: 'Get latest', 'aria-label': 'Refresh', onClick: () => doRefresh(true) }, '↻'));
  const mobileSearch = h('input', {
    class: 'search mobile-only', type: 'search', placeholder: 'Search…', value: ui.search, key: 'search-mobile', 'aria-label': 'Search',
    onInput: (e, el) => { ui.search = el.value; render(); },
  });

  if (ui.view === 'diary' && !ui.search) return h('div', { class: 'col-inner' }, head, renderDiary());
  if (ui.view === 'settings' && !ui.search) return h('div', { class: 'col-inner' }, head, renderSettings());
  if (ui.view === 'people' && !ui.search) return h('div', { class: 'col-inner' }, head, renderPeopleList(ctx));

  const list = sortForView(visibleProjects(), today);
  const showSort = !ui.search && ui.view !== 'paused' && ui.view !== 'finished' && list.length > 1;
  const empty = !list.length ? h('p', { class: 'empty-list' },
    ui.search ? 'Nothing found.' : ui.view === 'paused' ? 'No paused projects.' : ui.view === 'finished' ? 'No finished projects yet.'
      : 'No projects yet. Add your first one with "+ New project".') : null;
  return h('div', { class: 'col-inner' },
    head,
    mobileSearch,
    ui.view === 'today' && !ui.search ? progressLine(today) : null,
    ui.view === 'today' && !ui.search ? followUpRow() : null,
    ui.view === 'today' && !ui.search ? renderBrief() : null,
    h('div', { class: 'list-tools' },
      ui.view === 'finished' || ui.view === 'paused' || ui.search ? null : newProjectForm(),
      showSort && !ui.adding ? sortSwitch() : null),
    h('ul', { class: 'plist', key: 'plist-' + (ui.search ? 'search' : ui.view) }, list.map((p) => projectRow(p, today))),
    empty);
}

// ---------------------------------------------------------------- Diary

function renderDiary() {
  const { data, history } = store.view;
  const byDay = new Map();
  const add = (date, line) => { if (!byDay.has(date)) byDay.set(date, []); byDay.get(date).push(line); };
  const exists = new Set(data.projects.map((p) => p.id));
  const nameOf = (e) => {
    const p = data.projects.find((x) => x.id === e.projectId);
    return p ? p.name : `${e.projectName || ''} (deleted project)`;
  };
  for (const e of Object.values(history).flat()) {
    if (!['step_ticked', 'paused', 'unpaused', 'finished', 'reopened'].includes(e.kind)) continue;
    const words = { step_ticked: '✓', paused: 'Paused', unpaused: 'Unpaused', finished: 'Finished', reopened: 'Reopened' }[e.kind];
    add(indiaDate(e.at), { at: e.at, projectId: e.projectId, text: `${words} ${e.kind === 'step_ticked' ? e.detail : ''}`.trim(), name: nameOf(e) });
  }
  // Work notes come from the projects (so edits and deletes show correctly)...
  for (const p of data.projects) {
    for (const n of p.workNotes) add(indiaDate(n.createdAt), { at: n.createdAt, projectId: p.id, text: `📝 ${n.text}`, name: p.name });
  }
  // ...and from history only for deleted projects.
  for (const e of Object.values(history).flat()) {
    if (e.kind === 'note_added' && !exists.has(e.projectId)) {
      add(indiaDate(e.at), { at: e.at, projectId: e.projectId, text: `📝 ${e.detail}`, name: nameOf(e) });
    }
  }
  const days = [...byDay.keys()].sort().reverse();
  const shown = days.slice(0, ui.diaryDays);
  const loaded = new Set(Object.keys(history));
  const older = store.availableMonths().find((m) => !loaded.has(m));
  return h('div', { class: 'diary' },
    shown.length ? null : h('p', { class: 'empty-list' }, 'Nothing yet. Ticked steps and work notes will show here.'),
    shown.map((d) => h('section', { class: 'diary-day', key: 'd-' + d },
      h('h3', null, fmtLongDay(d)),
      h('ul', null, byDay.get(d).sort((a, b) => (a.at < b.at ? 1 : -1)).map((l) => h('li', null,
        h('span', { class: 'muted small' }, fmtTime(l.at)), ' ',
        exists.has(l.projectId)
          ? h('button', { class: 'link', onClick: () => { select(l.projectId); } }, l.name)
          : h('span', { class: 'muted' }, l.name),
        ': ', l.text))))),
    days.length > shown.length
      ? h('button', { class: 'btn', onClick: () => { ui.diaryDays += 14; render(); } }, 'Show older days')
      : older ? h('button', { class: 'btn', onClick: () => store.loadMonth(older) }, `Load ${older}`) : null);
}

// ---------------------------------------------------------------- Settings

function keyForm(provider, label, help) {
  const has = !!device.aiKey(provider);
  return h('form', {
    class: 'setting',
    onSubmit: async (e) => {
      e.preventDefault();
      const input = e.target.elements.key;
      const v = input.value.trim();
      if (!v) return;
      device.setAiKey(provider, v);
      input.value = '';
      toast(`${label} key saved on this device`);
      render();
    },
  },
  h('label', null, `${label} key `, has ? h('span', { class: 'ok' }, '(saved ✓)') : h('span', { class: 'muted' }, '(not set)')),
  h('div', { class: 'row' },
    h('input', { name: 'key', type: 'password', placeholder: has ? 'Paste a new key to replace' : 'Paste key here', autocomplete: 'off', key: 'k-' + provider }),
    h('button', { class: 'btn primary small', type: 'submit' }, 'Save'),
    has ? h('button', {
      class: 'btn small', type: 'button',
      onClick: async () => {
        toast('Testing…');
        try { toast((await ai.testKey(provider, device.aiKey(provider))) ? `${label} key works ✓` : 'Unclear answer from the AI'); } catch (err) { toast(err.message); }
      },
    }, 'Test') : null,
    has ? h('button', {
      class: 'btn small', type: 'button',
      onClick: () => { if (confirm(`Remove the ${label} key from this device?`)) { device.setAiKey(provider, ''); render(); } },
    }, 'Remove') : null),
  h('p', { class: 'muted small' }, help));
}

async function downloadBackup() {
  toast('Preparing backup…', 20000);
  try {
    await store.loadAllHistory();
    const today = todayIndia();
    const backup = { app: 'daily-projects', madeAt: new Date().toISOString(), data: store.view.data, history: store.view.history };
    const blob = new Blob([JSON.stringify(backup, null, 1)], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `daily-projects-backup-${today}.json` });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('Backup downloaded');
  } catch (e) {
    toast(`Backup failed: ${e.message}`);
  }
}

function renderSettings() {
  const { data } = store.view;
  const provider = data.settings.aiProvider || 'claude';
  const usage = data.aiUsage.date === todayIndia() ? data.aiUsage.count : 0;
  return h('div', { class: 'settings' },
    h('section', { class: 'block' }, h('h3', null, 'GitHub access key'),
      h('p', null, isMock ? 'Test mode (no real GitHub).' : 'Connected to your private data ✓'),
      h('div', { class: 'row' },
        isMock ? null : h('button', { class: 'btn', onClick: () => showKeyScreen('Paste your new GitHub access key.') }, 'Change key'),
        h('button', {
          class: 'btn danger',
          onClick: () => {
            const waiting = store.pending.length;
            if (waiting && !confirm(`${waiting} change(s) are not saved yet and will be lost. Continue?`)) return;
            if (!confirm('Forget this device? All keys are removed from this browser.')) return;
            device.forgetAll();
            location.reload();
          },
        }, 'Forget this device'))),
    h('section', { class: 'block' }, h('h3', null, 'AI helper'),
      h('div', { class: 'row' },
        ['claude', 'gemini'].map((x) => h('label', { class: 'check' },
          h('input', {
            type: 'radio', name: 'provider', checked: provider === x,
            onChange: () => store.dispatch('setAiProvider', { provider: x }),
          }), x === 'claude' ? ' Claude Haiku (main)' : ' Gemini Flash (backup)'))),
      h('p', null, `AI uses today: ${usage} / ${AI_DAILY_LIMIT}`),
      keyForm('claude', 'Claude', 'From console.anthropic.com → API keys. Saved only in this browser.'),
      keyForm('gemini', 'Gemini', 'Optional. From aistudio.google.com → Get API key. On the free plan Google may read the text.')),
    h('section', { class: 'block' }, h('h3', null, 'Backup'),
      h('p', { class: 'muted' }, 'Every save is kept as a version on GitHub. You can also download a copy.'),
      h('button', { class: 'btn', onClick: downloadBackup }, 'Download backup')),
    h('section', { class: 'block' }, h('h3', null, 'iPhone'),
      h('p', null, 'Always open Daily Projects from its home-screen icon. In Safari: Share → "Add to Home Screen". Then paste your keys inside the icon app.')));
}

// ---------------------------------------------------------------- key screen

function showKeyScreen(message = '') {
  const screen = document.getElementById('keyscreen');
  screen.hidden = false;
  root.hidden = true;
  screen.replaceChildren(h('form', {
    class: 'key-card',
    onSubmit: async (e) => {
      e.preventDefault();
      const key = e.target.elements.key.value.trim();
      if (!key) return;
      const msg = screen.querySelector('.key-msg');
      msg.textContent = 'Checking…';
      try {
        const repo = new GitHubRepo(key, DATA_OWNER, DATA_REPO, DATA_BRANCH);
        await repo.headCommit();
        device.setGithubKey(key);
        screen.hidden = true;
        root.hidden = false;
        start();
      } catch (err) {
        msg.textContent = err.message === 'No connection' ? 'No connection. Try again.' : 'This key does not work. Check it and try again.';
      }
    },
  },
  h('img', { src: 'icons/icon-192.png', alt: '', width: 64, height: 64 }),
  h('h1', null, 'Daily Projects'),
  h('p', null, message || 'Paste your GitHub access key to open your projects.'),
  h('input', { name: 'key', type: 'password', placeholder: 'github_pat_…', autocomplete: 'off', autofocus: true }),
  h('button', { class: 'btn primary', type: 'submit' }, 'Open'),
  h('p', { class: 'key-msg muted' }),
  h('p', { class: 'muted small' }, 'The key stays only on this device.')));
}

// ---------------------------------------------------------------- render

function focusKey(key) {
  setTimeout(() => {
    const el = root.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (el) el.focus();
  }, 30);
}

let sortables = [];

function setupSortable() {
  if (!window.Sortable) return;
  const lists = root.querySelectorAll('.plist, .sortable-steps');
  for (const el of lists) {
    const isProjects = el.classList.contains('plist');
    if (el.__sortable) {
      if (isProjects) el.__sortable.option('disabled', !canDrag());
      continue;
    }
    el.__sortable = window.Sortable.create(el, {
      animation: 150,
      disabled: isProjects && !canDrag(),
      handle: isProjects ? undefined : '.grip',
      delay: 300,
      delayOnTouchOnly: true,
      filter: 'input, select, textarea',
      preventOnFilter: false,
      onEnd: (evt) => {
        if (evt.oldIndex === evt.newIndex) return;
        const ids = [...el.children].map((c) => c.dataset.id);
        const id = evt.item.dataset.id;
        const i = ids.indexOf(id);
        const where = i > 0 ? { afterId: ids[i - 1] } : { beforeId: ids[1] };
        if (isProjects) {
          if (!canDrag()) { render(); return; }
          if (!store.dispatch('moveProject', { projectId: id, ...where })) render();
        } else {
          if (!store.dispatch('moveStep', { projectId: el.dataset.project, stepId: id, ...where })) render();
        }
      },
    });
    sortables.push(el.__sortable);
  }
}

function render() {
  if (!store || !store.view) {
    root.replaceChildren(h('div', { class: 'loading' }, store && store.status === 'offline' ? 'No connection. Retrying…' : 'Loading…'));
    return;
  }
  if (ui.selected && !store.view.data.projects.some((p) => p.id === ui.selected)) ui.selected = null;
  const wide = (ui.view === 'diary' || ui.view === 'settings') && !ui.search;
  const next = h('div', {
    class: ['layout', wide ? 'wide' : '', ui.mobile === 'detail' && !wide ? 'show-detail' : '', ui.menuOpen ? 'menu-open' : ''].join(' ').trim(),
  },
  h('aside', { id: 'menu' }, renderMenu()),
  h('div', { class: 'scrim', onClick: () => { ui.menuOpen = false; render(); } }),
  h('main', { id: 'list' }, renderListColumn()),
  wide ? null : h('section', { id: 'detail' }, ui.view === 'people' && !ui.search ? renderPerson(ctx) : renderDetail(ctx)),
  ui.showKeys ? keysHelp() : null);
  if (root.firstChild && root.firstChild.classList && root.firstChild.classList.contains('layout')) morph(root.firstChild, next);
  else root.replaceChildren(next);
  setupSortable();
}

// ---------------------------------------------------------------- keyboard

const KEYS = [
  ['↓  ↑', 'Next / previous project'],
  ['x', 'Tick the next step of the open project'],
  ['a', 'Type a new step'],
  ['w', 'Type in "What did you do today?"'],
  ['n', 'New project'],
  ['/', 'Search'],
  ['r', 'Switch "My order" / "Red first"'],
  ['t  d  p', 'Go to Today / Diary / People'],
  ['@', 'In a step or note: pick a person'],
  ['Esc', 'Leave a box, or close what is open'],
  ['?', 'Show or hide this list'],
];

function keysHelp() {
  return h('div', { class: 'keys-help', key: 'keys-help', role: 'dialog', 'aria-label': 'Keyboard shortcuts' },
    h('div', { class: 'keys-head' }, h('strong', null, 'Keyboard shortcuts'),
      h('button', { class: 'icon', 'aria-label': 'Close', onClick: () => { ui.showKeys = false; render(); } }, '✕')),
    h('p', { class: 'muted small' }, 'They work when you are not typing in a box. Press Esc to leave a box.'),
    h('table', null, KEYS.map(([k, what]) => h('tr', null, h('td', null, h('kbd', null, k)), h('td', null, what)))));
}

function isTyping(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.nodeName === 'TEXTAREA' || el.nodeName === 'SELECT') return true;
  return el.nodeName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes(el.type);
}

function currentList() {
  if (!store || !store.view || ui.view === 'diary' || ui.view === 'settings') return [];
  return sortForView(visibleProjects(), todayIndia());
}

function moveSelection(step) {
  if (ui.view === 'people' && !ui.search) {
    const people = store.view.data.people || [];
    if (!people.length) return;
    const i = people.findIndex((x) => x.id === ui.person);
    const next = i < 0 ? people[0] : people[Math.min(people.length - 1, Math.max(0, i + step))];
    ctx.selectPerson(next.id);
    ui.mobile = 'list'; render();
    const row = root.querySelector(`.people-list .prow[data-id="${CSS.escape(next.id)}"]`);
    if (row) row.scrollIntoView({ block: 'nearest' });
    return;
  }
  const list = currentList();
  if (!list.length) return;
  const i = list.findIndex((p) => p.id === ui.selected);
  const next = i < 0 ? list[step > 0 ? 0 : list.length - 1] : list[Math.min(list.length - 1, Math.max(0, i + step))];
  if (!next || next.id === ui.selected) return;
  select(next.id);
  ui.mobile = 'list'; // keyboard use: keep the list in view on small screens
  render();
  const row = root.querySelector(`.prow[data-id="${CSS.escape(next.id)}"]`);
  if (row) row.scrollIntoView({ block: 'nearest' });
}

function selectedProject() {
  return store && store.view ? store.view.data.projects.find((p) => p.id === ui.selected) : null;
}

function onKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return; // leave browser shortcuts alone
  if (e.key === 'Escape') {
    const viewer = document.getElementById('viewer');
    if (!viewer.hidden) { closeViewer(); return; }
    if (ui.showKeys) { ui.showKeys = false; render(); return; }
    if (isTyping(document.activeElement)) { document.activeElement.blur(); return; }
    if (ui.menuOpen) { ui.menuOpen = false; render(); return; }
    if (ui.adding) { ui.adding = false; render(); return; }
    if (ui.search) { ui.search = ''; render(); return; }
    if (ui.ai) { ui.ai = null; render(); return; }
    return;
  }
  if (isTyping(document.activeElement)) return;
  if (!store || !store.view || !document.getElementById('keyscreen').hidden) return;
  const p = selectedProject();
  const k = e.key;
  let handled = true;
  if (k === 'ArrowDown' || k === 'j') moveSelection(1);
  else if (k === 'ArrowUp' || k === 'k') moveSelection(-1);
  else if (ui.view === 'people' && 'xaw'.includes(k)) handled = false; // project keys do nothing on People
  else if (k === 'x') {
    const ns = p && p.state === 'active' && nextStep(p);
    if (ns) {
      if (store.dispatch('tickStep', { projectId: p.id, stepId: ns.id })) {
        const after = selectedProject();
        const nn = after && nextStep(after);
        toast(nn ? `✓ ${ns.text}. Next: ${nn.text}` : `✓ ${ns.text}. Press "a" to add the next step.`, 4500);
      }
    } else toast(p ? 'No step to tick. Press "a" to add one.' : 'Pick a project first (↓ ↑).');
  } else if (k === 'a') {
    if (!p) { toast('Pick a project first (↓ ↑).'); return; }
    ui.mobile = 'detail'; render(); focusKey('add-step-' + p.id);
  } else if (k === 'w') {
    if (!p) { toast('Pick a project first (↓ ↑).'); return; }
    ui.mobile = 'detail'; render(); focusKey('wn-' + p.id);
  } else if (k === 'n') {
    if (ui.view === 'diary' || ui.view === 'settings' || ui.view === 'paused' || ui.view === 'finished') ui.view = 'today';
    ui.search = ''; ui.adding = true; ui.mobile = 'list'; render(); focusKey('new-name');
  } else if (k === '/') {
    const box = [...root.querySelectorAll('input.search')].find((el) => el.offsetParent !== null);
    if (box) box.focus();
  } else if (k === 'r') {
    ui.sort = ui.sort === 'red' ? 'mine' : 'red'; rememberUi(); render();
    toast(ui.sort === 'red' ? 'Red first' : 'My order', 1500);
  } else if (k === 't') go('today');
  else if (k === 'd') go('diary');
  else if (k === 'p') go('people');
  else if (k === '?') { ui.showKeys = !ui.showKeys; render(); }
  else handled = false;
  if (handled) e.preventDefault();
}

// ---------------------------------------------------------------- start

async function doRefresh(force) {
  if (!store || store.status === 'auth') return;
  await store.refresh(force);
  if (force && store.status === 'saved') toast('Up to date ✓');
  makeBrief();
}

let started = false;

function start() {
  const key = device.githubKey();
  if (!isMock && !key) { showKeyScreen(); return; }
  const repo = isMock ? new MockRepo() : new GitHubRepo(key, DATA_OWNER, DATA_REPO, DATA_BRANCH);
  store = new Store(repo);
  store.addEventListener('change', () => render());
  store.addEventListener('status', (e) => {
    // Only build the key screen when it is not already showing, so a pasted key is not wiped.
    if (e.detail.status === 'auth' && document.getElementById('keyscreen').hidden) {
      showKeyScreen('Your GitHub key stopped working. Paste a new one. Your unsaved changes are kept.');
    }
    render();
  });
  store.addEventListener('blocked', (e) => {
    toast(e.detail.status === 'offline' ? 'No connection — changes not saved. Try again when online.' : 'Please wait…');
    render(); // put ticked boxes and menus back to the real data
  });
  render();
  store.init().then(() => { render(); makeBrief(); });
  if (started) return;
  started = true;
  setInterval(() => { if (document.visibilityState === 'visible') doRefresh(false); }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') doRefresh(false); });
  window.addEventListener('online', () => {
    if (store.status !== 'offline') return;
    store.init().then(() => { if (store.pending.length) store.save(); else if (store.status !== 'auth') store.setStatus('saved'); });
  });
  window.addEventListener('offline', () => store.setStatus('offline', 'No connection'));
  document.addEventListener('keydown', onKey);
}

installEvents(document.body);
installMentions(() => ctx);
if (isMock) document.title = 'Daily Projects (test mode)';
start();
