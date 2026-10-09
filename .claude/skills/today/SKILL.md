---
name: today
description: Show the user's red and yellow Daily Projects for today (not yet done for today), in plain words. Use when the user types /today or asks what to work on today.
---

# /today — what needs me today

The user is not a programmer. Use short, plain English.

1. From the Task folder, run:

   ```bash
   node tools/tracker.mjs list --today
   ```

2. Show the result as a short list:
   - **Red first** (not looked at today), then yellow (opened, nothing done).
   - For each: project name — next step (add "waiting on X" if waiting, and the deadline if passed or close).
3. End with one line: which project to start with, and why (red, passed deadline, or high priority first).

This command only reads. It never changes anything.
