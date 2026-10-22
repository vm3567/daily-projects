# Connect any app to Work Task

Any app can send you **tasks** and **approvals** in Work Task / Daily Projects.
When you press ✓ Approve or ✕ Reject, the app gets your decision back.

## 1. Make a key for the app

1. Open Daily Projects on worktask.in → **Settings** → **🔌 Connections**.
2. Press **+ New connection**. Type the app's name.
3. Optional: type the app's **Decision address** (the page in the app that should receive your decisions). It must start with `https://`.
4. Press **Create**. A yellow box shows three things **only once**:
   - **Address** – `https://worktask.in/api/?a=connect.push`
   - **Key** – starts with `wtc_`
   - **Signing secret** – starts with `wts_`
5. Copy them into the app (or press **⬇ Download PHP connector** – the file already has them inside).

Keep the key secret. If it leaks, press **Rotate key**: the old key stops at once and you get a new one.

## 2. Send a task or an approval

`POST https://worktask.in/api/?a=connect.push`

Headers:

```
Authorization: Bearer wtc_your_key
Content-Type: application/json
```

Body (JSON):

| Field | Needed? | What it is |
|---|---|---|
| `external_id` | yes | The app's own number for it (100 letters at most). The same number again = an update, never a second item. |
| `kind` | yes | `"task"` = goes straight to ✅ Tasks. `"approval"` = waits in 🔌 From apps for ✓ Approve / ✕ Reject. |
| `title` | yes | 200 letters at most. |
| `details` | no | 5000 letters at most. |
| `link` | no | A web address (`https://…`) to open the item in the app. |
| `fields` | no | Up to 20 name / value pairs, shown as a small table. Example: `{"Amount": "12,500", "Vendor": "ABC"}` |

Answer: `{"ok": true, "id": 12, "status": "pending"}` (a task answers `"done"` once it is in your list).

Example with curl:

```
curl -X POST 'https://worktask.in/api/?a=connect.push' \
  -H 'Authorization: Bearer wtc_your_key' -H 'Content-Type: application/json' \
  -d '{"external_id": "PO-1001", "kind": "approval", "title": "Approve PO 1001",
       "details": "Clay order for March", "link": "https://erp.example/po/1001",
       "fields": {"Amount": "12,500", "Vendor": "ABC Minerals"}}'
```

Take it back (no decision needed any more):

`POST https://worktask.in/api/?a=connect.withdraw` with `{"external_id": "PO-1001"}`

Limits: 120 calls a minute per app. A wrong or switched-off key gets `401`. Too many calls get `429`.

## 3. Get your decisions back

Choose **one** way.

**a) Work Task calls the app (Decision address).**
Work Task sends a `POST` with this JSON:

```
{"event": "decision", "external_id": "PO-1001", "status": "approved", "reason": "", "decided_at": "2026-10-22T10:42:00+05:30", "item_id": 12}
```

and two headers:

- `X-WorkTask-Timestamp` – the time it was sent (seconds).
- `X-WorkTask-Signature` – `sha256=` + HMAC-SHA256(signing secret, timestamp + "." + body), in hex.

The app should check the signature and that the time is within 5 minutes, then answer `200`.
Any other answer is tried again by itself (5, 10, 20 … minutes apart) for 24 hours.
Work Task never follows a redirect, and waits 5 seconds at most.

**b) The app asks Work Task (no Decision address needed).**

`POST https://worktask.in/api/?a=connect.decisions` with `{"since": "2026-10-22T10:00:00+05:30"}`
(or `GET …?a=connect.decisions&since=…`). The answer lists `external_id`, `status`, `reason`, `decided_at`, `item_id`.
Keep the newest `decided_at` for the next time. The same decision may come twice – use `external_id` to skip it.

## n8n, Make, Zapier or Power Automate

Use their **HTTP Request** step:

1. Method: `POST`. URL: `https://worktask.in/api/?a=connect.push`.
2. Header `Authorization` = `Bearer wtc_your_key`. Header `Content-Type` = `application/json`.
3. Body: the JSON above (map your fields into `external_id`, `kind`, `title` …).
4. For decisions, add a second flow that runs every 5 minutes and calls `connect.decisions` (way **b**).
   Or give the flow's webhook address as the Decision address (way **a**).

## PHP apps

Use `worktask-connector.php` (in this folder, or the ready file from **⬇ Download PHP connector**).
It needs PHP 7.4 or newer with curl. The comments at its top show the 3 steps:
`wt_push()`, `wt_withdraw()`, `wt_decisions()` and `wt_receive_decision()`.
The file in this folder has placeholders only: paste the address, key and secret where it says so.
