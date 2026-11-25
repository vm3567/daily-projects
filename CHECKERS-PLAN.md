# Plan: borrow the Acton Hub's checkers for this app

Status: **ready to start.** Run it with the command `/loop /checkers-loop` (see the end).
Progress is kept in `CHECKERS-PROGRESS.md`, so the work can stop and carry on at any time.

Owner's answers (25 Nov):
- Chosen: 1 gitleaks, 2 Semgrep, 4 browser walk-through, and the Hub's lessons. (3 plain English, 5 page sweep: later.)
- OK: a second practice port. OK: the full check (about 10 minutes) runs before every deploy.
- Problems found: **small, safe ones are fixed straight away** (each with its own check, as CLAUDE.md asks);
  **bigger ones are listed** in `CHECKERS-PROGRESS.md` under "Waiting for the owner", and the work carries on
  with everything else.

What counts as small (fixed straight away): a missing label or name for a screen reader, a colour with too little
contrast, something wider than a phone screen, an error message in the background, a risky code line with the same
behaviour after the fix, a test value that looks like a key.
What counts as big (asked first): anything that changes what a page shows or does, removes a button, changes a
rule, a server change, or a real key found in the history.

Rules for every step:
- Made-up data and the practice server only. **Never the live site, never real passwords.**
- Nothing new is added to the app itself. gitleaks and Chrome are already on this Mac; the Python helpers run
  through `uv` (nothing is installed into this project).
- Every step ends with its own check. A result is read by a script (PASS / FAIL), never by eye.
- Every fix gets a test (CLAUDE.md), every bug gets a lesson (LESSONS.md), `npm test` passes before every commit.
- Each step is saved and pushed on its own. A deploy only after the full check prints ALL CHECKS PASS.

---

## Step 0 — A practice server that always starts (about 1 hour)

Why: the walk-through needs the practice server. Today it only works on port 8090 (Docker holds it), and its
made-up data lived in a folder that is cleared every few days.

1. The app treats port **8095** as a practice server too (one line in `docs/app.js`, with a check).
2. `tools/practice-up.sh`:
   - refuses to start when port 8095 or the database port is taken (Hub lesson: a leftover server holds the port);
   - starts a throwaway database and the server on 8095;
   - fills made-up data with `tools/practice-seed.mjs`: a boss (the owner), two staff, team tasks (one-time,
     daily with a time, weekly), a given group with steps and photos, messages, a staff update with photos,
     and **the owner's own tasks** (made with the app's own change rules, then loaded the way `dp-import.php` does);
   - writes the made-up sign-ins to `checks-out/practice-logins.json` (never shown, never committed).
3. `tools/practice-down.sh`: stops both and removes the throwaway data.
4. Everything the checks write goes in `checks-out/`, kept out of git by `.git/info/exclude`
   (the owner's own `.gitignore` change is not touched).

Done when: up → down → up → down works, and the app on 8095 never goes to the live site.

## Step 1 — gitleaks: no passwords or keys in the code (about 30 minutes)

1. Run gitleaks on the whole history and on the files as they are now.
2. Something found: say which file and when, **never the secret itself**.
   A made-up test value → listed as allowed in `.gitleaks.toml`, one by one, with the reason.
   A real key → "Waiting for the owner" (it may need changing on the service).
3. Add gitleaks to the commit guard, next to the secret scan already there.

Done when: gitleaks passes on the history and on every new commit.

## Step 2 — Semgrep: risky code patterns (1 to 2 hours)

1. Run Semgrep (through `uv`) with its rule sets for JavaScript, PHP and secrets.
2. Our own rules (`checks/semgrep.yml`) from our lessons:
   - `replaceChildren(…, null)` puts the word "null" on the page (lesson 10);
   - `style="…"` written into the page is blocked by the page's safety rules (lesson 19);
   - `innerHTML` with words that came from a person (a way to break the page or attack it);
   - a number or date read from the request with no check (Hub lesson, 23 Nov), in PHP.
3. Each finding: a real problem → fixed (small) or listed (big); a false alarm → marked with a one-line reason.

Done when: Semgrep passes with nothing left unexplained.

## Step 3 — Browser walk-through (3 to 4 hours)

`tools/walk.py`, run with `uv` (Playwright + axe-core, as in the Hub's `journeys/run.py`).

Safety: before every page it checks the address is `localhost:8095` or `127.0.0.1:8095`. Anything else stops the
whole run at once (today's near miss: port 8080 sent the page to the live site).

Sizes: 360 and 390 px (phones), 768 px (tablet), 1440 px (computer). Simple mode on, then off.
Who: the owner (made-up boss), a manager who is not the owner, and a staff member (signed in through the
real sign-in page with the made-up sign-ins).

Pages and actions:
- Owner: Today, ✅ Tasks, 📂 Groups, a group, 📅 Calendar (Day / Week / Month), Inbox, People, a person,
  Settings; a task page with ⋯ open, ⚙ More details open, 📅 Plan open; the photo viewer.
- Team: Team today, Team tasks, a team task (⋯ open), Give a task, People, Settings.
- Staff: his list, a task, his calendar, Suggest a task.

On every page and after every action:
1. accessibility (axe-core): no serious or critical problem;
2. nothing wider than the screen;
3. no error in the background (console), including blocked-by-safety-rules (CSP) messages;
4. no page over 15,000 px tall on a phone (a list that should page its rows);
5. the page answered (no "not found" and no sign-in page when signed in);
6. the server's log has no PHP warning or error during the walk;
7. each page opens within 3 seconds on this Mac;
8. a screenshot of each page, in `checks-out/walk/<date>/`, with one page that shows them all.

Done when: every page passes at every size for every person, or each problem is fixed (small) or listed (big).

## Step 4 — The Hub's lessons, as rules and checks (1 to 2 hours)

Added to LESSONS.md, each with an automatic check where one can be written:

| Lesson from the Hub | Check here |
|---|---|
| A choice box starts on "Choose…", never on a real answer | `checks/choose_first.mjs`: every `select` that is a decision |
| Every count says what it counts (🔔 number vs list count) | a screen test for the 🔔 and the menu counts |
| A link uses the same rule as the page it opens | the walk: a staff member opens every link they see, none says "not found" |
| A button tapped twice must not do the job twice | a test per sending button (two taps, one call) — those missing a guard are fixed |
| A long list shows a page at a time | the walk's 15,000 px rule |
| A check's result is read by a script | Step 5's one command |
| A leftover test server holds the port | `practice-up.sh` refuses (Step 0) |
| Two check runs at once break each other | `run-checks.sh` takes a lock folder; a second run waits or stops |

## Step 5 — One command for everything (about 30 minutes)

`sh tools/run-checks.sh` runs: `npm test` (and reads the "skipped" count too: lesson 16), gitleaks, Semgrep,
the `choose_first` check, then `practice-up`, the walk-through, `practice-down`. It prints **ALL CHECKS PASS**
only when every one passes, and saves the report in `checks-out/last-run.txt` with the commit it checked.

- `npm test` keeps running before every commit (fast, as now).
- `tools/deploy-worktask.sh` runs the full check first and stops if it fails (owner's OK).
- CLAUDE.md gets one line: run `sh tools/run-checks.sh` before every deploy.

Done when: the full command passes twice in a row on a clean start.

---

## The loop: `/loop /checkers-loop`

The owner types **`/loop /checkers-loop`** in this folder. Each turn of the loop (instructions in
`.claude/skills/checkers-loop/SKILL.md`):

1. Read this plan, `CHECKERS-PROGRESS.md` and LESSONS.md.
2. **Building phase** (a step is not done yet): do the next step, run its "Done when" check, fix small problems,
   list big ones, tick the step in `CHECKERS-PROGRESS.md`, commit and push.
3. **Checking phase** (all steps done): run `sh tools/run-checks.sh`. Fix the small problems it finds, list the
   big ones, run again.
4. Stop when the full check passes **twice in a row**, or when only "Waiting for the owner" items are left. Then
   send the owner a short report with the screenshots page, and deploy only if the full check passed.

The same command works later, any time: when the steps are all done, it simply checks the whole app, fixes
what it can, and lists the rest.

## Time

About one working day for Steps 0–5. After that, one loop run takes about 10–30 minutes.
