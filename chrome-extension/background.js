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
  return { selection: String(getSelection() || '').replace(/\s+/g, ' ').trim(), subject, url: location.href, title: document.title };
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
  const target = APP + '#add=' + encodeURIComponent(JSON.stringify({ text, title, url }));
  // Use the Daily Projects tab if one is open (no second copy of the app), else open a new one next to this tab.
  const [open] = await chrome.tabs.query({ url: APP + '*' });
  if (open) {
    await chrome.tabs.update(open.id, { url: target, active: true });
    await chrome.windows.update(open.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: target, index: tab.index + 1 });
  }
}
