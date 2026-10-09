# Daily Projects

A simple tracker for many projects. It shows the next step of every project, and colours each one so none gets forgotten.

- **Open it:** https://vm3567.github.io/daily-projects/
- **Your data** lives in a separate PRIVATE GitHub repository: `vm3567/daily-projects-data`.
- This repository holds only the app code. It has no data and no keys.

The full plan is in [PLAN.md](PLAN.md).

---

## Colours

| Dot | Meaning |
|-----|---------|
| 🟢 Green | You ticked a step today |
| 🟠 Orange | Not yet today, but ticked yesterday |
| 🔴 Red | Nothing ticked for 2+ days, or the deadline has passed |
| ⚪ Grey | Paused or finished |

---

## One-time setup

### 1. Turn on two-step login on GitHub
GitHub → your photo → **Settings** → **Password and authentication** → **Enable two-factor authentication**.

### 2. Make the app's GitHub access key
1. Go to https://github.com/settings/personal-access-tokens/new
2. **Token name:** `Daily Projects`
3. **Expiration:** the longest allowed.
4. **Repository access:** "Only select repositories" → pick `daily-projects-data`.
5. **Permissions → Repository permissions → Contents:** "Read and write".
   (Metadata: Read-only is added by itself.)
6. Press **Generate token**. Copy it (it starts with `github_pat_`).

### 3. Open the app on your Mac
1. Open https://vm3567.github.io/daily-projects/
2. Paste the key. Press **Open**.

### 4. iPhone
1. Open the same address in **Safari**.
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Open **Daily Projects** from the new icon (not from Safari).
4. Paste the key there.

> Always use the icon on iPhone. Safari forgets saved keys after 7 days without use; the icon does not.

### 5. AI helper (optional)
1. Get a Claude key: https://console.anthropic.com → **API keys** → **Create key**. Add a small credit under **Billing**.
2. In the app: **Settings → Claude key** → paste → **Save** → **Test**.
3. Gemini (backup, optional): https://aistudio.google.com → **Get API key**. Paste it under **Gemini key**.
4. Do this on each device (Mac and the iPhone icon).

---

## People

- **People** in the left menu: add names (or type `@` and a new name in any step).
- In a step, step note, work note or project notes, type `@` and the first letters, then pick a name (↓ ↑ Enter, or tap).
- Open a person to see, across all projects:
  - **Waiting on them** — steps marked "Waiting" on that person
  - **To discuss with them** — other open steps with `@Name`
  - notes about them, and steps done recently
- Tick steps right there when you meet them.

---

## Claude commands (on the Mac)

Open Claude in this folder and type:

| Command | What it does |
|---------|--------------|
| `/review-projects` | Goes through your projects one by one, red first. Suggests next steps. Adds them only after you say yes. |
| `/add` | Add a project or tasks in normal words. Asks before saving. |
| `/today` | Lists today's red and orange projects. Read only. |

These use the GitHub login already on the Mac. No extra key is needed.

---

## If something goes wrong

- **"Key problem":** the GitHub key expired or was deleted. Make a new one (step 2) and paste it. Unsaved changes are kept.
- **"No connection":** check the internet. Changes wait on the device and save when you are back online.
- **Restore old data:** ask Claude: "restore my tracker to 2026-10-09". The restore is saved as a new version, so nothing is lost.
- **Download a backup:** Settings → Download backup.

---

## For developers

- App: plain HTML/CSS/JS ES modules in `docs/` (served by GitHub Pages). No build step.
- Shared logic: `docs/rules.js` (dates, dot colours) and `docs/ops.js` (every change as an operation), used by the app and by `tools/tracker.mjs`.
- Saving: `docs/store.js` keeps a queue of operations, writes one commit through the Git Data API, and replays the queue on top of fresh data if another device saved first.
- Try it without GitHub: `npm run serve`, then open http://localhost:8080/?mock=1 (test mode, data kept in this browser only).
- Tests: `npm test`.
