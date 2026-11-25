---
name: checkers-loop
description: Build and run the app's checkers (gitleaks, Semgrep, the browser walk-through, the Hub's lessons) from CHECKERS-PLAN.md, one piece of work per turn, fixing small problems and listing big ones. Use when the user types /checkers-loop or /loop /checkers-loop.
---

# /checkers-loop — one turn of the checkers work

The owner is not a programmer. Reply in short, plain English (see the global CLAUDE.md), end with one "Next:" line.
This runs inside `/loop` (dynamic): **do one piece of work per turn**, then stop the turn. The loop starts the next one.

## Every turn

1. Read `CHECKERS-PLAN.md` (the plan and the rules), `CHECKERS-PROGRESS.md` (where we are) and `LESSONS.md`.
2. `git pull` first. Never touch the owner's own uncommitted changes (`.gitignore`, `tools/tracker.mjs`, its test):
   stage only the files you changed, by name.
3. Pick the work:
   - **Building phase**: the first step in `CHECKERS-PROGRESS.md` that is not ticked. Do that step only.
     Run its "Done when" check. Tick it only when that check passed.
   - **Checking phase** (every step ticked): run `sh tools/run-checks.sh` once, read its result by script.
4. Problems found:
   - **Small** (as the plan defines): fix it, add a test that fails without the fix (CLAUDE.md), add a lesson
     when it was a bug, write a row under "Fixed straight away".
   - **Big**: do not fix. Write a row under "Waiting for the owner" (what, why it needs them, your suggestion)
     and carry on with other work.
5. `npm test` must pass (read the pass, fail **and skipped** counts). Commit only the files you changed, with the
   usual message ending (Co-Authored-By line), never `--no-verify`. Push.
6. Deploy (`sh tools/deploy-worktask.sh`) **only** when app code changed and the full check printed
   ALL CHECKS PASS for this commit. Never in the building phase before Step 5 is done.
7. Write one row under "Full check runs" when a full check ran.
8. End the turn with a short report: what was done, what was fixed, what waits for the owner, and whether the loop
   should go on.

## When the loop stops

Stop the loop (do not schedule another turn) when:
- the full check passed **twice in a row** with nothing new to fix, or
- only "Waiting for the owner" items are left, or
- something unsafe would be needed (see below).

On stopping: send the owner a short report (PushNotification, then the reply), with the screenshots page from
`checks-out/walk/` (SendUserFile) and the list of what waits for them. The last line of the reply is
`CHECKERS LOOP: DONE`.

## Never

- Never open, sign in to or test the live site (worktask.in). Practice server on **port 8095** only, made-up data only.
  The walk stops at once if a page's address is not `localhost:8095` / `127.0.0.1:8095`.
- Never start the practice server on another port if 8095 is taken: report it and stop the loop.
- Never print, paste or commit a password, key or token. gitleaks findings are reported by file and date only.
- Never weaken or delete an existing check to make something pass (CLAUDE.md).
- Never install anything into this project. Python helpers run through `uv run --with …`.
- Never kill a program you did not start (Docker holds port 8090: leave it).
