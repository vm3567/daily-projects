// Test helpers: a browser-like localStorage and an in-memory "GitHub" with the same methods as GitHubRepo.
import { ClashError, NetworkError, AuthError } from '../docs/github.js';

/** localStorage stand-in: items are own properties (so Object.keys works like in browsers). */
class MemoryStorage {
  getItem(k) { return Object.prototype.hasOwnProperty.call(this, k) ? this[k] : null; }
  setItem(k, v) { this[k] = String(v); }
  removeItem(k) { delete this[k]; }
  clear() { for (const k of Object.keys(this)) delete this[k]; }
}

export function installStorage() {
  globalThis.localStorage = new MemoryStorage();
  return globalThis.localStorage;
}

/**
 * In-memory repository. Several MemRepo objects can share one `state` = several devices on one GitHub.
 * Set `.fail = 'net'` or `'auth'` to make the next calls fail like the real one would.
 */
export class MemRepo {
  constructor(state) {
    this.s = state || MemRepo.empty();
    this.fail = null;
  }

  static empty() {
    return { head: 'c0', commits: { c0: { tree: 't0' } }, trees: { t0: { 'README.md': 'b0' } }, blobs: { b0: '# data' }, n: 0 };
  }

  id(prefix) { this.s.n += 1; return prefix + this.s.n; }

  check() {
    if (this.fail === 'net') throw new NetworkError('No connection');
    if (this.fail === 'auth') throw new AuthError('GitHub key not accepted');
  }

  /** Put files straight in (like another device that saved earlier). */
  seed(files) {
    const tree = { ...this.s.trees[this.s.commits[this.s.head].tree] };
    for (const [path, content] of Object.entries(files)) {
      const b = this.id('b');
      this.s.blobs[b] = content;
      tree[path] = b;
    }
    const t = this.id('t');
    const c = this.id('c');
    this.s.trees[t] = tree;
    this.s.commits[c] = { tree: t, parent: this.s.head };
    this.s.head = c;
  }

  read(path) {
    const tree = this.s.trees[this.s.commits[this.s.head].tree];
    return tree[path] ? this.s.blobs[tree[path]] : null;
  }

  async headCommit() { this.check(); return this.s.head; }

  async snapshot() {
    this.check();
    const commit = this.s.head;
    const tree = this.s.commits[commit].tree;
    return { commit, tree, entries: new Map(Object.entries(this.s.trees[tree])) };
  }

  async blobText(sha) { this.check(); return this.s.blobs[sha]; }

  async blobBytes(sha) { this.check(); return new TextEncoder().encode(this.s.blobs[sha]); }

  async createBlobBase64(b64) {
    this.check();
    const b = this.id('b');
    this.s.blobs[b] = Buffer.from(b64, 'base64').toString();
    return b;
  }

  async commit(parentCommit, parentTree, changes) {
    this.check();
    const files = { ...this.s.trees[parentTree] };
    for (const c of changes) {
      if ('content' in c) { const b = this.id('b'); this.s.blobs[b] = c.content; files[c.path] = b; }
      else if (c.sha) files[c.path] = c.sha;
      else delete files[c.path];
    }
    if (this.s.head !== parentCommit) throw new ClashError('Branch moved');
    const t = this.id('t');
    const cm = this.id('c');
    this.s.trees[t] = files;
    this.s.commits[cm] = { tree: t, parent: parentCommit };
    this.s.head = cm;
    return { commit: cm, tree: t };
  }
}

/** Replace fetch for one test; returns the list of calls made. */
export function mockFetch(handler) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    return handler(String(url), opts, calls.length);
  };
  calls.restore = () => { globalThis.fetch = real; };
  return calls;
}

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
