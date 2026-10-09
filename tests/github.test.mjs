// The GitHub connection: right headers, never cached, clear errors, one commit, clash detection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockFetch, jsonResponse } from './helpers.mjs';
import { GitHubRepo, AuthError, NetworkError, ClashError, GitHubError } from '../docs/github.js';

const repo = () => new GitHubRepo('token-for-tests', 'vm3567', 'daily-projects-data');

test('reads the latest commit with the key, never from cache', async () => {
  const calls = mockFetch(() => jsonResponse({ object: { sha: 'abc123' } }));
  try {
    assert.equal(await repo().headCommit(), 'abc123');
    const c = calls[0];
    assert.match(c.url, /repos\/vm3567\/daily-projects-data\/git\/ref\/heads\/main$/);
    assert.equal(c.opts.cache, 'no-store');
    assert.equal(c.opts.headers.Authorization, 'Bearer token-for-tests');
  } finally { calls.restore(); }
});

test('clear errors: wrong key, no access, rate limit, no connection', async () => {
  let calls = mockFetch(() => new Response('', { status: 401 }));
  await assert.rejects(repo().headCommit(), AuthError); calls.restore();
  calls = mockFetch(() => new Response('Not Found', { status: 404 }));
  await assert.rejects(repo().headCommit(), AuthError); calls.restore();
  calls = mockFetch(() => new Response('API rate limit exceeded', { status: 403 }));
  await assert.rejects(repo().headCommit(), GitHubError); calls.restore();
  calls = mockFetch(() => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(repo().headCommit(), NetworkError); calls.restore();
});

test('files are read as raw bytes (works above 1 MB)', async () => {
  const calls = mockFetch(() => new Response('hello'));
  try {
    assert.equal(await repo().blobText('sha1'), 'hello');
    assert.equal(calls[0].opts.headers.Accept, 'application/vnd.github.raw');
  } finally { calls.restore(); }
});

test('one save = tree + commit + move main (not forced); deleting sends sha null', async () => {
  const calls = mockFetch((url, opts) => {
    if (url.endsWith('/git/trees')) return jsonResponse({ sha: 'tree2' });
    if (url.endsWith('/git/commits')) return jsonResponse({ sha: 'commit2' });
    return jsonResponse({ object: { sha: 'commit2' } });
  });
  try {
    const r = await repo().commit('commit1', 'tree1', [{ path: 'data.json', content: '{}' }, { path: 'files/p/x.jpg', sha: null }], 'msg');
    assert.deepEqual(r, { commit: 'commit2', tree: 'tree2' });
    const tree = JSON.parse(calls[0].opts.body);
    assert.equal(tree.base_tree, 'tree1');
    assert.equal(tree.tree[1].sha, null);
    const patch = calls[2];
    assert.equal(patch.opts.method, 'PATCH');
    assert.equal(JSON.parse(patch.opts.body).force, false);
  } finally { calls.restore(); }
});

test('another device saved first → ClashError (so the app replays)', async () => {
  const calls = mockFetch((url) => {
    if (url.endsWith('/git/trees')) return jsonResponse({ sha: 't' });
    if (url.endsWith('/git/commits')) return jsonResponse({ sha: 'c' });
    return new Response('Update is not a fast forward', { status: 422 });
  });
  try {
    await assert.rejects(repo().commit('c1', 't1', [{ path: 'data.json', content: '{}' }], 'm'), ClashError);
  } finally { calls.restore(); }
});
