// AI helper: Claude Haiku (main) or Gemini Flash (backup), called straight from the browser
// with the key saved on this device. The AI only suggests; it never changes anything.

import { AI_MODELS } from './config.js';
import { dotColour, isSnoozed, nextStep, todayIndia, addDays, isOverdue, daysBetween, indiaDate } from './rules.js';

export class AiError extends Error {}

async function callClaude(key, system, user) {
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: AI_MODELS.claude,
        // Haiku 5.5 thinks before answering and that counts toward max_tokens,
        // so leave room; low effort keeps it fast and cheap for short step lists.
        max_tokens: 4000,
        output_config: { effort: 'low' },
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
  } catch {
    throw new AiError('No connection to Claude');
  }
  if (res.status === 401) throw new AiError('Claude key not accepted. Check it in Settings.');
  if (!res.ok) throw new AiError(`Claude error ${res.status}`);
  const j = await res.json();
  return (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
}

async function callGemini(key, system, user) {
  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${AI_MODELS.gemini}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });
  } catch {
    throw new AiError('No connection to Gemini');
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) throw new AiError('Gemini key not accepted. Check it in Settings.');
  if (!res.ok) throw new AiError(`Gemini error ${res.status}`);
  const j = await res.json();
  return j.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
}

/** Pull the first JSON object out of the AI's answer. */
function parseJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new AiError('The AI gave an unclear answer. Try again.');
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new AiError('The AI gave an unclear answer. Try again.');
  }
}

function strings(list, max) {
  return (Array.isArray(list) ? list : [])
    .map((x) => (typeof x === 'string' ? x : x && typeof x.text === 'string' ? x.text : ''))
    .map((s) => s.trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, max);
}

async function ask(provider, key, system, user) {
  if (!key) throw new AiError('Add an AI key in Settings');
  const text = provider === 'gemini' ? await callGemini(key, system, user) : await callClaude(key, system, user);
  return parseJson(text);
}

const STYLE = 'Use short, plain, everyday English. Each item is one short action a busy person can do. '
  + 'Answer ONLY with JSON, no other text.';

function describeProject(p, today) {
  const lines = [
    `Project: ${p.name}`,
    `Priority: ${p.priority}${p.deadline ? `, target date ${p.deadline}${isOverdue(p, today) ? ' (passed)' : ''}` : ''}`,
  ];
  const open = p.steps.filter((s) => !s.done);
  const done = p.steps.filter((s) => s.done).slice(-8);
  if (open.length) lines.push('Open steps:\n' + open.map((s) => `- ${s.text}${s.waiting ? ` (waiting${s.waitingOn ? ' on ' + s.waitingOn : ''})` : ''}${s.dueDate ? ` (due ${s.dueDate})` : ''}`).join('\n'));
  if (done.length) lines.push('Done steps:\n' + done.map((s) => `- ${s.text}`).join('\n'));
  if (p.notes) lines.push('Notes: ' + p.notes.slice(0, 1500));
  if (p.workNotes.length) lines.push('Recent work notes:\n' + p.workNotes.slice(0, 5).map((n) => `- ${indiaDate(n.createdAt)}: ${n.text}`).join('\n'));
  return lines.join('\n');
}

/** ✨ Break into steps: 5-10 steps for a goal. */
export async function breakIntoSteps(provider, key, project, goal) {
  const today = todayIndia();
  const r = await ask(provider, key,
    `You help plan a personal work project. ${STYLE} Format: {"steps": ["...", "..."]} with 5 to 10 steps in order.`,
    `${describeProject(project, today)}\n\nGoal to break into steps: ${goal}`);
  const steps = strings(r.steps, 10);
  if (!steps.length) throw new AiError('The AI gave no steps. Try again.');
  return steps;
}

/** ✨ Suggest next step: 1-3 ideas. */
export async function suggestNextSteps(provider, key, project) {
  const today = todayIndia();
  const r = await ask(provider, key,
    `You help a person move a project forward today. ${STYLE} Format: {"steps": ["...", "..."]} with 1 to 3 next steps. `
    + 'Do not repeat steps that are already open or done.',
    describeProject(project, today));
  const steps = strings(r.steps, 3);
  if (!steps.length) throw new AiError('The AI gave no ideas. Try again.');
  return steps;
}

function projectSummaryLine(p, today) {
  const ns = nextStep(p);
  const parts = [
    `[${p.id}] ${p.name}`,
    `dot ${dotColour(p, today)}`,
    `priority ${p.priority}`,
    p.deadline ? `target date ${p.deadline}${isOverdue(p, today) ? ' PASSED' : ` (${daysBetween(today, p.deadline)} days left)`}` : '',
    ns ? `next: ${ns.text}${ns.waiting ? ' (waiting)' : ''}` : 'no next step',
  ];
  return parts.filter(Boolean).join(' | ');
}

/** ✨ AI steps: the next steps in order (first = the very next one), 3 to 7 of them. */
export async function suggestSteps(provider, key, project) {
  const today = todayIndia();
  const r = await ask(provider, key,
    'You help a busy person move a project forward. Read the project title, notes, open steps, done steps and work notes. '
    + 'Suggest the next steps IN ORDER, starting with the very next one to do. Each step is one small, clear action '
    + '(start with a verb, max 12 words). Do not repeat open or done steps. Give 3 to 7 steps. '
    + `${STYLE} Format: {"steps": ["first next step", "then this", "..."]}`,
    describeProject(project, today));
  const steps = strings(r.steps, 7);
  if (!steps.length) throw new AiError('The AI gave no steps. Try again.');
  return steps;
}

/** ✍ A short, polite follow-up message to someone you are waiting on. */
export async function draftFollowUp(provider, key, { person, step, project, days }) {
  const notes = project.workNotes.filter((n) => !n.stepId || n.stepId === step.id).slice(0, 4)
    .map((n) => `- ${indiaDate(n.createdAt)}: ${n.text}`).join('\n');
  const r = await ask(provider, key,
    'You write short follow-up messages for WhatsApp or email, for a professional in the Indian ceramic industry. '
    + 'Friendly, polite, respectful, plain English. 2 to 4 short sentences. Start with a greeting using the person\'s first name. '
    + 'Say clearly what you are waiting for and ask for an update or a date. No subject line, no signature, no emojis. '
    + 'Answer ONLY with JSON: {"message": "..."}',
    `Person: ${person || '(name not known)'}\nWaiting for: ${step.text}\nProject: ${project.name}\n`
    + `Waiting for ${days} day${days === 1 ? '' : 's'}.\n${step.note ? 'Step note: ' + step.note + '\n' : ''}${notes ? 'Recent notes:\n' + notes : ''}`);
  const msg = typeof r.message === 'string' ? r.message.trim().slice(0, 1200) : '';
  if (!msg) throw new AiError('The AI gave no message. Try again.');
  return msg;
}

/** ✨ Make the day summary shorter and nicer, keeping every fact. */
export async function polishSummary(provider, key, text) {
  const r = await ask(provider, key,
    'Rewrite this daily work update to send to a manager on WhatsApp. Keep every fact, project name and person; '
    + 'make it short, clear and professional. Use simple bullet lines. No emojis except ✅ and ⏳. '
    + 'Answer ONLY with JSON: {"text": "..."}',
    text);
  const out = typeof r.text === 'string' ? r.text.trim().slice(0, 4000) : '';
  if (!out) throw new AiError('The AI gave no text. Try again.');
  return out;
}

/** Morning plan: the 5 most important things for today. Returns { items: [{projectId, text}] }. */
export async function morningPlan(provider, key, data) {
  const today = todayIndia();
  const active = data.projects.filter((p) => p.state === 'active' && !isSnoozed(p, today)); // snoozed ones (and all-steps-reminded) wait
  if (!active.length) return { items: [] };
  const r = await ask(provider, key,
    `You plan someone's work day across many projects. Pick the 5 most important things to do today. `
    + 'Order: passed deadlines and red-dot projects first, then deadlines soon, then high priority. '
    + `${STYLE} Format: {"items": [{"projectId": "id from the brackets", "text": "short action"}]}`,
    `Today is ${today}. Projects:\n` + active.map((p) => projectSummaryLine(p, today)).join('\n'));
  const ids = new Set(active.map((p) => p.id));
  const items = (Array.isArray(r.items) ? r.items : [])
    .filter((x) => x && typeof x.text === 'string')
    .map((x) => ({ projectId: ids.has(x.projectId) ? x.projectId : null, text: x.text.trim().slice(0, 300) }))
    .filter((x) => x.text)
    .slice(0, 5);
  return { items };
}

/** Weekly review: what moved, what is stuck, what to fix. */
export async function weeklyReview(provider, key, data, history) {
  const today = todayIndia();
  const from = addDays(today, -7);
  const events = Object.values(history).flat()
    .filter((e) => indiaDate(e.at) >= from && ['step_ticked', 'note_added', 'finished', 'paused', 'created'].includes(e.kind))
    .slice(-150)
    .map((e) => `${indiaDate(e.at)} ${e.projectName || ''}: ${e.kind.replace('_', ' ')} - ${e.detail}`);
  const active = data.projects.filter((p) => p.state === 'active');
  const r = await ask(provider, key,
    'You write a short weekly review of a person\'s projects. '
    + `${STYLE} Format: {"moved": ["..."], "stuck": ["..."], "fix": ["..."]} with up to 5 items each.`,
    `Today is ${today}. This week's activity:\n${events.join('\n') || '(none)'}\n\nProjects now:\n`
    + active.map((p) => projectSummaryLine(p, today)).join('\n'));
  return { moved: strings(r.moved, 5), stuck: strings(r.stuck, 5), fix: strings(r.fix, 5) };
}

/** Tiny call to check a key works. */
export async function testKey(provider, key) {
  const r = await ask(provider, key, 'Answer ONLY with JSON.', 'Reply with {"ok": true}');
  return r && r.ok === true;
}
