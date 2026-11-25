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
14. **A `//` note in the middle of a one-line statement switches off the rest of the line.** It broke all of
    app.js once (the "all app files parse" check caught it).
    → Inside a line of code use `/* … */`, or put the note on its own line. Run `node --check` after editing.
15. **In test data, a 📂 project is only a group once it holds a task** (or was made with createMainProject).
    Two checks wrongly assumed "Kilns" was already a group.
    → Make the group in the test the way the app does, before testing what it can or cannot do.
16. **Skipped checks look like passes.** On a new cloud machine MySQL was missing, so all ~146 server checks
    were skipped and the summary still said "0 fail".
    → Always read the `skipped` count too. If server checks skip: `apt-get install -y mysql-server`, then comment out
    `user = mysql` in /etc/mysql/mysql.conf.d/mysqld.cnf (the throwaway test databases must run as root).
17. **"Text A comes before text B" passes when A is missing** (`indexOf` gives -1). An email check compared with a
    heading that no longer existed, so it tested nothing.
    → Check that the text is there (`> -1`) before comparing positions.
18. **A new style name can clash with an old one.** The new calendar used `.cal`, which the Dashboard's streak
    calendar already used, and the layout broke.
    → Before naming new styles, search styles.css for the name. Give a new part its own prefix (e.g. `pcal-`).
19. **The page's safety rules (CSP) block `style="…"` attributes.**
    → Set sizes and places through the element's style object (`el.style.cssText = …`), as the rest of the app does.
20. **A browser try re-run on the same data makes doubles** (two tasks with the same name).
    → Start fresh throwaway data (stop, up, seed) before each run.
21. **A form or box is made when the page is drawn.** Twice a test read a form's values (the 📅 Plan box, the Give
    form) before the page had drawn it, and failed.
    → In a test, draw the page (render / view) after opening a box, then read or change its values.
22. **A drop area that is only one line high is missed by a real mouse.** The calendar's "all day" row passed every
    check (they send the drop straight to it) but a real drag in the browser landed outside it.
    → Give every drop area a sensible minimum size, and try one real mouse drag in the browser before calling it done.
23. **A new kind of plan must count in the colour rule.** The calendar added a planned time, but `dotColour` only
    looked at days since the last update, so a task planned for Saturday still showed red.
    → When a feature adds a new way to "deal with" a task (plan, snooze, give), check `dotColour` / `colourWhy` use it.
