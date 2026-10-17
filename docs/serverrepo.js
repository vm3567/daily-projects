// Talks to the Work Task server (worktask.in) instead of GitHub. Same methods as GitHubRepo,
// so the rest of the app does not know the difference. Sign-in is the Work Task username and password.

import { AuthError, NetworkError, ClashError, GitHubError } from './github.js';

export const SERVER_TOKEN_KEY = 'wt.token'; // shared with the Work Task sign-in page on the same site

export class ServerRepo {
  constructor(token, api = '../api/') {
    this.token = token;
    this.api = api;
  }

  async call(a, body, method = 'POST') {
    let res;
    try {
      res = await fetch(`${this.api}?a=${a}${method === 'GET' ? '&' + new URLSearchParams(body) : ''}`, {
        method,
        cache: 'no-store',
        headers: { Authorization: `Bearer ${this.token}`, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
        body: method === 'POST' ? JSON.stringify(body || {}) : undefined,
      });
    } catch {
      throw new NetworkError('No connection');
    }
    if (res.status === 401 || res.status === 403) {
      const out = await res.json().catch(() => null);
      throw new AuthError(out?.error || 'Please sign in again');
    }
    if (res.status === 409) throw new ClashError('Another device saved first');
    if (method === 'GET') {
      if (!res.ok) throw new GitHubError(`Server error ${res.status}`, res.status);
      return res;
    }
    const out = await res.json().catch(() => null);
    if (!res.ok || !out || !out.ok) throw new GitHubError(out?.error || `Server error ${res.status}`, res.status);
    return out;
  }

  async headCommit() { return (await this.call('dp.head')).head; }

  async snapshot(commitSha) {
    const s = await this.call('dp.snapshot', { commit: commitSha || '' });
    return { commit: s.commit, tree: s.tree, entries: new Map(Object.entries(s.entries)) };
  }

  async blobBytes(sha) {
    const res = await this.call('dp.blob', { sha }, 'GET');
    return new Uint8Array(await res.arrayBuffer());
  }

  async blobText(sha) { return new TextDecoder().decode(await this.blobBytes(sha)); }

  async createBlobBase64(base64) { return (await this.call('dp.blobPut', { base64 })).sha; }

  async commit(parentCommit, parentTree, changes, message) {
    const r = await this.call('dp.commit', { parent: parentCommit, changes, message });
    return { commit: r.commit, tree: r.tree };
  }
}
