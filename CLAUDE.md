# Rules for this project (Daily Projects + Work Task on worktask.in)

## Every fix and every new feature comes with an automatic check

The owner asked for this so a later update never breaks what already works.

- When you fix a bug, add a test in `tests/` that fails without the fix and passes with it.
- When you add or change a feature, add tests for what it must do (and must not do).
- Server rules (team/app/*.php): add to `tests/php-server.test.mjs` (real PHP + throwaway MySQL).
  Small server helpers: `team/tests/unit.php`.
- Projects app logic (docs/ops.js, docs/rules.js): `tests/core.test.mjs`. Its screens: `tests/screens.test.mjs`.
- Team app (team/public_html/app.js) logic: `tests/team-app.test.mjs`.
- Run `npm test` before every commit. Never commit with a failing check.
- A commit guard (.git/hooks/pre-commit) refuses a commit that changes app code with no test change,
  and anything that looks like a key or token. Never bypass it (no `--no-verify`).
- This applies to every fix from code reviews (including the ultracode review loop) and to every helper agent:
  tell each helper to add the check with its fix.
- Never delete or weaken an existing check to make a change pass. If a check's rule really changed
  (the owner asked for different behaviour), update it and say so in the commit message.

## Other standing rules

- Never print or paste passwords, keys or tokens. Run the secret scan before every commit.
- Deploy with `sh tools/deploy-worktask.sh` (it never deletes files on the server).
- Test only on 127.0.0.1 with the throwaway data, never on the live site's data.
- Any email drafted for the owner (/replies, follow-ups, any mail the owner asks for) must follow the my-writing-style skill
  (~/.claude/skills/my-writing-style). No "Regards"/signature at the end: Outlook adds "Thanks & Regards," and the signature itself.

## A new feature goes everywhere it belongs (owner asked, 23 Oct)

When the owner asks for something new (e.g. a right-click menu, keyboard shortcuts, a stage label), do it in EVERY
place where it fits, not only the screen in the screenshot or the one named:
- the owner's Daily Projects pages (Today, ✅ Tasks, 📂 Projects, a task's page, a project's task table, Inbox, People),
- the owner's / managers' team pages (docs/ui/team.js: Team today, Tasks, People, Projects, Follow-up, Search),
- the staff app (docs/ui/staff.js: their tasks, folders, a task's page),
- desktop and phone (and the Work Task forwarding page if it still draws anything).
Before calling it done, go through that list, check each place, and say which places got it (and why any did not).
Every place gets its own test.
