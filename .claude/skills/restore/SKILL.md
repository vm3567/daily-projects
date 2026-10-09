---
name: restore
description: Bring the user's Daily Projects data back to how it was on a chosen date, after showing what that version contains and getting a clear yes. Use when the user types /restore or asks to restore, undo everything, or go back to an earlier day.
---

# /restore — go back to an earlier day

The user is not a programmer. Use short, plain English.

1. If the user did not give a date, ask: "Which day do you want to go back to? (for example 9 Oct)". Turn it into `YYYY-MM-DD` (India dates).
2. From the Task folder, run (this only SHOWS the version, it changes nothing):

   ```bash
   node tools/tracker.mjs restore <YYYY-MM-DD>
   ```

3. Tell the user in 2–3 lines what that version has (how many projects, their names) and that:
   - everything after that day will be replaced by this version,
   - nothing is lost for good — the current version stays in the history and can be brought back the same way,
   - the AI keys are not changed.
4. Ask: "Restore to this version?" Only after a clear yes, run:

   ```bash
   node tools/tracker.mjs restore <YYYY-MM-DD> --yes
   ```

5. Tell the user it is done, and to reload the app on every device (Mac: Cmd + R; iPhone: close and reopen).

Never run the `--yes` command without a yes in this conversation.
