// Tests for the Work Task server storage used on worktask.in. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServerRepo } from '../docs/serverrepo.js';
import { AuthError, ClashError, NetworkError } from '../docs/github.js';

function fakeFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, opts) => { calls.push({ url, opts }); return handler(url, opts); };
  return calls;
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('server storage: sign-in token is sent, snapshot becomes a Map', async () => {
  const calls = fakeFetch(() => json(200, { ok: true, commit: 'c1', tree: 't1', entries: { 'data.json': 'abc' } }));
  const r = new ServerRepo('tok', '../api/');
  const s = await r.snapshot();
  assert.equal(s.commit, 'c1');
  assert.equal(s.entries.get('data.json'), 'abc');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer tok');
  assert.match(calls[0].url, /\?a=dp\.snapshot$/);
});

test('server storage: another device first = ClashError; signed out = AuthError; offline = NetworkError', async () => {
  const r = new ServerRepo('tok');
  fakeFetch(() => json(409, { ok: false, error: 'Another device saved first.' }));
  await assert.rejects(r.commit('p', 't', [], 'm'), ClashError);
  fakeFetch(() => json(401, { ok: false, error: 'Please sign in again.' }));
  await assert.rejects(r.headCommit(), AuthError);
  fakeFetch(() => json(403, { ok: false, error: 'These projects belong to someone else.' }));
  await assert.rejects(r.headCommit(), AuthError);
  fakeFetch(() => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(r.headCommit(), NetworkError);
});

test('server storage: files come back as bytes', async () => {
  const calls = fakeFetch(() => new Response(new Uint8Array([104, 105]), { status: 200 }));
  const r = new ServerRepo('tok');
  assert.equal(await r.blobText('a'.repeat(40)), 'hi');
  assert.equal(calls[0].opts.method, 'GET');
  assert.match(calls[0].url, /a=dp\.blob&sha=a{40}/);
});
