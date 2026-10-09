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
Every project starts **red** at 12 midnight (India time).

| Dot | Meaning |
|-----|---------|
| 🔴 Red | Not looked at today |
| 🟡 Yellow | Opened today, nothing done yet |
| 🟢 Green | Changed something today, or pressed **✓ OK for today** |
| ⚪ Grey | Paused or finished |

A grey note **"No real work for N days"** shows when there was no real change for 3+ days (OK does not count). A passed target date shows **Overdue** in red.

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
4. Paste each key once, on any device — it is kept in your private data, so all your devices use it.
5. To really cancel a key, delete it at console.anthropic.com or aistudio.google.com. ("Remove" in Settings takes it out of the app, but GitHub keeps old versions; "Forget this device" does not remove shared keys.)

---

## Daily round (fastest way)

1. On **Today**, tap **▶ Daily round** (or press **g**).
2. You see one project at a time, red first.
3. Tap one button — it saves and jumps to the next project:
   **✓ Step done** (x) · **+ Add step** (s) · **✎ Note** (w) · **Chased** (c) · **✓ OK for today** (o) · **Skip** (n)
4. Skipped projects come back at the end. **End** (Esc) leaves the round.

Also: each red/yellow row has a one-tap **✓ OK** (or **Chased** when waiting), green projects fold into **Done today**, and ticking the last step asks **"What's next?"**.

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
| `/today` | Lists today's red and yellow projects (not done yet today). Read only. |
| `/restore` | Go back to an earlier day. Shows the version first and asks before changing anything. |

These use the GitHub login already on the Mac. No extra key is needed.

---

## If something goes wrong

- **"Key problem":** the GitHub key expired or was deleted. Make a new one (step 2) and paste it. Unsaved changes are kept.
- **"No connection":** check the internet. While offline the app does not accept new changes; changes made just before are kept on the device and saved when you are back online.
- **Restore old data:** in Claude type `/restore` (or "restore my tracker to 9 Oct"). Claude shows what that version has and asks "yes?" first. The restore is saved as a new version, so nothing is lost, and your AI keys are not changed.
- **Download a backup:** Settings → Download backup.

---

## For developers

- App: plain HTML/CSS/JS ES modules in `docs/` (served by GitHub Pages). No build step.
- Shared logic: `docs/rules.js` (dates, dot colours) and `docs/ops.js` (every change as an operation), used by the app and by `tools/tracker.mjs`.
- Saving: `docs/store.js` keeps a queue of operations, writes one commit through the Git Data API, and replays the queue on top of fresh data if another device saved first.
- Try it without GitHub: `npm run serve`, then open http://localhost:8080/?mock=1 (test mode, data kept in this browser only).
- Tests: `npm test`.
