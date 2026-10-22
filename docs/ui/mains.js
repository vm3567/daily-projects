// 📂 Main projects: one project holds a few others (only one level).
// The "Put under a main project…" box, the SUB-PROJECTS table on a main project's page, the "📂 Kilns ›" chip
// on a project that is under one, the nested project list (▾ / ▸), and the "📂 Main projects" page.

import { h, fmtDay } from './dom.js';
import { dotColour, nextStep, todayIndia, indiaDate, childrenOf, parentOf, isMainProject, mainProjects, mainColour, mainSummary, mainChoices, addHereChoices, nestList } from '../rules.js';
import { newId } from '../ops.js';

const ORDER = { red: 0, yellow: 1, green: 2, grey: 3 };
const PRIORITY = { high: 0, medium: 1, low: 2 };

/** Red first (then high priority, then my order). `colour(p)` gives the dot to sort by. */
function redFirst(list, colour) {
  return list.map((p, i) => ({ p, i, c: ORDER[colour(p)], r: PRIORITY[p.priority] ?? 1 }))
    .sort((a, b) => a.c - b.c || a.r - b.r || a.i - b.i).map((x) => x.p);
}

/** The dot a project shows in a nested list: a main project shows the worst of itself and its projects. */
export function listColour(data, p, today = todayIndia()) {
  return isMainProject(data, p) ? mainColour(p, childrenOf(data, p.id), today) : dotColour(p, today);
}

function focusBox(key) {
  setTimeout(() => { const n = globalThis.document && document.querySelector(`[data-key="${key}"]`); if (n && n.focus) n.focus(); }, 30);
}

/** Open the box: mode 'parent' = pick a main project for p; mode 'add' = pick a project to put under the main project p. */
export function openMainBox(ctx, p, mode = 'parent') {
  ctx.ui.mainBox = { id: p.id, mode, q: '', index: 0 };
  ctx.ui.projMenu = null;
  ctx.render();
  focusBox('mainbox-' + p.id);
}

/** What the box offers now: [{ label, run, kind }] (the highlighted one is picked by Enter). */
export function mainBoxItems(ctx, p) {
  const { store, ui } = ctx;
  const data = store.view.data;
  const box = ui.mainBox || { q: '' };
  const done = () => { ui.mainBox = null; ctx.render(); };
  if (box.mode === 'add') {
    return addHereChoices(data, p, box.q).slice(0, 12).map((x) => ({
      kind: 'project', p: x, label: x.name,
      run: () => { ctx.act('setParent', { projectId: x.id, parentId: p.id }, `${x.name} is now under 📂 ${p.name}`); done(); },
    }));
  }
  const { items, create } = mainChoices(data, p, box.q);
  const out = items.slice(0, 12).map(({ p: m, main }) => ({
    kind: main ? 'main' : 'project', p: m, label: m.name,
    run: () => { ctx.act('setParent', { projectId: p.id, parentId: m.id }, `Put under 📂 ${m.name}`); done(); },
  }));
  if (create) {
    out.push({
      kind: 'create', label: `+ Create '${create}' as a new main project`,
      run: () => {
        ctx.act('createMainProject', { projectId: newId(), name: create, groupId: p.groupId, childId: p.id }, `New main project 📂 ${create} — ${p.name} is under it`);
        done();
      },
    });
  }
  return out;
}

/** The smart box: type to find, ↓ ↑ to move, Enter or tap to pick, Esc to close. */
export function mainBox(ctx, p, mode = 'parent') {
  const { store, ui } = ctx;
  const box = ui.mainBox;
  if (!box || box.id !== p.id || (box.mode || 'parent') !== mode) return null;
  const items = mainBoxItems(ctx, p);
  const index = Math.min(Math.max(0, box.index || 0), Math.max(0, items.length - 1));
  const close = () => { ui.mainBox = null; ctx.render(); };
  const main = box.mode === 'parent' ? parentOf(store.view.data, p) : null;
  return h('div', { class: 'main-box', key: 'mainbox-wrap-' + p.id, role: 'dialog', 'aria-label': box.mode === 'add' ? 'Add a project here' : 'Put under a main project' },
    h('div', { class: 'main-box-head' },
      h('strong', null, box.mode === 'add' ? `Add a project to 📂 ${p.name}` : '📂 Put under a main project'),
      h('button', { class: 'icon', type: 'button', 'aria-label': 'Close', onClick: close }, '✕')),
    main ? h('button', {
      class: 'main-box-remove', type: 'button',
      onClick: () => { ctx.act('setParent', { projectId: p.id, parentId: null }, `Taken out of 📂 ${main.name}`); close(); },
    }, `Remove from 📂 ${main.name}`) : null,
    h('input', {
      class: 'main-box-input', key: 'mainbox-' + p.id, value: box.q, autocomplete: 'off', 'aria-label': 'Type a name',
      placeholder: box.mode === 'add' ? 'Type a project name…' : 'Type a main project name…',
      onInput: (e, el) => { box.q = el.value; box.index = 0; ctx.render(); },
      onKeydown: (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); box.index = Math.min(items.length - 1, index + 1); ctx.render(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); box.index = Math.max(0, index - 1); ctx.render(); }
        else if (e.key === 'Enter') { e.preventDefault(); if (items[index]) items[index].run(); }
        else if (e.key === 'Escape') { e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); close(); }
      },
    }),
    h('ul', { class: 'main-box-list', role: 'listbox' }, items.map((it, i) => h('li', { key: 'mb-' + (it.p ? it.p.id : 'create') },
      h('button', {
        class: 'main-box-item' + (i === index ? ' on' : '') + (it.kind === 'create' ? ' create' : ''), type: 'button', role: 'option', 'aria-selected': String(i === index),
        onClick: () => it.run(),
      }, it.kind === 'main' ? '📂 ' : '', it.label)))),
    !items.length ? h('p', { class: 'muted small' }, box.mode === 'add' ? 'No project can go here.' : 'Type a name.') : null);
}

/** On a project that is under a main project: "📂 Kilns ›" (opens the main). */
export function mainChip(ctx, p) {
  const main = parentOf(ctx.store.view.data, p);
  if (!main) return null;
  return h('button', { class: 'main-chip', key: 'mainchip-' + p.id, title: `Open the main project ${main.name}`, onClick: () => ctx.openProject(main.id) }, `📂 ${main.name} ›`);
}

/** The newest work or team note: { day, text } (email lines are not updates). */
function lastUpdate(p) {
  const n = (p.workNotes || []).find((x) => !x.mail);
  return n ? { day: indiaDate(n.createdAt), text: String(n.text || '').replace(/^👥 /, '') } : null;
}

const short = (t, n = 60) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

/** On a main project's page: SUB-PROJECTS (N) — dot, name (+ 👥 person), Now, Last update; and the two buttons. */
export function subProjectsBlock(ctx, p, today = todayIndia()) {
  const { store } = ctx;
  const data = store.view.data;
  if (!isMainProject(data, p)) return null;
  const kids = redFirst(childrenOf(data, p.id), (c) => dotColour(c, today));
  return h('section', { class: 'block sub-projects', key: 'subs-' + p.id },
    h('h3', null, `SUB-PROJECTS (${kids.length})`),
    kids.length ? h('table', { class: 'sub-table' },
      h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'Project'), h('th', null, 'Now'), h('th', null, 'Last update'))),
      h('tbody', null, kids.map((c) => {
        const ns = c.state === 'active' ? nextStep(c, today) : null;
        const lu = lastUpdate(c);
        return h('tr', { class: 'sub-row', key: 'sub-' + c.id, onClick: () => ctx.openProject(c.id) },
          h('td', null, h('span', { class: `dot ${dotColour(c, today)}` })),
          h('td', null, h('button', { class: 'link sub-name', type: 'button' }, c.name), c.team ? h('span', { class: 'muted small' }, ` 👥 ${c.team.name}`) : null,
            c.state !== 'active' ? h('span', { class: 'tag' }, c.state) : null),
          h('td', { class: ns ? '' : 'warn' }, c.state !== 'active' ? '—' : ns ? short(ns.text) : 'No next step'),
          h('td', { class: 'muted small' }, lu ? `${fmtDay(lu.day)} · ${short(lu.text, 50)}` : '—'));
      }))) : h('p', { class: 'muted small' }, 'No projects under it yet.'),
    h('div', { class: 'sub-buttons' },
      h('button', { class: 'btn small', type: 'button', onClick: () => openMainBox(ctx, p, 'add') }, '+ Add a project here'),
      h('button', { class: 'btn small', type: 'button', onClick: () => newProjectHere(ctx, p) }, '+ New project here')),
    mainBox(ctx, p, 'add'));
}

/** "+ New project here": asks the name, the new project is made already under this main project. */
export function newProjectHere(ctx, p) {
  const name = globalThis.prompt ? prompt(`New project under 📂 ${p.name}:`) : null;
  if (!name || !name.trim()) return null;
  const projectId = newId();
  const op = ctx.store.dispatch('createProject', { projectId, name: name.trim(), groupId: p.groupId, parentId: p.id });
  if (op) { ctx.toast(`Added under 📂 ${p.name}: ${name.trim()}`); ctx.render(); }
  return op ? projectId : null;
}

/** ▾ / ▸ in front of a main project in the list: fold its projects away (remembered). */
export function foldButton(ctx, p, kids) {
  const folded = !!(ctx.ui.folded || {})[p.id];
  return h('button', {
    class: 'fold', type: 'button', key: 'fold-' + p.id, 'aria-expanded': String(!folded),
    title: folded ? `Show its ${kids} project${kids === 1 ? '' : 's'}` : 'Fold away its projects', 'aria-label': folded ? 'Unfold' : 'Fold',
    onClick: () => {
      const f = { ...(ctx.ui.folded || {}) };
      if (folded) delete f[p.id]; else f[p.id] = true;
      ctx.ui.folded = f;
      if (ctx.rememberUi) ctx.rememberUi();
      ctx.render();
    },
  }, folded ? '▸' : '▾');
}

/**
 * A project list with main projects (▾ / ▸) and their projects indented under them.
 * `rowFn(p, today, { depth, fold, colour })` draws one row (app.js projectRow).
 */
export function nestedRows(ctx, list, today, rowFn) {
  const data = ctx.store.view.data;
  return nestList(list, ctx.ui.folded || {}).map(({ p, depth, kids }) => rowFn(p, today, {
    depth, fold: kids ? foldButton(ctx, p, kids) : null,
    colour: isMainProject(data, p) ? mainColour(p, childrenOf(data, p.id), today) : null,
  }));
}

/** The "📂 Main projects" page: one card per main project, red first. */
export function renderMainProjects(ctx) {
  const { store } = ctx;
  const data = store.view.data;
  const today = todayIndia();
  const mains = redFirst(mainProjects(data), (m) => listColour(data, m, today));
  const kidsOf = (m) => redFirst(childrenOf(data, m.id).filter((c) => c.state !== 'finished'), (c) => dotColour(c, today));
  const inside = mains.reduce((n, m) => n + kidsOf(m).length, 0);
  const newMain = () => {
    const name = globalThis.prompt ? prompt('Name of the new main project (it holds a few projects):') : null;
    if (!name || !name.trim()) return;
    const projectId = newId();
    if (store.dispatch('createMainProject', { projectId, name: name.trim(), groupId: data.groups[0] && data.groups[0].id })) {
      ctx.toast(`New main project: 📂 ${name.trim()}`);
      ctx.render();
    }
  };
  return h('div', { class: 'mains-page', key: 'mains-page' },
    h('p', { class: 'muted mains-line' }, `${mains.length} main project${mains.length === 1 ? '' : 's'} · ${inside} project${inside === 1 ? '' : 's'} inside · red first`),
    h('button', { class: 'btn primary new-main', type: 'button', onClick: newMain }, '+ New main project'),
    mains.length ? null : h('p', { class: 'empty-list' }, 'No main projects yet. Make one here, or open a project and use ⋯ → 📂 Put under a main project.'),
    mains.map((m) => {
      const kids = kidsOf(m);
      return h('div', { class: 'main-card', key: 'mc-' + m.id },
        h('div', { class: 'main-card-head' },
          h('span', { class: `dot ${mainColour(m, kids, today)}` }),
          h('button', { class: 'link main-card-name', type: 'button', onClick: () => ctx.openProject(m.id) }, `📂 ${m.name}`),
          h('span', { class: 'muted small main-card-sum' }, mainSummary(kids, today)),
          h('button', { class: 'btn small main-open', type: 'button', onClick: () => ctx.openProject(m.id) }, 'Open ›')),
        kids.length ? h('ul', { class: 'main-card-list' }, kids.map((c) => {
          const ns = c.state === 'active' ? nextStep(c, today) : null;
          return h('li', { key: 'mcc-' + c.id },
            h('button', { class: 'main-card-row', type: 'button', onClick: () => ctx.openProject(c.id) },
              h('span', { class: `dot ${dotColour(c, today)}` }), ` ${c.name}`,
              h('span', { class: 'muted small' }, ` — ${c.state !== 'active' ? c.state : ns ? ns.text : 'No next step'}${c.team ? ` · 👥 ${c.team.name}` : ''}`)));
        })) : null);
    }));
}
