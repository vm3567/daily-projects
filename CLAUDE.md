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
- Never delete or weaken an existing check to make a change pass. If a check's rule really changed
  (the owner asked for different behaviour), update it and say so in the commit message.

## Other standing rules

- Never print or paste passwords, keys or tokens. Run the secret scan before every commit.
- Deploy with `sh tools/deploy-worktask.sh` (it never deletes files on the server).
- Test only on 127.0.0.1 with the throwaway data, never on the live site's data.
