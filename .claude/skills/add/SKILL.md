---
name: add
description: Add a new task (or 📂 project) or new steps to the user's Daily Projects tracker from a normal-words description, after showing exactly what will be saved and getting a yes. Use when the user types /add.
---

# /add — add a task or steps in normal words

Words: a **task** is one piece of work with its steps (the app once called it a project).
A **📂 project** holds a few tasks. A task can be in several projects, or none.

The user is not a programmer. Use short, plain English.

## Tool

```bash
node tools/tracker.mjs summary
node tools/tracker.mjs new-task "<name>" --priority <high|medium|low> --steps "<step>" "<step>" [--project "<📂 project>"]
node tools/tracker.mjs add-steps "<task id or name>" "<step>" "<step>"
node tools/tracker.mjs add-to "<task>" "<📂 project>" [--create]      (put a task into a project; it can be in several)
node tools/tracker.mjs remove-from "<task>" "<📂 project>"
```

Run it from the Task folder.

## Steps

1. Read what the user wrote after /add. If it is empty, ask: "What do you want to add?"
2. Run `summary` to see the existing tasks, 📂 projects and their ids.
3. Decide:
   - If it belongs to an existing task → add steps to that task.
   - Otherwise → a new task. Use priority medium unless the user says otherwise.
   - If it belongs in a 📂 project (or several), say so in the plan; add it with `--project` or `add-to`.
   - Split the description into short, clear steps (max 7). Each step is one action.
4. Show the plan in plain words, for example:
   - "New task: **Glaze test** (priority medium, in 📂 Kilns)"
   - "Steps: 1. Mix batch 2. Fire samples 3. Check colour"
5. Ask: "Save this?" Change it if the user asks.
6. Only after a yes, run the command. Then confirm in one line.

Never change anything without a yes. Never edit `data/` by hand.
