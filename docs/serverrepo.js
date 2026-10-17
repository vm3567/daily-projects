// Talks to the Work Task server (worktask.in) instead of GitHub. Same methods as GitHubRepo,
// so the rest of the app does not know the difference. Sign-in is the Work Task username and password.

import { AuthError, NetworkError, ClashError, GitHubError } from './github.js';

export const SERVER_TOKEN_KEY = 'wt.token'; // shared with the Work Task sign-in page on the same site

/** Text cut in the middle of an emoji leaves half a character, which the server cannot read: replace it. */
export function wellFormed(v) {
  if (typeof v === 'string') return v.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
  if (Array.isArray(v)) return v.map(wellFormed);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, wellFormed(x)]));
  return v;
}

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
        body: method === 'POST' ? JSON.stringify(wellFormed(body || {})) : undefined,
      });
    } catch {
      throw new NetworkError('No connection');
    }
    if (res.status === 401) {
      const out = await res.json().catch(() => null);
      throw new AuthError(out?.error || 'Please sign in again');
    }
    // 403 is never 'signed out': our server uses it for 'not allowed', and the host's firewall answers some saves
    // with its own page. Going to sign-in would come straight back and try the same save again, without end.
    if (res.status === 403) {
      const out = await res.json().catch(() => null);
      throw new GitHubError(out?.error || `The server refused this save (${res.status}). Remove any code-like text you just added.`, 403);
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
