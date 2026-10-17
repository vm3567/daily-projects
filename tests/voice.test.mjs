// Tests for Siri: what you said → step, project, waiting on, day. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVoice } from '../docs/voice.js';

const projects = [{ id: 'p1', name: 'Kiln trial' }, { id: 'p2', name: 'Glaze audit 2026' }, { id: 'p3', name: 'Kiln 3 burners' }];
const people = [{ name: 'Ravi Kumar' }, { name: 'Anita' }];
const today = '2026-10-15'; // a Thursday
const say = (s) => parseVoice(s, { projects, people, today });

test('Siri: plain words go to the Inbox unchanged', () => {
  const v = say('check the burner tomorrow');
  assert.equal(v.project, null);
  assert.equal(v.text, 'Check the burner tomorrow');
});

test('Siri: project, waiting on and day are taken out of the step', () => {
  const v = say('Order clay for Kiln trial project waiting on Ravi tomorrow.');
  assert.equal(v.project.id, 'p1');
  assert.equal(v.text, 'Order clay');
  assert.equal(v.waitOn, 'Ravi Kumar');
  assert.equal(v.date, '2026-10-16');
});

test('Siri: the longest project name wins, and words Siri changed still find one project', () => {
  assert.equal(say('Fix pilot in Kiln 3 burners').project.id, 'p3');
  const v = say('send samples for the glaze audits project');
  assert.equal(v.project.id, 'p2');
  assert.equal(v.text, 'Send samples');
});

test('Siri: days of the week, in N days, next week', () => {
  assert.equal(say('Call supplier for Kiln trial on Monday').date, '2026-10-19');
  assert.equal(say('Call supplier for Kiln trial Thursday').date, '2026-10-22');
  assert.equal(say('Call supplier for Kiln trial in two days').date, '2026-10-17');
  assert.equal(say('Call supplier for Kiln trial next week').date, '2026-10-22');
  assert.equal(say('Call supplier for Kiln trial today').date, null);
});

test('Siri: new names need a capital; "waiting for the reply" is not a person', () => {
  assert.equal(say('Quote for Kiln trial waiting on Suresh').waitOn, 'Suresh');
  const v = say('Quote for Kiln trial waiting for the reply');
  assert.equal(v.waitOn, '');
  assert.match(v.text, /waiting for the reply/);
});

test('Siri: a project it cannot find goes to the Inbox and says which', () => {
  const v = say('Book hotel for Mumbai expo project');
  assert.equal(v.project, null);
  assert.equal(v.missed, 'Mumbai expo');
  assert.equal(v.text, 'Book hotel for Mumbai expo project');
  assert.equal(say('  '), null);
});

test('Siri: day words inside the sentence stay in the step', () => {
  let v = say("Check tomorrow's firing plan for Kiln trial");
  assert.equal(v.text, "Check tomorrow's firing plan");
  assert.equal(v.date, null);
  v = say('Send the Friday report for Kiln trial');
  assert.equal(v.text, 'Send the Friday report');
  assert.equal(v.date, null);
  assert.equal(say('Call Ravi for Kiln trial Monday').date, '2026-10-19'); // a bare day is still a day
});
