---
name: replies
description: Prepare email replies in bulk for the user's Daily Projects (emails from Outlook waiting for a reply), show every draft first, and save them as drafts only after a yes. Never sends email. Use when the user types /replies or asks to prepare or draft their email replies.
---

# /replies — prepare email replies in bulk

The user is not a programmer. Use short, plain English.

**Never send email.** These steps only save drafts. The owner opens each draft in Outlook (✉ Replies page → "Open in Outlook") and presses Send himself.

1. From the Task folder, list what waits for a reply:

   ```bash
   node tools/tracker.mjs replies
   ```

   Each email has an id in [brackets], the subject, who wrote, how many days it waits, where it is (task → step, or Inbox), the email thread (📧 them / ↩ you) for a task made from an email, recent notes and the newest lines.

2. For each email waiting for a reply, read the newest email in full:

   ```bash
   node tools/tracker.mjs mail-body <id>
   ```

3. Write a short, polite reply in the owner's voice:
   - Plain English, Indian business email tone (courteous, direct, no fancy words).
   - Use the task's notes for facts. Never invent prices, dates or promises. If a fact is missing, write `[fill in: …]`.
   - Start with "Dear <first name>," and end with:

     ```
     Regards,
     Venkat
     ```

4. Show ALL the drafts to the owner in chat first (id, subject, to whom, the draft). Ask: "Save these as drafts? (yes / change …)". Do nothing until he says yes. Change any draft he asks for.

5. Only after a yes, save each one:

   ```bash
   node tools/tracker.mjs set-reply <id> --for <email id> "<the reply text>"
   ```

   `<email id>` is the "email id" line that `replies` / `mail-body` showed for the email you answered (so a newer email that came while they read the drafts shows as newer). If it says a newer email came, tell the owner.

   If it says several emails match, use the exact id from step 1.

6. End with one line: "Drafts saved. Open ✉ Replies in Daily Projects and press ▶ Check and send one by one."
