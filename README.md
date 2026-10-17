# Daily Projects

A simple tracker for many projects. It shows the next step of every project, and colours each one so none gets forgotten.

- **Open it:** https://vm3567.github.io/daily-projects/
- **Your data** lives in a separate PRIVATE GitHub repository: `vm3567/daily-projects-data`.
- This repository holds only the app code. It has no data and no keys.


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

## Time log

- In a project press **▶ Start** — it becomes **⏸ 0:23**. The running timer also shows at the top of every screen; tap **⏸ Stop** there.
- Starting another project stops the first one. Pausing or finishing a project stops its timer. A timer left on is cut to 10 hours.
- Forgot to time it? **+ Add time** (minutes, or hours like 1.5h). **Entries** shows each one with 🗑 (Undo available).
- Each project shows **Today · This week · Total**. The **Dashboard** shows **Time this week** by group and project, compared with last week. **Today's summary** shows the time per project.

---

## Tags and the Time report

- **Timer** works in **Acton** and **Ceramic Ninja** (not Personal). Change it per group in **Settings → Groups and tags**.
- **Tags belong to a group** (e.g. Acton: Kiln, Glaze, Quality). Add / rename / delete them in Settings, or pick **+ New tag…** inside a project. One tag per project: tap the line under the project name (group · tag · priority) to set it.
- **Time report** (left menu, or 🔍 → "Time report"): pick the **group**, the **period** (this week, last week, this month, last month, or your own dates), **By tag / By project**, **% / Hours**. A pie chart shows where the time went.
- **⬇ Download image** saves a PowerPoint-size (16:9) picture; **📋 Copy image** lets you paste it straight into PowerPoint or WhatsApp.
- **Work done** (under the pie): the steps you finished in that period, grouped by tag.
- **⬇ Full report image** / **📋 Copy full report**: one picture with the time pie on the left and the work done on the right — the monthly owner report. Pick **Last month**, then download.

---

## Writing what you did (inside the step)

- The **write box sits inside the next step** (blue box), with that step's latest notes just above it.
- **Click another step's words** (or its 📝) and the box moves into that step. Press **Enter** in a step to jump into its box.
- Write what happened. **Save** (or Enter) keeps the note. **✓ Save + done** (or **Ctrl/⌘+Enter**) keeps the note and ticks the step.
- **whole project** (right of the buttons) writes a note about the project, not one step.
- **Photos:** paste a screenshot into the box (Ctrl/⌘+V), or drag files onto the project page. Photos go on the note; other files go to Files.
- When the project turns green, a **Next: …** button opens the next project that still needs you.
- All notes are listed under **Work notes**, each saying which step it was about.

## How the app looks and feels

- **Opens at once** with the copy kept on your device, then quietly updates (the cloud sign is grey for a moment).
- **Saved sign:** a green ☁✓ at the top means everything is saved. Grey ☁… means saving. "Offline" shows only when there is no internet.
- **Rows slide** to their new place when a project turns green or a step is done.
- **Project page:** Status, Steps (with the write box) and Done are open. Work notes, notes, links, files and history are under **▸ More** (it stays open once you open it).
- **Messages** are small, in the bottom-right corner.
- **iPhone:** a bar at the bottom — Today, Inbox, People, More — and bigger buttons.
- **Remembers where you were:** the same page, project and scroll place when you open the app again.

## ⏰ Remind me (a step comes back later)

- Click **⏰** on a step, then **1 day**, **2 days**, **1 week**, or pick a date.
- The step goes grey with its day ("⏰ 12 Oct") and waits. The write box moves to the next step.
- On that day it comes back as the **next step**, marked "⏰ Reminder".
- If **every** step of a project is waiting for a reminder, the project rests (like Snooze) and returns on the first reminder day. It does not break your streak.
- Changed your mind? Click ⏰ again → **Show it now**.
- The reminder shows when you open the app (it cannot send a phone notification).

## Name, delete and typing help

- **Change a project's name:** click the name at the top (or the ✎ next to it), type, press Enter.
- **Delete a project:** 🗑 at the top right of the project (or right-click it in the list → Delete project…). You get a few seconds to press **Undo**.
- **No next step:** the page asks for the next step first ("What's next?"). The "anything done today" box is below it and is optional.
- **Auto-correct:** common typing mistakes are fixed when you finish a word ("teh" → "the", "becasue" → "because"). No AI, no internet. **Backspace** right after a fix puts your spelling back. Turn it off in **Settings → Typing**.

## Status, Snooze and Inbox

- **Status:** one line under the project name on where it stands. It saves by itself, shows in the list, and goes into the owner report ("Where things stand"). After 7 days it turns grey and asks for an update.
- **💤 Snooze:** type a number of days (or tap 1 / 3 / 7 / 14). The project leaves Today, does not count against your streak, waits in **💤 Snoozed** at the bottom of Today, and comes back by itself on that day. **⏰ Wake up now** brings it back early. Also in the right-click menu.
- **📥 Quick capture:** press **Q** anywhere (or 📥 at the top, on iPhone too), type, Enter. It goes to the **Inbox**. Today shows "📥 Inbox (n) — sort now". In the Inbox, tap a suggested project, or pick any project (or "+ New project in …") to turn the item into a step.

---

## Moving around quickly

- **Jump anywhere:** press **Ctrl+K** (Mac: **⌘K**) or tap **🔍**, type a few letters of a project, person or page, press **Enter**.
- **Next / previous project** in the list you are in (Today, All, Acton, …): **‹ Prev · Next ›** at the top of a project, keys **← →**, or **swipe left / right** on the iPhone.
- **People:** the people you are waiting on show under **People** in the left menu. Inside a project, tap **👤 Name** to see all your pending work with that person. On a person's page, **‹ ›** (or **← →**) goes to the next person with open work.
- **← Back** (or **Backspace**) returns to where you came from.
- **Right-click a project** in the list: tick the next step, add a step, write an update, OK for today, Chased, start the timer, pause — without opening it.
- **Search + Enter** opens the first project found.
- The **Time report** remembers your last choices, and in the first week of a month it opens on **Last month** (owner report time).

---

## People

- **People** in the left menu: add names (or type `@` and a new name in any step).
- In a step, step note, work note or project notes, type `@` and the first letters, then pick a name (↓ ↑ Enter, or tap).
- Open a person to see, across all projects:
  - **Waiting on them** — steps marked "Waiting" on that person
  - **To discuss with them** — other open steps with `@Name`
  - notes about them, and steps done recently
- Tick steps right there when you meet them.
- **📋 Send pending list** writes a message with everything open with that person (waiting on them, and to discuss) — Copy, WhatsApp or Email. Their own name is left out, because the message goes to them.

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
- **Two computers (or computer + phone):** a change is sent 2 seconds after you make it, and at once when you switch away or close the app. If something is still being sent, the browser asks before closing. The other computer checks every 30 seconds, and at once when you come back to its window or wake it from sleep. It then shows **↻ Updated with changes from your other device**. Tip: before you leave a computer, look for ☁︎✓ at the top (all sent). If a change has waited more than a minute, a red bar at the top says **N changes not sent yet** — tap it to send.
- **No internet:** the app still opens (after it was opened once online) and shows your projects as they were last time — the top says **Offline**. Tick, add steps, write notes, use the timer: changes wait on the device and are saved by themselves when the internet is back (or tap ↻). If another device changed things meanwhile, both are kept. AI, photos and files need internet.
- **Restore old data:** in Claude type `/restore` (or "restore my tracker to 9 Oct"). Claude shows what that version has and asks "yes?" first. The restore is saved as a new version, so nothing is lost, and your AI keys are not changed.
- **Download a backup:** Settings → Download backup.

---

## For developers

- App: plain HTML/CSS/JS ES modules in `docs/` (served by GitHub Pages). No build step.
- Shared logic: `docs/rules.js` (dates, dot colours) and `docs/ops.js` (every change as an operation), used by the app and by `tools/tracker.mjs`.
- Saving: `docs/store.js` keeps a queue of operations, writes one commit through the Git Data API, and replays the queue on top of fresh data if another device saved first.
- Try it without GitHub: `npm run serve`, then open http://localhost:8080/?mock=1 (test mode, data kept in this browser only).
- Tests: `npm test`.

## Chrome button: add a mail or web page

The folder `chrome-extension` is a small Chrome add-on. It adds the mail or page you are looking at to Daily Projects, with a link back to it.

**Install (once on each computer):**
1. In Chrome, open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `chrome-extension` folder.
4. Click the puzzle piece 🧩 at the top of Chrome and pin **Daily Projects – Add**.

**Use:**
1. Open a mail in Outlook (in Chrome), or any web page. Select a line first if you want that line as the step.
2. Click the blue ✓ button, or press **Alt+Shift+D**, or right-click → **Add to Daily Projects**.
3. The app opens with the box filled in. Tap a project to add it as a step, or choose **+ New project** / **📥 To Inbox**.
4. The step shows **✉ Open mail** (or **↗ Open page**). Click it to go straight back.

**In the box:**
- **⚠︎ Already in …** — this mail was added before (even if it is now in another folder). Tap **Open** to go there.
- **People** — names from the mail (sender first). Tap ✕ on anyone you do not want. The rest are added to People and @mentioned in the step.
- **Waiting for a reply from** — tick it: the step shows Waiting on that person (Chased / ✍ Draft follow-up work as usual).
- **When** — Today, Tomorrow, In 2 days, 1 week. Later days hide the step until then (like ⏰ Remind me).

Shortcut: **Alt+Shift+D** (Mac: Option+Shift+D). After an update to the add-on files, open `chrome://extensions` and press ↻ on Daily Projects – Add.

The add-on never holds your GitHub key. It only opens the app with the details filled in; the app saves as usual. Links open the mail only in a browser signed in to Outlook on the web (not the Outlook desktop app).

## Add a task from a person's page

On a person's page (People → a name), the blue box **Add a task with …** adds a step without opening the project:
1. Write the task (press **N** on the page to jump to the box).
2. **I do it** (they are @mentioned) or **Waiting on …** (shows Waiting with a day count, Chased, ✍ Draft).
3. **When**: Today, Tomorrow or 1 week (later days hide it until then).
4. Tap a project (their projects come first, or Search…, or + New project). Enter adds it to the first one.

## WhatsApp and Outlook straight to a person

On a person's page, fill in **📞 WhatsApp number** (10-digit Indian numbers get +91 by themselves) and **✉ Email**. Then **📋 Send pending list** and **✍ Draft** show **WhatsApp Ravi** and **✉ Outlook Ravi**: WhatsApp opens the chat with the message written; Outlook (on the web) opens a new mail with To, subject and text filled in. You only press Send. Without a number or email the buttons still work; you pick the person yourself.

## Siri: add by voice (iPhone)

Say **"Hey Siri, Daily add"**, then say what to add. The app opens and saves it.

- "Check kiln burner" → goes to the 📥 Inbox.
- "Order clay **for Kiln trial**" (or "for the Kiln trial project") → a step in that project.
- "… **waiting on Ravi**" → marked as waiting for Ravi.
- "… **tomorrow**" / "in 2 days" / "next week" / "on Monday" → it comes back on that day.
- If it cannot find the project, it goes to the Inbox and says which name it did not find. Nothing is lost.
- Every add shows **Undo** for a few seconds.

**Set up once on the iPhone (Shortcuts app):**
1. Open the app link in **Safari** and check your projects show (the GitHub key must be saved in Safari).
2. Shortcuts → **+** → add **Ask for Input** (Text, prompt "What should I add?").
3. Add **URL Encode** (Encode, Provided Input).
4. Add **Text**: `https://vm3567.github.io/daily-projects/#say=` followed by the URL Encoded Text.
5. Add **Open URLs**.
6. Name the shortcut **Daily add**.

If the app is still loading or the key is missing, the words are kept on the phone and saved as soon as the app is ready.

## One place: worktask.in (projects + team)

Everything now lives on **https://worktask.in** (Hostinger), with a username and password for everyone.

- **You** sign in and go straight to your projects (worktask.in/projects/). The 👥 button opens the Team pages.
- **Staff** sign in and see only "My tasks today". They never see your projects.
- On a step: ⋯ → **👥 Give to team**. The step then shows the person's latest update (✓ time, or "not filled today").
- Your projects are saved on the server as versions (like GitHub was): nothing is lost, two computers never overwrite each other.
- The old address (vm3567.github.io/daily-projects) forwards to worktask.in. Siri and the Chrome button keep working.
- Claude's /today, /add, /review-projects and /restore use the server over SSH (`tools/tracker.mjs`).
- To publish code changes: `sh tools/deploy-worktask.sh`.

### Give a whole project to a person

On a project: **👥 Give project** → pick the person. They see its open steps in order; only the **current** step needs a daily update, the rest show as "Coming next". When they tap Finished, your step ticks itself and the next step becomes current. Steps you add later go to them; steps you tick or delete leave their list. **Change person** or **Take back** on the blue bar.

### More team tools
- **Team line on Today:** "👥 Team: 3 of 5 sent · 1 stuck · not filled: Valar" — tap it to open Team today.
- **Right-click a project → 👥 Give project to…** (or Take back).
- **📷 Photo needed to finish:** tick it when giving a task or a project; staff cannot tap Finished without a photo.
- **📎 Instructions:** add photos or PDFs to a task (Give a task form, or open the task → 📎 Add instruction photo / PDF). Staff see them on the task.
- **↔ Move a task:** open the task → **↔ Move to…** → pick the person. Its updates stay; both see a note. A step of a given project moves the whole project (your project's blue bar follows). **People → ↔ Move all tasks to…** hands over everything when someone is on leave.

### Offline
- **Projects:** works without internet. An orange **📴 Offline** bar says so; your changes wait on the device and are sent by themselves when the internet is back (tap the bar to try at once).
- **Staff app:** opens with the last saved list. Updates (with photos) and messages sent offline show **⏳ Waiting to send** and go out by themselves when online.
- The installed app opens on your projects; the 👥 button opens the Team pages (worktask.in/?team).

### Tests
`npm test` runs everything (about 130 checks, ~10 seconds): the app's rules, the projects storage, Claude's commands against a pretend server, quick PHP tests (`team/tests/unit.php`) and the full Work Task server — each run starts its own throwaway MySQL and PHP server, runs the setup, and tests sign-in, tasks, messages, photos, moves, giving projects, owner protection, projects storage and the command tool. Needs `php` and `mysqld` (Homebrew); without them the server tests are skipped.
