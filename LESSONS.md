# Lessons learned

Read this before starting any work. Add to it after each piece of work (see CLAUDE.md).
Each lesson: what went wrong, then what to do next time.

## Before changing anything

1. **Removing a section can lose things.** Removing "Needs you" from Team today also removed the only place
   suggestions, and stuck tasks not due today, were shown.
   → Before removing a section, list everything it shows and say where each item goes now.
2. **A rule written in two places drifts apart.** "Late" was worked out on the server for the morning email and
   again in the team table, and the two stopped agreeing.
   → Put each rule in one place (best: the server) and let every screen use it.
3. **Read the code before calling it.** Guessed names were wrong (`removeProjectId` instead of `parentId`; an error
   text "hour" that was really "Already chased at…").
   → Read the handler or the message first, then write the call or the check.
4. **Know how the screen is drawn.** The app redraws by keeping the old page and copying the new one onto it
   (morph). Code that wrote into the new copy never showed (form errors). The page also listens for every tap
   once on the whole page, so adding a second listener made one tap count twice (the 🔔 opened and closed).
   → Write into what is on the page (errLine), and never add a second tap listener under `document.body`.
5. **A new feature goes everywhere it belongs** (owner's pages, team pages, staff view, desktop and phone).
   → Check each place before calling it done (see CLAUDE.md).

## Writing checks (tests)

6. **A check that can never fail is worthless.** One check looked for a class name the app never uses, so it
   always passed.
   → Run every new check once without the fix and see it fail. Only then trust it.
7. **Put a screen check in the file that has the pretend page.** `tests/team-app.test.mjs` has no page, so
   screen checks there fail with "document is not defined".
   → Screen checks go in `tests/screens.test.mjs`; pure rules can go in either.
8. **Test data must look like real data.** Leaving out a field the server always sends (`dueToday`) made a test
   pass for the wrong reason.
   → Copy the shape of a real server answer into test data.
9. **Checks that pin exact source lines break on small, correct changes.** That is expected.
   → When the owner asked for the change, update the check and say so in the commit message. Never weaken it
   just to pass.

## Small traps

10. `el.replaceChildren(a, null)` puts the word "null" on the page. → Filter out empty items first.
11. `git merge -F -` does not read a message from a here-document. → Write the message to a file, then `-F file`.
12. **This cloud machine cannot deploy** (no server key, no ssh or rsync, the server is not an allowed host).
    → Never promise a deploy from here. Push to GitHub and ask the owner to run the deploy on their Mac.
13. **Main moves on its own.** Main had 14, later 22, new commits the branch did not have.
    → Fetch main and bring it in before starting work, and again before merging.
