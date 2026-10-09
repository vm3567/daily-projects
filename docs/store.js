// The app's data store: loads from GitHub, keeps a queue of pending operations,
// and saves them with replay on clash.

import { applyOp, applyOps, emptyData, makeOp, opMonth, commitMessage, clone } from './ops.js';

/** History months an operation touches (its own, plus the month of a change it undoes). */
const monthsOfOp = (op) => [opMonth(op), op.args && op.args.undoMonth].filter(Boolean);
import { todayIndia, monthOf } from './rules.js';
import { AuthError, NetworkError, ClashError } from './github.js';
import { SAVE_DELAY_MS } from './config.js';

const PENDING_KEY = 'dp.pending';
const SNAPSHOT_KEY = 'dp.snapshot'; // last data seen from GitHub, so the app can open without internet
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
    this.sentIds = new Set(); // ops this tab has saved (so they are never put back in the shared queue)
    // Another tab (or the home-screen app) changed the waiting list: take its version, so neither tab wipes the other's changes.
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('storage', (e) => {
        if (e.key !== PENDING_KEY || !this.base) return;
        this.pending = readPending().filter((o) => !this.sentIds.has(o.id));
        this.recompute();
        this.emit('change', { reason: 'other-tab' });
        if (this.pending.length && !this.saving) this.scheduleSave();
      });
    }
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

  /** Write the waiting list, MERGED with what other tabs have stored (one shared queue on this device). */
  persistPending() {
    try {
      const mine = new Set(this.pending.map((o) => o.id));
      const others = readPending().filter((o) => !mine.has(o.id) && !this.sentIds.has(o.id));
      const all = [...others, ...this.pending].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
      localStorage.setItem(PENDING_KEY, JSON.stringify(all));
    } catch { /* storage full or blocked */ }
  }

  // ---------- loading ----------
  async readMonth(entries, month) {
    const sha = entries.get(historyPath(month));
    if (!sha) return [];
    if (sha === 'local') return null; // written by us, kept in memory
    // A month file that did not change (same sha) is never downloaded twice.
    if (!this.monthCache) this.monthCache = new Map();
    if (!this.monthCache.has(sha)) this.monthCache.set(sha, await this.repo.blobText(sha));
    return JSON.parse(this.monthCache.get(sha));
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
    for (const op of this.pending) for (const m of monthsOfOp(op)) keepMonths.add(m);

    const snap = await this.repo.snapshot();
    const dataSha = snap.entries.get(DATA_PATH);
    const data = dataSha ? JSON.parse(await this.repo.blobText(dataSha)) : emptyData();
    const base = { data, history: {}, commit: snap.commit, tree: snap.tree, entries: snap.entries };
    await this.ensureMonths(base, keepMonths);
    this.base = base;
    this.recompute();
    this.saveSnapshot();
    if (['loading', 'checking', 'offline', 'auth', 'error'].includes(this.status) && !this.saving) this.setStatus(this.pending.length ? 'saving' : 'saved');
    this.emit('change', { reason: 'load' });
  }

  /** Keep the latest data (and this month's history) on the device for opening without internet. */
  saveSnapshot() {
    if (!this.base) return;
    try {
      const month = monthOf(todayIndia());
      // this month, plus any month only saved from this device ('local' = not downloadable by sha yet)
      const history = { [month]: this.base.history[month] || [] };
      for (const [path, sha] of this.base.entries) {
        const m = /^history\/(\d{4}-\d{2})\.json$/.exec(path);
        if (m && sha === 'local' && this.base.history[m[1]]) history[m[1]] = this.base.history[m[1]];
      }
      const snap = {
        at: new Date().toISOString(), data: this.base.data, history,
        commit: this.base.commit, tree: this.base.tree, entries: [...this.base.entries],
      };
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
    } catch { /* storage full: the app still works online */ }
  }

  /**
   * Open from the copy on this device. Returns true if there was one.
   * quiet = at start-up, while the newest data is still coming ("checking"); else = no internet ("offline").
   */
  openSnapshot(quiet = false) {
    let snap = null;
    try { snap = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || 'null'); } catch { snap = null; }
    if (!snap || !snap.data) return false;
    this.base = { data: snap.data, history: snap.history || {}, commit: snap.commit, tree: snap.tree, entries: new Map(snap.entries || []) };
    this.snapshotAt = snap.at;
    this.recompute();
    this.setStatus(quiet ? 'checking' : 'offline', quiet ? '' : 'No connection');
    this.emit('change', { reason: 'snapshot' });
    return true;
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
    // if a save or refresh swapped `base` while downloading, load into the new one too (cached, so free)
    let b;
    do { b = this.base; await this.ensureMonths(b, [month]); } while (this.base !== b);
    this.recompute();
    this.emit('change', { reason: 'history' });
  }

  async loadAllHistory() {
    let b;
    do { b = this.base; await this.ensureMonths(b, this.availableMonths()); } while (this.base !== b);
    this.recompute();
  }

  // ---------- changes ----------
  /**
   * Changes are accepted even with no connection: they wait in the queue on this device (kept in
   * localStorage) and are sent when the connection is back. Only a broken GitHub key or the very
   * first load blocks editing.
   */
  canEdit() {
    return !!this.base && this.status !== 'auth' && this.status !== 'loading';
  }

  /** True when the device is (or was just) without internet. */
  isOffline() {
    return this.status === 'offline' || (typeof navigator !== 'undefined' && navigator.onLine === false);
  }

  /** Record one change. Returns the operation, or null if editing is blocked. */
  dispatch(type, args) {
    if (!this.canEdit()) {
      this.emit('blocked', { status: this.status });
      return null;
    }
    const op = makeOp(type, args);
    const ok = applyOp(this.view, op);
    if (!ok) { this.emit('change', { reason: 'noop' }); return null; } // redraw so controls show the real data
    this.pending.push(op);
    this.persistPending();
    this.emit('change', { reason: 'edit', op });
    this.scheduleSave();
    return op;
  }

  scheduleSave(delay = SAVE_DELAY_MS) {
    clearTimeout(this.saveTimer);
    if (this.status === 'checking') return; // still getting the newest data: init() saves right after
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
      changes.push({ path: DATA_PATH, content: JSON.stringify(next.data) + '\n' }); // compact: smaller and faster
    }
    for (const [m, list] of Object.entries(next.history)) {
      if (JSON.stringify(base.history[m] || []) !== JSON.stringify(list)) {
        changes.push({ path: historyPath(m), content: JSON.stringify(list) + '\n' });
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
          await this.ensureMonths(this.base, new Set(ops.flatMap(monthsOfOp)));
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
            this.saveSnapshot();
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
      for (const id of sent) this.sentIds.add(id);
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
      // Waiting changes: try again if the last save failed (or when ↻ is tapped).
      if (force || ((this.status === 'offline' || this.status === 'error') && !this.saving)) {
        if (this.status === 'offline') this.setStatus('saving');
        await this.flush();
      }
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
    // Show the copy kept on this device at once (no "Loading…" wait); the newest data replaces it a moment later.
    if (!this.base) this.openSnapshot(true);
    try {
      await this.load();
      if (this.pending.length) this.scheduleSave(100);
    } catch (e) {
      // No internet at start: open with the copy kept on this device; it syncs when the internet is back.
      if (e instanceof NetworkError && !this.base && this.openSnapshot()) return;
      this.handleError(e);
    }
  }

  forgetPending() {
    this.pending = [];
    this.persistPending();
  }
}
