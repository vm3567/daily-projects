// Daily Projects – Add: sends the mail or page you are looking at to the Daily Projects app.
// It never holds your GitHub key: it only opens the app with the details filled in (#add=…), and the app saves as usual.

const APP = 'https://vm3567.github.io/daily-projects/';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'dp-add', title: 'Add to Daily Projects', contexts: ['page', 'selection', 'link'] });
});

chrome.action.onClicked.addListener((tab) => send(tab, {}));
chrome.contextMenus.onClicked.addListener((info, tab) => send(tab, info));

/** Runs inside the page: the selected text, and the mail subject when this is Outlook (its tab title is only "Mail - Name - Outlook"). */
function readPage() {
  const pick = (sel) => { const el = document.querySelector(sel); return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; };
  let subject = '';
  if (/outlook\.(office|office365|live)\.com$/.test(location.hostname)) {
    subject = pick('[role="main"] [role="heading"][aria-level="2"]') || pick('[role="main"] [role="heading"]') || pick('[aria-label="Message subject"]');
  } else if (location.hostname === 'mail.google.com') {
    subject = pick('h2.hP');
  }
  return { selection: String(getSelection() || '').replace(/\s+/g, ' ').trim(), subject, url: location.href, title: document.title, ...readNames() };

  /** The sender and the other people on the mail (names only). Outlook and Gmail show them differently. */
  function readNames() {
    const clean = (t) => String(t || '').replace(/<[^>]*>/g, '').replace(/["']/g, '').replace(/\s+/g, ' ').trim();
    const nameOf = (t) => { t = clean(t); return /@/.test(t) && !/\s/.test(t) ? t.split('@')[0].replace(/[._]/g, ' ') : t; };
    let from = '';
    const people = [];
    if (location.hostname === 'mail.google.com') {
      const s = document.querySelector('.adn .gD[name], span.gD[name]');
      from = s ? s.getAttribute('name') : '';
      document.querySelectorAll('.adn span.g2[name], span.g2[name]').forEach((e) => people.push(e.getAttribute('name')));
    } else if (/outlook\./.test(location.hostname)) {
      const pane = document.querySelector('[role="main"]') || document;
      // labels like "From: Ravi Kumar" / "To: Suresh; Anita" on the reading pane
      pane.querySelectorAll('[aria-label]').forEach((e) => {
        const m = /^(From|To|Cc|Sender)\s*:\s*(.+)$/i.exec(e.getAttribute('aria-label') || '');
        if (!m) return;
        const names = m[2].split(/[;,]/).map(nameOf).filter(Boolean);
        if (/^(from|sender)$/i.test(m[1]) && !from) from = names[0] || '';
        else people.push(...names);
      });
      // people shown as name buttons whose tooltip is their email address
      if (!from) {
        const s = pane.querySelector('[role="heading"] ~ * span[title*="@"], span[title*="@"]');
        if (s) from = nameOf(s.textContent || s.title);
      }
    }
    const seen = new Set();
    const list = [from, ...people].map(nameOf).filter((n) => n && n.length <= 60 && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()));
    return { from: nameOf(from), people: list.slice(0, 8) };
  }
}

async function send(tab, info) {
  if (!tab || !tab.id) return;
  if (tab.url && tab.url.startsWith(APP)) return; // already in the app
  let page = { selection: '', subject: '', url: tab.url || '', title: tab.title || '' };
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readPage });
    if (r && r.result) page = r.result;
  } catch { /* chrome:// pages and the Web Store cannot be read: use the tab title and address */ }
  const url = info.linkUrl || page.url;
  const title = (info.linkUrl ? info.selectionText || url : page.subject || page.title || url).slice(0, 200);
  const text = (info.selectionText || page.selection || title).slice(0, 1000);
  const target = APP + '#add=' + encodeURIComponent(JSON.stringify({ text, title, url, from: page.from || '', people: page.people || [] }));
  // Use the Daily Projects tab if one is open (no second copy of the app), else open a new one next to this tab.
  const [open] = await chrome.tabs.query({ url: APP + '*' });
  if (open) {
    await chrome.tabs.update(open.id, { url: target, active: true });
    await chrome.windows.update(open.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: target, index: tab.index + 1 });
  }
}
