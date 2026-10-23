<?php
// 🔌 Connections: any outside app (an ERP, a form, n8n, Power Automate…) can send the owner tasks and approvals,
// and gets the owner's decisions back.
//
// The app side (no sign-in; the header "Authorization: Bearer wtc_<key>"):
//   connect.push      {external_id, kind: task|approval, title, details?, link?, fields?} → {id, status}
//   connect.withdraw  {external_id}                                                      → {id, status}
//   connect.decisions {since?}                                                           → {decisions: [...], until}
// The owner side (signed in, the owner of the projects only): conn.list / create / update / rotate / delete,
// conn.items, conn.decide.
//
// A task goes straight into the owner's Daily Projects (the same server-side write as Outlook emails, outlook.php).
// An approval waits here until the owner presses ✓ Approve / ✕ Reject; the decision is then sent to the app's
// decision address (signed with HMAC-SHA256), and tried again by the 5-minute job for up to 24 hours.
// The key is kept only as its fingerprint (sha256), the signing secret locked (ol_seal); both are shown once.
declare(strict_types=1);

const CONN_RATE = 120;            // calls per minute for one connection
const CONN_FIELDS_MAX = 20;       // key / value pairs shown as a small table
const CONN_GIVE_UP = 86400;       // a decision that cannot be sent is tried again for 24 hours
const CONN_TIMEOUT = 5;           // seconds to wait for the app's decision address
const CONN_DECISIONS_MAX = 500;   // decisions in one connect.decisions answer (then `more`: ask again from `until`)
const CONN_DECISIONS_LAG = 10;   // seconds connect.decisions' `until` stays back (a decision being saved right then is not skipped)
const CONN_SEND_CLAIM = 120;      // seconds one sender holds a decision while it tells the app (nobody else sends it then)

/** "wtc_" + 48 random letters / numbers (the app key), or "wts_" + 48 (the signing secret). */
function conn_new_secret(string $prefix): string { return $prefix . bin2hex(random_bytes(24)); }

function conn_key_hash(string $key): string { return hash('sha256', $key); }

/** The app's decision address: https only (http://127.0.0.1 only in the automatic tests). '' = none. */
function conn_callback($v): string {
  $u = trim((string)($v ?? ''));
  if ($u === '') return '';
  if (strlen($u) > 500 || preg_match('/\s/', $u) || !filter_var($u, FILTER_VALIDATE_URL)) throw new ApiError('The decision address does not look right. It starts with https://');
  $p = parse_url($u);
  $scheme = strtolower((string)($p['scheme'] ?? ''));
  $host = strtolower((string)($p['host'] ?? ''));
  if (isset($p['user']) || isset($p['pass'])) throw new ApiError('The decision address must not hold a user name or password.');
  $testLocal = TEST_DIR !== '' && $scheme === 'http' && $host === '127.0.0.1';
  if ($scheme !== 'https' && !$testLocal) throw new ApiError('The decision address must start with https:// (a safe address).');
  return $u;
}

/** One connection for the owner's screen (never the key or the secret: only the key's last 4 letters). */
function conn_out(array $c): array {
  $pending = (int)(one("SELECT COUNT(*) AS n FROM conn_items WHERE conn_id = ? AND status = 'pending'", [$c['id']])['n'] ?? 0);
  return [
    'id' => (int)$c['id'], 'name' => $c['name'], 'keyEnd' => $c['key_end'], 'active' => (bool)$c['active'],
    'callbackUrl' => $c['callback_url'] ?? '', 'createdAt' => $c['created_at'], 'lastSeenAt' => $c['last_seen_at'],
    'lastError' => $c['last_error'] ?? '', 'pending' => $pending,
  ];
}

function conn_iso(?string $t): ?string { return $t ? date('c', (int)strtotime($t)) : null; }

/** How the app hears about this decision: sent, waiting to send, could not send, or the app asks for it. */
function conn_delivery(array $it, array $c): ?string {
  if (!in_array($it['status'], ['approved', 'rejected'], true)) return null;
  if ($it['callback_ok_at']) return 'sent';
  if ((int)$it['callback_failed']) return 'failed';
  if ($it['callback_next_at'] && ($c['callback_url'] ?? '') !== '') return 'waiting';
  return 'ask'; // nothing queued to send (conn.update queues them when an address is added): the app asks for it
}

function conn_fields_of(?string $json): array {
  $f = json_decode((string)$json, true);
  return is_array($f) ? array_values(array_filter($f, fn($x) => is_array($x) && count($x) === 2)) : [];
}

function conn_item_out(array $it, array $c): array {
  return [
    'id' => (int)$it['id'], 'connId' => (int)$it['conn_id'], 'app' => $c['name'], 'externalId' => $it['external_id'], 'kind' => $it['kind'],
    'title' => $it['title'], 'details' => $it['details'] ?? '', 'link' => $it['link'] ?? '', 'fields' => conn_fields_of($it['fields']),
    'status' => $it['status'], 'reason' => $it['reason'] ?? '', 'decidedAt' => $it['decided_at'], 'createdAt' => $it['created_at'],
    'updatedAt' => $it['updated_at'], 'delivery' => conn_delivery($it, $c), 'version' => conn_version($it),
  ];
}

/** Which words of an item the owner saw (title, details, link, fields): conn.decide sends it back, so a change made by the app meanwhile is never decided unseen. */
function conn_version(array $it): string {
  return substr(hash('sha256', json_encode([$it['title'], $it['details'] ?? '', $it['link'] ?? '', $it['fields'] ?? ''], JSON_UNESCAPED_UNICODE)), 0, 16);
}

// ---------------------------------------------------------------- what the app sends

/** The fields table: {"Amount": "12,500", …} (or [{key, value}, …]) → [[key, value], …], 20 at most, each 300 letters. */
function conn_fields($v): array {
  if ($v === null || $v === '' || $v === []) return [];
  if (!is_array($v)) throw new ApiError('fields must be a list of names and values, like {"Amount": "12,500"}.');
  $pairs = [];
  foreach ($v as $k => $x) {
    if (is_int($k) && is_array($x) && array_key_exists('value', $x)) { $k = $x['key'] ?? $x['name'] ?? ''; $x = $x['value']; }
    if (is_array($x) || is_object($x)) $x = json_encode($x, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (is_bool($x)) $x = $x ? 'yes' : 'no';
    $key = txt((string)$k, 300);
    if ($key === '') continue;
    $pairs[] = [$key, txt($x === null ? '' : (string)$x, 300)];
  }
  if (count($pairs) > CONN_FIELDS_MAX) throw new ApiError('fields: ' . CONN_FIELDS_MAX . ' at most.');
  return $pairs;
}

/** The calling app, from its key. Unknown or switched off: 401 with no detail. Too many calls: 429. */
function conn_app(): array {
  $h = (string)($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
  if (!preg_match('/^Bearer\s+(wtc_[A-Za-z0-9]{40,100})$/', $h, $m)) throw new ApiError('Not allowed.', 401);
  $c = one('SELECT * FROM connections WHERE key_hash = ?', [conn_key_hash($m[1])]);
  if (!$c || !(int)$c['active']) throw new ApiError('Not allowed.', 401);
  $min = intdiv(time(), 60);
  q('UPDATE connections SET rate_n = IF(rate_min = ?, rate_n + 1, 1), rate_min = ?, last_seen_at = ? WHERE id = ?', [$min, $min, now(), $c['id']]);
  if ((int)(one('SELECT rate_n FROM connections WHERE id = ?', [$c['id']])['rate_n'] ?? 0) > CONN_RATE) throw new ApiError('Too many calls. Wait a minute and try again.', 429);
  return $c;
}

/** The app's id for an item: refused when too long (cut, two ids sharing their first 100 letters would be one item). */
function conn_ext(array $in): string {
  $ext = txt($in['external_id'] ?? '', 1000, true, 'external_id');
  if (mb_strlen($ext) > 100) throw new ApiError('external_id is too long (at most 100 letters).');
  return $ext;
}

/** connect.* (the app side). Returns null when `a` is not one of them. */
function conn_app_handle(string $a, array $in): ?array {
  if (!str_starts_with($a, 'connect.')) return null;
  $c = conn_app();
  switch ($a) {
    case 'connect.push':
      return conn_push($c, $in);
    case 'connect.withdraw': {
      $ext = conn_ext($in);
      $it = one('SELECT * FROM conn_items WHERE conn_id = ? AND external_id = ?', [$c['id'], $ext]);
      if (!$it) throw new ApiError('Nothing with that external_id.', 404);
      return conn_withdraw($c, $it);
    }
    case 'connect.decisions': {
      $since = trim((string)($in['since'] ?? ''));
      // a GET with an unencoded '+' (…T10:00:00+05:30) arrives as a space: put the '+' back
      $since = (string)preg_replace('/(T\d\d:\d\d(?::\d\d(?:\.\d+)?)?) (\d\d:?\d\d)$/', '$1+$2', $since);
      $t = $since !== '' ? strtotime($since) : false;
      if ($since !== '' && !$t) throw new ApiError('since is not a time. Send it like 2026-10-22T10:00:00+05:30.');
      $from = $t ? date('Y-m-d H:i:s', $t) : '1970-01-02 00:00:00';
      // `until` is a few seconds back: a decision saved at this very moment (its time already taken, not yet written)
      // comes again on the next ask instead of being skipped for good; the app knows a repeat by item_id
      $until = date('Y-m-d H:i:s', max($t ?: 0, time() - CONN_DECISIONS_LAG));
      $rows = all("SELECT * FROM conn_items WHERE conn_id = ? AND status IN ('approved', 'rejected') AND decided_at >= ? ORDER BY decided_at, id LIMIT " . CONN_DECISIONS_MAX, [$c['id'], $from]);
      // a full page: more may come after it, so `until` is the last one's time (since = until goes on from there;
      // the decisions of that same second come again: the app knows them by item_id)
      $more = count($rows) === CONN_DECISIONS_MAX;
      if ($more) $until = (string)$rows[count($rows) - 1]['decided_at'];
      // asked for = the app knows (shown to the owner as "✓ sent to app"); no more sending to its address
      $ids = array_map(fn($r) => (int)$r['id'], array_filter($rows, fn($r) => !$r['callback_ok_at']));
      if ($ids) q('UPDATE conn_items SET callback_ok_at = ?, callback_next_at = NULL WHERE id IN (' . implode(',', $ids) . ')', [now()]);
      return [
        'decisions' => array_map(fn($r) => ['external_id' => $r['external_id'], 'status' => $r['status'], 'reason' => $r['reason'] ?? '',
          'decided_at' => conn_iso($r['decided_at']), 'item_id' => (int)$r['id']], $rows),
        'until' => conn_iso($until), 'more' => $more,
      ];
    }
  }
  throw new ApiError('Unknown request.', 404);
}

/** connect.push: a new item, or the same external_id again = an update (a decided item is not opened again). */
function conn_push(array $c, array $in): array {
  $ext = conn_ext($in);
  $kind = (string)($in['kind'] ?? '');
  if (!in_array($kind, ['task', 'approval'], true)) throw new ApiError('kind must be "task" or "approval".');
  $title = txt($in['title'] ?? '', 200, true, 'title');
  $details = txt($in['details'] ?? '', 5000);
  $linkIn = trim((string)($in['link'] ?? ''));
  $link = $linkIn === '' ? '' : (ol_link($linkIn) ?? '');
  if ($linkIn !== '' && ($link === '' || strlen($link) > 1000)) throw new ApiError('link must be a web address starting with http:// or https://');
  $fields = conn_fields($in['fields'] ?? null);
  $fjson = json_encode($fields, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  $old = one('SELECT * FROM conn_items WHERE conn_id = ? AND external_id = ?', [$c['id'], $ext]);
  if ($old && $old['kind'] !== $kind) throw new ApiError("This external_id was sent as a {$old['kind']}; it cannot change.");

  if (!$old) {
    q("INSERT INTO conn_items (conn_id, external_id, kind, title, details, link, fields, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
      [$c['id'], $ext, $kind, $title, $details, $link ?: null, $fjson, now(), now()]);
    $id = (int)db()->lastInsertId();
    $it = one('SELECT * FROM conn_items WHERE id = ?', [$id]);
    if ($kind === 'task') conn_make_task($it, $c);
    else conn_alert($c, $title, $details, $id);
    $it = one('SELECT * FROM conn_items WHERE id = ?', [$id]);
    return ['id' => $id, 'status' => $it['status']];
  }

  $id = (int)$old['id'];
  if ($kind === 'approval') return conn_approval_again($c, $old, $title, $details, $link, $fjson);
  // a task: what changed goes to that task as a note (never a second task)
  $changes = conn_changes($old, $title, $details, $link, $fields);
  // the note first, the saved words after: a note that could not be written is written when the app sends it again
  // (the link chip is touched only when the link changed: '' takes it away)
  $chip = ($old['link'] ?? '') !== $link ? $link : null;
  $note = "🔌 {$c['name']} updated this:\n" . implode("\n", $changes);
  if ($old['dp_task_id'] && $changes && !conn_task_note($old['dp_task_id'], $note, $c['name'], $chip))
    throw new ApiError('The task could not be updated just now. Send the same again in a minute.', 503);
  // a task the app took back before it was made, sent again: it is wanted again (made below), like an approval sent again
  q("UPDATE conn_items SET title = ?, details = ?, link = ?, fields = ?, updated_at = ?, status = IF(status = 'withdrawn' AND dp_task_id IS NULL, 'pending', status) WHERE id = ?", [$title, $details, $link ?: null, $fjson, now(), $id]);
  $it = one('SELECT * FROM conn_items WHERE id = ?', [$id]);
  $mine = false;
  if (!$it['dp_task_id']) conn_make_task($it, $c, $mine); // not made yet (the projects were not ready): made now, with the newest words
  $it = one('SELECT * FROM conn_items WHERE id = ?', [$id]);
  // the 5-minute job made the task meanwhile, from the words read before these: the task hears what changed
  if (!$old['dp_task_id'] && $it['dp_task_id'] && !$mine && $changes && !conn_task_note($it['dp_task_id'], $note, $c['name'], $chip)) {
    // not written: the old words go back (only when nothing newer came), so sending the same again writes the note
    q('UPDATE conn_items SET title = ?, details = ?, link = ?, fields = ? WHERE id = ? AND title = ? AND details <=> ? AND link <=> ? AND fields <=> ?',
      [$old['title'], $old['details'], $old['link'], $old['fields'], $id, $title, $details, $link ?: null, $fjson]);
    throw new ApiError('The task could not be updated just now. Send the same again in a minute.', 503);
  }
  return ['id' => $id, 'status' => $it['status']];
}

/**
 * An approval sent again (same external_id). A decided one stays as it is. The UPDATE checks the status again, so an
 * owner's ✓ / ✕ made between the read and the write is never turned back into 'pending' (the app hears the decision).
 */
function conn_approval_again(array $c, array $old, string $title, string $details, string $link, string $fjson): array {
  $id = (int)$old['id'];
  if (in_array($old['status'], ['approved', 'rejected'], true)) return ['id' => $id, 'status' => $old['status']]; // decided: stays as it is
  $again = $old['status'] === 'withdrawn'; // sent again after the app took it back: waits for the owner again
  $n = q("UPDATE conn_items SET title = ?, details = ?, link = ?, fields = ?, status = 'pending', updated_at = ? WHERE id = ? AND status IN ('pending', 'withdrawn')",
    [$title, $details, $link ?: null, $fjson, now(), $id])->rowCount();
  if ($n === 0) {
    $now = one('SELECT status FROM conn_items WHERE id = ?', [$id]);
    if ($now && $now['status'] !== 'pending') return ['id' => $id, 'status' => $now['status']]; // decided meanwhile: kept
    return ['id' => $id, 'status' => 'pending']; // same words saved again (nothing changed)
  }
  if ($again) conn_alert($c, $title, $details, $id);
  return ['id' => $id, 'status' => 'pending'];
}

/**
 * connect.withdraw: the app takes an item back. Only a waiting item (or a task already made) is withdrawn; an approval
 * the owner decided meanwhile stays decided (the UPDATE checks the status again, so a decision at the same moment wins).
 */
function conn_withdraw(array $c, array $it): array {
  // the UPDATE also checks the task it read: when the job made the task meanwhile, it is read again and the note written
  for ($try = 0; $try < 3; $try++) {
    if (!($it['status'] === 'pending' || ($it['status'] === 'done' && $it['dp_task_id']))) break;
    if ($it['kind'] === 'task' && $it['dp_task_id'] && !conn_task_note($it['dp_task_id'], "🔌 {$c['name']} took this back (withdrawn).", $c['name']))
      throw new ApiError('The task could not be updated just now. Send the same again in a minute.', 503);
    $st = q("UPDATE conn_items SET status = 'withdrawn', updated_at = ? WHERE id = ? AND status IN ('pending', 'done') AND dp_task_id <=> ?",
      [now(), $it['id'], $it['dp_task_id'] ?: null]);
    if ($st->rowCount() === 1) { $it['status'] = 'withdrawn'; break; }
    $it = one('SELECT * FROM conn_items WHERE id = ?', [$it['id']]) ?: $it; // decided (or its task made) meanwhile: see how it really is
  }
  return ['id' => (int)$it['id'], 'status' => $it['status']];
}

/** What changed between the saved item and the new words, as short lines. */
function conn_changes(array $old, string $title, string $details, string $link, array $fields): array {
  $out = [];
  if ($old['title'] !== $title) $out[] = "Title: {$old['title']} → $title";
  if (($old['details'] ?? '') !== $details) $out[] = 'Details: ' . ($details === '' ? '(removed)' : ol_one_line($details, 300));
  if (($old['link'] ?? '') !== $link) $out[] = 'Link: ' . ($link === '' ? '(removed)' : $link);
  $was = [];
  foreach (conn_fields_of($old['fields']) as [$k, $v]) $was[$k] = $v;
  $now = [];
  foreach ($fields as [$k, $v]) $now[$k] = $v;
  foreach ($now as $k => $v) {
    if (!array_key_exists($k, $was)) $out[] = "$k: $v";
    elseif ($was[$k] !== $v) $out[] = "$k: $v (was {$was[$k]})";
  }
  foreach ($was as $k => $v) if (!array_key_exists($k, $now)) $out[] = "$k: (removed)";
  return $out;
}

/** A phone alert to the owner for a new approval. */
function conn_alert(array $c, string $title, string $details, int $id): void {
  $owner = (int)setting('dp_owner', '0');
  if ($owner) notify([$owner], 'task', "🔌 {$c['name']}: $title", ol_one_line($details, 200), '/projects/#apps', 'conn' . $id);
}

// ---------------------------------------------------------------- tasks → the owner's Daily Projects

/** The task id for an item: always the same for the same item, so two makers at once (a push and the job) make one task. */
function conn_task_id(array $it): string {
  return 'ct' . (int)$it['id'] . '-' . substr(hash('sha256', $it['conn_id'] . '|' . $it['external_id'] . '|' . $it['created_at']), 0, 8);
}

/**
 * Make the Daily Projects task for a 'task' item (once). False when the projects are not ready (tried again by the job).
 * $mine: true only when this call put the task in (from $it's words), not another maker.
 */
function conn_make_task(array $it, array $c, ?bool &$mine = null): bool {
  $mine = false;
  if ($it['dp_task_id']) return true;
  $fresh = one('SELECT status, dp_task_id FROM conn_items WHERE id = ?', [$it['id']]);
  if (!$fresh || $fresh['dp_task_id'] || $fresh['status'] !== 'pending') return true; // made already, or the app took it back
  $taskId = conn_task_id($it);
  $there = false;
  try {
    $made = ol_write(function (object $data, array &$hist) use ($it, $c, $taskId, &$there): bool {
      foreach ((is_array($data->projects ?? null) ? $data->projects : []) as $p) {
        if (is_object($p) && (string)($p->id ?? '') === $taskId) { $there = true; return false; } // made by the other one already
      }
      $at = ol_iso_now();
      $day = date('Y-m-d');
      $groups = is_array($data->groups ?? null) ? $data->groups : [];
      $details = (string)($it['details'] ?? '');
      $task = (object)[
        'id' => $taskId, 'groupId' => (string)(is_object($groups[0] ?? null) ? ($groups[0]->id ?? 'g1') : 'g1'),
        'name' => mb_substr((string)$it['title'], 0, 200), 'priority' => 'medium', 'deadline' => null, 'notes' => '',
        'about' => mb_substr($details, 0, 1000),
        'links' => [], 'state' => 'active', 'lastTickDate' => null, 'lastActivityDate' => $day, 'activeSince' => $day,
        'stateChangedAt' => $at, 'createdAt' => $at, 'updatedAt' => $at, 'steps' => [], 'workNotes' => [], 'files' => [],
        'fromApp' => (string)$c['name'],
      ];
      if ($it['link']) $task->links[] = (object)['id' => $taskId . '-link', 'title' => mb_substr('Open in ' . $c['name'], 0, 200), 'url' => $it['link']];
      $lines = array_map(fn($p) => "{$p[0]}: {$p[1]}", conn_fields_of($it['fields']));
      if (mb_strlen($details) > 1000) $lines[] = ($lines ? "\n" : '') . $details; // the whole text (the description keeps the first 1000 letters)
      if ($lines) $task->workNotes[] = (object)['id' => ol_rand_id('an'), 'text' => mb_substr(implode("\n", $lines), 0, 5000), 'stepId' => null, 'createdAt' => $at, 'updatedAt' => $at, 'app' => true];
      if (!isset($data->projects) || !is_array($data->projects)) $data->projects = [];
      array_unshift($data->projects, $task);
      $hist[date('Y-m', strtotime($at))][] = (object)['id' => ol_rand_id('ak'), 'projectId' => $taskId, 'projectName' => $task->name, 'kind' => 'app_task',
        'detail' => mb_substr("From {$c['name']}: {$it['title']}", 0, 2000), 'at' => $at];
      return true;
    }, '🔌 Task from ' . ol_one_line((string)$c['name'], 60));
  } catch (OlError $e) {
    return false;
  }
  if (!$made && !$there) return false;
  $mine = $made && !$there;
  $st = q("UPDATE conn_items SET dp_task_id = ?, status = 'done', updated_at = ? WHERE id = ? AND dp_task_id IS NULL AND status = 'pending'", [$taskId, now(), $it['id']]);
  if ($st->rowCount() !== 1) {
    // the app took it back while the task was being made: it stays withdrawn, and the task says so
    $st = q("UPDATE conn_items SET dp_task_id = ?, updated_at = ? WHERE id = ? AND dp_task_id IS NULL AND status = 'withdrawn'", [$taskId, now(), $it['id']]);
    if ($st->rowCount() === 1 && !conn_task_note($taskId, "🔌 {$c['name']} took this back (withdrawn).", (string)$c['name'])) error_log('connect: withdrawn note not written');
  }
  return true;
}

/**
 * A note from the app on its task (not your work: the dot does not change). Nothing when the task was deleted.
 * True when it is written (or there is no task any more); false when the projects could not be saved just now.
 */
function conn_task_note(string $taskId, string $text, string $app, ?string $link = null): bool {
  try {
    ol_write(function (object $data, array &$hist) use ($taskId, $text, $app, $link): bool {
      foreach ((is_array($data->projects ?? null) ? $data->projects : []) as $p) {
        if (!is_object($p) || (string)($p->id ?? '') !== $taskId) continue;
        $at = ol_iso_now();
        if (!isset($p->workNotes) || !is_array($p->workNotes)) $p->workNotes = [];
        array_unshift($p->workNotes, (object)['id' => ol_rand_id('an'), 'text' => mb_substr($text, 0, 5000), 'stepId' => null, 'createdAt' => $at, 'updatedAt' => $at, 'app' => true]);
        if ($link !== null) { // the link chip follows the app's newest link ('' = the app took the link away: no chip)
          $links = array_values(array_filter(is_array($p->links ?? null) ? $p->links : [], fn($l) => !is_object($l) || ($l->id ?? '') !== $taskId . '-link'));
          if ($link !== '') $links[] = (object)['id' => $taskId . '-link', 'title' => mb_substr('Open in ' . $app, 0, 200), 'url' => $link];
          $p->links = $links;
        }
        $hist[date('Y-m', strtotime($at))][] = (object)['id' => ol_rand_id('ak'), 'projectId' => $taskId, 'projectName' => (string)($p->name ?? ''), 'kind' => 'app_note',
          'detail' => mb_substr($text, 0, 2000), 'at' => $at];
        return true;
      }
      return false;
    }, '🔌 Update from ' . ol_one_line($app, 60));
  } catch (OlError | ApiError $e) {
    error_log('connect note: ' . get_class($e));
    return false;
  }
  return true;
}

// ---------------------------------------------------------------- decisions → the app's address

/** The signature the app checks: "sha256=" + HMAC-SHA256(secret, timestamp + "." + body). */
function conn_signature(string $secret, string $ts, string $body): string {
  return 'sha256=' . hash_hmac('sha256', $ts . '.' . $body, $secret);
}

/**
 * Send one decision to the app's decision address. 2xx = done. Otherwise tried again later (5, 10, 20 … minutes,
 * at most 6 hours apart), for 24 hours after the decision; then the connection shows the error in plain words.
 */
function conn_send(int $itemId): void {
  $it = one('SELECT * FROM conn_items WHERE id = ?', [$itemId]);
  if (!$it || !in_array($it['status'], ['approved', 'rejected'], true) || $it['callback_ok_at'] || (int)$it['callback_failed']) {
    if ($it) q('UPDATE conn_items SET callback_next_at = NULL WHERE id = ?', [$itemId]); // nothing to send: never picked by the job again
    return;
  }
  $c = one('SELECT * FROM connections WHERE id = ?', [$it['conn_id']]);
  if (!$c || ($c['callback_url'] ?? '') === '') { q('UPDATE conn_items SET callback_next_at = NULL WHERE id = ? AND callback_ok_at IS NULL', [$itemId]); return; }
  // claim it: only one sender at a time (the owner's ✓ and the 5-minute job, or two jobs, never both send it)
  $claim = q('UPDATE conn_items SET callback_next_at = ? WHERE id = ? AND callback_ok_at IS NULL AND callback_failed = 0 AND callback_next_at IS NOT NULL AND callback_next_at <= ?',
    [date('Y-m-d H:i:s', jobs_now() + CONN_SEND_CLAIM), $itemId, date('Y-m-d H:i:s', jobs_now())]);
  if ($claim->rowCount() !== 1) return; // someone else is sending it (or it is not due)
  $body = json_encode(['event' => 'decision', 'external_id' => $it['external_id'], 'status' => $it['status'], 'reason' => $it['reason'] ?? '',
    'decided_at' => conn_iso($it['decided_at']), 'item_id' => (int)$it['id']], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  $ts = (string)time();
  $code = 0;
  try {
    $url = conn_callback($c['callback_url']); // checked again (https only)
    $ch = curl_init($url);
    curl_setopt_array($ch, [
      CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => false,
      CURLOPT_TIMEOUT => CONN_TIMEOUT, CURLOPT_CONNECTTIMEOUT => CONN_TIMEOUT,
      CURLOPT_PROTOCOLS => TEST_DIR !== '' ? (CURLPROTO_HTTPS | CURLPROTO_HTTP) : CURLPROTO_HTTPS,
      CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'User-Agent: WorkTask-Connections/1',
        'X-WorkTask-Timestamp: ' . $ts, 'X-WorkTask-Signature: ' . conn_signature(ol_open((string)$c['secret_enc']), $ts, $body)],
    ]);
    $ok = curl_exec($ch) !== false;
    $code = $ok ? (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE) : 0;
  } catch (ApiError $e) {
    $code = -1;
  }
  $now = jobs_now();
  if ($code >= 200 && $code < 300) {
    q('UPDATE conn_items SET callback_ok_at = ?, callback_next_at = NULL, callback_tries = callback_tries + 1 WHERE id = ?', [now(), $itemId]);
    q('UPDATE connections SET last_error = NULL WHERE id = ?', [$c['id']]);
    return;
  }
  $tries = (int)$it['callback_tries'] + 1;
  $why = $code === -1 ? 'its decision address is not a safe https:// address'
    : ($code === 0 ? 'its decision address did not answer' : ($code >= 300 && $code < 400 ? "its decision address sent us somewhere else (error $code)" : "its decision address said error $code"));
  $short = ol_one_line((string)$it['title'], 60);
  if ($now - (int)strtotime((string)($it['callback_since'] ?: $it['decided_at'])) >= CONN_GIVE_UP) { // 24 hours from the decision, or from a new address
    // (only while not taken: the app may have asked for it while this send waited)
    q('UPDATE conn_items SET callback_tries = ?, callback_next_at = NULL, callback_failed = 1 WHERE id = ? AND callback_ok_at IS NULL', [$tries, $itemId]);
    q('UPDATE connections SET last_error = ? WHERE id = ?', [mb_substr("Could not tell the app about “{$short}” for 24 hours: $why. Stopped trying — the app can still ask for its decisions.", 0, 300), $c['id']]);
    return;
  }
  $wait = min(300 * (2 ** min($tries - 1, 10)), 6 * 3600);
  $again = q('UPDATE conn_items SET callback_tries = ?, callback_next_at = ? WHERE id = ? AND callback_ok_at IS NULL', [$tries, date('Y-m-d H:i:s', $now + $wait), $itemId]);
  if ($again->rowCount() !== 1) return; // the app asked for it while this send waited: it has it, no error to show
  q('UPDATE connections SET last_error = ? WHERE id = ?', [mb_substr("Could not tell the app about “{$short}”: $why. Trying again by itself.", 0, 300), $c['id']]);
}

/** The 5-minute job: decisions waiting to be sent again, and tasks not made yet (the projects were not ready). */
function conn_jobs(): void {
  $due = date('Y-m-d H:i:s', jobs_now());
  foreach (all("SELECT id FROM conn_items WHERE callback_next_at IS NOT NULL AND callback_next_at <= ? AND callback_ok_at IS NULL AND callback_failed = 0 AND status IN ('approved', 'rejected') ORDER BY callback_next_at LIMIT 20", [$due]) as $r) {
    try { conn_send((int)$r['id']); } catch (Throwable $e) { error_log('connect send: ' . get_class($e)); }
  }
  foreach (all("SELECT i.*, c.name AS conn_name FROM conn_items i JOIN connections c ON c.id = i.conn_id WHERE i.kind = 'task' AND i.status = 'pending' AND i.dp_task_id IS NULL ORDER BY i.id LIMIT 20") as $r) {
    try { conn_make_task($r, ['name' => $r['conn_name']]); } catch (Throwable $e) { error_log('connect task: ' . get_class($e)); }
  }
}

// ---------------------------------------------------------------- the owner's screens

function conn_owner(array $me): void {
  if ($me['role'] !== 'admin' || (int)setting('dp_owner', '0') !== (int)$me['id']) throw new ApiError('Only the owner of the projects can manage connections.', 403);
}

function conn_get(int $id): array {
  $c = one('SELECT * FROM connections WHERE id = ?', [$id]);
  if (!$c) throw new ApiError('That connection was not found.', 404);
  return $c;
}

/** conn.* requests (the owner of the projects only). Returns null when `a` is not one of them. */
function conn_handle(string $a, array $in, array $me): ?array {
  if (!str_starts_with($a, 'conn.')) return null;
  conn_owner($me);
  switch ($a) {
    case 'conn.list':
      return ['connections' => array_map('conn_out', all('SELECT * FROM connections ORDER BY name, id'))];
    case 'conn.create': {
      $name = txt($in['name'] ?? '', 80, true, 'The name');
      $url = conn_callback($in['callback_url'] ?? '');
      $key = conn_new_secret('wtc_');
      $secret = conn_new_secret('wts_');
      q('INSERT INTO connections (name, key_hash, key_end, secret_enc, callback_url, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)',
        [$name, conn_key_hash($key), substr($key, -4), ol_seal($secret), $url ?: null, now()]);
      $id = (int)db()->lastInsertId();
      audit($me['id'], 'conn_create', "#$id $name");
      return ['connection' => conn_out(conn_get($id)), 'key' => $key, 'secret' => $secret]; // shown this once, never again
    }
    case 'conn.update': {
      $c = conn_get((int)($in['id'] ?? 0));
      $name = array_key_exists('name', $in) ? txt($in['name'], 80, true, 'The name') : $c['name'];
      $url = array_key_exists('callback_url', $in) ? conn_callback($in['callback_url']) : (string)($c['callback_url'] ?? '');
      $active = array_key_exists('active', $in) ? (int)(bool)$in['active'] : (int)$c['active'];
      q('UPDATE connections SET name = ?, callback_url = ?, active = ? WHERE id = ?', [$name, $url ?: null, $active, $c['id']]);
      if ($url !== (string)($c['callback_url'] ?? '')) {
        q('UPDATE connections SET last_error = NULL WHERE id = ?', [$c['id']]);
        // a new (or fixed) address: the decisions the app was not told yet are sent there by the 5-minute job
        if ($url !== '') q("UPDATE conn_items SET callback_next_at = ?, callback_since = ?, callback_failed = 0, callback_tries = 0 WHERE conn_id = ? AND status IN ('approved', 'rejected') AND callback_ok_at IS NULL",
          [date('Y-m-d H:i:s', jobs_now()), date('Y-m-d H:i:s', jobs_now()), $c['id']]);
      }
      audit($me['id'], 'conn_update', "#{$c['id']} $name" . ($active ? '' : ' (off)'));
      return ['connection' => conn_out(conn_get((int)$c['id']))];
    }
    case 'conn.rotate': {
      $c = conn_get((int)($in['id'] ?? 0));
      $key = conn_new_secret('wtc_');
      $secret = conn_new_secret('wts_');
      q('UPDATE connections SET key_hash = ?, key_end = ?, secret_enc = ? WHERE id = ?', [conn_key_hash($key), substr($key, -4), ol_seal($secret), $c['id']]);
      audit($me['id'], 'conn_rotate', "#{$c['id']} {$c['name']}");
      return ['connection' => conn_out(conn_get((int)$c['id'])), 'key' => $key, 'secret' => $secret];
    }
    case 'conn.delete': {
      $c = conn_get((int)($in['id'] ?? 0));
      q('DELETE FROM conn_items WHERE conn_id = ?', [$c['id']]);
      q('DELETE FROM connections WHERE id = ?', [$c['id']]);
      audit($me['id'], 'conn_delete', "#{$c['id']} {$c['name']}");
      return [];
    }
    case 'conn.items': { // approvals: waiting ones, and the decided / withdrawn ones of the last 30 days
      $status = (string)($in['status'] ?? '');
      $where = $status === 'pending' ? "i.status = 'pending'"
        : ($status === 'decided' ? "i.status IN ('approved', 'rejected', 'withdrawn') AND i.updated_at >= ?" : "(i.status = 'pending' OR (i.status IN ('approved', 'rejected', 'withdrawn') AND i.updated_at >= ?))");
      $args = $status === 'pending' ? [] : [date('Y-m-d H:i:s', time() - 30 * 86400)];
      $conns = [];
      foreach (all('SELECT * FROM connections') as $c) $conns[(int)$c['id']] = $c;
      if ($status === '') { // a waiting approval is never cut off by many newer decided ones: only the decided list is capped
        $rows = array_merge(all("SELECT i.* FROM conn_items i WHERE i.kind = 'approval' AND i.status = 'pending' ORDER BY i.created_at DESC, i.id DESC LIMIT 2000"),
          all("SELECT i.* FROM conn_items i WHERE i.kind = 'approval' AND i.status IN ('approved', 'rejected', 'withdrawn') AND i.updated_at >= ? ORDER BY i.created_at DESC, i.id DESC LIMIT 300", $args));
        usort($rows, fn($a, $b) => [$b['created_at'], (int)$b['id']] <=> [$a['created_at'], (int)$a['id']]);
      } else {
        $rows = all("SELECT i.* FROM conn_items i WHERE i.kind = 'approval' AND $where ORDER BY i.created_at DESC, i.id DESC LIMIT " . ($status === 'pending' ? 2000 : 300), $args);
      }
      return ['items' => array_values(array_map(fn($r) => conn_item_out($r, $conns[(int)$r['conn_id']] ?? ['name' => '?', 'callback_url' => '']), $rows))];
    }
    case 'conn.decide': {
      $decision = (string)($in['decision'] ?? '');
      if (!in_array($decision, ['approved', 'rejected'], true)) throw new ApiError('Choose Approve or Reject.');
      $it = one("SELECT * FROM conn_items WHERE id = ? AND kind = 'approval'", [(int)($in['id'] ?? 0)]);
      if (!$it) throw new ApiError('That item was not found.', 404);
      if ($it['status'] !== 'pending') throw new ApiError($it['status'] === 'withdrawn' ? 'The app took this back, so there is nothing to decide.' : 'This was already decided.', 409);
      $changed = 'The app changed this since you opened it. Look at it again, then decide.';
      $ver = (string)($in['version'] ?? '');
      if ($ver !== '' && !hash_equals(conn_version($it), $ver)) throw new ApiError($changed, 409);
      $reason = txt($in['reason'] ?? '', 500);
      $c = conn_get((int)$it['conn_id']);
      $hasUrl = ($c['callback_url'] ?? '') !== '';
      $st = q('UPDATE conn_items SET status = ?, reason = ?, decided_at = ?, callback_since = ?, updated_at = ?, callback_next_at = ? WHERE id = ? AND status = ?'
        . ' AND title = BINARY ? AND details <=> BINARY ? AND link <=> BINARY ? AND fields <=> BINARY ?', // the words checked above (the app sending new ones at the same moment: refused)
        [$decision, $reason, now(), now(), now(), $hasUrl ? date('Y-m-d H:i:s', jobs_now()) : null, $it['id'], 'pending', $it['title'], $it['details'], $it['link'], $it['fields']]);
      if ($st->rowCount() !== 1) { // decided (or taken back) on another device at the same moment: that one counts, nothing is sent twice
        $now = one('SELECT status FROM conn_items WHERE id = ?', [$it['id']]);
        if (($now['status'] ?? '') === 'pending') throw new ApiError($changed, 409);
        throw new ApiError(($now['status'] ?? '') === 'withdrawn' ? 'The app took this back, so there is nothing to decide.' : 'This was already decided.', 409);
      }
      audit($me['id'], 'conn_decide', "#{$it['id']} $decision");
      if ($hasUrl) conn_send((int)$it['id']); // told at once; a failure is tried again by the 5-minute job
      $c = conn_get((int)$it['conn_id']);
      return ['item' => conn_item_out(one('SELECT * FROM conn_items WHERE id = ?', [$it['id']]), $c)];
    }
  }
  throw new ApiError('Unknown request.', 404);
}
