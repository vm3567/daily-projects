// Siri: what you said ("Check burner for Kiln project waiting on Ravi tomorrow") split into
// the step text, the project, who you wait on and the day it comes back.
// Anything it is not sure about stays in the words and goes to the Inbox, so nothing is lost.

import { addDays } from './rules.js';
import { MAX_SNOOZE_DAYS } from './ops.js';

const NUMBERS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const NOT_NAMES = new Set(['the', 'a', 'an', 'his', 'her', 'their', 'my', 'reply', 'approval', 'answer', 'payment', 'it', 'them', 'him']);

const words = (s) => String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const tidy = (s) => s.replace(/\s+/g, ' ').replace(/\s+([,.!?])/g, '$1').replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '')
  .replace(/\s+(and|for|to|in|on|by)$/i, '').trim();

/** Cut the first match of `re` out of `s`; returns [rest, match] or [s, null]. */
function cut(s, re) {
  const m = re.exec(s);
  if (!m) return [s, null];
  return [s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length), m];
}

function findProject(s, projects) {
  // 1. the project's name said in full: "for Kiln trial", "in the Kiln trial project", "project Kiln trial"
  let best = null;
  for (const p of projects) {
    const w = words(p.name);
    if (!w.length) continue;
    const name = w.join('[^a-z0-9]+');
    const re = new RegExp(`(?:\\b(?:for|in|to|into|under|on)\\s+(?:the\\s+)?(?:project\\s+)?|\\bproject\\s+)${name}\\b(?:\\s+project\\b)?`, 'i');
    const m = re.exec(s);
    if (m && (!best || w.length > best.size)) best = { p, m, size: w.length };
  }
  if (best) return { project: best.p, rest: s.slice(0, best.m.index) + ' ' + s.slice(best.m.index + best.m[0].length) };
  // 2. "for <words> project": the words Siri heard, matched to one project only
  const m = /\b(?:for|in|to|into|under)\s+(?:the\s+)?([a-z0-9][^,.;]*?)\s+project\b/i.exec(s) || /\bproject\s+([a-z0-9][^,.;]*)$/i.exec(s);
  if (!m) return { project: null, rest: s };
  const said = words(m[1]).filter((x) => x !== 'the');
  const fits = projects.filter((p) => {
    const pw = words(p.name);
    return said.length && said.every((x) => pw.some((y) => y === x || y === x.replace(/s$/, '') || y.replace(/s$/, '') === x));
  });
  if (fits.length === 1) return { project: fits[0], rest: s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length) };
  return { project: null, rest: s, missed: m[1].trim() };
}

function findWaitOn(s, people) {
  const m = /\b(?:waiting|wait)\s+(?:on|for)\s+/i.exec(s);
  if (!m) return { rest: s, name: '' };
  const after = s.slice(m.index + m[0].length);
  const title = (/^(?:mr|mrs|ms|dr|sir)\.?\s+/i.exec(after) || [''])[0].length; // "Mr. Rao": the name is Rao
  let name = '';
  let len = 0;
  for (const p of people) { // a saved person: full name, or a first name only one person has
    const full = p.name.toLowerCase();
    for (const at of [0, title]) {
      const low = after.slice(at).toLowerCase();
      if (low.startsWith(full) && !/[a-z]/i.test(after[at + full.length] || '') && at + full.length > len) { name = p.name; len = at + full.length; }
    }
  }
  if (!name) {
    const first = /^([a-z][\w'-]*)/i.exec(after.slice(title));
    if (first) {
      const same = people.filter((p) => p.name.split(/\s+/)[0].toLowerCase() === first[1].toLowerCase());
      if (same.length === 1) { name = same[0].name; len = title + first[1].length; }
      // a new name (Siri writes names with a capital); two saved people with this first name: not sure, so it stays in the words
      else if (!same.length && /^[A-Z]/.test(first[1]) && !NOT_NAMES.has(first[1].toLowerCase())) { name = first[1]; len = title + first[1].length; }
    }
  }
  if (!name) return { rest: s, name: '' };
  return { rest: s.slice(0, m.index) + ' ' + after.slice(len), name };
}

function findWhen(s, today) {
  const num = (x) => (/^\d+$/.test(x) ? Number(x) : NUMBERS[x.toLowerCase()]);
  let r;
  if ((r = cut(s, /\b(?:on\s+|by\s+)?(?:the\s+)?day after tomorrow\b(?![’']s\b)/i))[1]) return { rest: r[0], days: 2 };
  if ((r = cut(s, /\b(?:on\s+|by\s+)?tomorrow\b(?![’']s\b)/i))[1]) return { rest: r[0], days: 1 };
  if ((r = cut(s, /\b(?:in|after)\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+(days?|weeks?)\b/i))[1]) {
    const days = num(r[1][1]) * (/week/i.test(r[1][2]) ? 7 : 1);
    if (days > MAX_SNOOZE_DAYS) return { rest: s, days: 0 }; // too far to come back: the words stay in the step
    return { rest: r[0], days };
  }
  if ((r = cut(s, /\b(?:by\s+|on\s+)?next week\b/i))[1]) return { rest: r[0], days: 7 };
  if ((r = cut(s, /\b(?:(?:on|by|this|next|coming)\s+|(?<!\bthe\s+))(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b(?![’']s\b)/i))[1]) {
    const want = DAYS.indexOf(r[1][1].toLowerCase());
    const now = new Date(`${today}T00:00:00Z`).getUTCDay();
    return { rest: r[0], days: ((want - now + 7) % 7) || 7 };
  }
  if ((r = cut(s, /\b(?:for\s+)?today\b(?![’']s\b)/i))[1]) return { rest: r[0], days: 0 };
  return { rest: s, days: 0 };
}

/**
 * said: the words from Siri. projects: the active projects. people: saved people. today: 'YYYY-MM-DD'.
 * Returns { text, project, waitOn, date, missed }:
 * - with a project: text is what is left after taking out the project, the person and the day;
 * - with no project: text is everything you said (it goes to the Inbox) and `missed` is a project name it could not find.
 */
export function parseVoice(said, { projects = [], people = [], today }) {
  const all = tidy(String(said || '').replace(/\s+/g, ' ')).slice(0, 1000);
  if (!all) return null;
  const found = findProject(all, projects);
  if (!found.project) return { text: all.charAt(0).toUpperCase() + all.slice(1), project: null, waitOn: '', date: null, missed: found.missed || '' };
  const wait = findWaitOn(found.rest, people);
  const when = findWhen(wait.rest, today);
  let text = tidy(when.rest);
  if (!text) text = all;
  return {
    text: text.charAt(0).toUpperCase() + text.slice(1),
    project: found.project,
    waitOn: wait.name,
    date: when.days > 0 ? addDays(today, when.days) : null,
    missed: '',
  };
}
