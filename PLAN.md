# Daily Projects — Plan

Date: 9 Oct 2026
Status: Built (9 Oct 2026). Live at https://vm3567.github.io/daily-projects/
Version: 5.
- v1: Mac only.
- v2: Online with Supabase, on any device + iPhone.
- v3: Added GitHub, AI helper, Claude review, coding details.
- v4: Removed Supabase and Netlify. Everything lives on GitHub. No daily reminder for now.
- v5: Fixed 16 gaps found in review: safe saving between devices, iPhone key storage, file safety, deadlines, AI choice, history rules.

---

## 1. Goal

- See all my projects in one place.
- Always know the next step of every project.
- Work on every project every day. Forget none.
- Open it in any browser: Mac, iPhone, any computer.
- Get help from AI to plan steps and pick what to do first.
- Only I can see my projects.
- Keep it simple: only GitHub, no other online services.

---

## 2. Decisions (from our chat)

| # | Topic | Decision |
|---|-------|----------|
| 1 | App name | Daily Projects |
| 2 | Number of projects | More than 15 |
| 3 | Where to use it | Any browser: Mac, iPhone, any computer |
| 4 | Online service | GitHub only. No Supabase, no Netlify. |
| 5 | App code | Public GitHub repository (online folder). The website is served free by GitHub Pages. |
| 6 | My data | A separate PRIVATE GitHub repository. Only I can see it. |
| 7 | Access | A GitHub access key (a password made only for this app), pasted once on each device |
| 8 | Not a phone app | It is a web page. On iPhone I always open it from a home-screen icon (keeps my keys safe). |
| 9 | Project details | Steps list, notes, links, deadline, priority |
| 10 | Simple vs big projects | Both use a steps list. A simple project just has one step. |
| 11 | Reminder | Red colour on the page only. No pop-up reminder for now. |
| 12 | Waiting steps | A grey "Waiting" label. The project still shows every day. |
| 13 | How often | Every active project, every day |
| 14 | Pause | Yes. Hides the project from Today until I unpause it. |
| 15 | Finish | Yes. Moves it to "Finished" with full history. |
| 16 | Diary | Yes. Shows what I did each day, across all projects. |
| 17 | Groups | Acton, Personal, Ceramic Ninja (set 9 Oct; I can add more later) |
| 18 | Look | Light and clean |
| 19 | Adding projects | I add them myself on the page with a "+" button |
| 20 | Layout | Like Outlook mail. 3 columns. One page. No moving between pages. |
| 21 | Work note | Yes. A quick box: "What did you do today?" |
| 22 | Step details | Step text (required), plus optional due date, small note, "waiting on whom" |
| 23 | List order | My own order. I drag projects up and down. |
| 24 | Backup | Every save is kept as a version on GitHub, forever. Plus a "Download backup" button. |
| 25 | Red rule | DAILY: every project turns red at 12 midnight India time (not looked at today). A passed target date shows "Overdue" in red text. Changed 9 Oct. |
| 26 | Green / yellow | Yellow = opened today. Green = any change today, or the "✓ OK for today" button. A grey "No real work for N days" note shows after 3+ days without a real change (OK does not count). Changed 9 Oct. |
| 27 | Files | Upload copies of files into the project (saved in the private data repository) |
| 28 | Search | One search box. Searches project names, steps, notes. |
| 29 | AI jobs | Break a project into steps, suggest the next step, Morning plan, Weekly review |
| 30 | AI choice | Claude Haiku is the main AI (it does not train on my text). Gemini Flash is a backup switch in Settings. |
| 31 | AI keys | Pasted once in Settings on any device; stored in my PRIVATE data repository so every device uses them (changed 9 Oct). Left out of "Download backup". |
| 32 | AI can read | All projects (names, steps, notes) |
| 33 | AI output place | Morning plan and Weekly review show at the top of the Today screen |
| 34 | AI limit | Max 50 AI uses a day |
| 35 | Claude review on Mac | Claude goes through my projects one by one with me. It adds or changes things only after I say yes. |
| 36 | Deleting a project | Its Diary lines stay, marked "(deleted project)" |
| 37 | Target date | Every new project gets a target date 30 days ahead. I can change or remove it. ("Deadline" is called "Target date" in the app.) |
| 38 | Keyboard | Shortcuts on the computer (each key letter is shown on its button or box): ↓ ↑ move between projects, x tick, s add step, w note, n new project, / search, r Red first, t Today, d Diary, Esc leave, ? help |
| 39 | People | A People list (name only). Type @ in a step, step note, work note or project notes to pick a person. Each person's page shows "Waiting on them" and "To discuss with them" (all projects), notes about them, and done steps. "Waiting on" uses the same names. Keyboard: p opens People. |
| 40 | Follow-up | Each person gets a dot: red = waiting on them 2+ days (or a linked step's date passed) → contact now; orange = something open; green = nothing open. Today shows a "Follow up today" row (red and orange names). Waiting steps show "Waiting: Name · Nd". |
| 41 | Fewer clicks | (1) Daily round: one project at a time, red first; each action (✓ step done, + add step, ✎ note, Chased, ✓ OK, Skip) saves and jumps to the next project. Keys g, then x s w c o n. (2) ✓ OK / Chased button on each list row. (3) Green projects fold into "Done today (n)" on Today. (4) Ticking the last step asks "What's next?". (5) Chased: notes the follow-up and restarts the waiting count. |
| 42 | Undo, repeat, streak | Undo button on the message after tick / OK / chased / delete step or note / pause / finish / delete project (puts the project back exactly). Repeating steps: Every day / week / month in the step's ⋯; ticking makes a copy that comes back on the next date. Streak "🔥 N days all green" on Today and a 7-day bar chart in the Diary. Step and note deletes no longer ask "Are you sure?" (Undo instead). |
| 43 | AI steps | One "✨ AI steps" button (key i) in each project: reads title, notes, steps and work notes, suggests 3–7 next steps in order (top = next). Untick, ✕ remove or edit any, then "Add N steps". Uses the chosen AI; if it fails, tries the other key. List rows no longer show the target date (only "Overdue"). |
| 44 | Notes save sign | Under the big Notes box: "Typing…" → "Saving…" → "Saved ✓ time" (red if no connection). Typed text is also saved when leaving the app or switching tabs. |
| 45 | Dashboard | Menu → Dashboard (key b): today's green count, current and best all-green streak, all-green days this month, a month calendar of green days (‹ › for other months), last 7 days numbers (steps done, notes, projects worked on), most worked projects this month, projects that need attention (overdue or no real work 3+ days), people to contact, wins this week (the real steps done), this week vs last week, all-time totals, a 🏆 shelf of finished projects, and a 🎉 all-green celebration (also on Today). |
| 46 | Today's update | "What did you do today?" became "Today's update": shows the next step on top; the note is linked to that step; tick "This step is done" and a "What's next?" box appears; one Save (Enter) saves note + tick + next step with one Undo. Notes show under their step and in the Diary ("on: step"). |
| 47 | Draft, summary, photos | ✍ Draft on waiting steps (project page, person page, daily round key m): AI writes a short polite follow-up; Copy / WhatsApp / Email / Mark as chased. 📋 Summary on Today: everything done today by project, with next steps and who you wait on; Copy / WhatsApp / Email; ✨ Shorter with AI. 📷 Photo in Today's update and the daily round (iPhone camera or library); photos are linked to that note. |

---

## 3. Screen layout on computer (one page)

```
+-------------+---------------------------+-----------------------------------+
| LEFT MENU   | PROJECT LIST              | PROJECT DETAILS                   |
|             |                           |                                   |
| [Search...] | ┌ MORNING PLAN (AI) ────┐ | Kiln trial           [Pause][Done]|
|             | │ 1. Call supplier      │ | Group: Ceramic   Priority: High   |
| Today   18  | │ 2. Write AI intro ... │ | Deadline: 20 Oct                  |
| All     22  | └───────────────────────┘ |                                   |
| -- Groups --| ● Kiln trial      (red)   | STEPS            [✨ Suggest next] |
| AI       5  |   Next: Call supplier     | [x] Order clay                    |
| Ceramic  8  | ● AI article      (orange)| [ ] Call supplier  (Waiting: Ravi)|
| General  4  |   Next: Write intro       | [ ] Fire sample    by 15 Oct      |
| Work     5  | ● Glaze test      (green) | + Add step   [✨ Break into steps] |
| ----------- |   Next: Fire sample       |                                   |
| Paused   2  |                           | WHAT DID YOU DO TODAY? [______]   |
| Finished 6  |                           | NOTES / LINKS / FILES             |
| Diary       |  [+ New project]          | HISTORY                           |
| Settings    |                           |                                   |
+-------------+---------------------------+-----------------------------------+
```

### Left column: the menu
- Search box at the top.
- Today: all active projects, with a count.
- All projects.
- Groups: AI, Ceramic, General, Work / Office. Each shows a count.
- Paused.
- Finished.
- Diary.
- Settings.
- "+ Group" to add a new group.

### Middle column: the project list
- On the Today screen, the AI box (Morning plan or Weekly review) sits at the top. It can be folded away.
- One row per project, like an email.
- Each row shows the coloured dot, the project name and the next step.
- A grey "Waiting" tag shows if the next step is waiting.
- A small deadline shows if one is set.
- Drag rows up and down to set my own order.
- A "+ New project" button.

### Right column: the project details
- Everything about the clicked project.
- I can edit everything right there. No pop-up windows.
- Changes save on their own. There is no Save button.
- A small sign at the top shows "Saving…" then "Saved ✓".

---

## 4. Screen layout on iPhone

A phone is too narrow for 3 columns. So the same page shows one column at a time, like the Outlook app on a phone:

1. **List screen:** the search box, the AI box, then the project list with coloured dots. A menu button (☰) at the top opens Today, Groups, Paused, Finished, Diary and Settings.
2. **Tap a project:** the details slide in. Everything can be edited here too.
3. **Back arrow:** returns to the list.

- It is still one page. Nothing reloads.
- Tick boxes and buttons are big enough for a finger.
- Drag to reorder works with a press-and-hold.
- Always open it from the "Daily Projects" home-screen icon (Safari → Share → "Add to Home Screen").
- Why: Safari wipes saved keys from websites not opened for 7 days. The home-screen icon does not.
- The icon has its own storage, so I paste my keys inside the icon app, not in Safari.

---

## 5. Colour rules (the dot)

| Colour | Meaning |
|--------|---------|
| Green | I changed something today, or pressed "OK for today" |
| Yellow | I opened it today, nothing done yet |
| Red | Not looked at today (every project resets to red at midnight) |
| Grey | Paused or finished (not on Today) |

- A brand-new project starts orange. It turns red after 2 days with no step ticked.
- After unpausing, the count starts again from the unpause day, so it starts orange.
- Any change to the project today turns it green: adding, ticking or editing a step, a work note, notes, links, files, group, priority or target date.
- Unticking the only step ticked today takes the green away again.
- A passed deadline keeps the dot red even after ticking steps. Fix: finish the project, or change the deadline.
- Deleting a ticked step does not change the dot.
- "Today" means India time. A new day starts at midnight.

---

## 6. Project parts

Each project has:
1. Name.
2. Group: AI, Ceramic, General, Work / Office, or a new one.
3. Priority: High, Medium or Low. New projects start as Medium.
4. Deadline (optional).
5. Steps list.
6. "What did you do today?" note box.
7. Notes: free text.
8. Links: web links.
9. Files: uploaded copies of files.
10. History: everything that happened, with dates.
11. State: Active, Paused or Finished.

---

## 7. Steps

- Each step has its text. This is the only required part.
- Optional extras, hidden until I use them:
  - due date (shown in red once it has passed)
  - small note
  - waiting on whom (for example "Waiting on Ravi")
- Tick to finish a step. Finished steps move to a "Done" section under the list.
- Drag steps to change their order.
- The "Next step" shown in the list is the first unfinished step.
- If no steps are left, the list shows "No next step — add one" in red text.
- Untick works in case I tick by mistake.
- Delete a step with a small bin icon. I am asked "Are you sure?" first.

---

## 8. Waiting steps

- I mark a step "Waiting" and type the person's name if I want.
- It shows a grey "Waiting" tag in the list.
- The project still shows on Today every day, so I remember to chase it.

---

## 9. Work note ("What did you do today?")

- A small box in the project details.
- Press Enter (or "Save" on iPhone) to save. It stores with today's date and time.
- It shows in the project history and in the Diary.
- I can edit or delete a note later.

---

## 10. Diary

- A day-by-day record across all projects.
- Each day lists the steps ticked, the work notes written, and projects paused, finished or reopened.
- The newest day is on top.
- Click a line to open that project.

---

## 11. Pause and finish

- **Pause:** the project moves to "Paused". It is hidden from Today and its dot does not turn red. "Unpause" brings it back.
- **Finish:** the project moves to "Finished" and keeps its full history. "Reopen" brings it back.
- **Delete project:** only from the Finished list. I am asked "Are you sure?" twice.
- After deleting, its lines stay in the Diary, marked "(deleted project)". Its files are removed.

---

## 12. Groups

- Start with 4 groups: AI, Ceramic, General, Work / Office.
- Add a group with "+ Group".
- Rename a group anytime.
- Delete a group only when it has no projects in it.
- Every project belongs to exactly one group.

---

## 13. Files

- On the computer: drag a file onto the project, or click "Add file".
- On iPhone: tap "Add file" and choose a photo, a camera shot or a file.
- A copy is saved in my private data repository on GitHub.
- Click a photo or PDF to see it inside the app.
- Other files (Word, Excel, etc.) download to open in their own app. For safety, they never open inside the tracker.
- Remove a file with a bin icon, after "Are you sure?".
- Size limit: 25 MB per file. Keep the total under 1 GB (GitHub's advice).
- Photos from the iPhone are shrunk before upload, to save space.
- Removing a file does not free space, because GitHub keeps old versions. So upload only what is needed.

---

## 14. Search

- On the computer: one box at the top of the menu.
- On iPhone: the box sits at the top of the project list, always visible.
- It searches project names, steps, step notes, project notes and work notes.
- It includes paused and finished projects. Their results have a grey label.
- Results show in the project list as I type.

---

## 15. AI helper

### What it does
1. **✨ Break into steps:** I type a goal, for example "Launch glaze article". The AI suggests 5–10 steps, each with a tick box. I tick the ones I want and press "Add selected".
2. **✨ Suggest next step:** a button on each project. The AI reads the project and suggests 1–3 next steps. I tap one to add it.
3. **Morning plan:** made automatically the first time I open the app each day. The AI picks the 5 most important things for today from all my projects (red first, then deadlines, then priority). It shows at the top of the Today screen. It is saved, so my other devices show the same plan.
4. **Weekly review:** made automatically the first time I open the app on a Sunday. It shows what moved this week, what is stuck, and what to fix. On Sundays it shows at the top of Today in place of the Morning plan.

### Rules
- The AI never changes anything by itself. It only suggests. I choose what to add.
- Each Morning plan and Weekly review replaces the one before it. Old ones stay only in the GitHub history.
- A "↻ Make again" button on the box remakes it (this counts as 1 AI use).
- Limit: 50 AI uses a day, counted across all my devices. After that, the AI buttons say "Daily AI limit reached — try tomorrow".
- If the AI is down or a key is wrong, the app still works normally. Only the AI buttons show an error.
- If no AI key is saved on a device, the AI buttons on that device show "Add an AI key in Settings".
- The Morning plan is made by only one device. If the device I open first has no AI key, the box says "No plan yet".

### Choosing the AI (Settings)
- Settings has a switch: "Claude Haiku" (main) or "Gemini Flash" (backup).
- It shows "AI uses today: 12 / 50".
- I paste my AI keys in Settings myself, once per device. They stay only on that device. They are never saved to GitHub.

---

## 16. Settings

- GitHub access key: paste, test, or "Forget this device".
- AI choice: Claude Haiku (main) or Gemini Flash (backup).
- AI keys: Claude key, Gemini key (each with a "Test" button). The Gemini key is optional.
- AI uses today: 12 / 50.
- Download backup.

---

## 17. Getting in (instead of a login)

- The first time I open the app on a device, it asks for my GitHub access key.
- I paste it once. The device remembers it.
- Without the key, the page shows nothing but the "paste your key" box. So the public page reveals no projects.
- The key can only read and write my private data repository. Nothing else on my GitHub.
- On a shared or office computer: press "Forget this device" when done.
- If my phone is lost: delete the key on the GitHub website. Then make a new one.
- If the key expires or stops working, the app says so and asks for a new one. Unsaved changes are kept and saved after the new key works.

---

## 18. How I open it

- Open the app's web address in any browser (for example `https://vm3567.github.io/daily-projects`).
- Bookmark it, or keep the tab open all day.
- On iPhone, always open it from the home-screen icon (see section 4).

---

## 19. Sync between devices

- The app gets the latest data when it opens, when I come back to the tab, and every 60 seconds.
- A "↻" button at the top fetches the latest data right away.
- My changes save to GitHub about 2 seconds after I stop typing or clicking. Several quick changes go together as one save.
- If another device saved in between, the app joins both changes together automatically. If both changed the very same thing, the change saved last wins.
- Changes not yet saved are also kept on the device. Closing the tab or losing internet does not lose them. They are saved next time.
- The 60-second refresh never changes a box while I am typing in it.
- With no internet, the app shows "No connection". Edits are blocked until the connection comes back.

---

## 20. Data and backup

- All data lives in my private GitHub repository `daily-projects-data`.
- Every save is a version in GitHub. I can go back to any earlier version, forever.
- A "Download backup" button in Settings saves one file with all my projects and history (not uploaded files) to whichever device I am on.
- If something goes wrong, I ask Claude to restore the data from a chosen date. The restore is saved as a new version, so nothing is ever lost.

---

## 21. Claude review on my Mac (one by one)

When I am at my Mac, I open Claude in the Task folder and type **/review-projects**.

1. Claude gets the latest data from GitHub.
2. Claude shows a short summary: how many projects are red, orange and green.
3. Claude shows projects one at a time, red ones first. For each one it shows the name, next step, waiting steps, last work note and deadline.
4. I tell Claude what I think or what happened.
5. Claude suggests a solution, a direction, and new steps.
6. Claude asks: "Add these steps?" It changes the tracker only after I say yes.
7. I can say "skip", "next" or "stop" at any time.
8. At the end, Claude saves the changes to GitHub and gives a one-line summary. My phone and browser show them on the next refresh.

Other commands:
- **/add** — I describe a new project or task in normal words. Claude makes it and asks before saving.
- **/today** — Claude lists today's red and orange projects only.

How it connects:
- Claude uses the GitHub login already on my Mac (account vm3567). No extra key is needed.

---

## 22. Daily habit

1. Open the app. Read the Morning plan at the top.
2. Start with the red projects.
3. For each project, do the next step, tick it, and add the next one.
4. Write a quick note if useful.
5. When at the Mac, type **/review-projects** in Claude to talk through stuck projects.
6. Stop when all dots are green, or as many as possible.

---

## 23. Setup I do myself (with Claude guiding)

Claude cannot make passwords or keys, or paste them anywhere. I do these. Claude tells me each click.

1. Turn on two-step login (2FA) for my GitHub account, if not already on.
2. On the GitHub website, make a "fine-grained access key" (personal access token):
   - only for the repository `daily-projects-data`
   - permission: "Contents — Read and write"
   - the longest expiry allowed
3. Paste that key into the app on the Mac. On the iPhone, first add the home-screen icon, then paste it inside the icon app.
4. Get a Claude API key (from the Anthropic Console). Add a small credit.
5. Optional: get a Google Gemini API key (from Google AI Studio) as a backup.
6. Paste the AI keys into the app's Settings on each device.

Claude does the rest: makes both repositories, turns on GitHub Pages, writes the code, and pushes it.

---

## 24. Build order

1. Claude makes the 2 GitHub repositories:
   - `daily-projects` (public, the app code)
   - `daily-projects-data` (private, my data), with a first README file and a starting `data.json` (4 groups, no projects)
2. Claude turns on GitHub Pages for `daily-projects`. The app gets its web address.
3. The "paste your key" screen. I do steps 23.1–23.3 and test my key.
4. Saving and loading data from the private repository.
5. The 3-column page for the computer.
6. Projects and steps: add, edit, tick, drag.
7. Colour dots and the Today view.
8. Work notes, history and Diary.
9. Pause, Finish and groups.
10. Search.
11. File upload.
12. The iPhone layout.
13. Sync between devices and the no-internet message.
14. Settings and "Download backup".
15. AI helper: keys (steps 23.4–23.6), Break into steps, Suggest next step, Morning plan, Weekly review, AI switch, daily limit.
16. Claude commands: /review-projects, /add, /today.
17. Full test on the Mac and the iPhone with sample projects (see section 26), then remove the samples.

After each step: push to GitHub, and show it to me to check.

---

## 25. How it is built (for the builder)

### Repositories
- `vm3567/daily-projects` — **public**. App code only. No data, no keys. Served by GitHub Pages from the `main` branch, folder `/docs`. Local folder: `/Users/venkatmani/Task`.
- `vm3567/daily-projects-data` — **private**. Data and uploaded files only. Local copy for Claude: `/Users/venkatmani/Task/data` (listed in `.gitignore` of the code repository).

### Folder layout (code repository)
```
Task/
  PLAN.md
  README.md                 setup steps in simple English
  .gitignore                blocks data/, .env, any key files
  docs/                     the app (published by GitHub Pages; Pages only serves / or /docs)
    index.html
    app.js, store.js, ops.js, github.js, rules.js, ai.js, ui/*.js
                            (rules.js and ops.js are shared with tools/tracker.mjs)
    styles.css
    manifest.webmanifest, icons/
    vendor/sortable.min.js  drag-and-drop library, pinned version, saved in the repo
  tools/
    tracker.mjs             command-line helper Claude uses for /review-projects, /add, /today
  .claude/skills/
    review/, add/, today/   Claude commands
  data/                     (not pushed here) local copy of daily-projects-data
```

### Data repository layout
```
daily-projects-data/
  README.md                 made at setup, so the repository is never empty (the Git Data API fails on an empty repository)
  data.json                 groups, projects, steps, work notes, settings, AI usage, AI briefs
  history/2026-10.json      one file per month: history events (feeds History and Diary)
  files/<project-id>/<fileId>-<safe-name>   uploaded files (fileId in the name, so names never clash)
```

### data.json shape
- `version`: 1
- `groups`: [{id, name}] — shown in this fixed order: the 4 starting groups, then new ones by creation.
- `projects`: [{id, groupId, name, priority (high/medium/low), deadline|null, notes, links: [{id, title, url}], state (active/paused/finished), order, lastTickDate|null, activeSince, stateChangedAt, createdAt, updatedAt,
  steps: [{id, text, done, doneAt|null, dueDate|null, note, waiting, waitingOn, order, createdAt, updatedAt}],
  workNotes: [{id, text, createdAt, updatedAt}],
  files: [{id, name, path, size, type, createdAt}]}]
- `settings`: {aiProvider: "claude" | "gemini"} — default "claude".
- `aiUsage`: {date: "YYYY-MM-DD", count}
- `aiBriefs`: {morning: {date, status: "pending" | "ready", content}, weekly: {date, status, content}}
- All ids are random short strings. All times are ISO text. Dates are India time (Asia/Kolkata) "YYYY-MM-DD".
- `activeSince` (India date) is set when a project is created, unpaused or reopened.
- `order` is ONE global order for all projects. Group views and Today just filter it. Dragging in any view moves the project within that global order.
- Moving a project to another group only changes `groupId`.
- A group can be deleted only if no project (active, paused or finished) uses it.

### history/YYYY-MM.json
- A list of events: {id, projectId, projectName, kind, detail, at}.
- Group events (`group_added`, `group_renamed`, `group_deleted`) have `projectId: null` and `projectName: null`; the group name goes in `detail`. They do NOT show in the Diary or in any project's History. They are kept only as a record in GitHub.
- `kind` values: created, edited, renamed, group_changed, step_added, step_edited, step_ticked, step_unticked, step_deleted, note_added, note_edited, note_deleted, paused, unpaused, finished, reopened, file_added, file_removed, deleted, group_added, group_renamed, group_deleted.
- History is append-only. Events are never changed or removed, also not when a project is deleted.
- Showing a name: use the project's current name if it still exists, else the stored `projectName` with "(deleted project)". Clicking a deleted project's line does nothing.
- The Diary shows ticked steps and pause/finish/reopen events from history, and work notes from `workNotes` (so edited notes show their new text, and deleted notes disappear). Notes of a deleted project still show in the Diary, because a copy of the note text is stored in the `note_added` event's `detail`.

### Loading (github.js)
- All GitHub calls use `cache: 'no-store'` (the GitHub API otherwise allows 60-second caching, which would give old data).
- Load:
  1. GET `git/ref/heads/main` → the latest **commit sha**. Keep it as `baseCommit`.
  2. GET that commit's tree (recursive) → the blob shas of `data.json` and the history files.
  3. GET each needed blob by sha (works up to 100 MB; the Contents API stops at 1 MB).
- Only the current month's history file is loaded at first.
- Before any save, every history month that the pending operations write to is loaded first (an operation queued on 31 Oct and saved on 1 Nov loads `history/2026-10.json` first). A history file is never written without its existing events loaded. Older months load when the Diary or a project's History scrolls back that far.

### Saving: operation queue (store.js)
- Every change is recorded as a small **operation**. Each operation has its own id and its own time (`at`). Dates it sets (like `doneAt`, `lastTickDate`, history `at`) come from the operation's own time, never from the replay time.
- Full list of operations (in `ops.js`, shared with `tracker.mjs`):
  - Projects: `createProject`, `setProjectField` (one field per operation: name, groupId, priority, deadline, notes), `addLink`, `editLink`, `removeLink`, `moveProject` (placed "after project X", not by number, so it still lands right after a replay), `pause`, `unpause`, `finish`, `reopen`, `deleteProject`.
  - Steps: `addStep`, `setStepField` (text, dueDate, note, waiting, waitingOn), `tickStep`, `untickStep`, `deleteStep`, `moveStep` ("after step X").
  - Work notes: `addWorkNote`, `editWorkNote`, `deleteWorkNote`.
  - Files: `addFile` (holds only the blob sha, name, type, size), `removeFile`.
  - Groups: `addGroup`, `renameGroup`, `deleteGroup` (skipped on replay if the fresh data has a project in that group).
  - Settings and AI: `setAiProvider`, `incrementAiUsage` (re-checks the 50 limit on replay; if over, the AI answer is still kept but no more calls are made), `claimBrief` (skipped if today's brief is already "ready", or is "pending" and under 5 minutes old), `setBriefReady`.
  - History events: the operations listed in the `kind` list below write one event (same event id on every replay, so it is never doubled). `editLink`, `addLink` and `removeLink` write an `edited` event. These write NO event: `moveProject`, `moveStep`, `setAiProvider`, `incrementAiUsage`, `claimBrief`, `setBriefReady`.
- Replay rule: an operation on an item that no longer exists is skipped. For field changes, the device that saves last wins.
- The operation is applied to the screen at once, and added to a **pending queue**.
- The pending queue is also kept in the device's local storage, so closing the tab, losing internet or a crash loses nothing. On next open, the queue is sent.
- Save, 2 seconds after the last change:
  1. Build the new `data.json` and the history file(s) from `base data + pending operations`.
  2. Create blobs for changed files, plus blobs for any newly uploaded files.
  3. Create a tree on top of `baseCommit`'s tree, then a commit with `baseCommit` as parent. Message like "Tick step: Call supplier" (or "3 changes" for several).
  4. PATCH `git/refs/heads/main` to the new commit with `force: false`.
- Clash (the PATCH answers 422, because another device or Claude saved first):
  1. Load again (fresh `baseCommit` and data).
  2. Replay the pending operations on top of the fresh data. An operation on an item that no longer exists is skipped. History events are added by event id, so nothing is doubled.
  3. Save again. Try up to 3 times, then show "Could not save — tap ↻". The queue stays safe in local storage.
- After a good save: clear the sent operations from the queue, and set `baseCommit` to the new commit.

### Refresh
- On open, on returning to the tab, every 60 seconds, and with the ↻ button.
- Skip the refresh while operations are pending.
- Never re-draw a text box that is being typed in. It updates when I leave the box.

### Files
- Upload: as soon as a file is chosen, it is sent with POST `git/blobs`, which returns its sha. The `addFile` operation stores only that sha, so the pending queue stays small (local storage holds only about 5 MB). The file joins the tree in the next data commit. (No Contents API PUT, which would make its own commit and cause a clash every time.)
- Max 25 MB per file. iPhone photos are resized to about 2000 px wide before upload.
- Open: fetch the blob through the API, then:
  - Images (png, jpeg, gif, webp) and PDF: show inside the app's own viewer panel. SVG is never treated as an image.
  - Every other type: offer it as a download only (forced `application/octet-stream`). It is never opened as a page inside the app, because an HTML or SVG file opened that way could read the saved keys.
- On iPhone, the viewer is used instead of a new tab, because Safari blocks new tabs opened after a wait.
- Removing a file removes it from the current version only. GitHub keeps old versions, so the space is not freed. The "Remove file" box says this in plain words.
- Deleting a project also removes its `files/<project-id>/` folder in the same commit.

### Device storage (on each device only, never sent to GitHub)
- GitHub access key, Claude key, Gemini key, the pending operation queue, the last opened screen.
- Kept in the browser's local storage. "Forget this device" clears all of it (after warning if operations are still pending).
- GitHub answers 401 (key expired or deleted): show the "paste your key" screen. The pending queue is kept and sent after the new key works.

### Dot colour (rules.js, India time)
- `refDate` = the later of `lastTickDate` and `activeSince`.
- Red if the project's deadline has passed (deadline date is before today), no matter what else.
- Otherwise green if `lastTickDate` is today.
- Otherwise orange if `today - refDate` is less than 2 days.
- Otherwise red.
- Unticking a step: recalculate `lastTickDate` from the latest `doneAt` of the steps still ticked.
- Deleting a ticked step: `lastTickDate` stays as it is.
- Paused and finished projects are grey.

### AI (ai.js)
- Main AI: **Claude Haiku**. Backup switch: Gemini Flash.
- Calls go straight from the browser with the device's key:
  - Claude through the Anthropic Messages API (`POST https://api.anthropic.com/v1/messages`, headers `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`, `anthropic-dangerous-direct-browser-access: true`).
  - Gemini through the Google Generative Language API, with the key in the `x-goog-api-key` header (never in the web address).
- The model names are kept in one place, so they are easy to update.
- The AI must answer in JSON (a list of steps, or plan items). The app checks the shape, and shows the text as plain text only.
- Before each call: if `aiUsage.date` is today and `count` is 50 or more, stop. Otherwise add +1 (as an operation) and save.
- Morning plan / Weekly review (India time decides "today" and "Sunday"):
  1. Runs only after the data has fully loaded, and only if this device has a key for the chosen AI.
  2. If today's brief is missing: first save a claim `{date: today, status: "pending"}`. If that save clashes, the `claimBrief` replay rule decides: if today's brief is "ready", or "pending" and under 5 minutes old, do nothing (another device has it).
  3. Make the brief, then save `{status: "ready", content}`.
  4. If the claim is "pending" for more than 5 minutes, any device may try again.
  5. No key on this device: the box shows "No plan yet — open on a device with an AI key, or add a key in Settings".
- Morning plan order: overdue deadlines and red projects first, then deadlines soon, then priority.
- Sunday (India time): only the Weekly review is made. No Morning plan that day. Monday to Saturday: only the Morning plan.

### Claude helper (tools/tracker.mjs)
- Works on the local copy in `Task/data`, using git with the Mac's existing GitHub login.
- Commands: `pull`, `summary`, `list --today`, `show <project>`, `add-steps <project> "<step>" ...`, `add-note <project> "<text>"`, `new-project ...`, `push "<message>"`, `restore <date>`.
- Uses the SAME rules file and the SAME operation code as the app (shared `rules.js` and `ops.js`), so both behave the same.
- Push clash: if `git push` is refused, run `git fetch` + `git reset --hard origin/main`, replay the operations, then push again (a normal text merge of `data.json` would break it).
- `restore <date>`: takes `data.json`, history AND the `files/` folder as they were on that date, and saves them as a NEW commit. Never a force-push. Asks "yes?" first.
- The Claude skills use this tool. They always show the change and ask "yes?" before writing and pushing.

### Backup
- Every save is a commit in the private repository, so every version is kept.
- "Download backup" in Settings saves one JSON file: `data.json` plus all history months (no uploaded files), named `daily-projects-backup-YYYY-MM-DD.json`.

### Security
- The app shows notes, links, file names and AI answers as plain text only (`textContent`, never `innerHTML`), so nothing typed or returned by the AI can run as code.
- Links: only `http://` and `https://` are allowed.
- A Content Security Policy tag in `index.html`, exactly:
  `default-src 'self'; script-src 'self'; style-src 'self'; connect-src https://api.github.com https://api.anthropic.com https://generativelanguage.googleapis.com; img-src 'self' blob: data:; frame-src blob:; object-src blob:; manifest-src 'self'`
- No outside scripts, no analytics, no trackers. Libraries are saved in the repository.
- The fine-grained key needs only: repository `daily-projects-data`, "Contents: Read and write" (this also covers the Git Data API), "Metadata: Read" (added automatically).
- The public code repository holds no data and no keys. Check this before every push.
- `data/` is in `.gitignore`.
- The page shows nothing until a working key is pasted.
- My GitHub account should have two-step login (2FA) turned on, because anyone who could change the public code could steal the saved keys.

### GitHub limits (fine for one person)
- 5,000 API calls per hour per key. Refresh every 60 s uses about 60–200 calls per hour.
- Files up to 100 MB per blob (the app limits uploads to 25 MB).
- GitHub Pages: free for public repositories, about 1 minute to update after a push.

---

## 26. Test checklist (before I start using it)

1. Without a key, the page shows only the key box. A wrong key is refused.
2. Add, edit, tick, untick, drag and delete projects and steps.
3. Dots: green after a tick. Orange the next day. Red after 2 days (tested by changing dates in test data).
4. Pause, unpause, finish, reopen, delete.
5. Groups: add, rename, delete an empty one.
6. Work notes show in History and the Diary.
7. Search finds text in names, steps and notes.
8. File upload and open on the Mac and the iPhone.
9. A change on the iPhone shows on the Mac after ↻ or within 60 seconds.
10. Editing on 2 devices at the same time does not lose either change. A deleted step does not come back.
11. Closing the tab right after a change: the change is saved on next open.
12. An overdue deadline makes the dot red.
13. An uploaded .html or .svg file only downloads; it never opens inside the app.
14. A note with code-like text (for example `<script>`) shows as plain text.
15. A deleted project's lines stay in the Diary with "(deleted project)".
16. On iPhone, keys stay after a week away (home-screen icon).
17. The no-internet message appears when Wi-Fi is off.
18. AI: Break into steps, Suggest next step, Morning plan, Weekly review — with Claude, and with Gemini.
19. Two devices opened at the same time make only one Morning plan.
20. The 50-a-day limit message appears.
21. Download backup works. Restoring an old version works.
22. /review-projects, /add and /today work in Claude and ask before changing anything.
23. "Forget this device" clears all keys from that device.
24. No data or keys are in the public code repository.

---

## 27. Points to watch

1. **Waiting + green rule:** a waiting project cannot turn green on its own, because there is nothing to tick. Fix: add a small step like "Chased Ravi" and tick it. This is my own choice.
2. **Many projects every day:** with 15+ projects, some days not all will turn green. That is fine. Red shows what to do first tomorrow.
3. **Drag order vs red:** the list keeps my drag order. Red projects do NOT jump to the top. The Morning plan and the red dots show what comes first.
4. **Internet needed:** it needs internet to load and save.
5. **Not instant sync:** another device shows changes after ↻ or within 60 seconds, not straight away.
6. **Keys on devices:** the GitHub key and AI keys are saved in the browser of each device. Fine for my own Mac and iPhone. On a shared computer, always press "Forget this device".
6b. **iPhone:** always use the home-screen icon. If I open the web address in Safari instead, it will ask for the keys again.
7. **Key expiry:** the GitHub key may expire (up to 1 year). The app will ask for a new one. Making a new one takes 2 minutes.
8. **Code is public:** anyone can see how the app is built, but never my projects or keys.
9. **File space:** keep uploads small. Very large or very many files slow GitHub down.
10. **AI cost:** Claude Haiku costs a little, likely under ₹100 a month at normal use. Gemini Flash is a free backup, but on the free plan Google may read the text. Prices can change.
11. **AI sees my text:** when the AI runs, project text is sent to Google or Anthropic. I agreed to this for all projects.
12. **Cost:** ₹0 for GitHub. Only AI use may cost a little.

---

## 28. Not included (for now)

- Daily 9:30 AM pop-up reminder (can be added later with a scheduled GitHub job).
- A real phone app.
- Sharing with other people.
- Repeating steps (for example "every Monday").
- Working without internet.
- AI changing things on its own.

These can be added later if needed.
