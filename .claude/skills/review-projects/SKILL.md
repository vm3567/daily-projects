---
name: review-projects
description: Go through the user's Daily Projects one by one (red first), talk through each, suggest a solution and next steps, and add them to the tracker only after the user says yes. Use when the user types /review-projects or asks to review their projects.
---

# /review-projects — go through my projects one by one

The user is not a programmer. Use short, plain English. One idea per sentence. No jargon.

## Tool

Use only this helper (it reads and saves the private data on GitHub, with the Mac's GitHub login):

```bash
node tools/tracker.mjs summary
node tools/tracker.mjs show "<project id or name>"
node tools/tracker.mjs add-steps "<project id>" "<step>" "<step>"
node tools/tracker.mjs tick "<project id>" "<step text or id>"
node tools/tracker.mjs add-note "<project id>" "<text>"
```

Run it from the Task folder. Always use the project id (in [brackets]) once you know it.

## Steps

1. Run `summary`. Tell the user in one line: how many projects are red, yellow and green.
2. Take the projects in the order shown (red first, then yellow, then green). Skip green ones unless the user asks.
3. For each project, run `show` and present it briefly:
   - Name and colour.
   - Next step (and if it is waiting, on whom).
   - Last work note and deadline, if any.
   Then ask: "What happened with this? Any news or problem?"
4. Listen to the user's answer. Then give:
   - A short suggestion or solution (2–4 lines).
   - 1–3 concrete next steps.
5. Ask: "Add these steps?" (and, if it fits, "Tick '<step>' as done?" or "Save your news as a work note?").
6. Only after a clear yes, run the matching command. Never change anything without a yes.
7. The user can say "skip", "next" or "stop" at any time. Respect it at once.
8. At the end, give a one-line summary of what changed (for example: "Added 4 steps, ticked 2, 1 note.").

## Rules

- Never edit `data/` files by hand. Only use `tools/tracker.mjs`.
- Never invent progress. Only record what the user said.
- If a command prints an error, tell the user in plain words and continue with the next project.
