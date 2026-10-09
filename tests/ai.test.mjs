// AI calls: right headers (key never in the address), answers checked, clear errors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockFetch, jsonResponse } from './helpers.mjs';
import * as ai from '../docs/ai.js';
import { AI_MODELS } from '../docs/config.js';

const project = {
  id: 'p1', name: 'Kiln trial', priority: 'high', deadline: null, notes: 'Kiln stops at 1150', state: 'active',
  steps: [{ id: 's1', text: 'Call supplier', done: false, waiting: true, waitingOn: 'Ravi' }], workNotes: [], files: [], activeSince: '2026-10-01',
};

const claudeSays = (obj) => mockFetch(() => jsonResponse({ content: [{ type: 'text', text: `Sure! ${JSON.stringify(obj)}` }] }));
const geminiSays = (obj) => mockFetch(() => jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }));

test('Claude call: key in header, current model, low effort, browser header', async () => {
  const calls = claudeSays({ steps: ['Order frit', 'Fire samples', 'Check colour'] });
  try {
    const steps = await ai.suggestSteps('claude', 'key-for-tests', project);
    assert.deepEqual(steps, ['Order frit', 'Fire samples', 'Check colour']);
    const { url, opts } = calls[0];
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.equal(opts.headers['x-api-key'], 'key-for-tests');
    assert.equal(opts.headers['anthropic-dangerous-direct-browser-access'], 'true');
    const body = JSON.parse(opts.body);
    assert.equal(body.model, AI_MODELS.claude);
    assert.equal(body.output_config.effort, 'low');
    assert.match(body.messages[0].content, /Kiln trial/);
  } finally { calls.restore(); }
});

test('Gemini call: key in a header, never in the web address', async () => {
  const calls = geminiSays({ steps: ['Order frit'] });
  try {
    await ai.suggestSteps('gemini', 'gkey-for-tests', project);
    assert.ok(!calls[0].url.includes('gkey-for-tests'));
    assert.equal(calls[0].opts.headers['x-goog-api-key'], 'gkey-for-tests');
  } finally { calls.restore(); }
});

test('answers are checked: at most 7 steps, trimmed, empty is an error', async () => {
  let calls = claudeSays({ steps: Array.from({ length: 12 }, (_, i) => `  Step ${i}  `) });
  assert.equal((await ai.suggestSteps('claude', 'k', project)).length, 7); calls.restore();
  calls = claudeSays({ steps: [] });
  await assert.rejects(ai.suggestSteps('claude', 'k', project), ai.AiError); calls.restore();
  calls = mockFetch(() => jsonResponse({ content: [{ type: 'text', text: 'not json at all' }] }));
  await assert.rejects(ai.suggestSteps('claude', 'k', project), /unclear answer/); calls.restore();
});

test('wrong key and no key give plain messages', async () => {
  const calls = mockFetch(() => new Response('', { status: 401 }));
  await assert.rejects(ai.suggestSteps('claude', 'bad', project), /key not accepted/);
  calls.restore();
  await assert.rejects(ai.suggestSteps('claude', '', project), /Add an AI key/);
});

test('draft message and summary polish return text', async () => {
  let calls = claudeSays({ message: 'Hi Ravi, any update on the frit price?' });
  assert.match(await ai.draftFollowUp('claude', 'k', { person: 'Ravi', step: project.steps[0], project, days: 3 }), /Hi Ravi/);
  assert.match(calls[0].opts.body, /Waiting for 3 days/);
  calls.restore();
  calls = geminiSays({ text: '✅ Kiln trial: called supplier' });
  assert.match(await ai.polishSummary('gemini', 'k', 'Daily update...'), /Kiln trial/);
  calls.restore();
});

test('Morning plan keeps only real projects and at most 5 items', async () => {
  const items = [{ projectId: 'p1', text: 'Call Ravi' }, { projectId: 'nope', text: 'Unknown project' }, ...Array.from({ length: 6 }, () => ({ projectId: 'p1', text: 'x' }))];
  const calls = geminiSays({ items });
  try {
    const plan = await ai.morningPlan('gemini', 'k', { projects: [project] });
    assert.equal(plan.items.length, 5);
    assert.equal(plan.items[1].projectId, null, 'unknown project id dropped');
  } finally { calls.restore(); }
});
