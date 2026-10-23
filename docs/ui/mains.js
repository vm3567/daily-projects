// 📂 Projects: a project holds a few tasks; a task can be in several projects (or none). A project is never inside another.
// The "📂 Add to a project…" box (pick several: ✓ = in it), the TASKS table on a project's page, the "📂 Kilns ›" chips
// on a task, the small project chips under a task's row in the lists, and the "📂 Projects" page.

import { h, fmtDay } from './dom.js';
import { dotColour, nextStep, todayIndia, indiaDate, childrenOf, parentsOf, isMainProject, mainProjects, mainColour, mainSummary, mainChoices, addHereChoices, orderedTasks, movedOrder, dropSlot, droppedOrder } from '../rules.js';
import { newId } from '../ops.js';
import { newTaskBox, createTaskWithNote, findEditor } from './richedit.js';

const ORDER = { red: 0, yellow: 1, green: 2, grey: 3 };
const PRIORITY = { high: 0, medium: 1, low: 2 };

/** Red first (then high priority, then my order). `colour(p)` gives the dot to sort by. */
function redFirst(list, colour) {
  return list.map((p, i) => ({ p, i, c: ORDER[colour(p)], r: PRIORITY[p.priority] ?? 1 }))
    .sort((a, b) => a.c - b.c || a.r - b.r || a.i - b.i).map((x) => x.p);
}

/** The dot in a list: a 📂 project shows the worst of itself and its tasks; a task its own dot. */
export function listColour(data, p, today = todayIndia()) {
  return isMainProject(data, p) ? mainColour(p, childrenOf(data, p.id), today) : dotColour(p, today);
}

function focusBox(key) {
  setTimeout(() => { const n = globalThis.document && document.querySelector(`[data-key="${key}"]`); if (n && n.focus) n.focus(); }, 30);
}

/** Open the box: mode 'parent' = pick projects for the task p; mode 'add' = pick tasks to put into the project p. */
export function openMainBox(ctx, p, mode = 'parent') {
  ctx.ui.mainBox = { id: p.id, mode, q: '', index: 0 };
  ctx.ui.projMenu = null;
  ctx.render();
  focusBox('mainbox-' + p.id);
}

/** What the box offers now: [{ label, run, kind, on }] (the highlighted one is picked by Enter). */
export function mainBoxItems(ctx, p) {
  const { store, ui } = ctx;
  const data = store.view.data;
  const box = ui.mainBox || { q: '' };
  const again = () => { if (ui.mainBox) { ui.mainBox.q = ''; ui.mainBox.index = 0; } ctx.render(); focusBox('mainbox-' + p.id); }; // stays open: pick more
  if (box.mode === 'add') {
    return addHereChoices(data, p, box.q).slice(0, 12).map((x) => ({
      kind: 'project', p: x, label: x.name,
      run: () => { ctx.act('addToProject', { projectId: x.id, parentId: p.id }, `${x.name} added to 📂 ${p.name}`); again(); },
    }));
  }
  const { items, create } = mainChoices(data, p, box.q);
  const out = items.slice(0, 12).map(({ p: m, in: on }) => ({
    kind: 'main', p: m, label: m.name, on,
    run: () => {
      if (on) ctx.act('removeFromProject', { projectId: p.id, parentId: m.id }, `Taken out of 📂 ${m.name}`);
      else ctx.act('addToProject', { projectId: p.id, parentId: m.id }, `Added to 📂 ${m.name}`);
      again();
    },
  }));
  if (create) {
    out.push({
      kind: 'create', label: `+ Create '${create}' as a new project`,
      run: () => {
        ctx.act('createMainProject', { projectId: newId(), name: create, childId: p.id }, `New project 📂 ${create} — ${p.name} is in it`);
        again();
      },
    });
  }
  return out;
}

/** The smart box: type to find, ↓ ↑ to move, Enter or tap to pick (✓ = already in it: pick again to take it out), Esc to close. */
export function mainBox(ctx, p, mode = 'parent') {
  const { ui } = ctx;
  const box = ui.mainBox;
  if (!box || box.id !== p.id || (box.mode || 'parent') !== mode) return null;
  const items = mainBoxItems(ctx, p);
  const index = Math.min(Math.max(0, box.index || 0), Math.max(0, items.length - 1));
  const close = () => { ui.mainBox = null; ctx.render(); };
  return h('div', { class: 'main-box', key: 'mainbox-wrap-' + p.id, role: 'dialog', 'aria-label': box.mode === 'add' ? 'Add a task here' : 'Add to a project' },
    h('div', { class: 'main-box-head' },
      h('strong', null, box.mode === 'add' ? `Add a task to 📂 ${p.name}` : '📂 Add to a project'),
      h('button', { class: 'icon', type: 'button', 'aria-label': 'Close', onClick: close }, '✕')),
    box.mode === 'add' ? null : h('p', { class: 'muted small' }, 'A task can be in several projects. ✓ = in it now; tap again to take it out.'),
    h('input', {
      class: 'main-box-input', key: 'mainbox-' + p.id, value: box.q, autocomplete: 'off', 'aria-label': 'Type a name',
      placeholder: box.mode === 'add' ? 'Type a task name…' : 'Type a project name…',
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
        class: 'main-box-item' + (i === index ? ' on' : '') + (it.kind === 'create' ? ' create' : '') + (it.on ? ' in' : ''), type: 'button', role: 'option',
        'aria-selected': String(i === index), ...(it.kind === 'main' ? { 'aria-checked': String(!!it.on) } : {}),
        onClick: () => it.run(),
      }, it.on ? '✓ ' : '', it.kind === 'main' ? '📂 ' : '', it.label)))),
    !items.length ? h('p', { class: 'muted small' }, box.mode === 'add' ? 'No task can go here.' : 'Type a name.') : null,
    h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', onClick: close }, 'Done')));
}

/** "+ Add tasks": the task list with tick boxes, to put one or several tasks into the project m at once. */
export function addTasksPicker(ctx, m) {
  const { store, ui } = ctx;
  const pk = ui.addTasks;
  if (!pk || pk.id !== m.id) return null;
  const data = store.view.data;
  const list = addHereChoices(data, m, pk.q);
  const close = () => { ui.addTasks = null; ctx.render(); };
  const add = () => {
    const ids = [...pk.picked].filter((id) => data.projects.some((x) => x.id === id));
    let n = 0;
    for (const id of ids) if (store.dispatch('addToProject', { projectId: id, parentId: m.id })) n++;
    ui.addTasks = null;
    ctx.toast(n ? `${n} task${n === 1 ? '' : 's'} added to 📂 ${m.name}` : 'Nothing added');
    ctx.render();
  };
  return h('div', { class: 'add-tasks', key: 'addtasks-' + m.id, role: 'dialog', 'aria-label': `Add tasks to ${m.name}` },
    h('div', { class: 'main-box-head' }, h('strong', null, `Add tasks to 📂 ${m.name}`),
      h('button', { class: 'icon', type: 'button', 'aria-label': 'Close', onClick: close }, '✕')),
    h('input', {
      class: 'main-box-input', key: 'addtasks-q-' + m.id, value: pk.q, autocomplete: 'off', placeholder: 'Find a task…', 'aria-label': 'Find a task',
      onInput: (e, el) => { pk.q = el.value; ctx.render(); },
      onKeydown: (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } },
    }),
    list.length ? h('ul', { class: 'add-tasks-list' }, list.map((x) => h('li', { key: 'at-' + x.id },
      h('label', { class: 'add-tasks-row' },
        h('input', { type: 'checkbox', checked: pk.picked.has(x.id) ? true : undefined, onChange: (e, el) => { if (el.checked) pk.picked.add(x.id); else pk.picked.delete(x.id); ctx.render(); } }),
        h('span', { class: `dot ${dotColour(x, todayIndia())}` }), ` ${x.name}`,
        parentsOf(data, x).length ? h('span', { class: 'muted small' }, `  · ${parentsOf(data, x).map((m) => '📂 ' + m.name).join(', ')}`) : null))))
      : h('p', { class: 'muted small' }, pk.q ? 'No task matches.' : 'Every task is in it already.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary small', type: 'button', disabled: pk.picked.size ? undefined : true, onClick: add },
        pk.picked.size ? `Add ${pk.picked.size} task${pk.picked.size === 1 ? '' : 's'}` : 'Add tasks'),
      h('button', { class: 'btn small', type: 'button', onClick: close }, 'Cancel')));
}

export function openAddTasks(ctx, m) {
  ctx.ui.addTasks = { id: m.id, q: '', picked: new Set() };
  ctx.ui.mainBox = null;
  ctx.render();
  focusBox('addtasks-q-' + m.id);
}

/** On a task that is in projects: "📂 Kilns ›" for each (opens that project). */
export function mainChip(ctx, p) {
  const mains = parentsOf(ctx.store.view.data, p);
  if (!mains.length) return null;
  return h('div', { class: 'main-chips', key: 'mainchips-' + p.id }, mains.map((m) => h('button', {
    class: 'main-chip', key: 'mainchip-' + p.id + '-' + m.id, title: `Open the project ${m.name}`, onClick: () => ctx.openProject(m.id),
  }, `📂 ${m.name} ›`)));
}

/** Small chips under a task's row in a list: "📂 Kilns" "📂 Supplier approval" (the projects it is in). */
export function projectChips(data, p) {
  const mains = parentsOf(data, p);
  if (!mains.length) return null;
  return h('span', { class: 'prow-chips' }, mains.map((m) => h('span', { class: 'tag main-tag', key: 'pc-' + m.id, title: `In the project ${m.name}` }, `📂 ${m.name}`)));
}

/** The newest work or team note: { day, text } (email lines are not updates). */
function lastUpdate(p) {
  const n = (p.workNotes || []).find((x) => !x.mail);
  return n ? { day: indiaDate(n.createdAt), text: String(n.text || '').replace(/^👥 /, '') } : null;
}

const short = (t, n = 60) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

const hasClass = (el, c) => (' ' + (el.className || '') + ' ').includes(' ' + c + ' ');
function setClass(el, c, on) {
  if (!el || hasClass(el, c) === !!on) return;
  el.className = on ? ((el.className || '') + ' ' + c).trim() : (' ' + el.className + ' ').replace(' ' + c + ' ', ' ').trim();
}

/**
 * Drag a task row by its ⋮⋮ grip (Pointer Events: mouse and touch alike). While dragging nothing is redrawn:
 * the row is lifted and follows the pointer, and a blue line shows where it will land. Letting go calls
 * done(order) once with the new full order; the same place (or Escape, or a cancelled touch) calls nothing.
 */
export function startTaskDrag(e, grip, kids, c, done) {
  if (!e || !grip || (e.button !== undefined && e.button !== 0)) return null;
  let row = grip.parentNode;
  while (row && row.nodeName !== 'TR') row = row.parentNode;
  const body = row && row.parentNode;
  if (!body || typeof grip.addEventListener !== 'function') return null;
  const rows = body.childNodes.filter ? body.childNodes.filter((n) => n.nodeName === 'TR') : [...body.childNodes].filter((n) => n.nodeName === 'TR');
  const box = (r) => (typeof r.getBoundingClientRect === 'function' ? r.getBoundingClientRect() : { top: 0, height: 0 });
  const mids = rows.map((r) => { const b = box(r); return b.top + b.height / 2; });
  const startY = e.clientY;
  let slot = null; let moved = false; let over = false;
  if (e.preventDefault) e.preventDefault(); // no text selection while dragging
  try { if (typeof grip.setPointerCapture === 'function' && e.pointerId !== undefined) grip.setPointerCapture(e.pointerId); } catch { /* not supported: still works while the pointer stays near */ }
  const clearLine = () => rows.forEach((r) => { setClass(r, 'drop-line-above', false); setClass(r, 'drop-line-below', false); });
  const showLine = () => {
    clearLine();
    const i = kids.findIndex((x) => x.id === c.id);
    if (slot === null || slot === i || slot === i + 1) return; // the same place: no line
    if (slot < rows.length) setClass(rows[slot], 'drop-line-above', true);
    else setClass(rows[rows.length - 1], 'drop-line-below', true);
  };
  const onMove = (ev) => {
    if (over) return;
    const dy = ev.clientY - startY;
    if (!moved && Math.abs(dy) < 4) return; // a small wobble is not a drag
    moved = true;
    setClass(row, 'dragging', true);
    if (row.style) row.style.transform = `translateY(${dy}px)`;
    slot = dropSlot(mids, ev.clientY);
    showLine();
  };
  const finish = (ev, drop) => {
    if (over) return;
    over = true;
    grip.removeEventListener('pointermove', onMove);
    grip.removeEventListener('pointerup', onUp);
    grip.removeEventListener('pointercancel', onCancel);
    if (typeof document !== 'undefined' && document.removeEventListener) document.removeEventListener('keydown', onEsc, true);
    try { if (typeof grip.releasePointerCapture === 'function' && e.pointerId !== undefined) grip.releasePointerCapture(e.pointerId); } catch { /* already let go */ }
    clearLine();
    setClass(row, 'dragging', false);
    if (row.style) row.style.transform = '';
    if (!drop || !moved) return;
    const order = droppedOrder(kids, c.id, dropSlot(mids, ev.clientY));
    if (order) done(order);
  };
  const onUp = (ev) => finish(ev, true);
  const onCancel = (ev) => finish(ev, false);
  const onEsc = (ev) => { if (ev.key === 'Escape') { if (ev.preventDefault) ev.preventDefault(); if (ev.stopPropagation) ev.stopPropagation(); finish(ev, false); } };
  grip.addEventListener('pointermove', onMove);
  grip.addEventListener('pointerup', onUp);
  grip.addEventListener('pointercancel', onCancel);
  if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('keydown', onEsc, true);
  return { cancel: () => finish(null, false) };
}

/** On a project's page: TASKS (N) — dot, name (+ 👥 person), Now, Last update; and the two buttons. */
export function subProjectsBlock(ctx, p, today = todayIndia()) {
  const { store } = ctx;
  const data = store.view.data;
  if (!isMainProject(data, p)) return null;
  const kids = orderedTasks(data, p, today); // your order (drag the ⋮⋮ grip), new ones after
  // the redraw moves the rows, which drops the keyboard focus: put it back on the same task's grip
  const refocus = (c) => {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
    const el = document.querySelector(`[data-key="grip-${c.id}"]`);
    if (el && typeof el.focus === 'function') el.focus();
  };
  const save = (c, order) => { if (!order) return; ctx.store.dispatch('setTaskOrder', { projectId: p.id, order }); ctx.render(); refocus(c); };
  const gripKey = (c, e) => {
    if (!e || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || e.ctrlKey || e.metaKey) return;
    if (e.preventDefault) e.preventDefault(); // no page scroll,
    if (e.stopPropagation) e.stopPropagation(); // and not the list's own ↑ ↓
    save(c, movedOrder(kids, c.id, e.key === 'ArrowUp' ? -1 : 1));
  };
  return h('section', { class: 'block sub-projects', key: 'subs-' + p.id },
    h('h3', null, `TASKS (${kids.length})`),
    kids.length ? h('table', { class: 'sub-table' },
      h('thead', null, h('tr', null, h('th', null, ''), h('th', null, ''), h('th', null, 'Task'), h('th', null, 'Now'), h('th', null, 'Last update'), h('th', null, ''), h('th', null, ''))),
      h('tbody', null, kids.map((c) => {
        const ns = c.state === 'active' ? nextStep(c, today) : null;
        const lu = lastUpdate(c);
        const done = c.state === 'finished'; // a finished task shows in green (owner asked, 22 Oct)
        return h('tr', { class: 'sub-row' + (done ? ' sub-done' : ''), key: 'sub-' + c.id, onClick: () => (ctx.ui.view === 'mains' && ctx.showHere ? ctx.showHere(c.id) : ctx.openProject(c.id)) },
          // hold the grip and drag the row up or down (mouse or finger); or ↑ ↓ (Alt+↑ ↓) on it
          h('td', { class: 'sub-grip-cell' }, h('button', {
            class: 'sub-grip', type: 'button', key: 'grip-' + c.id, title: 'Drag to move (or ↑ ↓)', 'aria-label': `Drag to move ${c.name}`,
            onClick: (e) => { if (e && e.stopPropagation) e.stopPropagation(); },
            onPointerdown: (e, el) => startTaskDrag(e, el || (e && e.currentTarget), kids, c, (order) => save(c, order)),
            onKeydown: (e) => gripKey(c, e),
          }, '⋮⋮')),
          h('td', null, h('span', { class: `dot ${done ? 'green' : dotColour(c, today)}` })),
          h('td', null, h('button', { class: 'link sub-name', type: 'button' }, c.name), c.team ? h('span', { class: 'muted small' }, ` 👥 ${c.team.name}`) : null,
            c.state !== 'active' ? h('span', { class: done ? 'tag done-tag' : 'tag' }, done ? '✓ finished' : c.state) : null),
          h('td', { class: c.state !== 'active' ? 'muted' : ns ? '' : 'warn' }, c.state !== 'active' ? '—' : ns ? short(ns.text) : 'No next step'),
          h('td', { class: 'muted small' }, lu ? `${fmtDay(lu.day)} · ${short(lu.text, 50)}` : '—'),
          // takes the task out of this project only (the task itself stays, with Undo)
          h('td', null, p.misc ? null : h('button', { // (📂 Misc: a task leaves it by going into another project)
            class: 'link small sub-remove', type: 'button', title: `Take ${c.name} out of this project (the task is kept)`,
            onClick: (e) => { if (e && e.stopPropagation) e.stopPropagation(); ctx.act('removeFromProject', { projectId: c.id, parentId: p.id }, `${c.name} taken out of 📂 ${p.name} (the task is kept)`); },
          }, '✕ Remove')));
      }))) : h('p', { class: 'muted small' }, 'No tasks in it yet.'),
    h('div', { class: 'sub-buttons' },
      p.misc ? null : h('button', { class: 'btn small', type: 'button', onClick: () => openAddTasks(ctx, p) }, '+ Add tasks'),
      h('button', { class: 'btn small', type: 'button', onClick: () => newProjectHere(ctx, p) }, '+ New task here'),
      h('button', { class: 'btn small', type: 'button', title: 'Copy this project\'s tasks as a numbered list (for an AI chat or an email)', onClick: () => ctx.copyList && ctx.copyList(orderedTasks(ctx.store.view.data, p).filter((c) => c.state !== 'finished'), { title: `📂 ${p.name}`, about: p.about || '' }) }, '📋 Copy list')),
    addTasksPicker(ctx, p),
    newHereBox(ctx, p));
}

/** "+ New task here": opens a box on the page (a name, and notes you can paste a screenshot or a table into). */
export function newProjectHere(ctx, p) {
  ctx.ui.newHere = p.id;
  ctx.render();
  setTimeout(() => { const el = findEditor(`newhere-${p.id}-name`); if (el && el.focus) el.focus(); }, 30);
}

/** The "+ New task here" box: Create makes the task already in this project (with its first update, if written). */
function newHereBox(ctx, p) {
  const { ui } = ctx;
  if (ui.newHere !== p.id) return null;
  const d = ((ui.newTaskDraft ||= {})['here-' + p.id] ||= {});
  const close = () => { ui.newHere = null; ctx.render(); };
  return newTaskBox(ctx, d, {
    key: `newhere-${p.id}`, heading: `New task in 📂 ${p.name}`,
    onCancel: close,
    onCreate: (name, editor) => {
      const id = createTaskWithNote(ctx, { name, parentId: p.id, d, editor });
      if (!id) return;
      ctx.toast(`Added to 📂 ${p.name}: ${name}`);
      close();
    },
  });
}

/** Top of the 📂 Projects list: "3 projects · 8 tasks in them · red first" and "+ New project" (the list itself is like ✅ Tasks). */
export function renderProjectsHead(ctx) {
  const { store } = ctx;
  const data = store.view.data;
  const mains = mainProjects(data).filter((m) => m.state !== 'finished');
  const inside = new Set(mains.flatMap((m) => childrenOf(data, m.id).filter((c) => c.state !== 'finished').map((c) => c.id))).size; // each task once
  const newMain = () => {
    const name = globalThis.prompt ? prompt('Name of the new project (it holds a few tasks):') : null;
    if (!name || !name.trim()) return;
    const projectId = newId();
    if (store.dispatch('createMainProject', { projectId, name: name.trim() })) {
      ctx.toast(`New project: 📂 ${name.trim()}`);
      if (ctx.showHere) ctx.showHere(projectId); else ctx.render();
    }
  };
  return h('div', { class: 'mains-head', key: 'mains-head' },
    h('p', { class: 'muted mains-line' }, `${mains.length} project${mains.length === 1 ? '' : 's'} · ${inside} task${inside === 1 ? '' : 's'} in them · red first`),
    h('button', { class: 'btn primary new-main', type: 'button', onClick: newMain }, '+ New project'),
    mains.length ? null : h('p', { class: 'empty-list' }, 'No projects yet. Make one here, or open a task and use ⋯ → 📂 Add to a project.'));
}
