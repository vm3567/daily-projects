// Things saved only on this device (never sent to GitHub). See PLAN.md section 25 "Device storage".

const KEYS = {
  github: 'dp.githubKey',
  claude: 'dp.claudeKey',
  gemini: 'dp.geminiKey',
  ui: 'dp.ui',
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
  /** "Forget this device": remove every key and anything waiting. */
  forgetAll() {
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith('dp.')) localStorage.removeItem(k);
    } catch { /* blocked */ }
  },
};
