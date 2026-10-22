// 🔌 Connections: other apps (an ERP, a web form, n8n, Power Automate…) send the owner tasks and approvals through
// the Work Task server (team/app/connect.php), and get the owner's decisions back.
//  - Settings → "🔌 Connections": the list of apps, "+ New connection", Rotate key, Delete, and — once, right after
//    making a key — the address, key and signing secret to give to the app (with a ready PHP connector to download).
//  - "🔌 From apps": approvals waiting for ✓ Approve / ✕ Reject, grouped by app; decided ones fold away.
// The key and the secret are only kept in memory while the one-time box is open: never saved on this device.

import { h, fmtDay, fmtTime } from './dom.js';
import { indiaDate } from '../rules.js';

/** The same text as team/connector/worktask-connector.php (a check keeps them equal). */
export const CONNECTOR_TEMPLATE = String.raw`<?php
/*
 * Work Task connector - one file that lets your app send tasks and approvals to Work Task,
 * and get the owner's decisions (approved / rejected) back.
 *
 * How to use it - 3 steps:
 *
 * 1. Put this file in your app's folder.
 *    If you downloaded it from Work Task (Settings > Connections), the address, key and secret below are
 *    already filled in. If not, paste them below from the box Work Task showed you.
 *
 * 2. Send something to Work Task:
 *
 *      require_once __DIR__ . '/worktask-connector.php';
 *      wt_push([
 *        'external_id' => 'PO-1001',            // your own number for it (same number again = an update)
 *        'kind'        => 'approval',           // 'approval' = waits for Approve / Reject; 'task' = goes to the task list
 *        'title'       => 'Approve PO 1001',
 *        'details'     => 'Clay order for March',
 *        'link'        => 'https://your-app.example/po/1001',
 *        'fields'      => ['Amount' => '12,500', 'Vendor' => 'ABC Minerals'],
 *      ]);
 *      wt_withdraw('PO-1001');                  // you took it back (no decision needed any more)
 *
 * 3. Get the decision back - choose one way:
 *
 *    a) A page in your app that Work Task calls (put its address in Work Task as the "Decision address"):
 *
 *      require_once __DIR__ . '/worktask-connector.php';
 *      wt_receive_decision(function ($externalId, $status, $reason) {
 *        // $status is 'approved' or 'rejected'; $reason may be empty. Mark it in your app here.
 *      });
 *
 *    b) Or ask Work Task now and then (for example every 5 minutes):
 *
 *      foreach (wt_decisions($lastTime) as $d) { ... $d['external_id'], $d['status'], $d['reason'], $d['decided_at'] ... }
 *      // keep the answer's newest decided_at as $lastTime for the next time (a decision may come twice: that is fine)
 *
 * Keep the key and the secret private. If they leak, press "Rotate key" in Work Task and put the new ones here.
 * Needs PHP 7.4 or newer, with curl.
 */

const WT_ADDRESS = 'https://YOUR-WORK-TASK-ADDRESS/api/';
const WT_KEY = 'PASTE-YOUR-KEY-HERE';
const WT_SECRET = 'PASTE-YOUR-SIGNING-SECRET-HERE';

/** Call Work Task. Returns its answer as an array, or throws RuntimeException with the reason in plain words. */
function wt_call(string $action, array $body): array {
  $ch = curl_init(WT_ADDRESS . '?a=' . rawurlencode($action));
  curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . WT_KEY, 'Content-Type: application/json', 'Accept: application/json'],
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_CONNECTTIMEOUT => 8,
    CURLOPT_TIMEOUT => 15,
  ]);
  $raw = curl_exec($ch);
  $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
  $error = curl_error($ch);
  if ($raw === false) throw new RuntimeException('Could not reach Work Task: ' . $error);
  $answer = json_decode((string)$raw, true);
  if (!is_array($answer) || empty($answer['ok'])) {
    $why = is_array($answer) && isset($answer['error']) ? (string)$answer['error'] : 'error ' . $code;
    throw new RuntimeException('Work Task said: ' . $why);
  }
  return $answer;
}

/** Send a task or an approval (the same external_id again = an update). Returns ['id' => …, 'status' => …]. */
function wt_push(array $item): array {
  return wt_call('connect.push', $item);
}

/** You took it back: Work Task marks it withdrawn. */
function wt_withdraw(string $externalId): array {
  return wt_call('connect.withdraw', ['external_id' => $externalId]);
}

/** The decisions made since that time ('' = all). Each: external_id, status, reason, decided_at, item_id. */
function wt_decisions(string $since = ''): array {
  $answer = wt_call('connect.decisions', $since === '' ? [] : ['since' => $since]);
  return isset($answer['decisions']) && is_array($answer['decisions']) ? $answer['decisions'] : [];
}

/** Is this really from Work Task? The time must be within 5 minutes, and the signature must match. */
function wt_signature_ok(string $body, string $timestamp, string $signature, ?int $now = null): bool {
  if (!preg_match('/^[0-9]{1,12}$/', $timestamp)) return false;
  if (abs(($now === null ? time() : $now) - (int)$timestamp) > 300) return false;
  $expected = 'sha256=' . hash_hmac('sha256', $timestamp . '.' . $body, WT_SECRET);
  return hash_equals($expected, $signature);
}

/** Your decision address: checks the message, then calls $onDecision($externalId, $status, $reason). Answers 200 or 401. */
function wt_receive_decision(callable $onDecision): void {
  $body = (string)file_get_contents('php://input');
  $timestamp = (string)($_SERVER['HTTP_X_WORKTASK_TIMESTAMP'] ?? '');
  $signature = (string)($_SERVER['HTTP_X_WORKTASK_SIGNATURE'] ?? '');
  header('Content-Type: application/json');
  if (!wt_signature_ok($body, $timestamp, $signature)) {
    http_response_code(401);
    echo '{"ok":false,"error":"The signature is not right."}';
    return;
  }
  $d = json_decode($body, true);
  if (!is_array($d) || ($d['event'] ?? '') !== 'decision' || !isset($d['external_id'], $d['status'])) {
    http_response_code(400);
    echo '{"ok":false,"error":"Not a decision."}';
    return;
  }
  $onDecision((string)$d['external_id'], (string)$d['status'], (string)($d['reason'] ?? ''));
  http_response_code(200);
  echo '{"ok":true}';
}
`;

const PLACE = {
  address: "'https://YOUR-WORK-TASK-ADDRESS/api/'",
  key: "'PASTE-YOUR-KEY-HERE'",
  secret: "'PASTE-YOUR-SIGNING-SECRET-HERE'",
};
const phpQuote = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";

/** The PHP connector with this app's address, key and secret filled in (made here in the browser, never on the server). */
export function buildConnector({ address, key, secret }) {
  let out = CONNECTOR_TEMPLATE;
  for (const [name, value] of Object.entries({ address, key, secret })) {
    if (!out.includes(PLACE[name])) throw new Error('The connector file is not right (' + name + ').');
    out = out.replace(PLACE[name], () => phpQuote(value)); // (a function: a $ in the value stays as it is)
  }
  return out;
}

/** The addresses an app calls, from the Work Task address this page is opened on ("https://worktask.in/api/"). */
export function appAddresses(base) {
  return { push: base + '?a=connect.push', withdraw: base + '?a=connect.withdraw', decisions: base + '?a=connect.decisions' };
}

/** "How to connect": the short guide (JSON shape, a curl example, how to check the signature), ready to copy. */
export function howToText({ base, key }) {
  const a = appAddresses(base);
  return [
    'How to connect an app to Work Task',
    '',
    '1. Send a task or an approval (POST, JSON):',
    '   Address: ' + a.push,
    '   Header:  Authorization: Bearer ' + key,
    '   Body:    {"external_id": "PO-1001", "kind": "approval", "title": "Approve PO 1001",',
    '             "details": "Clay order for March", "link": "https://your-app.example/po/1001",',
    '             "fields": {"Amount": "12,500", "Vendor": "ABC Minerals"}}',
    '   kind: "task" = goes to the task list; "approval" = waits for Approve / Reject.',
    '   The same external_id again = an update, never a second item.',
    '   Limits: title 200 letters, details 5000, 20 fields (300 letters each), 120 calls a minute.',
    '',
    '2. Take it back:  POST ' + a.withdraw + '  {"external_id": "PO-1001"}',
    '',
    '3. Get the decision back, one of two ways:',
    '   a) Decision address: Work Task sends a POST with',
    '      {"event": "decision", "external_id": "PO-1001", "status": "approved" or "rejected", "reason": "...", "decided_at": "...", "item_id": 12}',
    '      and the headers X-WorkTask-Timestamp and X-WorkTask-Signature: sha256=<hex>.',
    '      Check it: <hex> = HMAC-SHA256(signing secret, timestamp + "." + body), and the timestamp is within 5 minutes.',
    '      Answer 200. Any other answer is tried again (for up to 24 hours).',
    '   b) Or ask now and then:  POST ' + a.decisions + '  {"since": "2026-10-22T10:00:00+05:30"}',
    '',
    'Example (curl):',
    "curl -X POST '" + a.push + "' \\",
    "  -H 'Authorization: Bearer " + key + "' -H 'Content-Type: application/json' \\",
    '  -d \'{"external_id": "TEST-1", "kind": "approval", "title": "Test approval"}\'',
    '',
    'Keep the key secret. Rotate it if it leaks.',
  ].join('\n');
}

// ---------------------------------------------------------------- what this page holds (in memory only)

export const cx = {
  list: null, loading: false, error: '',
  form: null,          // + New connection: { name, url }
  editUrl: null,       // the connection whose decision address is being changed: { id, url }
  once: null,          // the one-time box: { name, key, secret, base } — forgotten when closed
  items: null, itemsLoading: false, itemsAt: 0, itemsError: '',
  rejecting: null, reason: '', open: new Set(), showDecided: false, busy: new Set(),
};

/** Start again (tests; and signing out). */
export function resetConnections() {
  Object.assign(cx, { list: null, loading: false, error: '', form: null, editUrl: null, once: null, items: null, itemsLoading: false, itemsAt: 0, itemsError: '', rejecting: null, reason: '', open: new Set(), showDecided: false, busy: new Set() });
}

/** Close the one-time box: the key and the secret are gone from this page. */
export function forgetOnce() { cx.once = null; }

const apiBase = (ctx) => (typeof ctx.base === 'function' ? ctx.base() : ctx.base);
const ask = (ctx, text) => (ctx.confirm ? ctx.confirm(text) : window.confirm(text));

/** A time from the server ("2026-10-22 10:42:00", India time, or an ISO time). */
function serverDate(s) {
  if (!s) return null;
  const d = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : String(s).replace(' ', 'T') + '+05:30');
  return Number.isNaN(d.getTime()) ? null : d;
}
/** "10:42" today, else "21 Oct 10:42". */
export function whenText(s, today = indiaDate()) {
  const d = serverDate(s);
  if (!d) return '';
  const day = indiaDate(d);
  return day === today ? fmtTime(d) : `${fmtDay(day)} ${fmtTime(d)}`;
}

function copy(ctx, text, what) {
  if (ctx.copy) { ctx.copy(text, what); return; }
  Promise.resolve().then(() => navigator.clipboard.writeText(text))
    .then(() => ctx.toast(`${what} copied ✓`, 1500), () => ctx.toast('Could not copy — select it and copy it by hand.', 4000));
}

function download(ctx, name, text) {
  if (ctx.download) { ctx.download(name, text); return; }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
  const a = h('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  ctx.toast(`${name} downloaded ✓`, 2500);
}

// ---------------------------------------------------------------- talking to the server

export async function loadConnections(ctx) {
  cx.loading = true;
  try {
    const out = await ctx.api('conn.list');
    cx.list = out.connections || [];
    cx.error = '';
  } catch (e) {
    cx.list = cx.list || [];
    cx.error = `Could not load the connections: ${e.message}`;
  }
  cx.loading = false;
  ctx.render();
}

/** The approvals (waiting and decided). Asked at most once a minute unless `force`. */
export async function loadApps(ctx, force = false) {
  if (cx.itemsLoading || (!force && cx.items && Date.now() - cx.itemsAt < 60000)) return;
  cx.itemsLoading = true;
  try {
    const out = await ctx.api('conn.items');
    cx.items = out.items || [];
    cx.itemsError = '';
  } catch (e) {
    cx.items = cx.items || [];
    cx.itemsError = `Could not load: ${e.message}`;
  }
  cx.itemsAt = Date.now();
  cx.itemsLoading = false;
  ctx.render();
}

/** Approvals waiting for you (for the menu). */
export function appsPending() {
  return (cx.items || []).filter((i) => i.status === 'pending').length;
}

async function busyCall(ctx, tag, fn) {
  if (cx.busy.has(tag)) return;
  cx.busy.add(tag);
  ctx.render();
  try { await fn(); } catch (e) { ctx.toast(e.message, 5000); }
  cx.busy.delete(tag);
  ctx.render();
}

function putConnection(c) {
  const list = (cx.list || []).filter((x) => x.id !== c.id);
  list.push(c);
  list.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  cx.list = list;
}

function createConnection(ctx) {
  const f = cx.form;
  const name = String(f.name || '').trim();
  if (!name) { ctx.toast('Type the name of the app first.', 3000); return; }
  return busyCall(ctx, 'create', async () => {
    const out = await ctx.api('conn.create', { name, callback_url: String(f.url || '').trim() });
    putConnection(out.connection);
    cx.form = null;
    cx.once = { name: out.connection.name, key: out.key, secret: out.secret, base: apiBase(ctx) };
  });
}

function rotateKey(ctx, c) {
  if (!ask(ctx, `Make a new key for "${c.name}"?\n\nThe old key stops working at once — the app needs the new key and secret.`)) return;
  return busyCall(ctx, 'rotate' + c.id, async () => {
    const out = await ctx.api('conn.rotate', { id: c.id });
    putConnection(out.connection);
    cx.once = { name: out.connection.name, key: out.key, secret: out.secret, base: apiBase(ctx) };
  });
}

function deleteConnection(ctx, c) {
  if (!ask(ctx, `Delete the connection "${c.name}"?\n\nThe app can no longer send anything, and its approvals here are deleted too.`)) return;
  return busyCall(ctx, 'delete' + c.id, async () => {
    await ctx.api('conn.delete', { id: c.id });
    cx.list = (cx.list || []).filter((x) => x.id !== c.id);
    if (cx.items) cx.items = cx.items.filter((i) => i.connId !== c.id);
    ctx.toast(`"${c.name}" deleted`, 2500);
  });
}

function updateConnection(ctx, c, change, done) {
  return busyCall(ctx, 'update' + c.id, async () => {
    const out = await ctx.api('conn.update', { id: c.id, ...change });
    putConnection(out.connection);
    if (done) done();
  });
}

function decide(ctx, it, decision, reason = '') {
  return busyCall(ctx, 'item' + it.id, async () => {
    const out = await ctx.api('conn.decide', { id: it.id, decision, reason: String(reason || '').trim() });
    cx.items = (cx.items || []).map((x) => (x.id === it.id ? out.item : x));
    cx.rejecting = null;
    cx.reason = '';
    const told = { sent: 'the app was told ✓', waiting: 'the app will be told', ask: 'the app picks it up when it asks' }[out.item.delivery] || '';
    ctx.toast(`${decision === 'approved' ? '✓ Approved' : '✕ Rejected'}: ${it.title}${told ? ' — ' + told : ''}`, 3500);
    if (cx.list) { const c = cx.list.find((x) => x.id === it.connId); if (c && c.pending) c.pending -= 1; }
  });
}

// ---------------------------------------------------------------- Settings → 🔌 Connections

function onceRow(ctx, label, value, key) {
  return h('div', { class: 'once-row', key },
    h('span', { class: 'once-label' }, label),
    h('code', { class: 'once-value' }, value),
    h('button', { class: 'btn small', type: 'button', onClick: () => copy(ctx, value, label) }, '📋 Copy'));
}

/** Shown once, right after making (or rotating) a key: what to give the app. */
function oncePanel(ctx) {
  const o = cx.once;
  const guide = howToText({ base: o.base, key: o.key });
  return h('div', { class: 'conn-once', key: 'conn-once', role: 'region', 'aria-label': 'New key' },
    h('h4', null, `Give these to ${o.name} — shown only now`),
    onceRow(ctx, 'Address', appAddresses(o.base).push, 'once-addr'),
    onceRow(ctx, 'Key', o.key, 'once-key'),
    onceRow(ctx, 'Signing secret', o.secret, 'once-secret'),
    h('p', { class: 'warn' }, '⚠ Keep the key secret. Rotate it if it leaks.'),
    h('div', { class: 'row' },
      h('button', {
        class: 'btn primary', type: 'button',
        onClick: () => download(ctx, 'worktask-connector.php', buildConnector({ address: o.base, key: o.key, secret: o.secret })),
      }, '⬇ Download PHP connector'),
      h('button', { class: 'btn', type: 'button', onClick: () => copy(ctx, guide, 'The guide') }, '📋 Copy guide')),
    h('details', { class: 'conn-guide' }, h('summary', null, 'How to connect'), h('pre', null, guide)),
    h('p', { class: 'muted small' }, 'After you close this box the key and secret cannot be shown again. Lost them? Press Rotate key.'),
    h('button', { class: 'btn', type: 'button', onClick: () => { forgetOnce(); ctx.render(); } }, 'Done — I gave them to the app'));
}

function newForm(ctx) {
  const f = cx.form;
  return h('form', { class: 'conn-form', key: 'conn-form', onSubmit: (e) => { e.preventDefault(); return createConnection(ctx); } },
    h('label', null, 'Name of the app',
      h('input', { type: 'text', maxlength: 80, value: f.name, placeholder: 'e.g. Purchase app', 'aria-label': 'Name of the app', onInput: (e, el) => { f.name = el.value; } })),
    h('label', null, 'Decision address (callback URL) — optional',
      h('input', { type: 'url', maxlength: 500, value: f.url, placeholder: 'https://your-app.example/worktask-decision.php', 'aria-label': 'Decision address', onInput: (e, el) => { f.url = el.value; } })),
    h('p', { class: 'muted small' }, 'Where Work Task sends your ✓ Approve / ✕ Reject (https:// only). Leave it empty if the app asks for decisions itself.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', type: 'submit', disabled: cx.busy.has('create') }, cx.busy.has('create') ? 'Making…' : 'Create'),
      h('button', { class: 'btn', type: 'button', onClick: () => { cx.form = null; cx.editUrl = null; ctx.render(); } }, 'Cancel')));
}

function urlEditor(ctx, c) {
  const e = cx.editUrl;
  return h('div', { class: 'conn-url-edit', key: 'url-' + c.id },
    h('input', { type: 'url', maxlength: 500, value: e.url, placeholder: 'https://… (empty = the app asks for decisions)', 'aria-label': 'Decision address', onInput: (ev, el) => { e.url = el.value; } }),
    h('button', { class: 'btn small primary', type: 'button', onClick: () => updateConnection(ctx, c, { callback_url: String(e.url || '').trim() }, () => { cx.editUrl = null; }) }, 'Save'),
    h('button', { class: 'btn small', type: 'button', onClick: () => { cx.editUrl = null; ctx.render(); } }, 'Cancel'));
}

function connRow(ctx, c) {
  return h('li', { class: 'conn-row' + (c.active ? '' : ' off'), key: 'conn-' + c.id },
    h('div', { class: 'conn-head' },
      h('strong', null, c.name),
      h('span', { class: 'muted small' }, ` · key …${c.keyEnd}`),
      h('label', { class: 'check conn-on' },
        h('input', { type: 'checkbox', checked: c.active, 'aria-label': `${c.name} on`, onChange: (e, el) => updateConnection(ctx, c, { active: el.checked }) }),
        c.active ? ' On' : ' Off (the app is refused)')),
    h('div', { class: 'muted small' },
      c.lastSeenAt ? `last seen ${whenText(c.lastSeenAt)}` : 'not used yet',
      ' · ', c.pending ? `${c.pending} waiting for you` : 'nothing waiting',
      ' · ', c.callbackUrl ? `decisions go to ${c.callbackUrl}` : 'no decision address (the app asks for decisions)'),
    c.lastError ? h('p', { class: 'conn-error small' }, '⚠ ' + c.lastError) : null,
    cx.editUrl && cx.editUrl.id === c.id ? urlEditor(ctx, c) : null,
    h('div', { class: 'row' },
      h('button', { class: 'btn small', type: 'button', onClick: () => { cx.editUrl = { id: c.id, url: c.callbackUrl || '' }; ctx.render(); } }, '✎ Decision address'),
      h('button', { class: 'btn small', type: 'button', disabled: cx.busy.has('rotate' + c.id), onClick: () => rotateKey(ctx, c) }, 'Rotate key'),
      h('button', { class: 'btn small danger', type: 'button', disabled: cx.busy.has('delete' + c.id), onClick: () => deleteConnection(ctx, c) }, 'Delete')));
}

/** Settings → 🔌 Connections. */
export function renderConnectionsSettings(ctx) {
  if (cx.list === null && !cx.loading) loadConnections(ctx);
  return h('section', { class: 'block connections', key: 'connections' },
    h('h3', null, '🔌 Connections'),
    h('p', { class: 'muted small' }, 'Other apps (an ERP, a web form, n8n, Power Automate…) can send you tasks and approvals. Your ✓ Approve / ✕ Reject goes back to them.'),
    cx.once ? oncePanel(ctx) : null,
    cx.error ? h('p', { class: 'conn-error' }, cx.error) : null,
    cx.list === null ? h('p', { class: 'muted' }, 'Loading…')
      : cx.list.length ? h('ul', { class: 'conn-list' }, cx.list.map((c) => connRow(ctx, c)))
        : h('p', { class: 'muted' }, 'No connections yet.'),
    cx.form ? newForm(ctx) : h('button', { class: 'btn', type: 'button', onClick: () => { cx.form = { name: '', url: '' }; ctx.render(); } }, '+ New connection'));
}

// ---------------------------------------------------------------- 🔌 From apps

const STATUS = { approved: '✓ Approved', rejected: '✕ Rejected', withdrawn: 'Withdrawn by the app' };
const DELIVERY = { sent: '✓ sent to app', waiting: 'waiting to send', failed: 'could not send (the app can still ask)', ask: 'the app picks it up when it asks' };
const SHORT = 200;

function safeLink(url) { return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null; }

function detailsBlock(ctx, it) {
  const long = it.details.length > SHORT;
  const open = cx.open.has(it.id);
  return h('div', { class: 'app-details' },
    long && !open ? it.details.slice(0, SHORT).trimEnd() + '…' : it.details,
    long ? h('button', {
      class: 'link small', type: 'button',
      onClick: () => { if (open) cx.open.delete(it.id); else cx.open.add(it.id); ctx.render(); },
    }, open ? ' Less ▴' : ' More ▾') : null);
}

/** The cursor goes straight into the reason box, so you can type at once. */
function focusReason(id) {
  if (typeof document === 'undefined') return;
  setTimeout(() => { const t = document.querySelector(`[data-key="rej-reason-${id}"]`); if (t) t.focus(); }, 30);
}

function rejectBox(ctx, it) {
  return h('div', { class: 'reject-box', key: 'rej-' + it.id },
    h('label', null, 'Why? (optional — the app is told)',
      h('textarea', { rows: 3, maxlength: 500, value: cx.reason, 'aria-label': 'Reason', key: 'rej-reason-' + it.id, onInput: (e, el) => { cx.reason = el.value; } })),
    h('div', { class: 'row' },
      h('button', { class: 'btn danger', type: 'button', disabled: cx.busy.has('item' + it.id), onClick: () => decide(ctx, it, 'rejected', cx.reason) }, '✕ Reject'),
      h('button', { class: 'btn', type: 'button', onClick: () => { cx.rejecting = null; cx.reason = ''; ctx.render(); } }, 'Cancel')));
}

function itemCard(ctx, it) {
  const link = safeLink(it.link);
  const busy = cx.busy.has('item' + it.id);
  return h('article', { class: 'app-item', key: 'ai-' + it.id },
    h('div', { class: 'app-item-title' }, h('strong', null, it.title)),
    h('div', { class: 'muted small' }, `${it.app} · ${whenText(it.updatedAt || it.createdAt)}`),
    it.fields && it.fields.length ? h('table', { class: 'app-fields' },
      h('tbody', null, it.fields.map(([k, v], i) => h('tr', { key: 'f' + i }, h('th', null, k), h('td', null, v))))) : null,
    it.details ? detailsBlock(ctx, it) : null,
    link ? h('a', { class: 'tag link-chip', href: link, target: '_blank', rel: 'noopener noreferrer', title: link }, 'Open ↗') : null,
    cx.rejecting === it.id ? rejectBox(ctx, it) : h('div', { class: 'row app-actions' },
      h('button', { class: 'btn primary', type: 'button', disabled: busy, onClick: () => decide(ctx, it, 'approved') }, '✓ Approve'),
      h('button', { class: 'btn danger', type: 'button', disabled: busy, onClick: () => { cx.rejecting = it.id; cx.reason = ''; ctx.render(); focusReason(it.id); } }, '✕ Reject')));
}

function decidedRow(it) {
  return h('li', { class: 'app-decided ' + it.status, key: 'ad-' + it.id },
    h('span', { class: 'tag app-status ' + it.status }, STATUS[it.status] || it.status), ' ',
    h('strong', null, it.title),
    h('span', { class: 'muted small' }, ` · ${it.app} · ${whenText(it.decidedAt || it.updatedAt)}`,
      it.delivery ? ` · ${DELIVERY[it.delivery] || ''}` : '',
      it.reason ? ` · “${it.reason}”` : ''));
}

/** The 🔌 From apps page: waiting approvals by app (newest first), then "Decided (N)" folded. */
export function renderFromApps(ctx) {
  if (cx.items === null && !cx.itemsLoading) loadApps(ctx, true);
  const items = cx.items || [];
  const pending = items.filter((i) => i.status === 'pending');
  const decided = items.filter((i) => i.status !== 'pending');
  const groups = new Map(); // newest first (as the server sends them), so each app's place is its newest item
  for (const it of pending) {
    if (!groups.has(it.app)) groups.set(it.app, []);
    groups.get(it.app).push(it);
  }
  return h('div', { class: 'from-apps' },
    h('p', { class: 'muted small' }, 'Approvals your apps sent. Tasks they send go straight to ✅ Tasks (with a link chip).'),
    cx.itemsError ? h('p', { class: 'conn-error' }, cx.itemsError) : null,
    cx.items === null ? h('p', { class: 'muted' }, 'Loading…')
      : !pending.length ? h('p', { class: 'muted empty' }, 'Nothing waiting for you ✓')
        : [...groups].map(([app, list]) => h('section', { class: 'apps-group', key: 'g-' + app },
          h('h3', null, `${app} (${list.length})`),
          list.map((it) => itemCard(ctx, it)))),
    decided.length ? h('div', { class: 'apps-decided' },
      h('button', {
        class: 'link', type: 'button', 'aria-expanded': String(cx.showDecided),
        onClick: () => { cx.showDecided = !cx.showDecided; ctx.render(); },
      }, `${cx.showDecided ? '▾' : '▸'} Decided (${decided.length})`),
      cx.showDecided ? h('ul', { class: 'apps-decided-list' }, decided.map(decidedRow)) : null) : null);
}
