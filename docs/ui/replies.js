// Email replies: the email card (with its "✉ Reply ready" box) on a project page and on Inbox items, the "✉ Replies"
// page (ready to send / waiting for your reply), and the one-by-one round. A reply is only a draft here: it is never
// sent from the app or the server. "Open in Outlook" makes a draft in the same thread; you press Send there.

import { h, fmtDay, fmtTime } from './dom.js';
import { mailThreads, mailThreadOf, repliesOf, replyState, replyRoundAt, indiaDate, todayIndia } from '../rules.js';
import { REPLY_MAX } from '../ops.js';

const daysWord = (n) => (n <= 0 ? 'today' : n === 1 ? '1 day' : `${n} days`);
const whenText = (iso) => (iso ? `${fmtDay(indiaDate(iso))} ${fmtTime(iso)}` : '');

/** "Open email ↗": the newest email of the thread in Outlook. */
function mailLink(m, label = 'Open email ↗') {
  const url = m.link && m.link.url;
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return h('a', { class: 'tag link-chip', href: url, target: '_blank', rel: 'noopener noreferrer', title: m.link.title || url, key: 'ml-' + m.key }, label);
}

/** The reply text box: saves by itself after a short pause, and when leaving the box (by 'you'). */
function replyText(ctx, m, extra = {}) {
  let timer = null;
  const save = (el) => {
    clearTimeout(timer);
    const text = el.value;
    if (!text.trim() || (m.reply && m.reply.state !== 'sent' && m.reply.text === text)) return; // empty: kept as it was (✕ Clear throws it away)
    ctx.store.dispatch('setReply', { ...m.ref, text, by: 'you' });
  };
  return h('textarea', {
    class: 'reply-text', rows: 7, maxlength: REPLY_MAX, key: 'reply-' + m.key, 'aria-label': `Reply to ${m.from}`,
    placeholder: `Dear Mr. ${m.from.split(/\s+/)[0]},\n\n…\n\nThank you.`, // the owner's style; Outlook adds "Thanks & Regards," and the signature
    value: m.reply && m.reply.state !== 'sent' ? m.reply.text : '',
    onInput: (e, el) => { clearTimeout(timer); timer = setTimeout(() => save(el), 900); },
    onChange: (e, el) => save(el),
    onFocusout: (e, el) => save(el),
    ...extra,
  });
}

function focusReply(m) {
  const el = typeof document.querySelector === 'function' ? document.querySelector(`[data-key="reply-${m.key}"]`) : null;
  if (el && el.focus) el.focus();
}

/** ✓ Sent (your work, like a note) — with Undo. */
function markSent(ctx, m) {
  const before = m.reply && m.reply.state !== 'sent' ? { ...m.reply } : null;
  const workDate = m.project ? m.project.workDate || null : null;
  const op = ctx.store.dispatch('markReplySent', m.ref);
  if (!op) return false;
  // Undo takes it all back: the draft, the "Reply sent" line and the day counted as work
  ctx.toast(`✓ Reply to ${m.from} marked sent`, 4000, () => {
    ctx.store.dispatch('undoReplySent', { ...m.ref, reply: before, workDate, sentAt: op.at, undoOpId: op.id });
  });
  return true;
}

function later(ctx, m) {
  if (!ctx.store.dispatch('replyLater', m.ref)) return false;
  ctx.toast('⏭ Later — it comes back tomorrow', 2500);
  return true;
}

function clearIt(ctx, m) {
  const old = m.reply && m.reply.text;
  if (!ctx.store.dispatch('clearReply', m.ref)) return;
  if (ctx.ui.replyOpen === m.key) ctx.ui.replyOpen = null;
  ctx.toast('Reply cleared', 5000, old ? () => ctx.store.dispatch('setReply', { ...m.ref, text: old, by: 'you' }) : null);
}

/** The "✉ Reply ready" box, or (no reply yet) a hint and "✎ Write reply". */
export function replyArea(ctx, m, today = todayIndia()) {
  const st = replyState(m, today);
  const r = m.reply;
  const open = st === 'ready' || st === 'later';
  if (!open && ctx.ui.replyOpen !== m.key) {
    if (st === 'done') {
      return r && r.state === 'sent'
        ? h('div', { class: 'reply-done muted small', key: 'rd-' + m.key }, `✓ Replied ${r.sentAt ? whenText(r.sentAt) : ''}`.trim())
        : null;
    }
    return h('div', { class: 'reply-none', key: 'rn-' + m.key },
      h('span', { class: 'muted small' }, `No reply yet — ask Claude "prepare the reply for ${m.project ? m.project.name : m.subject}"`),
      h('button', { class: 'btn small', onClick: () => { ctx.ui.replyOpen = m.key; ctx.render(); focusReply(m); } }, '✎ Write reply'));
  }
  if (!open) { // the empty box after "✎ Write reply": it saves as soon as something is typed
    return h('div', { class: 'reply-box', key: 'rb-' + m.key },
      h('strong', null, '✉ Your reply'),
      replyText(ctx, m),
      h('div', { class: 'row reply-actions' },
        h('button', { class: 'btn small', onClick: () => { ctx.ui.replyOpen = null; ctx.render(); } }, 'Cancel')));
  }
  const who = r.by === 'claude' ? 'prepared by Claude' : 'written by you';
  return h('div', { class: 'reply-box' + (r.state === 'later' && st === 'later' ? ' later' : ''), key: 'rb-' + m.key },
    h('strong', null, st === 'later' ? `⏭ Reply for later — ${fmtDay(r.laterUntil)}` : '✉ Reply ready'),
    h('div', { class: 'muted small reply-meta' }, `${who} · ${whenText(r.at)} · you can edit`),
    m.newer ? h('div', { class: 'warn small' }, 'A newer email came after this draft — check it still fits.') : null,
    replyText(ctx, m),
    h('div', { class: 'row reply-actions' },
      h('button', { class: 'btn primary small', onClick: () => ctx.openReplyDraft(m), title: 'Makes a draft reply in the same email thread. You press Send in Outlook.' }, 'Open in Outlook (same thread)'),
      h('button', { class: 'btn small', onClick: () => { markSent(ctx, m); } }, '✓ Sent'),
      st === 'later' ? null : h('button', { class: 'btn small', onClick: () => { later(ctx, m); } }, '⏭ Later'),
      h('button', { class: 'btn small danger', onClick: () => clearIt(ctx, m) }, '✕ Clear')));
}

/** The email card: who wrote, when, the newest lines, how many emails, Open email — then the reply. */
export function emailCard(ctx, m, today = todayIndia()) {
  return h('div', { class: 'mail-card', key: 'mc-' + m.key },
    h('div', { class: 'mail-from' }, `From ${m.from}${m.since ? ` · ${m.mail.at ? whenText(m.mail.at) : fmtDay(m.since)}` : ''}`,
      m.step ? h('span', { class: 'muted small' }, ` · step: ${m.step.text}`) : null),
    m.preview ? h('div', { class: 'mail-preview muted small' }, m.preview) : null,
    h('div', { class: 'row mail-meta' },
      h('span', { class: 'muted small' }, `💬 ${m.count} email${m.count === 1 ? '' : 's'}`),
      mailLink(m)),
    replyArea(ctx, m, today));
}

/** A task made from an email: EMAIL THREAD — each email (📧 them / ↩ you), when, its first lines and Open ↗ (newest last). */
export function emailThreadBlock(ctx, p) {
  const th = mailThreadOf(p);
  if (!th.length) return null;
  return h('section', { class: 'block email-thread', key: 'et-' + p.id },
    h('h3', null, `EMAIL THREAD (${th.length})`),
    h('ul', { class: 'thread-list' }, th.map((e, i) => h('li', { class: 'thread-row' + (e.fromMe ? ' me' : ''), key: `th-${p.id}-${i}` },
      h('div', { class: 'thread-head' },
        h('strong', null, e.fromMe ? '↩ You' : `📧 ${e.fromName || 'Them'}`),
        h('span', { class: 'muted small' }, ` · ${whenText(e.at)} `),
        typeof e.link === 'string' && /^https?:\/\//i.test(e.link)
          ? h('a', { class: 'tag link-chip', href: e.link, target: '_blank', rel: 'noopener noreferrer', title: 'Open this email in Outlook' }, 'Open ↗') : null),
      e.preview ? h('div', { class: 'muted small thread-preview' }, e.preview) : null))));
}

/** The email cards of one project (the project's own thread first, then its open steps' threads). */
export function projectEmailCards(ctx, p, today = todayIndia()) {
  const list = mailThreads(ctx.store.view.data).filter((m) => m.project && m.project.id === p.id);
  if (!list.length) return null;
  return h('div', { class: 'mail-cards', key: 'mcs-' + p.id }, list.map((m) => emailCard(ctx, m, today)));
}

// ---------------------------------------------------------------- the ✉ Replies page

/** The menu's number: replies ready to send. */
export function readyCount(data, today = todayIndia()) {
  return repliesOf(data, today).ready.length;
}

function row(ctx, m, sub, cls = '') {
  return h('li', { key: 'rr-' + m.key, class: 'reply-row ' + cls },
    h('button', { class: 'reply-open', onClick: () => ctx.openMail(m), title: `Open ${m.name}` },
      h('span', { class: `dot ${m.colour}` }),
      h('span', { class: 'reply-subject' }, m.subject),
      h('span', { class: 'muted small' }, sub)));
}

export function renderReplies(ctx, today = todayIndia()) {
  const { ready, waiting, later: wait } = repliesOf(ctx.store.view.data, today);
  return h('div', { class: 'replies', key: 'replies' },
    h('div', { class: 'row replies-top' },
      h('strong', null, `${ready.length} ready · ${waiting.length} waiting`),
      h('button', { class: 'btn primary', disabled: ready.length ? null : true, onClick: () => ctx.startReplyRound() }, '▶ Check and send one by one')),
    h('p', { class: 'muted small' }, 'Replies are never sent from here: they open in Outlook, and you press Send.'),
    h('h3', { class: 'replies-head' }, `Ready to send (${ready.length})`),
    ready.length ? h('ul', { class: 'reply-list' }, ready.map((m) => row(ctx, m, ` — to ${m.from} · waiting ${daysWord(m.days)}${m.newer ? ' · newer email came' : ''}`)))
      : h('p', { class: 'muted small' }, 'No reply ready. Ask Claude "/replies" to prepare them.'),
    h('h3', { class: 'replies-head' }, `Waiting for your reply (${waiting.length})`),
    waiting.length ? h('ul', { class: 'reply-list' }, waiting.map((m) => row(ctx, m, ` — from ${m.from} · waiting ${daysWord(m.days)}`, 'waiting ' + m.colour)))
      : h('p', { class: 'muted small' }, 'Nothing waits for your reply ✓'),
    wait.length ? h('p', { class: 'muted small' }, `⏭ ${wait.length} for later (they come back on their day).`) : null);
}

/** The one-by-one round: ui.replyRound = { ids (keys when it started), pos }. */
export function renderReplyRound(ctx, today = todayIndia()) {
  const r = ctx.ui.replyRound;
  const { ready } = repliesOf(ctx.store.view.data, today);
  const at = replyRoundAt(r.ids, r.pos, new Set(ready.map((m) => m.key)));
  r.pos = at.pos;
  const end = () => { ctx.ui.replyRound = null; ctx.render(); };
  const top = h('div', { class: 'round-top' },
    h('button', { class: 'icon back', 'aria-label': 'End', onClick: end }, '←'),
    h('strong', null, at.done ? 'Replies' : `Reply ${at.n} of ${at.of}`),
    h('button', { class: 'btn small', onClick: end, title: 'End (Esc)' }, 'End'));
  const fill = h('div');
  if (fill.style) fill.style.width = `${Math.round(at.progress * 100)}%`; // set through the style object (a style attribute is blocked by the page's safety rules)
  const bar = h('div', { class: 'reply-progress', 'aria-hidden': 'true' }, fill);
  if (at.done) {
    return h('div', { class: 'reply-round', key: 'reply-round-done' }, top, bar,
      h('div', { class: 'round-card round-finish' },
        h('div', { class: 'round-big' }, 'All replies checked ✓'),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', onClick: end }, 'Done'))));
  }
  const m = ready.find((x) => x.key === r.ids[at.pos]);
  const next = () => { r.pos = at.pos + 1; ctx.render(); };
  return h('div', { class: 'reply-round', key: 'reply-round-' + m.key }, top, bar,
    h('div', { class: 'round-card' },
      h('div', { class: 'mail-from' }, `From ${m.from}${m.mail.at ? ` · ${whenText(m.mail.at)}` : m.since ? ` · ${fmtDay(m.since)}` : ''}`),
      h('div', { class: 'reply-subject' }, m.subject, h('span', { class: 'muted small' }, ` · ${m.name}`)),
      m.preview ? h('div', { class: 'mail-preview muted small' }, m.preview) : null,
      mailLink(m, 'Open ↗'),
      m.newer ? h('div', { class: 'warn small' }, 'A newer email came after this draft — check it still fits.') : null,
      replyText(ctx, m),
      h('div', { class: 'round-actions' },
        h('button', { class: 'btn primary round-btn', onClick: () => ctx.openReplyDraft(m) }, 'Open in Outlook to send'),
        h('button', { class: 'btn round-btn', onClick: () => focusReply(m) }, '✎ Edit'),
        h('button', { class: 'btn round-btn', onClick: () => { if (markSent(ctx, m)) next(); } }, '✓ Sent'),
        h('button', { class: 'btn round-btn', onClick: () => { if (later(ctx, m)) next(); } }, '⏭ Later'))));
}
