---
name: add
description: Add a new project or new steps to the user's Daily Projects tracker from a normal-words description, after showing exactly what will be saved and getting a yes. Use when the user types /add.
---

# /add — add a project or a task in normal words

The user is not a programmer. Use short, plain English.

## Tool

```bash
node tools/tracker.mjs summary
node tools/tracker.mjs new-project "<name>" --group "<AI|Ceramic|General|Work / Office|...>" --priority <high|medium|low> --steps "<step>" "<step>"
node tools/tracker.mjs add-steps "<project id or name>" "<step>" "<step>"
```

Run it from the Task folder.

## Steps

1. Read what the user wrote after /add. If it is empty, ask: "What do you want to add?"
2. Run `summary` to see the existing projects and their ids.
3. Decide:
   - If it belongs to an existing project → add steps to that project.
   - Otherwise → a new project. Pick the best group. Use priority medium unless the user says otherwise.
   - Split the description into short, clear steps (max 7). Each step is one action.
4. Show the plan in plain words, for example:
   - "New project: **Glaze test** (group Ceramic, priority medium)"
   - "Steps: 1. Mix batch 2. Fire samples 3. Check colour"
5. Ask: "Save this?" Change it if the user asks.
6. Only after a yes, run the command. Then confirm in one line.

Never change anything without a yes. Never edit `data/` by hand.
