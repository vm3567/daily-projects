// A pretend GitHub repository kept in this browser, for trying the app on this Mac
// without a real key (open http://localhost:8080/?mock=1). It has the same methods as
// GitHubRepo, including "another device saved first" clashes between browser tabs.

import { ClashError, base64ToBytes, bytesToBase64 } from './github.js';

const KEY = 'dp.mock';

function rid() {
  return Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => b.toString(16).padStart(2, '0')).join('');
}

export class MockRepo {
  read() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s) return s;
    } catch { /* fresh */ }
    const readme = rid();
    const tree = rid();
    const commit = rid();
    const s = {
      head: commit,
      blobs: { [readme]: bytesToBase64(new TextEncoder().encode('# Daily Projects data (mock)\n')) },
      trees: { [tree]: { 'README.md': readme } },
      commits: { [commit]: { tree, parent: null } },
    };
    this.write(s);
    return s;
  }

  write(s) { localStorage.setItem(KEY, JSON.stringify(s)); }

  async headCommit() { return this.read().head; }

  async snapshot(commitSha) {
    const s = this.read();
    const commit = commitSha || s.head;
    const tree = s.commits[commit].tree;
    return { commit, tree, entries: new Map(Object.entries(s.trees[tree])) };
  }

  async blobBytes(sha) { return base64ToBytes(this.read().blobs[sha]); }

  async blobText(sha) { return new TextDecoder().decode(await this.blobBytes(sha)); }

  async createBlobBase64(base64) {
    const s = this.read();
    const sha = rid();
    s.blobs[sha] = base64;
    this.write(s);
    return sha;
  }

  async commit(parentCommit, parentTree, changes) {
    await new Promise((r) => setTimeout(r, 150)); // feel like a network call
    const s = this.read();
    const files = { ...s.trees[parentTree] };
    for (const c of changes) {
      if ('content' in c) {
        const sha = rid();
        s.blobs[sha] = bytesToBase64(new TextEncoder().encode(c.content));
        files[c.path] = sha;
      } else if (c.sha) files[c.path] = c.sha;
      else delete files[c.path];
    }
    if (s.head !== parentCommit) throw new ClashError('Branch moved');
    const tree = rid();
    const commit = rid();
    s.trees[tree] = files;
    s.commits[commit] = { tree, parent: parentCommit };
    s.head = commit;
    this.write(s);
    return { commit, tree };
  }
}
