// Sending while offline, for the staff view: today's update (with photos), messages, steps and suggestions wait
// on the phone and go out when the internet is back.
// It is Work Task's own outbox on this site (IndexedDB "worktask", store "outbox", the same item shape), so what
// waits is sent by whichever of the two apps is open: one sender at a time (the "wt-outbox" lock), and the
// server keeps each clientId once. The way each item is sent follows Work Task's sendItem step by step.

/** The phone's outbox (IndexedDB). */
export function idbOutbox() {
  const open = () => new Promise((resolve, reject) => {
    const r = indexedDB.open('worktask', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('outbox', mode);
      const req = fn(tx.objectStore('outbox'));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Could not save on this phone.')); // e.g. phone storage full
    });
  };
  return {
    all: () => run('readonly', (s) => s.getAll()).then((x) => x || []),
    add: (item) => run('readwrite', (s) => s.add(item)),
    // remember how far an item got; only while it is still there (the other app may have sent and removed it)
    put: (item) => run('readwrite', (s) => { s.get(item.id).onsuccess = (e) => { if (e.target.result) s.put(item); }; }),
    del: (id) => run('readwrite', (s) => s.delete(id)),
  };
}

/** The same, in memory (tests). */
export function memOutbox() {
  const items = new Map();
  let next = 1;
  return {
    items,
    all: async () => [...items.values()].map((x) => ({ ...x, files: x.files ? [...x.files] : x.files })),
    add: async (item) => { const id = next++; items.set(id, { ...item, id }); return id; },
    put: async (item) => { if (items.has(item.id)) items.set(item.id, { ...item, files: item.files ? [...item.files] : item.files }); },
    del: async (id) => { items.delete(id); },
  };
}

const istDay = (at) => new Date(at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const newClientId = () => (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''));

/**
 * opts: { box (idbOutbox / memOutbox), api, rules (Work Task's logic.js), userId(), signedIn() (still the same sign-in),
 *   toast(text, ms), giveBack(item, why), older(kept), lock (navigator.locks or null), now() }
 * Errors from api carry .offline / .auth / .retry (as Work Task's OfflineError / AuthError / RetryError).
 */
export function createOutbox(opts) {
  const { box, api, rules, toast = () => {}, giveBack = () => {}, older = () => {} } = opts;
  const now = opts.now || (() => new Date());
  const lock = opts.lock === undefined ? (typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null) : opts.lock;
  let flushing = null;

  /** This person's waiting items, oldest first. */
  async function list() {
    try { return (await box.all()).filter((x) => x.userId === opts.userId()).sort((a, b) => a.id - b.id); } catch { return []; }
  }

  /** Keep an item on the phone (throws when the phone cannot keep it). */
  async function queue(item) {
    await box.add({ ...item, clientId: item.clientId || newClientId(), userId: opts.userId(), at: now().toISOString() });
  }

  async function sendItem(it) {
    const day = istDay(it.at); // the day it was written, not the day it is sent
    const mine = () => { if (!opts.signedIn()) throw Object.assign(new Error('Signed out.'), { auth: true }); }; // never with the next person's sign-in
    if (it.kind === 'update' && !it.updateId && daysBetween(day, istDay(now())) > 2) // the server would save it as today's update
      throw new Error(`This update was written on ${day}, too long ago to send. Please write it again for today`);
    if (it.kind === 'comment') { await api('comment.add', { taskId: it.taskId, text: it.text, day, clientId: it.clientId }); return; }
    if (it.kind === 'step') { await api('project.addStep', { projectRef: it.projectRef, title: it.title, clientId: it.clientId }); return; }
    if (it.kind === 'suggest') { await api('suggest', { title: it.title, details: it.details, repeat: it.repeat, clientId: it.clientId }); return; }
    if (it.kind === 'update' && !it.updateId) {
      const twoSteps = it.state === 'finished' && it.needsPhoto && it.files && it.files.length && !it.hadPhoto;
      const out = await api('update.save', rules.updateSaveBody({ taskId: it.taskId, note: it.note, state: twoSteps ? 'progress' : it.state, day, writtenAt: it.at, clientId: it.clientId }));
      it.updateId = out.update.id; it.thenFinish = !!twoSteps && !out.history;
      it.day = out.update.day; // the day the server saved it for (it puts a wrong phone date right)
      if (twoSteps) it.note = out.update.note; // keep the earlier person's words (after a move) for the Finished save
      if (out.history === 'merged' || out.history === 'older') { // kept as words only (the task moved on, or a newer update of theirs stays)
        const kept = out.history === 'older' ? rules.olderShow(it, out.update) : null; // its words are not lost without a word
        if (kept) older(kept);
        if ((it.files || []).length) toast('The photos of a late update were not added: the task has a newer update now.', 7000);
        it.files = [];
      }
      await box.put(it);
    }
    while ((it.files || []).length) { // kind 'update' or 'photos'
      mine();
      const fd = new FormData(); fd.append('updateId', String(it.updateId)); fd.append('file', it.files[0], 'photo.jpg');
      if (it.clientId) fd.append('clientId', `${it.clientId}-p${it.photoNo || 0}`);
      try { await api('photo.add', fd, true); it.files.shift(); it.photoNo = (it.photoNo || 0) + 1; }
      catch (ex) {
        if (ex.offline || ex.auth || ex.retry) throw ex;
        if (/^Up to \d+ photos/.test(ex.message)) it.files = []; // already full: the photos went before
        else { it.files.shift(); toast(`A photo was not sent: ${ex.message}`, 8000); }
      }
      await box.put(it);
    }
    mine();
    if (it.thenFinish) await api('update.save', rules.updateSaveBody({ taskId: it.taskId, note: it.note, day: it.day || day, clientId: it.clientId, finish: true })); // (the same day as the first save)
  }

  async function doFlush() {
    let sent = 0, gave = 0;
    const uid = opts.userId();
    const stuck = new Set(); // tasks with an item the server keeps failing on: later items for them wait behind it
    for (const it of await list()) {
      if (!opts.signedIn() || opts.userId() !== uid) break; // signed out, or someone else signed in
      if (stuck.has(rules.itemKey(it))) continue;
      try {
        await sendItem(it);
        await box.del(it.id);
        sent++;
      } catch (ex) {
        if (ex.offline || ex.auth) break; // keep it: try again later
        if (ex.retry) { // a server error: keep it, but after a few tries let the items behind it go first
          it.tries = (it.tries || 0) + 1;
          if (it.tries >= 20 && now() - new Date(it.at) > 12 * 3600000) { // failing for half a day: give up on it
            await box.del(it.id);
            giveBack(it, ex.message); gave++;
            continue;
          }
          await box.put(it);
          if (it.tries < 5) break;
          stuck.add(rules.itemKey(it));
          continue;
        }
        await box.del(it.id); // refused by the server (e.g. task closed): say so, do not retry forever
        giveBack(it, ex.message); gave++;
      }
    }
    return { sent, gave };
  }

  /** Send what waits, oldest first; stops at the first "still offline". One send at a time (also across both apps). */
  function flush() {
    if (flushing) return flushing;
    const run = lock && lock.request ? lock.request('wt-outbox', { ifAvailable: true }, (l) => (l ? doFlush() : { sent: 0, gave: 0, busy: true })) : doFlush();
    flushing = Promise.resolve(run).catch(() => ({ sent: 0, gave: 0 })).finally(() => { flushing = null; });
    return flushing;
  }

  return { list, queue, flush, sendItem };
}
