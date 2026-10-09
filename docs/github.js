// Talks to the private data repository through the GitHub REST API (Git Data API).
// See PLAN.md section 25 "Loading" and "Saving".

const API = 'https://api.github.com';

export class AuthError extends Error {}
export class NetworkError extends Error {}
export class ClashError extends Error {}
export class GitHubError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export function bytesToBase64(bytes) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

export function base64ToBytes(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class GitHubRepo {
  constructor(token, owner, repo, branch = 'main') {
    this.token = token;
    this.base = `${API}/repos/${owner}/${repo}`;
    this.branch = branch;
  }

  async request(method, path, body, accept = 'application/vnd.github+json') {
    let res;
    try {
      res = await fetch(this.base + path, {
        method,
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: accept,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new NetworkError('No connection');
    }
    if (res.status === 401) throw new AuthError('GitHub key not accepted');
    if (res.status === 403 || res.status === 404) {
      const text = await res.text().catch(() => '');
      // A fine-grained key without access to this repository gives 403/404.
      if (/rate limit/i.test(text)) throw new GitHubError('GitHub rate limit reached. Try again in a few minutes.', res.status);
      throw new AuthError('This key cannot open the data repository');
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new GitHubError(`GitHub error ${res.status}: ${text.slice(0, 200)}`, res.status);
    }
    return res;
  }

  async json(method, path, body) {
    const res = await this.request(method, path, body);
    return res.json();
  }

  /** Latest commit sha of the branch. */
  async headCommit() {
    const ref = await this.json('GET', `/git/ref/heads/${this.branch}`);
    return ref.object.sha;
  }

  /** { commit, tree, entries: Map(path -> sha) } */
  async snapshot(commitSha) {
    const commit = commitSha || (await this.headCommit());
    const c = await this.json('GET', `/git/commits/${commit}`);
    const t = await this.json('GET', `/git/trees/${c.tree.sha}?recursive=1`);
    const entries = new Map();
    for (const e of t.tree) if (e.type === 'blob') entries.set(e.path, e.sha);
    return { commit, tree: c.tree.sha, entries };
  }

  async blobBytes(sha) {
    const res = await this.request('GET', `/git/blobs/${sha}`, null, 'application/vnd.github.raw');
    return new Uint8Array(await res.arrayBuffer());
  }

  async blobText(sha) {
    return new TextDecoder().decode(await this.blobBytes(sha));
  }

  async createBlobBase64(base64) {
    const r = await this.json('POST', '/git/blobs', { content: base64, encoding: 'base64' });
    return r.sha;
  }

  /**
   * Make one commit on top of `parent`.
   * changes: [{ path, content }] text files, [{ path, sha }] existing blobs, [{ path, sha: null }] deletions.
   * Returns { commit, tree }. Throws ClashError if the branch moved (another device saved first).
   */
  async commit(parentCommit, parentTree, changes, message) {
    const tree = changes.map((c) => (
      'content' in c
        ? { path: c.path, mode: '100644', type: 'blob', content: c.content }
        : { path: c.path, mode: '100644', type: 'blob', sha: c.sha }
    ));
    const t = await this.json('POST', '/git/trees', { base_tree: parentTree, tree });
    const c = await this.json('POST', '/git/commits', { message, tree: t.sha, parents: [parentCommit] });
    try {
      await this.json('PATCH', `/git/refs/heads/${this.branch}`, { sha: c.sha, force: false });
    } catch (e) {
      if (e instanceof GitHubError && (e.status === 422 || e.status === 409)) throw new ClashError('Branch moved');
      throw e;
    }
    return { commit: c.sha, tree: t.sha };
  }
}
