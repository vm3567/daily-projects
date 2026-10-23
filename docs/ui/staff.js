// The staff view of the one app: a team member signs in on worktask.in and sees only their own Work Task tasks,
// in the same layout as the owner's Daily Projects (menu, list, page on the right).
// Everything goes through the Work Task server, which answers each person with their own tasks only.
// The owner's projects are never asked for here (dp.* is refused for anyone but the owner anyway).
// The rules (the day-by-day history, the update body, what stays in a box after Send) come from Work Task's
// logic.js, passed in as `rules`, so both apps follow the same rules.

import { h, morph, fmtDay as dayOf } from './dom.js';

// the server's times are India time as "2026-10-22 10:30:00" (as Work Task shows them)
const fmtDay = (d) => (d ? dayOf(String(d).slice(0, 10)) : '');
const fmtTime = (dt) => {
  const [hh, mm] = String(dt || '').slice(11, 16).split(':').map(Number);
  return Number.isFinite(hh) && Number.isFinite(mm) ? `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}` : '';
};
const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const STATES = [['progress', 'Working on it'], ['stuck', 'Stuck'], ['finished', 'Finished']];
const stateName = (s) => (STATES.find((x) => x[0] === s) || STATES[0])[1];
const stateTag = (s) => h('span', { class: 'tag ' + (s === 'stuck' ? 'red' : s === 'finished' ? 'green' : 'grey') }, stateName(s));
const newClientId = () => (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''));
const istDay = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
const nowHm = () => new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

/** The only server calls the staff view makes (a check in tests/screens.test.mjs holds it to this list). */
export const STAFF_CALLS = ['me', 'my.today', 'task.get', 'project.mine', 'update.save', 'photo.add', 'comment.add',
  'project.addStep', 'suggest', 'password', 'logout'];

/** Talks to the Work Task server with the person's own sign-in. Throws Error with the server's plain words. */
export function staffApi(token, base = '../api/') {
  return async (a, body = {}, form = false) => {
    if (!STAFF_CALLS.includes(a)) throw new Error('Not allowed here.');
    let res;
    try {
      res = await fetch(`${base}?a=${a}`, { method: 'POST', cache: 'no-store', headers: { Authorization: 'Bearer ' + token, ...(form ? {} : { 'Content-Type': 'application/json' }) }, body: form ? body : JSON.stringify(body) });
    } catch { throw Object.assign(new Error('No connection. Try again when the internet is back.'), { offline: true }); }
    const out = await res.json().catch(() => null);
    if (res.status === 401) throw Object.assign(new Error((out && out.error) || 'Please sign in again.'), { auth: true });
    if (!out || !out.ok) throw new Error((out && out.error) || 'Server busy, try again.');
    return out;
  };
}

/** "Every day", "By Mon 3 Nov · 2 days late", "Current step — send an update each day" … */
export function repeatLabel(t, today) {
  const by = t.dueDate ? (today && t.status === 'open' && t.dueDate < today ? ` · ⏰ late, was by ${fmtDay(t.dueDate)}` : ` · by ${fmtDay(t.dueDate)}`) : '';
  if (t.seq !== null && t.seq !== undefined && t.status === 'open') return (t.queued ? 'Coming next' : 'Current step — send an update each day') + by;
  if (today && t.startDate && t.startDate > today && t.status === 'open') return `Starts ${fmtDay(t.startDate)}`;
  if (t.repeat === 'daily') return t.skipSunday ? 'Every day (Mon–Sat)' : 'Every day';
  if (t.repeat === 'weekly') return `Every ${LONG_DAYS[t.weekday ?? 1]}`;
  if (!t.dueDate) return 'One time';
  const late = today && t.status === 'open' ? daysBetween(t.dueDate, today) : 0;
  return late > 0 ? `By ${fmtDay(t.dueDate)} · ${late} day${late > 1 ? 's' : ''} late` : `By ${fmtDay(t.dueDate)}`;
}

/** The projects given to me, each with its open steps in order (the current one first). */
export function myProjects(d) {
  if (!d) return [];
  const by = new Map();
  for (const t of [...(d.tasks || []), ...(d.other || [])]) {
    if (!t.projectRef || t.seq === null || t.seq === undefined || t.status !== 'open') continue;
    if (!by.has(t.projectRef)) by.set(t.projectRef, { ref: t.projectRef, name: t.project || 'Project', steps: [] });
    by.get(t.projectRef).steps.push(t);
  }
  return [...by.values()].map((pr) => {
    pr.steps.sort((a, b) => a.seq - b.seq || a.id - b.id);
    pr.real = pr.steps.filter((t) => !String(t.stepRef || '').endsWith(':whole')); // the "whole project" task while there are no steps
    pr.current = pr.steps.find((t) => !t.queued) || pr.steps[0];
    return pr;
  });
}

/**
 * The staff view. opts: { root, api, rules, user, toast, signOut, photo(kind, id) → Promise<url> }.
 * Returns { state, render, load, open, act } (act: the screen's actions, also used by the tests).
 */
export function createStaff(opts) {
  const { root, api, rules, toast = () => {}, signOut = () => {} } = opts;
  const photo = opts.photo || (() => Promise.reject(new Error('photo')));
  const state = {
    user: opts.user, data: null, loadFailed: '', section: 'today', sel: null, detail: null, detailFailed: '',
    menuOpen: false, mobile: 'list', drafts: {}, editing: {}, files: {}, sending: {}, msgDrafts: {}, stepDrafts: {}, diaryDays: 14,
  };
  const ids = { msg: {}, step: {} }; // the same clientId on a retry of the same words: the server keeps it once
  let detailSeq = 0;
  const today = () => (state.data && state.data.today) || istDay();

  async function load() {
    try { state.data = await api('my.today'); state.loadFailed = ''; } catch (e) { if (e.auth) { signOut(); return; } state.loadFailed = e.message; }
    render();
  }
  async function loadDetail() {
    const sel = state.sel, n = ++detailSeq;
    if (!sel || !(sel.startsWith('task:') || sel.startsWith('project:'))) return;
    let detail = null, failed = '';
    try {
      detail = sel.startsWith('task:') ? await api('task.get', { id: Number(sel.slice(5)) }) : await api('project.mine', { projectRef: sel.slice(8) });
    } catch (e) { failed = e.message; }
    if (n !== detailSeq || state.sel !== sel) return; // another page was opened meanwhile
    state.detail = detail; state.detailFailed = failed;
    render();
    if (detail && detail.task && detail.task.unread) load(); // opening it marked its messages read (task.get): the list's "New" goes
  }
  function open(sel) {
    state.sel = sel; state.detail = null; state.detailFailed = ''; state.mobile = 'detail'; state.menuOpen = false;
    render(); loadDetail();
  }
  function show(section) { state.section = section; state.sel = null; state.mobile = 'list'; state.menuOpen = false; render(); }
  function back() { state.sel = null; state.mobile = 'list'; render(); }
  function reload() { load(); if (state.sel) loadDetail(); }

  // ---------------------------------------------------------------- actions (each says what happened in plain words)

  async function sendUpdate(t) {
    const d = state.drafts[t.id] || { note: '', state: 'progress' };
    const files = state.files[t.id] || [];
    if (!d.note.trim()) return 'Write what you did first.';
    const hadPhoto = !!(t.today && t.today.photos && t.today.photos.length);
    if (d.state === 'finished' && t.needsPhoto && !hadPhoto && !files.length) return '📷 Add a photo to finish this task.';
    if (state.sending[t.id]) return '';
    state.sending[t.id] = true; render();
    // a photo needed to finish: save as "working", add the photos, then mark finished (as Work Task does)
    const twoSteps = d.state === 'finished' && t.needsPhoto && files.length && !hadPhoto;
    const cid = newClientId();
    const sentNote = d.note;
    try {
      const out = await api('update.save', rules.updateSaveBody({ taskId: t.id, note: sentNote, state: twoSteps ? 'progress' : d.state, clientId: cid }));
      for (let i = 0; i < files.length; i++) {
        const fd = new FormData();
        fd.append('updateId', String(out.update.id)); fd.append('file', files[i], 'photo.jpg'); fd.append('clientId', `${cid}-p${i}`);
        await api('photo.add', fd, true);
      }
      if (twoSteps) await api('update.save', rules.updateSaveBody({ taskId: t.id, note: out.update.note, clientId: cid, finish: true }));
      // words typed while it was sending stay in the box (the rule: logic.js)
      const left = rules.updateBoxLeft(d.note, sentNote);
      if (left) { state.drafts[t.id] = { note: left, state: d.state }; state.editing[t.id] = true; } else { delete state.drafts[t.id]; delete state.editing[t.id]; }
      delete state.files[t.id];
      toast('Sent ✓');
      return '';
    } catch (e) {
      if (e.auth) { signOut(); return ''; }
      return e.message; // the words stay in the box
    } finally {
      delete state.sending[t.id];
      reload();
    }
  }

  async function sendMessage(taskId) {
    const key = 'm' + taskId;
    const text = state.msgDrafts[taskId] || '';
    if (!text.trim()) return 'Write the message first.';
    if (state.sending[key]) return '';
    if (!ids.msg[taskId] || ids.msg[taskId].text !== text) ids.msg[taskId] = { id: newClientId(), text };
    state.sending[key] = true; render();
    try {
      const out = await api('comment.add', { taskId, text, clientId: ids.msg[taskId].id });
      delete ids.msg[taskId];
      const left = rules.msgBoxLeft(state.msgDrafts[taskId], text); // words typed meanwhile stay
      if (left) state.msgDrafts[taskId] = left; else delete state.msgDrafts[taskId];
      if (state.detail && state.detail.task && state.detail.task.id === taskId && out.comments) state.detail.comments = out.comments;
      toast('Sent ✓');
      return '';
    } catch (e) {
      if (e.auth) { signOut(); return ''; }
      return e.message;
    } finally { delete state.sending[key]; render(); }
  }

  async function addStep(ref) {
    const title = (state.stepDrafts[ref] || '').trim();
    if (!title) return 'Write the step first.';
    if (!ids.step[ref] || ids.step[ref].title !== title) ids.step[ref] = { id: newClientId(), title };
    try {
      await api('project.addStep', { projectRef: ref, title, clientId: ids.step[ref].id });
      delete ids.step[ref];
      const left = rules.msgBoxLeft((state.stepDrafts[ref] || '').trim(), title);
      if (left) state.stepDrafts[ref] = left; else delete state.stepDrafts[ref];
      toast('➕ Step added. Your manager sees it in the project too.');
      reload();
      return '';
    } catch (e) { if (e.auth) { signOut(); return ''; } return e.message; }
  }

  async function suggest(item) {
    if (!String(item.title || '').trim()) return 'Write the task first.';
    try {
      await api('suggest', item);
      toast('Sent for a yes ✓');
      state.sel = null; state.section = 'sugg'; state.mobile = 'list'; load();
      return '';
    } catch (e) { if (e.auth) { signOut(); return ''; } return e.message; }
  }

  async function changePassword(oldPw, newPw) {
    try { await api('password', { old: oldPw, new: newPw }); toast('Password changed ✓'); back(); return ''; } catch (e) { return e.message; }
  }

  const act = { sendUpdate, sendMessage, addStep, suggest, changePassword, open, show, back, reload };

  // ---------------------------------------------------------------- screens

  const item = (label, on, onClick, count) => h('li', null,
    h('button', { class: 'menu-item' + (on ? ' current' : ''), onClick }, h('span', null, label), count ? h('span', { class: 'count' }, String(count)) : null));

  function menu() {
    const d = state.data;
    const due = d ? d.tasks.filter((x) => !x.today).length : 0;
    const projs = myProjects(d);
    return h('nav', { class: 'menu-inner' },
      h('div', { class: 'brand' }, h('img', { src: 'icons/icon-192.png', alt: '', width: 28, height: 28 }), h('span', null, 'Work Task')),
      h('ul', { class: 'menu-list' },
        item('Today', !state.sel && state.section === 'today', () => show('today'), due || null),
        item('Coming next', !state.sel && state.section === 'next', () => show('next'), d && d.other.length ? d.other.length : null),
        item('My suggestions', !state.sel && state.section === 'sugg', () => show('sugg'), d && (d.suggestions || []).length ? d.suggestions.length : null),
        projs.length ? h('li', { class: 'menu-head' }, 'My projects') : null,
        projs.map((pr) => item(`📁 ${pr.name}`, state.sel === 'project:' + pr.ref, () => open('project:' + pr.ref), pr.real.length || null)),
        h('li', { class: 'menu-sep' }),
        item('💡 Suggest a task', state.sel === 'suggest', () => open('suggest')),
        item(`👤 ${state.user.name}`, state.sel === 'password', () => open('password')),
        item('Sign out', false, signOut)));
  }

  function row(t, sub, dot, warn = false) {
    return h('li', { key: 't-' + t.id, class: 'prow' + (state.sel === 'task:' + t.id ? ' current' : '') },
      h('span', { class: 'quick-tick-space', 'aria-hidden': 'true' }),
      h('button', { class: 'prow-btn', onClick: () => open('task:' + t.id) },
        h('span', { class: 'dot ' + dot, 'aria-label': dot }),
        h('span', { class: 'prow-text' },
          h('span', { class: 'prow-name' }, t.title, t.unread ? h('span', { class: 'tag high', title: `${t.unread} new message(s)` }, '💬 New') : null),
          h('span', { class: 'prow-next' + (warn ? ' warn' : '') }, sub))));
  }

  function projectRow(pr) {
    const now = pr.current ? `Now: ${pr.current.title}${pr.current.today ? ' · ✓ sent today' : ''}` : '';
    return h('li', { key: 'p-' + pr.ref, class: 'prow' + (state.sel === 'project:' + pr.ref ? ' current' : '') },
      h('span', { class: 'quick-tick-space', 'aria-hidden': 'true' }),
      h('button', { class: 'prow-btn', onClick: () => open('project:' + pr.ref) },
        h('span', { class: 'dot ' + (pr.current && pr.current.today ? 'green' : 'red') }),
        h('span', { class: 'prow-text' }, h('span', { class: 'prow-name' }, '📁 ', pr.name), h('span', { class: 'prow-next' }, now))));
  }

  const sec = (label, extra) => h('div', { class: 'list-sec' }, h('span', null, label), extra || null);

  function list() {
    const d = state.data;
    const title = { today: 'My tasks today', next: 'Coming next', sugg: 'My suggestions' }[state.section];
    const head = h('div', { class: 'list-head' },
      h('button', { class: 'icon menu-btn', 'aria-label': 'Menu', onClick: () => { state.menuOpen = true; render(); } }, '☰'),
      h('h2', null, title),
      h('button', { class: 'icon', title: 'Get latest', 'aria-label': 'Refresh', onClick: reload }, '↻'));
    if (!d) return h('div', { class: 'col-inner' }, head, h('p', { class: 'empty-list' }, state.loadFailed ? [state.loadFailed, ' ', h('button', { class: 'link', onClick: reload }, 'Try again')] : 'Loading…'));
    const td = d.today;
    let body;
    if (state.section === 'next') {
      body = [sec(`${d.other.length} coming next`), h('ul', { class: 'list-body' }, d.other.map((t) => row(t, [t.project, repeatLabel(t, td)].filter(Boolean).join(' · '), 'grey'))),
        d.other.length ? null : h('p', { class: 'empty-list' }, 'Nothing coming next.')];
    } else if (state.section === 'sugg') {
      const s = d.suggestions || [];
      body = [sec(`${s.length} suggestion${s.length === 1 ? '' : 's'}`),
        h('ul', { class: 'list-body' }, s.map((t) => row(t, t.status === 'suggested' ? 'Waiting for a yes' : 'Not now' + (t.lastMessage ? ` — ${t.lastMessage.text}` : ''), t.status === 'suggested' ? 'yellow' : 'grey'))),
        s.length ? null : h('p', { class: 'empty-list' }, 'No suggestions yet. Tap 💡 Suggest a task in the menu.')];
    } else {
      const sent = d.tasks.filter((t) => t.today).length;
      const projs = myProjects(d);
      body = [
        projs.length ? [sec('📁 My projects'), h('ul', { class: 'list-body' }, projs.map(projectRow))] : null,
        sec(`${fmtDay(td)} · ${sent} of ${d.tasks.length} sent`, h('span', { class: 'tag' }, `by ${d.fillBy}`)),
        h('ul', { class: 'list-body' }, d.tasks.map((t) => {
          const late = t.repeat === 'once' && t.dueDate && t.dueDate < td;
          const sub = t.today ? `✓ Sent ${fmtTime(t.today.at)}${t.today.state === 'stuck' ? ' · stuck' : t.today.state === 'finished' ? ' · finished' : ''}`
            : [t.project, repeatLabel(t, td)].filter(Boolean).join(' · ') || 'Send today\'s update';
          // the same dots as the owner's Today: green = sent today, red = not yet (late or not)
          return row(t, sub, t.today ? 'green' : 'red', late && !t.today);
        })),
        d.tasks.length ? null : h('p', { class: 'empty-list' }, 'No tasks for today. 🎉'),
      ];
    }
    return h('div', { class: 'col-inner' }, head, body);
  }

  function chips(t, td) {
    const c = (text, cls = '') => h('span', { class: 'info-chip static' + cls }, text);
    const late = t.status === 'open' && t.dueDate && t.dueDate < td;
    return h('div', { class: 'info-chips' },
      t.project ? c(`📁 ${t.project}`) : null,
      c(repeatLabel({ ...t, dueDate: null }, td)),
      t.dueDate ? c(late ? `⏰ Late — was by ${fmtDay(t.dueDate)}` : `By ${fmtDay(t.dueDate)}`, late ? ' bad' : '') : null,
      t.needsPhoto ? c('📷 Photo to finish') : null,
      t.status === 'done' ? c('✓ Done', ' good') : t.status === 'cancelled' ? c('Cancelled', ' bad') : t.status === 'suggested' ? c('💡 Suggestion') : t.today ? c('✓ Sent today', ' good') : null);
  }

  function photos(kind, list) {
    if (!list || !list.length) return null;
    return h('div', { class: 'thumbs' }, list.map((id) => {
      const img = h('img', { alt: 'Photo', class: 'diary-photo' });
      photo(kind, id).then((u) => { img.src = u; }, () => { img.alt = 'Photo missing'; });
      return img;
    }));
  }

  function updateCard(t) {
    const done = t.today && !state.editing[t.id];
    if (t.status !== 'open' && !t.today) return null;
    if (done) {
      const u = t.today;
      return h('div', { class: 'card sent' }, h('div', { class: 'row spread small' }, h('strong', null, "Today's update"), h('span', { class: 'ok' }, `Sent ${fmtTime(u.at)}`)),
        h('div', { class: 'row small' }, stateTag(u.state)), h('div', { class: 'pre' }, u.note), photos('photo', u.photos),
        h('div', { class: 'row' }, h('button', { class: 'btn', onClick: () => { state.editing[t.id] = true; state.drafts[t.id] = { note: u.note, state: u.state }; render(); } }, '✎ Edit')));
    }
    const d = (state.drafts[t.id] ||= { note: '', state: 'progress' });
    const files = state.files[t.id] || [];
    const err = h('p', { class: 'err small', key: 'err-' + t.id, hidden: true });
    const say = (m) => { if (m) { err.textContent = m; err.hidden = false; } };
    const pick = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'hidden-file', onChange: (e, el) => { state.files[t.id] = [...files, ...el.files].slice(0, 5); el.value = ''; render(); } });
    return h('div', { class: 'card' }, h('div', { class: 'row spread small' }, h('strong', null, "Today's update")),
      h('textarea', { key: 'up-' + t.id, placeholder: 'What did you do today? (you can tap 🎤 on the keyboard to speak)', value: d.note, onInput: (e, el) => { d.note = el.value; err.hidden = true; } }),
      h('div', { class: 'row', role: 'group', 'aria-label': 'How is it going' }, STATES.map(([k, label]) =>
        h('button', { class: 'chip' + (d.state === k ? ' on ' + k : ''), type: 'button', onClick: () => { d.state = k; render(); } }, label))),
      files.length ? h('p', { class: 'small muted' }, `📷 ${files.length} photo${files.length === 1 ? '' : 's'} ready `, h('button', { class: 'link', onClick: () => { delete state.files[t.id]; render(); } }, 'Remove')) : null,
      err,
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', disabled: state.sending[t.id] ? true : undefined, onClick: () => sendUpdate(t).then(say) }, state.sending[t.id] ? 'Sending…' : 'Send'),
        files.length < 5 ? h('label', { class: 'btn' }, '📷 Add photo', pick) : null,
        state.editing[t.id] ? h('button', { class: 'btn', onClick: () => { delete state.editing[t.id]; delete state.drafts[t.id]; render(); } }, 'Cancel') : null));
  }

  function messages(taskId, comments) {
    const key = 'm' + taskId;
    const err = h('p', { class: 'err small', key: 'merr-' + taskId, hidden: true });
    return [
      h('h3', { class: 'part-title' }, '💬 Messages'),
      comments.length ? comments.map((c) => h('div', { class: 'card msg' + (c.mine ? ' mine' : ''), key: 'c-' + c.id },
        h('div', { class: 'row small' }, h('strong', null, c.mine ? 'You' : c.by), h('span', { class: 'muted' }, `${fmtDay(c.at)} ${fmtTime(c.at)}${c.editedAt ? ' · edited' : ''}`)),
        c.photo ? photos('comment.photo', [c.id]) : null,
        c.text ? h('div', { class: 'pre' }, c.text) : null)) : h('p', { class: 'muted small' }, 'No messages yet.'),
      h('div', { class: 'card stack' },
        h('textarea', { key: 'msg-' + taskId, placeholder: 'Ask or reply to your manager…', value: state.msgDrafts[taskId] || '', onInput: (e, el) => { state.msgDrafts[taskId] = el.value; err.hidden = true; } }),
        err,
        h('div', { class: 'row' }, h('button', { class: 'btn primary', disabled: state.sending[key] ? true : undefined,
          onClick: () => sendMessage(taskId).then((m) => { if (m) { err.textContent = m; err.hidden = false; } }) }, 'Send message'))),
    ];
  }

  function diary(t, updates, td) {
    const n = state.diaryDays;
    const { rows, more } = rules.diaryRows(t, updates, td, { staff: true, n, fillBy: (state.data && state.data.fillBy) || '18:00', nowHm: nowHm() });
    return [
      h('h3', { class: 'part-title' }, '📅 Earlier days'),
      rows.length ? h('ul', { class: 'diary-days' }, rows.map(({ day, kind, ups }) => h('li', { class: 'diary-day', key: 'd-' + day },
        h('div', { class: 'diary-date' }, day === td ? 'Today' : LONG_DAYS[new Date(day + 'T00:00:00Z').getUTCDay()], h('div', { class: 'muted small' }, fmtDay(day))),
        h('div', { class: 'diary-items' }, kind === 'ups' ? ups.map((u) => h('div', { class: 'diary-line' },
          h('span', { class: 'diary-icon' }, u.state === 'stuck' ? '⚠️' : u.state === 'finished' ? '✅' : '📝'),
          h('div', { class: 'diary-text' }, h('strong', null, (u.byId === state.user.id ? 'You' : u.by) + ' '), u.state !== 'progress' ? [stateTag(u.state), ' '] : null, u.note, photos('photo', u.photos)),
          h('span', { class: 'muted small' }, fmtTime(u.at))))
          : kind === 'off' ? h('span', { class: 'muted' }, 'Off')
            : kind === 'wait' ? h('span', { class: 'diary-none wait' }, 'Waiting for today\'s update')
              : h('span', { class: 'diary-none' }, 'No progress'))))) : h('p', { class: 'muted small' }, 'Nothing yet.'),
      more ? h('button', { class: 'link small', onClick: () => { state.diaryDays = n + 14; render(); } }, 'Show older days') : null,
    ];
  }

  function taskPage() {
    const { task: t, updates = [], comments = [] } = state.detail;
    const td = today();
    return [
      chips(t, td),
      t.details ? h('div', { class: 'task-details pre' }, t.details) : null,
      t.files && t.files.length ? h('p', { class: 'small muted' }, `📎 ${t.files.length} instruction file${t.files.length === 1 ? '' : 's'} — open them in Work Task for now.`) : null,
      updateCard(t),
      messages(t.id, comments),
      t.status === 'suggested' || (t.status !== 'open' && !updates.length) ? null : diary(t, updates, td),
    ];
  }

  function projectPage() {
    const pr = myProjects(state.data).find((x) => x.ref === state.sel.slice(8));
    const done = ((state.detail && state.detail.tasks) || []).filter((t) => t.status === 'done' && !String(t.stepRef || '').endsWith(':whole'));
    const k = done.length;
    const sentSub = (t) => (t.today ? `✓ Sent ${fmtTime(t.today.at)}` : 'Send today\'s update');
    const err = h('p', { class: 'err small', key: 'serr', hidden: true });
    const ref = state.sel.slice(8);
    return [
      done.length ? [sec(`✓ ${done.length} done`), h('ul', { class: 'list-body' }, done.map((t, i) => row(t, `Step ${i + 1} · done ${t.doneAt ? fmtDay(t.doneAt) : ''}`, 'green')))] : null,
      !pr ? h('p', { class: 'muted' }, done.length ? 'All your steps are done ✓. Your manager decides what comes next.' : 'This project is not on your list any more.')
        : [h('p', { class: 'muted' }, pr.real.length ? 'Do the steps in order. Every day, open the current step and send what you did. Found more work? Add a step below.'
          : 'No steps yet. Add the steps you will do, in order. Until then, send your daily update on the whole project.'),
        h('ul', { class: 'list-body' }, (pr.real.length ? pr.real : pr.steps).map((t, i) => row(t,
          !pr.real.length ? sentSub(t) : t === pr.current ? `Step ${k + i + 1} · current · ${sentSub(t)}` : `Step ${k + i + 1} · next${t.fromStaff ? ' · added by you' : ''}`,
          t === pr.current || !pr.real.length ? (t.today ? 'green' : 'red') : 'grey'))),
        h('div', { class: 'card stack' },
          h('label', null, 'Add a step', h('input', { key: 'step-' + ref, placeholder: 'e.g. Order the spare servo motor', maxlength: '300', value: state.stepDrafts[ref] || '', onInput: (e, el) => { state.stepDrafts[ref] = el.value; } })),
          err,
          h('button', { class: 'btn primary', onClick: () => addStep(ref).then((m) => { if (m) { err.textContent = m; err.hidden = false; } }) }, '+ Add step'))],
    ];
  }

  function suggestPage() {
    const f = (state.suggestForm ||= { title: '', details: '', repeat: 'once', clientId: newClientId() }); // one id per form: a retry is kept once
    const err = h('p', { class: 'err small', key: 'sgerr', hidden: true });
    return [
      h('p', { class: 'muted' }, 'Your manager says yes or no. If yes, it comes on your list.'),
      h('div', { class: 'card stack' },
        h('label', null, 'Task', h('input', { key: 'sg-title', placeholder: 'Clean the dryer filters every week', value: f.title, onInput: (e, el) => { f.title = el.value; } })),
        h('label', null, 'Details', h('textarea', { key: 'sg-details', placeholder: 'Why it is needed (optional)', value: f.details, onInput: (e, el) => { f.details = el.value; } })),
        h('label', null, 'How often', h('select', { key: 'sg-repeat', value: f.repeat, onChange: (e, el) => { f.repeat = el.value; } },
          h('option', { value: 'once' }, 'One time'), h('option', { value: 'daily' }, 'Every day'), h('option', { value: 'weekly' }, 'Once a week'))),
        err,
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onClick: () => suggest({ ...f }).then((m) => { if (m) { err.textContent = m; err.hidden = false; } else state.suggestForm = null; }) }, 'Send to my manager'),
          h('button', { class: 'btn', onClick: () => { state.suggestForm = null; back(); } }, 'Cancel'))),
    ];
  }

  function passwordPage() {
    const f = (state.pwForm ||= { old: '', nw: '' });
    const err = h('p', { class: 'err small', key: 'pwerr', hidden: true });
    return h('div', { class: 'card stack' },
      h('label', null, 'Current password', h('input', { key: 'pw-old', type: 'password', autocomplete: 'current-password', value: f.old, onInput: (e, el) => { f.old = el.value; } })),
      h('label', null, 'New password (8 letters or more)', h('input', { key: 'pw-new', type: 'password', autocomplete: 'new-password', value: f.nw, onInput: (e, el) => { f.nw = el.value; } })),
      err,
      h('button', { class: 'btn primary', onClick: () => changePassword(f.old, f.nw).then((m) => { if (m) { err.textContent = m; err.hidden = false; } else state.pwForm = null; }) }, 'Change password'));
  }

  function detail() {
    const sel = state.sel;
    if (!sel) return h('div', { class: 'empty' }, h('p', null, 'Pick a task on the left.'));
    let title = '', body;
    if (sel === 'suggest') { title = '💡 Suggest a task'; body = suggestPage(); }
    else if (sel === 'password') { title = 'Change password'; body = passwordPage(); }
    else if (!state.detail) body = h('p', { class: 'muted' }, state.detailFailed ? [state.detailFailed, ' ', h('button', { class: 'link', onClick: loadDetail }, 'Try again')] : 'Loading…');
    else if (sel.startsWith('task:')) { title = state.detail.task.title; body = taskPage(); }
    else { const pr = myProjects(state.data).find((x) => x.ref === sel.slice(8)); title = '📁 ' + (pr ? pr.name : 'Project'); body = projectPage(); }
    return h('div', { class: 'detail-inner', key: 'detail-' + sel },
      h('div', { class: 'detail-top' }, h('button', { class: 'icon back', 'aria-label': 'Back', onClick: back }, '←'), h('h2', { class: 'detail-title' }, title)),
      body);
  }

  function view() {
    return h('div', { class: ['layout', 'staff', state.mobile === 'detail' ? 'show-detail' : '', state.menuOpen ? 'menu-open' : ''].join(' ').trim() },
      h('aside', { id: 'menu' }, menu()),
      h('div', { class: 'scrim', onClick: () => { state.menuOpen = false; render(); } }),
      h('main', { id: 'list' }, list()),
      h('section', { id: 'detail' }, detail()));
  }

  function render() {
    if (!root) return;
    const next = view();
    if (root.firstChild && root.firstChild.classList && root.firstChild.classList.contains('layout')) morph(root.firstChild, next);
    else root.replaceChildren(next);
  }

  return { state, render, load, open, act, view };
}
