// Things saved only on this device: the GitHub key, AI keys pasted here (they are also shared
// through the private data), the waiting changes and screen choices.

const KEYS = {
  github: 'dp.githubKey',
  claude: 'dp.claudeKey',
  gemini: 'dp.geminiKey',
  ui: 'dp.ui',
  report: 'dp.report',
};

function get(k) {
  try { return localStorage.getItem(k) || ''; } catch { return ''; }
}
function set(k, v) {
  try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* blocked */ }
}

export const device = {
  githubKey: () => get(KEYS.github),
  setGithubKey: (v) => set(KEYS.github, v.trim()),
  aiKey: (provider) => get(provider === 'gemini' ? KEYS.gemini : KEYS.claude),
  setAiKey: (provider, v) => set(provider === 'gemini' ? KEYS.gemini : KEYS.claude, v.trim()),
  ui: () => { try { return JSON.parse(get(KEYS.ui) || '{}'); } catch { return {}; } },
  setUi: (obj) => set(KEYS.ui, JSON.stringify(obj)),
  /** The Time report's last choices (group, period, by, % or hours). */
  report: () => { try { return JSON.parse(get(KEYS.report) || '{}'); } catch { return {}; } },
  setReport: (obj) => set(KEYS.report, JSON.stringify(obj)),
  /** "Forget this device": remove every key and anything waiting. */
  forgetAll() {
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith('dp.')) localStorage.removeItem(k);
    } catch { /* blocked */ }
  },
};
