// The app's data store: loads from GitHub, keeps a queue of pending operations,
// and saves them with replay on clash. See PLAN.md section 25.

import { applyOp, applyOps, emptyData, makeOp, opMonth, commitMessage, clone } from './ops.js';
import { todayIndia, monthOf } from './rules.js';
import { AuthError, NetworkError, ClashError } from './github.js';
import { SAVE_DELAY_MS } from './config.js';

const PENDING_KEY = 'dp.pending';
const DATA_PATH = 'data.json';
const historyPath = (m) => `history/${m}.json`;

function readPending() {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); } catch { return []; }
}

function filesOf(data) {
  const map = new Map();
  for (const p of data.projects) for (const f of p.files) if (f.sha) map.set(f.path, f.sha);
  return map;
}

export class Store extends EventTarget {
  constructor(repo) {
    super();
    this.repo = repo;
    this.base = null; // { data, history, commit, tree, entries }
    this.view = null; // { data, history } = base + pending
    this.pending = readPending();
    this.status = 'loading';
    this.message = '';
    this.saving = false;
    this.saveTimer = null;
  }

  // ---------- events ----------
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  setStatus(status, message = '') {
    this.status = status;
    this.message = message;
    this.emit('status', { status, message });
  }

  handleError(e) {
    if (e instanceof AuthError) this.setStatus('auth', e.message);
    else if (e instanceof NetworkError) this.setStatus('offline', 'No connection');
    else this.setStatus('error', e.message || String(e));
  }

  persistPending() {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(this.pending)); } catch { /* storage full or blocked */ }
  }

  // ---------- loading ----------
  async readMonth(entries, month) {
    const sha = entries.get(historyPath(month));
    if (!sha) return [];
    if (sha === 'local') return null; // written by us, kept in memory
    return JSON.parse(await this.repo.blobText(sha));
  }

  async ensureMonths(target, months) {
    for (const m of months) {
      if (target.history[m]) continue;
      const list = await this.readMonth(target.entries, m);
      target.history[m] = list || [];
    }
  }

  /** Load the latest data from GitHub. Keeps the history months already loaded. */
  async load() {
    const keepMonths = new Set(this.base ? Object.keys(this.base.history) : []);
    keepMonths.add(monthOf(todayIndia()));
    for (const op of this.pending) keepMonths.add(opMonth(op));

    const snap = await this.repo.snapshot();
    const dataSha = snap.entries.get(DATA_PATH);
    const data = dataSha ? JSON.parse(await this.repo.blobText(dataSha)) : emptyData();
    const base = { data, history: {}, commit: snap.commit, tree: snap.tree, entries: snap.entries };
    await this.ensureMonths(base, keepMonths);
    this.base = base;
    this.recompute();
    if (this.status === 'loading' || this.status === 'offline' || this.status === 'auth') this.setStatus('saved');
    this.emit('change', { reason: 'load' });
  }

  recompute() {
    const view = { data: clone(this.base.data), history: clone(this.base.history) };
    applyOps(view, this.pending);
    this.view = view;
  }

  /** Months with a history file on GitHub (newest first), plus any loaded. */
  availableMonths() {
    const set = new Set(Object.keys(this.view.history));
    for (const path of this.base.entries.keys()) {
      const m = /^history\/(\d{4}-\d{2})\.json$/.exec(path);
      if (m) set.add(m[1]);
    }
    return [...set].sort().reverse();
  }

  async loadMonth(month) {
    await this.ensureMonths(this.base, [month]);
    this.recompute();
    this.emit('change', { reason: 'history' });
  }

  async loadAllHistory() {
    await this.ensureMonths(this.base, this.availableMonths());
    this.recompute();
  }

  // ---------- changes ----------
  canEdit() {
    return this.base && this.status !== 'offline' && this.status !== 'auth' && this.status !== 'loading'
      && (typeof navigator === 'undefined' || navigator.onLine !== false);
  }

  /** Record one change. Returns the operation, or null if editing is blocked. */
  dispatch(type, args) {
    if (!this.canEdit()) {
      this.emit('blocked', { status: this.status });
      return null;
    }
    const op = makeOp(type, args);
    const ok = applyOp(this.view, op);
    if (!ok) return null; // nothing changed
    this.pending.push(op);
    this.persistPending();
    this.emit('change', { reason: 'edit', op });
    this.scheduleSave();
    return op;
  }

  scheduleSave(delay = SAVE_DELAY_MS) {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), delay);
  }

  /** Save now (used before AI briefs and by "↻"). */
  async flush() {
    clearTimeout(this.saveTimer);
    await this.save();
    // If a save was already running, wait for it, then save anything left.
    while (this.saving) await new Promise((r) => setTimeout(r, 200));
    if (this.pending.length && this.status !== 'error') await this.save();
  }

  diff(base, next) {
    const changes = [];
    if (JSON.stringify(base.data) !== JSON.stringify(next.data)) {
      changes.push({ path: DATA_PATH, content: JSON.stringify(next.data, null, 1) + '\n' });
    }
    for (const [m, list] of Object.entries(next.history)) {
      if (JSON.stringify(base.history[m] || []) !== JSON.stringify(list)) {
        changes.push({ path: historyPath(m), content: JSON.stringify(list, null, 1) + '\n' });
      }
    }
    const before = filesOf(base.data);
    const after = filesOf(next.data);
    for (const [path, sha] of after) if (!before.has(path)) changes.push({ path, sha });
    for (const path of before.keys()) if (!after.has(path)) changes.push({ path, sha: null });
    return changes;
  }

  async save() {
    if (this.saving || !this.pending.length || !this.base) return;
    this.saving = true;
    this.setStatus('saving');
    const ops = this.pending.slice();
    try {
      let done = false;
      for (let attempt = 0; attempt < 3 && !done; attempt++) {
        try {
          await this.ensureMonths(this.base, new Set(ops.map(opMonth)));
          const next = { data: clone(this.base.data), history: clone(this.base.history) };
          const applied = applyOps(next, ops);
          const changes = this.diff(this.base, next);
          if (changes.length) {
            const r = await this.repo.commit(this.base.commit, this.base.tree, changes,
              commitMessage(applied.length ? applied : ops, next.data));
            const entries = new Map(this.base.entries);
            for (const c of changes) {
              if ('content' in c) entries.set(c.path, 'local');
              else if (c.sha) entries.set(c.path, c.sha);
              else entries.delete(c.path);
            }
            this.base = { ...next, commit: r.commit, tree: r.tree, entries };
          }
          done = true;
        } catch (e) {
          if (!(e instanceof ClashError)) throw e;
          await this.load(); // another device saved first: get its data, then replay
        }
      }
      if (!done) {
        this.setStatus('error', 'Could not save — tap ↻');
        return;
      }
      const sent = new Set(ops.map((o) => o.id));
      this.pending = this.pending.filter((o) => !sent.has(o.id));
      this.persistPending();
      this.recompute();
      this.setStatus(this.pending.length ? 'saving' : 'saved');
      this.emit('change', { reason: 'saved' });
    } catch (e) {
      this.handleError(e);
    } finally {
      this.saving = false;
      if (this.pending.length && this.status === 'saving') this.scheduleSave(300);
    }
  }

  /** Get the latest data if another device saved. Skipped while changes are waiting. */
  async refresh(force = false) {
    if (!this.base) return this.init();
    if (this.pending.length) {
      if (force) await this.flush();
      return;
    }
    if (this.saving) return;
    try {
      const head = await this.repo.headCommit();
      if (head !== this.base.commit) await this.load();
      if (this.status !== 'saved') this.setStatus('saved');
    } catch (e) {
      this.handleError(e);
    }
  }

  async init() {
    try {
      await this.load();
      if (this.pending.length) this.scheduleSave(100);
    } catch (e) {
      this.handleError(e);
    }
  }

  forgetPending() {
    this.pending = [];
    this.persistPending();
  }
}
