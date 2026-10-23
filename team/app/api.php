<?php
// Everything the team app can ask the server. Staff only ever reach their own tasks;
// every manager-only action checks require_admin() first.
declare(strict_types=1);

require_once __DIR__ . '/push.php';
require_once __DIR__ . '/jobs.php';
require_once __DIR__ . '/outlook.php';
require_once __DIR__ . '/connect.php';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function txt($v, int $max, bool $required = false, string $what = 'This'): string {
  $s = trim(preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/u', '', (string)($v ?? '')) ?? '');
  if ($required && $s === '') throw new ApiError("$what is empty.");
  return mb_substr($s, 0, $max);
}
function date_or_null($v): ?string {
  $v = (string)($v ?? '');
  if ($v === '') return null;
  if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $v)) throw new ApiError('That date is not right.');
  [$y, $m, $d] = array_map('intval', explode('-', $v));
  if (!checkdate($m, $d, $y)) throw new ApiError('That date is not right.'); // like 30 February
  return $v;
}

/** Is this task on the list for that day? */
function due_on(array $t, string $day): bool {
  if ($day < $t['start_date']) return false;
  $wd = (int)date('w', strtotime($day));
  if ($t['repeat_kind'] === 'daily') return !($t['skip_sunday'] && $wd === 0);
  if ($t['repeat_kind'] === 'weekly') return (int)$t['weekday'] === $wd;
  return !($t['skip_sunday'] && $wd === 0); // one-time: every working day until finished
}

function photos_of(array $updateIds): array {
  if (!$updateIds) return [];
  $in = implode(',', array_fill(0, count($updateIds), '?'));
  $out = [];
  foreach (all("SELECT id, update_id FROM photos WHERE update_id IN ($in) ORDER BY id", array_values($updateIds)) as $p) $out[$p['update_id']][] = (int)$p['id'];
  return $out;
}

function user_name(int $id): string {
  static $names = null;
  if ($names === null) { $names = []; foreach (all('SELECT id, name FROM users') as $r) $names[(int)$r['id']] = $r['name']; }
  return $names[$id] ?? '';
}

function update_out(?array $u, array $photos = []): ?array {
  if (!$u) return null;
  return ['id' => (int)$u['id'], 'day' => $u['day'], 'note' => $u['note'], 'state' => $u['state'], 'at' => $u['updated_at'], 'photos' => $photos[$u['id']] ?? [],
    'byId' => (int)$u['user_id'], 'by' => user_name((int)$u['user_id'])];
}

/** Hand open tasks to another person: history stays, and both see a note on the task. Returns how many moved. */
function move_tasks(array $me, array $tasks, int $toId, bool $tell = true): int {
  $to = one("SELECT id, name, active FROM users WHERE id = ?", [$toId]);
  if (!$to || !$to['active']) throw new ApiError('Choose who takes it over.');
  $n = 0;
  $titles = [];
  $lost = []; // person who had it => titles
  foreach ($tasks as $t) {
    if ((int)$t['assignee_id'] === $toId || $t['status'] !== 'open') continue;
    q('UPDATE tasks SET assignee_id = ?, updated_at = ? WHERE id = ?', [$toId, now(), $t['id']]);
    // the old messages count as read for the new person: only the move note shows as new
    $prev = (int)(one('SELECT MAX(id) AS m FROM comments WHERE task_id = ?', [$t['id']])['m'] ?? 0);
    q('INSERT INTO task_reads (task_id, user_id, at, last_id) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE last_id = GREATEST(last_id, VALUES(last_id))', [$t['id'], $toId, now(), $prev]);
    q("INSERT INTO comments (task_id, user_id, text, at, kind) VALUES (?, ?, ?, ?, 'move')", [$t['id'], $me['id'], '↔ Moved from ' . user_name((int)$t['assignee_id']) . ' to ' . $to['name'] . '.', now()]);
    q('INSERT INTO task_moves (task_id, from_id, to_id, at) VALUES (?, ?, ?, ?)', [$t['id'], (int)$t['assignee_id'], $toId, now()]);
    audit($me['id'], 'task_moved', "#{$t['id']} → {$to['name']}");
    $n++;
    $titles[] = $t['title'];
    $lost[(int)$t['assignee_id']][] = $t['title'];
  }
  if ($tell) foreach ($lost as $from => $list) notify([$from], 'task', count($list) === 1 ? "↔ A task was moved to {$to['name']}" : '↔ ' . count($list) . " tasks were moved to {$to['name']}", implode(' · ', array_slice($list, 0, 3)), '/');
  if ($n && $tell) notify([$toId], 'task', $n === 1 ? '↔ A task was moved to you' : "↔ $n tasks were moved to you", implode(' · ', array_slice($titles, 0, 3)), '/');
  return $n;
}

/** ref => the given project's short description (sent with project.sync), for the refs that have one. */
function project_abouts(array $refs): array {
  if (!$refs) return [];
  $keys = [];
  foreach ($refs as $r) $keys['pab:' . md5((string)$r)] = (string)$r;
  $out = [];
  foreach (all('SELECT k, v FROM settings WHERE k IN (' . implode(',', array_fill(0, count($keys), '?')) . ')', array_keys($keys)) as $r) $out[$keys[$r['k']]] = $r['v'];
  return $out;
}

/** Tasks with their update for today and the one before, ready for the screen. */
function tasks_out(array $tasks, string $day): array {
  if (!$tasks) return [];
  $ids = array_map(fn($t) => (int)$t['id'], $tasks);
  $in = implode(',', array_fill(0, count($ids), '?'));
  $todays = [];
  foreach (all("SELECT * FROM updates WHERE task_id IN ($in) AND day = ?", [...$ids, $day]) as $u) $todays[$u['task_id']] = $u;
  $lasts = [];
  foreach (all("SELECT u.* FROM updates u JOIN (SELECT task_id, MAX(day) AS d FROM updates WHERE task_id IN ($in) AND day < ? GROUP BY task_id) m ON m.task_id = u.task_id AND m.d = u.day", [...$ids, $day]) as $u) $lasts[$u['task_id']] = $u;
  $photos = photos_of(array_map(fn($u) => (int)$u['id'], [...array_values($todays), ...array_values($lasts)]));
  // messages on each task: how many, how many I have not read, and the newest one
  $meId = (int)($GLOBALS['me']['id'] ?? 0);
  $count = []; $unread = []; $lastMsg = [];
  foreach (all("SELECT task_id, COUNT(*) AS n FROM comments WHERE task_id IN ($in) GROUP BY task_id", $ids) as $r) $count[$r['task_id']] = (int)$r['n'];
  foreach (all("SELECT c.task_id, COUNT(*) AS n FROM comments c LEFT JOIN task_reads r ON r.task_id = c.task_id AND r.user_id = ?
      WHERE c.task_id IN ($in) AND c.user_id <> ? AND c.id > COALESCE(r.last_id, 0) GROUP BY c.task_id", [$meId, ...$ids, $meId]) as $r) $unread[$r['task_id']] = (int)$r['n'];
  $answered = []; // newest message from someone other than the person who wrote the newest update (a move note is not an answer)
  foreach (all("SELECT c.task_id, MAX(c.at) AS at FROM comments c
      JOIN (SELECT task_id, MAX(day) AS d FROM updates WHERE task_id IN ($in) GROUP BY task_id) m ON m.task_id = c.task_id
      JOIN updates u ON u.task_id = m.task_id AND u.day = m.d
      WHERE c.user_id <> u.user_id AND c.kind IS NULL GROUP BY c.task_id", $ids) as $r) $answered[$r['task_id']] = $r['at'];
  foreach (all("SELECT c.*, u.name FROM comments c JOIN users u ON u.id = c.user_id JOIN (SELECT task_id, MAX(id) AS mid FROM comments WHERE task_id IN ($in) GROUP BY task_id) m ON m.mid = c.id", $ids) as $c) {
    $lastMsg[$c['task_id']] = ['by' => $c['name'], 'byId' => (int)$c['user_id'], 'text' => $c['text'], 'at' => $c['at'], 'mine' => (int)$c['user_id'] === $meId];
  }
  // whole projects given to a person: only the first open step (lowest seq) is due; the rest wait their turn
  $firstSeq = [];
  $refs = array_values(array_unique(array_filter(array_map(fn($t) => $t['seq'] !== null ? $t['project_ref'] : null, $tasks))));
  if ($refs) {
    $rin = implode(',', array_fill(0, count($refs), '?'));
    foreach (all("SELECT project_ref, assignee_id, MIN(seq) AS m FROM tasks WHERE status = 'open' AND seq IS NOT NULL AND project_ref IN ($rin) GROUP BY project_ref, assignee_id", $refs) as $r) {
      $firstSeq[$r['project_ref'] . '|' . $r['assignee_id']] = (int)$r['m'];
    }
  }
  $files = [];
  foreach (all("SELECT id, task_id, name, mime FROM task_files WHERE task_id IN ($in) ORDER BY id", $ids) as $f) $files[$f['task_id']][] = ['id' => (int)$f['id'], 'name' => $f['name'], 'image' => str_starts_with($f['mime'], 'image/')];
  $queued = fn($t) => $t['seq'] !== null && $t['status'] === 'open' && (int)$t['seq'] > ($firstSeq[$t['project_ref'] . '|' . $t['assignee_id']] ?? PHP_INT_MAX);
  $about = project_abouts($refs);
  $turnSince = [];
  foreach ($tasks as $t) {
    if ($t['seq'] === null || !$t['project_ref']) continue;
    $prev = one("SELECT MAX(done_at) AS d FROM tasks WHERE project_ref = ? AND seq IS NOT NULL AND seq < ? AND status IN ('done', 'cancelled') AND (closed_by IS NULL OR closed_by <> -3) AND id <> ?", [$t['project_ref'], $t['seq'], $t['id']]);
    if ($prev && $prev['d']) $turnSince[$t['id']] = substr($prev['d'], 0, 10);
  }
  return array_map(fn($t) => [
    'id' => (int)$t['id'], 'title' => $t['title'], 'queued' => $queued($t), 'seq' => $t['seq'] === null ? null : (int)$t['seq'], 'details' => $t['details'] ?? '',
    'assignee' => ['id' => (int)$t['assignee_id'], 'name' => $t['assignee_name'] ?? ''],
    'repeat' => $t['repeat_kind'], 'skipSunday' => (bool)$t['skip_sunday'], 'weekday' => $t['weekday'] === null ? null : (int)$t['weekday'],
    'dueDate' => $t['due_date'], 'startDate' => $t['start_date'], 'project' => $t['project'] ?? '', 'projectRef' => $t['project_ref'], 'stepRef' => $t['step_ref'],
    'projectAbout' => $t['seq'] !== null && $t['project_ref'] ? ($about[$t['project_ref']] ?? '') : '',
    'status' => $t['status'], 'createdAt' => $t['created_at'], 'doneAt' => $t['done_at'],
    'dueToday' => $t['status'] === 'open' && due_on($t, $day) && !$queued($t),
    'today' => update_out($todays[$t['id']] ?? null, $photos), 'last' => update_out($lasts[$t['id']] ?? null, $photos),
    'createdBy' => (int)$t['created_by'], 'createdByName' => user_name((int)$t['created_by']), 'declined' => (int)($t['closed_by'] ?? 0) === -2,
    'closedByPerson' => $t['status'] === 'done' && (int)($t['closed_by'] ?? 0) > 0, // their own Finished (not the manager's Mark done)
    'reopenedAt' => $t['reopened_at'] ?? null, 'closedFrom' => $t['closed_from'] ?? null,
    'turnSince' => $turnSince[$t['id']] ?? null, 'fromStaff' => (bool)($t['from_staff'] ?? 0), 'needsPhoto' => (bool)($t['needs_photo'] ?? 0), 'files' => $files[$t['id']] ?? [],
    'messages' => $count[$t['id']] ?? 0, 'unread' => $unread[$t['id']] ?? 0, 'lastMessage' => $lastMsg[$t['id']] ?? null,
    // stuck: the newest update says "Stuck" (and the manager has not answered since)
    'stuck' => (function () use ($t, $todays, $lasts, $answered) {
      $u = $todays[$t['id']] ?? $lasts[$t['id']] ?? null;
      if (!$u || $u['state'] !== 'stuck' || $t['status'] !== 'open') return false;
      return !(isset($answered[$t['id']]) && $answered[$t['id']] >= $u['updated_at']);
    })(),
  ], $tasks);
}

/** The phone's own id for something it sends, so a repeat (reply lost) is kept only once. */
function client_id($v): ?string {
  return is_string($v) && preg_match('/^[A-Za-z0-9-]{8,60}$/', $v) ? $v : null;
}

/** $upTo: the newest message the person was shown (0 = all) — one that came after it stays unread. */
function mark_read(array $taskIds, int $userId, int $upTo = 0): void {
  foreach (array_unique($taskIds) as $id) {
    $last = (int)(one('SELECT MAX(id) AS m FROM comments WHERE task_id = ?', [(int)$id])['m'] ?? 0);
    if ($upTo > 0) $last = min($last, $upTo);
    q('INSERT INTO task_reads (task_id, user_id, at, last_id) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE at = VALUES(at), last_id = GREATEST(last_id, VALUES(last_id))', [(int)$id, $userId, now(), $last]);
  }
}

function comments_of(int $taskId): array {
  $meId = (int)($GLOBALS['me']['id'] ?? 0);
  return array_map(fn($c) => ['id' => (int)$c['id'], 'by' => $c['name'], 'byId' => (int)$c['user_id'], 'text' => $c['text'], 'at' => $c['at'], 'mine' => (int)$c['user_id'] === $meId,
    'photo' => !empty($c['photo']), 'editedAt' => $c['edited_at'] ?? null, 'kind' => $c['kind'] ?? null],
    all('SELECT c.*, u.name FROM comments c JOIN users u ON u.id = c.user_id WHERE c.task_id = ? ORDER BY c.id', [$taskId]));
}

/** What needs the manager: stuck, new messages from staff, suggestions waiting for a yes. */
function team_attention(): array {
  $open = tasks_out(all(TASK_SELECT . " WHERE t.status = 'open' ORDER BY t.id"), today());
  return [
    'open' => $open,
    'stuck' => array_values(array_filter($open, fn($t) => $t['stuck'])),
    'unread' => array_values(array_filter($open, fn($t) => $t['unread'] > 0 && !$t['stuck'])),
    'suggestions' => tasks_out(all(TASK_SELECT . " WHERE t.status = 'suggested' ORDER BY t.id"), today()),
  ];
}

const TASK_SELECT = 'SELECT t.*, u.name AS assignee_name FROM tasks t JOIN users u ON u.id = t.assignee_id';

function own_task(array $me, int $id): array {
  $t = one(TASK_SELECT . ' WHERE t.id = ?', [$id]);
  if (!$t || ($me['role'] !== 'admin' && (int)$t['assignee_id'] !== $me['id'])) throw new ApiError('That task was not found.', 404);
  return $t;
}

/** The owner of the Daily Projects account can only be changed by the owner (another manager could otherwise sign in as them). */
function guard_owner(int $id, array $me): void {
  if ($id === (int)setting('dp_owner', '0') && $id !== $me['id']) throw new ApiError('Only the owner can change this account.', 403);
}

function handle(string $a, array $in): array {
  if ($a === 'ping') return ['setUp' => (bool)config(), 'time' => now()];
  if ($a === 'login') return login((string)($in['username'] ?? ''), (string)($in['password'] ?? ''), (string)($_SERVER['HTTP_USER_AGENT'] ?? ''));
  $fromApp = conn_app_handle($a, $in); // 🔌 an outside app, with its own key (no sign-in)
  if ($fromApp !== null) return $fromApp;

  $me = current_user();
  $GLOBALS['me'] = $me;
  // a first password (or one the manager reset) must be changed before anything else
  if ($me['must_change'] && !in_array($a, ['me', 'logout', 'password'], true)) throw new ApiError('Choose your own password first.', 428);
  $day = today();
  $dp = dp_handle($a, $in, $me);
  if ($dp !== null) return $dp;
  $push = push_handle($a, $in, $me);
  if ($push !== null) return $push;
  $ol = ol_handle($a, $in, $me); // the owner's Outlook → Daily Projects Inbox
  if ($ol !== null) return $ol;
  $conn = conn_handle($a, $in, $me); // 🔌 Connections (the owner of the projects only)
  if ($conn !== null) return $conn;
  switch ($a) {
    case 'me':
      return ['user' => public_user($me), 'today' => $day];
    case 'logout':
      logout((string)($in['endpoint'] ?? ''));
      return [];
    case 'password':
      change_password($me, (string)($in['old'] ?? ''), (string)($in['new'] ?? ''));
      return ['user' => public_user(one('SELECT * FROM users WHERE id = ?', [$me['id']]))];

    // ---------- staff: my tasks ----------
    case 'my.today': {
      $tasks = all(TASK_SELECT . " WHERE t.assignee_id = ? AND (t.status = 'open' OR t.done_at >= ?) ORDER BY t.repeat_kind = 'once', t.due_date IS NULL, t.due_date, t.project_ref, t.seq, t.id", [$me['id'], $day . ' 00:00:00']);
      $out = array_values(array_filter(tasks_out($tasks, $day), fn($t) => !($t['status'] === 'cancelled' && str_ends_with((string)$t['stepRef'], ':whole')))); // a replaced whole-project task: its words are on the step
      $due = array_values(array_filter($out, fn($t) => $t['dueToday'] || ($t['today'] !== null)));
      $other = array_values(array_filter($out, fn($t) => !$t['dueToday'] && $t['today'] === null && $t['status'] === 'open'));
      // my suggestions: waiting for a yes, or said no this week (with the reason in the messages)
      $sugg = tasks_out(all(TASK_SELECT . " WHERE t.created_by = ? AND t.assignee_id = ? AND (t.status = 'suggested' OR (t.status = 'cancelled' AND t.closed_by = -2 AND t.updated_at >= ?)) ORDER BY t.id DESC",
        [$me['id'], $me['id'], date('Y-m-d H:i:s', time() - 7 * 86400)]), $day);
      return ['today' => $day, 'tasks' => $due, 'other' => $other, 'suggestions' => $sugg, 'fillBy' => setting('fill_by', '18:00')];
    }
    case 'update.save': {
      $t = one(TASK_SELECT . ' WHERE t.id = ?', [(int)($in['taskId'] ?? 0)]);
      // the phone's clock may be off: its time when it sent this (sentAt) puts writtenAt on the server's clock
      $sent = is_string($in['sentAt'] ?? null) && strtotime($in['sentAt']);
      $skew = $sent ? max(-86400, min(86400, time() - (int)strtotime($in['sentAt']))) : 0;
      $wrote = is_string($in['writtenAt'] ?? null) && strtotime($in['writtenAt']) ? date('Y-m-d H:i:s', min(time(), (int)strtotime($in['writtenAt']) + $skew)) : null;
      // written offline and sent later: it counts for the day it was written (up to 2 days back)
      // (that day by the server's clock when the phone said both times; the phone's own day only when it did not)
      $uday = $day;
      $wday = $sent && $wrote ? substr($wrote, 0, 10) : ($in['day'] ?? null);
      if (is_string($wday) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $wday) && $wday < $day) {
        // older than 2 days: say so, never quietly save it as today's update
        if ($wday < date('Y-m-d', strtotime($day . ' -2 days'))) throw new ApiError('This update was written more than 2 days ago, so it was not saved. Please write it again.');
        $uday = $wday;
      }
      // a closed task can only be changed by the person who finished it today (to fix or undo their own Finished);
      // never when the manager cancelled it, took it back, or marked it done (closed_by is set only by their own Finished)
      // (the newest update: a Finished written offline yesterday and sent today is still theirs to undo)
      if ($wrote && substr($wrote, 0, 10) !== $uday) $wrote = null; // the time it was written must be on the day it is for
      // (an undo written offline within 12 hours of their Finished counts too, even if it arrives later)
      $mine = $t && $t['status'] === 'done' && $t['done_at'] && (int)($t['closed_by'] ?? 0) === $me['id']
        && ($t['done_at'] >= date('Y-m-d H:i:s', time() - 12 * 3600) || ($wrote && $wrote >= $t['done_at'] && strtotime($wrote) <= strtotime($t['done_at']) + 12 * 3600))
        && ($fin = one('SELECT state, user_id FROM updates WHERE task_id = ? ORDER BY day DESC LIMIT 1', [$t['id']]))
        && $fin['state'] === 'finished' && (int)$fin['user_id'] === $me['id'];
      // written offline before the task was moved to someone else or closed: kept as history for that day, nothing else changes
      // (only someone who still had the task that day: it was moved away from them on or after that day, or closed while theirs)
      // today's update only if it was written (offline) before the move or the close; an earlier day's if moved after that day
      $since = $uday < $day ? $uday . ' 00:00:00' : $wrote;
      $hadIt = $t && $since !== null && (((int)$t['assignee_id'] === $me['id'] && $t['status'] !== 'suggested' && $t['done_at']
          && ($wrote ? $t['done_at'] > $wrote : ($uday < $day && $t['done_at'] >= $uday . ' 00:00:00'))) // closed after it was written (or after that day began)
        || one('SELECT id FROM task_moves WHERE task_id = ? AND from_id = ? AND regive = 0 AND at > ? LIMIT 1', [$t['id'], $me['id'], $since])); // moved after it was written
      // (also today's: written before the move or the close later today)
      $ucid = client_id($in['clientId'] ?? null); // the phone's id of this update: a resend is the same save
      // today's words for a task that someone else holds now: never on their update (a time from the phone cannot prove it is old)
      if ($t && $hadIt && $uday === $day && (int)$t['assignee_id'] !== $me['id']) {
        throw new ApiError('This task was moved to ' . user_name((int)$t['assignee_id']) . ' before your update arrived, so it was not saved. Tell your manager what you did.');
      }
      // an earlier day: only if it was theirs that day (not given to them or started later)
      $notYetTheirs = function (array $t) use ($me, $uday): bool {
        $first = one('SELECT to_id, at FROM task_moves WHERE task_id = ? AND (from_id = ? OR to_id = ?) ORDER BY at, id LIMIT 1', [$t['id'], $me['id'], $me['id']]);
        $cameLater = $first && (int)$first['to_id'] === $me['id'] && $first['at'] > $uday . ' 23:59:59'; // (moved away and back: they had it from the start)
        return $cameLater || $t['start_date'] > $uday || substr((string)$t['created_at'], 0, 10) > $uday;
      };
      if ($t && ((int)$t['assignee_id'] !== $me['id'] || ($t['status'] !== 'open' && !$mine)) && $hadIt) {
        // (history for an earlier day too: only by who held the task that day)
        if ($uday < $day && $notYetTheirs($t)) throw new ApiError('That day was before this task was yours, so the update was not saved.');
        $note = txt($in['note'] ?? '', 4000, true, 'The update');
        $state = in_array($in['state'] ?? '', ['progress', 'finished'], true) ? $in['state'] : 'progress'; // not "Stuck": the task is not theirs now
        $old = one('SELECT user_id, note, COALESCE(written_at, updated_at) AS written_at, client_id FROM updates WHERE task_id = ? AND day = ?', [$t['id'], $uday]);
        if ($old && $ucid && (int)$old['user_id'] === $me['id'] && $old['client_id'] === $ucid) { // sent before, the answer was lost
          $u = one('SELECT * FROM updates WHERE task_id = ? AND day = ?', [$t['id'], $uday]);
          return ['update' => update_out($u, photos_of([(int)$u['id']])), 'history' => 'own'];
        }
        if ($old && $wrote && (int)$old['user_id'] === $me['id'] && $old['written_at'] > $wrote) { // they wrote again later: that one stays
          return ['update' => update_out(one('SELECT * FROM updates WHERE task_id = ? AND day = ?', [$t['id'], $uday]), []), 'history' => 'older'];
        }
        if ($old && (int)$old['user_id'] !== $me['id']) { // someone else already wrote for that day: add these words below theirs (once)
          $line = $me['name'] . ': ' . $note;
          if (!str_contains((string)$old['note'], $line)) q('UPDATE updates SET note = ? WHERE task_id = ? AND day = ?', [mb_substr(trim((string)$old['note']) . "\n\n" . $line, 0, 8000), $t['id'], $uday]);
          $u = one('SELECT * FROM updates WHERE task_id = ? AND day = ?', [$t['id'], $uday]);
          $u['note'] = $note; $u['user_id'] = $me['id']; // the answer: only what this person wrote, never the other person's update
          return ['update' => update_out($u, []), 'history' => 'merged']; // (photos cannot go on the other person's update)
        } else {
          q('INSERT INTO updates (task_id, user_id, day, note, state, created_at, updated_at, written_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE note = VALUES(note), state = VALUES(state), updated_at = VALUES(updated_at), written_at = VALUES(written_at)',
            [$t['id'], $me['id'], $uday, $note, $state, now(), now(), $wrote ?? now()]);
          if ($ucid) q('UPDATE updates SET client_id = ? WHERE task_id = ? AND day = ?', [$ucid, $t['id'], $uday]);
          // today's words (written offline) for a whole-project task replaced by steps since: they count for their first step too
          if ($uday === $day && $t['status'] === 'cancelled' && $t['project_ref'] && $t['step_ref'] === $t['project_ref'] . ':whole') carry_whole_update((string)$t['project_ref'], $me['id']);
        }
        $u = one('SELECT * FROM updates WHERE task_id = ? AND day = ?', [$t['id'], $uday]);
        return ['update' => update_out($u, photos_of([(int)$u['id']])), 'history' => 'own'];
      }
      $t = own_task($me, (int)($in['taskId'] ?? 0));
      if ($uday < $day && $notYetTheirs($t)) throw new ApiError('That day was before this task was yours, so the update was not saved.');
      $cur = one('SELECT id, user_id, COALESCE(written_at, updated_at) AS written_at, client_id FROM updates WHERE task_id = ? AND day = ?', [$t['id'], $uday]);
      if ($cur && $ucid && (int)$cur['user_id'] === $me['id'] && $cur['client_id'] === $ucid) { // sent before, the answer was lost: the same save
        return ['update' => update_out(one('SELECT * FROM updates WHERE id = ?', [$cur['id']]), photos_of([(int)$cur['id']]))];
      }
      if ($wrote && $cur && (int)$cur['user_id'] === $me['id'] && $cur['written_at'] > $wrote) { // an older offline update: their newer one stays (and the task is not reopened)
        return ['update' => update_out(one('SELECT * FROM updates WHERE task_id = ? AND day = ?', [$t['id'], $uday]), []), 'history' => 'older'];
      }
      if ((int)$t['assignee_id'] !== $me['id']) throw new ApiError('Only the person doing the task can write its update.', 403);
      if ($t['status'] !== 'open' && !$mine) throw new ApiError('This task is closed.');
      $note = txt($in['note'] ?? '', 4000, true, 'The update');
      $state = in_array($in['state'] ?? '', ['progress', 'stuck', 'finished'], true) ? $in['state'] : 'progress';
      if ($state === 'finished' && $t['needs_photo']) { // only photos added by this person (not the one before a move)
        $n = one('SELECT COUNT(*) AS n FROM photos p JOIN updates u ON u.id = p.update_id WHERE u.task_id = ? AND u.day = ? AND u.user_id = ? AND p.created_at >= u.created_at', [$t['id'], $uday, $me['id']]);
        if (!(int)$n['n']) throw new ApiError('A photo is needed to finish this task. Add a photo, then tap Finished.');
      }
      $old = one('SELECT user_id, note, state FROM updates WHERE task_id = ? AND day = ?', [$t['id'], $uday]);
      // the manager hears of the first update of the day, and of Stuck / Finished (not of every small fix)
      if (!$old || ($state !== $old['state'] && $state !== 'progress')) {
        notify(admin_ids(), $state === 'stuck' ? 'stuck' : 'update',
          $state === 'stuck' ? "⚠️ {$me['name']} is stuck" : ($state === 'finished' ? "✅ {$me['name']} finished a task" : "✓ {$me['name']} sent an update"),
          $t['title'] . ': ' . $note, '/projects/#team-task=' . $t['id'], 'u' . $t['id']);
      }
      if ($old && (int)$old['user_id'] !== $me['id']) {
        // the task was moved: the person before already wrote for this day. Keep their words above;
        // their photos stay on the row but are marked as older than this take-over (created_at)
        $before = trim((string)$old['note']);
        if ($before !== '') $note = mb_substr(user_name((int)$old['user_id']) . ': ' . $before . "\n\n" . $note, 0, 8000);
        q('UPDATE updates SET user_id = ?, note = ?, state = ?, created_at = ?, updated_at = ?, written_at = ? WHERE task_id = ? AND day = ?', [$me['id'], $note, $state, now(), now(), $wrote ?? now(), $t['id'], $uday]);
      } else {
        // (written_at: when it was written, so the next offline one is compared with that, not with when this arrived)
        q('INSERT INTO updates (task_id, user_id, day, note, state, created_at, updated_at, written_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), note = VALUES(note), state = VALUES(state), updated_at = VALUES(updated_at), written_at = VALUES(written_at)',
          [$t['id'], $me['id'], $uday, $note, $state, now(), now(), $wrote ?? now()]);
      }
      if ($ucid) q('UPDATE updates SET client_id = ? WHERE task_id = ? AND day = ?', [$ucid, $t['id'], $uday]);
      // a late update for an earlier day (sent from the outbox) is kept as history: it never reopens or closes the task
      $newer = $uday < $day && one('SELECT id FROM updates WHERE task_id = ? AND day > ?', [$t['id'], $uday]);
      if ($t['repeat_kind'] === 'once' && !$newer) {
        if ($state === 'finished') q("UPDATE tasks SET status = 'done', done_at = ?, closed_by = ?, updated_at = ? WHERE id = ?", [now(), $me['id'], now(), $t['id']]);
        elseif ($t['status'] === 'done') q("UPDATE tasks SET status = 'open', closed_from = done_at, done_at = NULL, closed_by = NULL, reopened_at = ?, updated_at = ? WHERE id = ?", [now(), now(), $t['id']]);
      }
      $u = one('SELECT * FROM updates WHERE task_id = ? AND day = ?', [$t['id'], $uday]);
      return ['update' => update_out($u, photos_of([(int)$u['id']]))];
    }
    case 'photo.add':
      return ['photoId' => add_photo($me, (int)($in['updateId'] ?? 0))];
    case 'photo.delete': {
      $p = one('SELECT p.*, u.user_id, u.day, u.state, u.created_at AS u_at, t.needs_photo FROM photos p JOIN updates u ON u.id = p.update_id JOIN tasks t ON t.id = u.task_id WHERE p.id = ?', [(int)($in['id'] ?? 0)]);
      // the same days a photo can be added on (today's update, or one written offline in the last 2 days): never stuck for good
      if (!$p || (int)$p['user_id'] !== $me['id'] || $p['day'] > $day || $p['day'] < date('Y-m-d', strtotime($day . ' -2 days')) || $p['created_at'] < $p['u_at']) throw new ApiError('You can only remove your own photos from the last 2 days.', 403);
      if ($p['needs_photo'] && $p['state'] === 'finished'
        && (int)one('SELECT COUNT(*) AS n FROM photos WHERE update_id = ? AND created_at >= ?', [$p['update_id'], $p['u_at']])['n'] <= 1) {
        throw new ApiError('This task needs a photo. Add another photo first, or change the update from Finished.');
      }
      @unlink(UPLOAD_DIR . '/' . $p['file']);
      q('DELETE FROM photos WHERE id = ?', [$p['id']]);
      return [];
    }
    case 'task.get': {
      $t = own_task($me, (int)($in['id'] ?? 0));
      $ups = all('SELECT * FROM updates WHERE task_id = ? ORDER BY day DESC LIMIT 60', [$t['id']]);
      $photos = photos_of(array_map(fn($u) => (int)$u['id'], $ups));
      $out = ['task' => tasks_out([$t], $day)[0], 'updates' => array_map(fn($u) => update_out($u, $photos), $ups), 'comments' => comments_of((int)$t['id'])];
      mark_read([(int)$t['id']], $me['id']);
      notifs_read_task($me['id'], (int)$t['id']); // its 🔔 notifications are seen too
      return $out;
    }
    case 'comment.add': { // a message on a task: between the manager and the person doing it
      $t = own_task($me, (int)($in['taskId'] ?? 0));
      $text = (string)preg_replace('/^[↔\s]+/u', '', txt($in['text'] ?? '', 2000, true, 'The message')); // (that sign marks the server's move notes)
      if ($text === '') throw new ApiError('The message is empty.');
      $cid = client_id($in['clientId'] ?? null);
      if (!$cid || !one('SELECT id FROM comments WHERE user_id = ? AND client_id = ?', [$me['id'], $cid])) {
        // (the same send twice at the same moment: kept once, the second simply gets the messages)
        if (insert_once('INSERT INTO comments (task_id, user_id, text, at, client_id) VALUES (?, ?, ?, ?, ?)', [$t['id'], $me['id'], $text, now(), $cid]))
        // the manager writes: the person doing it hears; the person writes: the managers hear
        notify($me['role'] === 'admin' ? [(int)$t['assignee_id']] : admin_ids(), 'msg', "💬 {$me['name']} · {$t['title']}", $text, '/projects/#team-task=' . $t['id'], 'm' . $t['id']);
      }
      mark_read([(int)$t['id']], $me['id'], max(0, (int)($in['upTo'] ?? 0)));
      return ['comments' => comments_of((int)$t['id'])];
    }
    case 'project.addStep': { // the person adds a step to a project given to them; the owner's Daily Projects then adds it to the project
      $ref = txt($in['projectRef'] ?? '', 80, true, 'The project');
      $title = txt($in['title'] ?? '', 300, true, 'The step');
      $mine = all("SELECT * FROM tasks WHERE project_ref = ? AND seq IS NOT NULL AND status = 'open' AND assignee_id = ? ORDER BY seq", [$ref, $me['id']]);
      if (!$mine) throw new ApiError('This project is not given to you.', 403);
      $lk = 'ps:' . md5($ref); // the same lock as project.sync: never two changes to one project at once
      if (!(int)(one('SELECT GET_LOCK(?, 10) AS l', [$lk])['l'] ?? 0)) throw new ApiError('Busy, try again in a moment.', 503);
      try {
        $mine = all("SELECT * FROM tasks WHERE project_ref = ? AND seq IS NOT NULL AND status = 'open' AND assignee_id = ? ORDER BY seq", [$ref, $me['id']]); // again, inside the lock
        if (!$mine) throw new ApiError('This project is not given to you.', 403);
        $t = add_staff_step($me, $ref, $title, $mine, $day, client_id($in['clientId'] ?? null));
      }
      finally { q('SELECT RELEASE_LOCK(?)', [$lk]); }
      return ['task' => tasks_out([own_task($me, $t)], $day)[0]];
    }
    case 'project.mine': { // staff: one project given to me — every step, done ones too, for the project page
      $ref = txt($in['projectRef'] ?? '', 80, true, 'The project');
      $tasks = all(TASK_SELECT . " WHERE t.project_ref = ? AND t.seq IS NOT NULL AND t.assignee_id = ? AND (t.status = 'open' OR t.status = 'done') ORDER BY t.status = 'open', t.done_at, t.seq, t.id", [$ref, $me['id']]);
      return ['today' => $day, 'tasks' => tasks_out($tasks, $day)];
    }
    case 'comment.photo': { // a photo in the messages (with an optional line of text)
      $t = own_task($me, (int)($_POST['taskId'] ?? 0));
      $cid = client_id($_POST['clientId'] ?? null);
      if ($cid && ($dup = one('SELECT id FROM comments WHERE user_id = ? AND client_id = ?', [$me['id'], $cid]))) return ['comments' => comments_of((int)$t['id'])];
      $f = $_FILES['file'] ?? null;
      if (!$f || $f['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($f['tmp_name'])) throw new ApiError('The photo did not arrive. Try again.');
      if ($f['size'] > MAX_UPLOAD_BYTES) throw new ApiError('That photo is too big.');
      $mime = (new finfo(FILEINFO_MIME_TYPE))->file($f['tmp_name']);
      if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'], true)) throw new ApiError('Only photos can be added.');
      $jpeg = shrink_photo($f['tmp_name'], $mime);
      $dir = 'msg/' . date('Y-m');
      if (!is_dir(UPLOAD_DIR . "/$dir")) mkdir(UPLOAD_DIR . "/$dir", 0750, true);
      $file = "$dir/" . bin2hex(random_bytes(12)) . '.jpg';
      file_put_contents(UPLOAD_DIR . "/$file", $jpeg);
      $text = txt($_POST['text'] ?? '', 2000);
      if (!insert_once('INSERT INTO comments (task_id, user_id, text, at, client_id, photo) VALUES (?, ?, ?, ?, ?, ?)', [$t['id'], $me['id'], $text, now(), $cid, $file], $file)) return ['comments' => comments_of((int)$t['id'])]; // the same send arrived twice at once: kept once
      mark_read([(int)$t['id']], $me['id']);
      notify($me['role'] === 'admin' ? [(int)$t['assignee_id']] : admin_ids(), 'msg', "📷 {$me['name']} · {$t['title']}", $text !== '' ? $text : 'Sent a photo', '/projects/#team-task=' . $t['id'], 'm' . $t['id']);
      return ['comments' => comments_of((int)$t['id'])];
    }
    case 'comment.edit':
    case 'comment.delete': { // only your own message
      $c = one('SELECT * FROM comments WHERE id = ?', [(int)($in['id'] ?? 0)]);
      if (!$c || (int)$c['user_id'] !== $me['id']) throw new ApiError('You can change only your own messages.', 403);
      own_task($me, (int)$c['task_id']);
      // the server's own notes (a move, a chase) are the task's record: never changed or deleted (the chase limit and
      // Follow-up's "chased" read them)
      if (in_array($c['kind'] ?? '', ['move', 'chase'], true)) throw new ApiError('This note cannot be changed.');
      if ($a === 'comment.delete') {
        q('DELETE FROM comments WHERE id = ?', [$c['id']]);
        if ($c['photo']) @unlink(UPLOAD_DIR . '/' . $c['photo']);
      } else {
        $text = (string)preg_replace('/^[↔\s]+/u', '', txt($in['text'] ?? '', 2000, !$c['photo'], 'The message'));
        if ($text === '' && !$c['photo']) throw new ApiError('The message is empty.');
        q('UPDATE comments SET text = ?, edited_at = ? WHERE id = ?', [$text, now(), $c['id']]);
      }
      return ['comments' => comments_of((int)$c['task_id'])];
    }
    case 'tasks.read': { // "seen": these tasks' messages count as read for me
      $ids = array_slice(array_map('intval', (array)($in['ids'] ?? [])), 0, 100);
      // only the ones still mine (one moved away meanwhile must not stop the others being marked read)
      $ids = array_values(array_filter($ids, function ($id) use ($me) { try { own_task($me, $id); return true; } catch (ApiError $e) { return false; } }));
      if ($ids) mark_read($ids, $me['id'], max(0, (int)($in['upTo'] ?? 0)));
      return [];
    }
    case 'search': { // tasks, messages and updates with these words (staff: only their own tasks)
      $words = txt($in['q'] ?? '', 100);
      if (mb_strlen($words) < 2) return ['results' => []];
      $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $words) . '%';
      $mine = $me['role'] === 'admin' ? '' : ' AND t.assignee_id = ' . (int)$me['id'];
      $out = [];
      foreach (all("SELECT t.id, t.title, t.status, t.project, t.updated_at AS at, u.name FROM tasks t JOIN users u ON u.id = t.assignee_id
          WHERE (t.title LIKE ? OR t.details LIKE ? OR t.project LIKE ?) AND t.status <> 'suggested'$mine ORDER BY t.status = 'open' DESC, t.updated_at DESC LIMIT 30", [$like, $like, $like]) as $r) {
        $out[] = ['taskId' => (int)$r['id'], 'title' => $r['title'], 'who' => $r['name'], 'kind' => 'task', 'text' => trim(($r['project'] ?? '') . ' · ' . $r['status'], ' ·'), 'at' => $r['at']];
      }
      foreach (all("SELECT c.task_id, c.text, c.at, t.title, u.name FROM comments c JOIN tasks t ON t.id = c.task_id JOIN users u ON u.id = c.user_id
          WHERE c.text LIKE ?$mine ORDER BY c.at DESC LIMIT 30", [$like]) as $r) {
        $out[] = ['taskId' => (int)$r['task_id'], 'title' => $r['title'], 'who' => $r['name'], 'kind' => 'message', 'text' => $r['text'], 'at' => $r['at']];
      }
      foreach (all("SELECT p.task_id, p.note, p.updated_at AS at, t.title, u.name FROM updates p JOIN tasks t ON t.id = p.task_id JOIN users u ON u.id = p.user_id
          WHERE p.note LIKE ?$mine ORDER BY p.day DESC LIMIT 30", [$like]) as $r) {
        $out[] = ['taskId' => (int)$r['task_id'], 'title' => $r['title'], 'who' => $r['name'], 'kind' => 'update', 'text' => $r['note'], 'at' => $r['at']];
      }
      usort($out, fn($x, $y) => strcmp($y['at'], $x['at']));
      return ['results' => array_slice($out, 0, 60)];
    }
    case 'suggest': { // staff: "I think this should be done" — it waits for the manager's yes
      $title = txt($in['title'] ?? '', 300, true, 'The task');
      $kind = in_array($in['repeat'] ?? '', ['daily', 'weekly', 'once'], true) ? $in['repeat'] : 'once';
      $cid = client_id($in['clientId'] ?? null);
      if ($cid && ($dup = one('SELECT id FROM tasks WHERE created_by = ? AND client_id = ?', [$me['id'], $cid]))) return ['task' => tasks_out([own_task($me, (int)$dup['id'])], $day)[0]]; // sent twice
      if (!insert_once("INSERT INTO tasks (title, details, assignee_id, created_by, repeat_kind, skip_sunday, weekday, due_date, start_date, status, client_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, NULL, ?, ?, 'suggested', ?, ?, ?)",
        [$title, txt($in['details'] ?? '', 4000), $me['id'], $me['id'], $kind, $kind === 'once' ? date_or_null($in['dueDate'] ?? null) : null, $day, $cid, now(), now()])) {
        return ['task' => tasks_out([own_task($me, (int)one('SELECT id FROM tasks WHERE created_by = ? AND client_id = ?', [$me['id'], $cid])['id'])], $day)[0]]; // sent twice at the same moment
      }
      $id = (int)db()->lastInsertId();
      audit($me['id'], 'task_suggested', "#$id $title");
      notify(admin_ids(), 'msg', "💡 {$me['name']} suggests a task", $title, '/projects/#team-task=' . $id);
      return ['task' => tasks_out([own_task($me, $id)], $day)[0]];
    }
  }

  // ---------- manager only ----------
  require_admin($me);
  switch ($a) {
    case 'team.today': {
      $people = all("SELECT * FROM users WHERE active = 1 AND role = 'staff' ORDER BY name");
      $tasks = all(TASK_SELECT . " WHERE (t.status = 'open' OR t.done_at >= ?) ORDER BY t.id", [$day . ' 00:00:00']);
      $out = array_values(array_filter(tasks_out($tasks, $day), fn($t) => ($t['dueToday'] || $t['today'] !== null) && !($t['status'] === 'cancelled' && str_ends_with((string)$t['stepRef'], ':whole'))));
      $fillBy = setting('fill_by', '18:00');
      $att = team_attention();
      unset($att['open']);
      // each person: the last day they sent an update (for "no update for 3 days")
      $lastDay = [];
      foreach (all('SELECT user_id, MAX(day) AS d FROM updates GROUP BY user_id') as $r) $lastDay[(int)$r['user_id']] = $r['d'];
      // stuck since: the first day of the run of Stuck updates on each stuck task
      $since = [];
      foreach ($att['stuck'] as $t) {
        $first = $t['today'] ?? $t['last'];
        foreach (all('SELECT day, state FROM updates WHERE task_id = ? ORDER BY day DESC LIMIT 30', [$t['id']]) as $u) { if ($u['state'] !== 'stuck') break; $first = $u['day']; }
        $since[$t['id']] = is_array($first) ? $first['day'] : $first;
      }
      return ['today' => $day, 'fillBy' => $fillBy, 'late' => date('H:i') >= $fillBy, 'people' => array_map(fn($p) => public_user($p) + ['lastUpdate' => $lastDay[(int)$p['id']] ?? null, 'morningSentAt' => morning_sent_at((int)$p['id'], $day)], $people),
        'tasks' => $out, 'stuckSince' => (object)$since] + $att;
    }
    case 'followup.list': // every open task given to staff, for the manager's 🔁 Follow-up screen
      return ['today' => $day, 'rows' => followup_rows($day)];
    case 'task.chase': { // 🔔 Chase: ask the person for an update (a message on the task, and a phone alert); once an hour at most
      $t = own_task($me, (int)($in['id'] ?? 0));
      if ($t['status'] !== 'open') throw new ApiError('This task is closed.');
      $last = one("SELECT at FROM comments WHERE task_id = ? AND kind = 'chase' ORDER BY id DESC LIMIT 1", [$t['id']]);
      if ($last && $last['at'] > date('Y-m-d H:i:s', time() - 3600)) throw new ApiError('Already chased at ' . substr($last['at'], 11, 5) . '.');
      $text = "🔔 {$me['name']} asks for an update on this.";
      q("INSERT INTO comments (task_id, user_id, text, at, kind) VALUES (?, ?, ?, ?, 'chase')", [$t['id'], $me['id'], $text, now()]);
      notify([(int)$t['assignee_id']], 'msg', "🔔 {$me['name']} · {$t['title']}", 'Please send an update on this.', '/projects/#team-task=' . $t['id'], 'm' . $t['id']);
      mark_read([(int)$t['id']], $me['id']);
      audit($me['id'], 'task_chase', "#{$t['id']} {$t['title']}");
      return ['chasedAt' => now(), 'comments' => comments_of((int)$t['id'])];
    }
    case 'morning.mail': { // one person's pending work (projects given to them and tasks), for the manager's morning email
      $u = one('SELECT * FROM users WHERE id = ?', [(int)($in['userId'] ?? 0)]);
      if (!$u) throw new ApiError('Person not found.', 404);
      return ['today' => $day, 'person' => ['id' => (int)$u['id'], 'name' => $u['name'], 'email' => (string)($u['email'] ?? '')],
        'manager' => $me['name'], 'items' => morning_items((int)$u['id'], $day)];
    }
    case 'morning.sent': { // the manager pressed 📧 Morning email for this person: remember the time (only today's counts)
      $u = one('SELECT id FROM users WHERE id = ?', [(int)($in['userId'] ?? 0)]);
      if (!$u) throw new ApiError('Person not found.', 404);
      $at = now();
      set_setting('ms:' . (int)$u['id'], $at);
      return ['sentAt' => $at];
    }
    case 'people.morning': // the People page: each active staff person's pending work (as in the morning email) and today's send, in one go
      return ['today' => $day, 'people' => array_map(fn($p) => ['id' => (int)$p['id'], 'name' => $p['name'], 'email' => (string)($p['email'] ?? ''),
        'items' => morning_items((int)$p['id'], $day), 'sentAt' => morning_sent_at((int)$p['id'], $day)],
        all("SELECT * FROM users WHERE active = 1 AND role = 'staff' ORDER BY name"))];
    case 'project.sync': {
      // Daily Projects: "this whole project is given to <person>". steps = the project's open steps, in order.
      // Makes a task for each new step, keeps titles and order up to date, moves them to a new person,
      // and closes tasks whose step is gone (ticked or deleted by the manager). assigneeId 0 = take the project back.
      // One at a time per project (two taps, or two devices, would otherwise make every step twice).
      $ref = txt($in['projectRef'] ?? '', 80, true, 'The project');
      unset($in['_server']);
      // a take-back sent because the sender's saved copy shows it no longer given: only if nothing was saved since
      // (another device may have given it again meanwhile); "stale" = not done, the sender looks again later
      if (!empty($in['ifHead']) && (int)($in['assigneeId'] ?? 0) === 0 && setting('dp_head', '') !== (string)$in['ifHead']) return ['stale' => true];
      $in['_psc'] = (int)setting('psc:' . md5($ref), '0'); // when the owner's app last sent it (a Work Task move after that is followed)
      set_setting('psc:' . md5($ref), (string)time()); // before the work too: a server sync waiting for the lock sees it
      // its unsaved changes: the saved projects are older than this for the project until they are saved
      $oldPsp = setting('psp:' . md5($ref), '');
      if (!empty($in['pending'])) set_setting('psp:' . md5($ref), json_encode(['who' => (int)($in['assigneeId'] ?? 0), 'base' => txt($in['baseCommit'] ?? '', 40), 'at' => time()] + pending_steps($ref, $in)));
      else q('DELETE FROM settings WHERE k = ?', ['psp:' . md5($ref)]);
      try {
        $out = locked_project_sync($me, $in, $ref, $day);
      } catch (Throwable $e) { // not done (busy, or the person is switched off): the owner's app keeps the old person, so the old marker is back
        if ($oldPsp === '') q('DELETE FROM settings WHERE k = ?', ['psp:' . md5($ref)]); else set_setting('psp:' . md5($ref), $oldPsp);
        // and the old "last sent" time: a Work Task move made before this failed try is still followed when the app sends again
        set_setting('psc:' . md5($ref), (string)$in['_psc']);
        throw $e;
      }
      set_setting('psc:' . md5($ref), (string)time()); // the server's own sync leaves this project alone for a few minutes
      if (!empty($in['pending']) && isset($out['assigneeId']) && $out['assigneeId'] !== (int)($in['assigneeId'] ?? 0) && is_array($pp = json_decode(setting('psp:' . md5($ref), ''), true))) {
        set_setting('psp:' . md5($ref), json_encode(['who' => $out['assigneeId']] + $pp)); // a followed move: the app saves the new person
      }
      return $out;
    }
    case 'task.move': { // one task — or, for a step of a given project, all its open steps
      $t = own_task($me, (int)($in['id'] ?? 0));
      $tasks = $t['seq'] !== null && $t['project_ref']
        ? all("SELECT * FROM tasks WHERE project_ref = ? AND seq IS NOT NULL AND status = 'open'", [$t['project_ref']])
        : [$t];
      return ['moved' => move_tasks($me, $tasks, (int)($in['toId'] ?? 0))];
    }
    case 'tasks.moveAll': { // someone on leave or leaving: all their open tasks to another person
      $from = (int)($in['fromId'] ?? 0);
      if ($from === (int)($in['toId'] ?? 0)) throw new ApiError('Choose a different person.');
      return ['moved' => move_tasks($me, all("SELECT * FROM tasks WHERE assignee_id = ? AND status = 'open'", [$from]), (int)($in['toId'] ?? 0))];
    }
    case 'task.file.add': // manager: an instruction photo / PDF on the task, for the person doing it
      $t = own_task($me, (int)($in['taskId'] ?? 0));
      $fid = add_task_file($me, $t);
      notify([(int)$t['assignee_id']], 'task', '📎 New instruction file', $t['title'], '/projects/#team-task=' . $t['id'], 'f' . $t['id']);
      return ['fileId' => $fid];
    case 'task.file.delete': {
      $f = one('SELECT * FROM task_files WHERE id = ?', [(int)($in['id'] ?? 0)]);
      if (!$f) throw new ApiError('File not found.', 404);
      @unlink(UPLOAD_DIR . '/' . $f['file']);
      q('DELETE FROM task_files WHERE id = ?', [$f['id']]);
      return [];
    }
    case 'task.approve': {
      $t = own_task($me, (int)($in['id'] ?? 0));
      if ($t['status'] !== 'suggested') throw new ApiError('This suggestion was already answered.');
      if (!(int)(one('SELECT active FROM users WHERE id = ?', [$t['assignee_id']])['active'] ?? 0)) throw new ApiError('This person is switched off. Make it a new task for someone else.');
      $kind = in_array($in['repeat'] ?? '', ['daily', 'weekly', 'once'], true) ? $in['repeat'] : $t['repeat_kind'];
      q("UPDATE tasks SET status = 'open', title = ?, repeat_kind = ?, skip_sunday = ?, weekday = ?, due_date = ?, start_date = ?, updated_at = ? WHERE id = ?", [
        txt($in['title'] ?? $t['title'], 300, true, 'The task'), $kind, array_key_exists('skipSunday', $in) ? (empty($in['skipSunday']) ? 0 : 1) : (int)$t['skip_sunday'],
        $kind === 'weekly' ? max(0, min(6, (int)($in['weekday'] ?? $t['weekday'] ?? 1))) : null,
        $kind === 'once' ? (array_key_exists('dueDate', $in) ? date_or_null($in['dueDate']) : $t['due_date']) : null, $day, now(), $t['id']]);
      if (trim((string)($in['note'] ?? '')) !== '') q('INSERT INTO comments (task_id, user_id, text, at) VALUES (?, ?, ?, ?)', [$t['id'], $me['id'], txt($in['note'], 2000), now()]);
      audit($me['id'], 'task_approved', "#{$t['id']} {$t['title']}");
      notify([(int)$t['assignee_id']], 'task', '✅ Your suggestion is now a task', $t['title'], '/projects/#team-task=' . $t['id'], 't' . $t['id']);
      return ['task' => tasks_out([own_task($me, (int)$t['id'])], $day)[0]];
    }
    case 'task.decline': {
      $t = own_task($me, (int)($in['id'] ?? 0));
      if ($t['status'] !== 'suggested') throw new ApiError('This suggestion was already answered.');
      q("UPDATE tasks SET status = 'cancelled', done_at = ?, closed_by = -2, updated_at = ? WHERE id = ?", [now(), now(), $t['id']]); // -2 = a suggestion that was declined
      $why = txt($in['reason'] ?? '', 2000);
      q('INSERT INTO comments (task_id, user_id, text, at) VALUES (?, ?, ?, ?)', [$t['id'], $me['id'], $why !== '' ? "Not now: $why" : 'Not now.', now()]);
      audit($me['id'], 'task_declined', "#{$t['id']} {$t['title']}");
      notify([(int)$t['assignee_id']], 'msg', '💡 Not now: ' . $t['title'], $why !== '' ? $why : 'Your manager said not now.', '/projects/#team-task=' . $t['id']);
      return [];
    }
    case 'projects.overview': { // every given project: who, how far, last update
      $tasks = tasks_out(all(TASK_SELECT . " WHERE t.seq IS NOT NULL AND t.project_ref IS NOT NULL AND (t.status = 'open' OR (t.status = 'done' AND t.done_at >= ?)) ORDER BY t.seq, t.id",
        [date('Y-m-d H:i:s', time() - 90 * 86400)]), $day);
      $by = [];
      foreach ($tasks as $t) $by[$t['projectRef']][] = $t;
      $out = [];
      foreach ($by as $ref => $list) {
        $open = array_values(array_filter($list, fn($t) => $t['status'] === 'open' && !str_ends_with((string)$t['stepRef'], ':whole')));
        $openAll = array_values(array_filter($list, fn($t) => $t['status'] === 'open'));
        $done = array_values(array_filter($list, fn($t) => $t['status'] === 'done' && !str_ends_with((string)$t['stepRef'], ':whole')));
        // (a project given as one task counts too: its open task is one open item, its finished one keeps it listed for 14 days)
        $doneAll = array_filter($list, fn($t) => $t['status'] === 'done');
        if (!$openAll && max(array_map(fn($t) => (string)$t['doneAt'], $doneAll) ?: ['']) < date('Y-m-d H:i:s', time() - 14 * 86400)) continue; // finished long ago
        $cur = null;
        foreach ($openAll as $t) if (!$t['queued']) { $cur = $t; break; }
        $ids = array_map(fn($t) => $t['id'], $list);
        $last = one('SELECT MAX(day) AS d FROM updates WHERE task_id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')', $ids)['d'] ?? null;
        $names = array_values(array_unique(array_map(fn($t) => $t['assignee']['name'], $openAll ?: $list)));
        $out[] = ['ref' => $ref, 'name' => end($list)['project'] ?: 'Project', 'projectAbout' => end($list)['projectAbout'], 'people' => $names, 'open' => count($open) ?: count($openAll), 'done' => count($done),
          'current' => $cur ? ['id' => $cur['id'], 'title' => $cur['title'], 'sentToday' => (bool)$cur['today']] : null, 'lastUpdate' => $last,
          'stuck' => (bool)array_filter($openAll, fn($t) => $t['stuck']), 'staffSteps' => count(array_filter($list, fn($t) => $t['createdBy'] === $t['assignee']['id']))];
      }
      usort($out, fn($a, $b) => [!$a['open'], $a['name']] <=> [!$b['open'], $b['name']]);
      return ['today' => $day, 'projects' => $out];
    }
    case 'project.team': { // one given project: every step (done ones too), for the manager
      $ref = txt($in['projectRef'] ?? '', 80, true, 'The project');
      $tasks = all(TASK_SELECT . " WHERE t.project_ref = ? AND t.seq IS NOT NULL AND (t.status = 'open' OR t.status = 'done') ORDER BY t.status = 'open', t.done_at, t.seq, t.id", [$ref]);
      return ['today' => $day, 'tasks' => tasks_out($tasks, $day)];
    }
    case 'report.week': { // each person, the 7 days up to `end`: days sent, days missed, stuck, finished
      $end = date_or_null($in['end'] ?? null) ?: $day;
      if ($end > $day) $end = $day;
      $from = date('Y-m-d', strtotime("$end -6 days"));
      $days = [];
      for ($d = $from; $d <= $end; $d = date('Y-m-d', strtotime("$d +1 day"))) $days[] = $d;
      $people = all("SELECT * FROM users WHERE active = 1 AND role = 'staff' ORDER BY name");
      $rows = [];
      foreach ($people as $p) {
        $tasks = all('SELECT * FROM tasks WHERE assignee_id = ? AND status <> ? AND (closed_by IS NULL OR closed_by <> -2) AND start_date <= ? AND (done_at IS NULL OR done_at >= ?)', [$p['id'], 'suggested', $end, $from . ' 00:00:00']);
        // tasks this person held at some point (moved away later): who held each task on each day comes from the move history
        $away = array_map('intval', array_column(all('SELECT DISTINCT m.task_id FROM task_moves m JOIN tasks t ON t.id = m.task_id WHERE m.from_id = ? AND t.assignee_id <> ? AND m.at >= ?', [$p['id'], $p['id'], $from . ' 00:00:00']), 'task_id'));
        if ($away) $tasks = [...$tasks, ...all('SELECT * FROM tasks WHERE id IN (' . implode(',', $away) . ') AND start_date <= ?', [$end])];
        $moves = [];
        foreach ($tasks as $t) $moves[$t['id']] = all('SELECT from_id, to_id, at FROM task_moves WHERE task_id = ? ORDER BY at, id', [$t['id']]);
        $holder = function (array $t, string $d) use ($moves): int { // who had task t at the end of day d
          $h = null;
          foreach ($moves[$t['id']] as $m) { if ($m['at'] <= "$d 23:59:59") $h = (int)$m['to_id']; elseif ($h === null) { $h = (int)$m['from_id']; break; } }
          return $h ?? (int)$t['assignee_id'];
        };
        $ups = all('SELECT day, state, task_id FROM updates WHERE user_id = ? AND day BETWEEN ? AND ?', [$p['id'], $from, $end]);
        $sentDays = array_values(array_unique(array_column($ups, 'day')));
        $workDays = []; $missed = [];
        foreach ($days as $d) {
          $due = false;
          foreach ($tasks as $t) {
            if ($t['created_at'] > "$d 23:59:59" || ($t['done_at'] && $t['done_at'] < "$d 00:00:00")) continue;
            if (!empty($t['reopened_at']) && $t['reopened_at'] > "$d 23:59:59" && (empty($t['closed_from']) || $t['closed_from'] <= "$d 23:59:59")) continue; // closed (or off the list) that day
            if ($holder($t, $d) !== (int)$p['id']) continue; // someone else had it that day
            if (due_on($t, $d) && ($t['seq'] === null || !one("SELECT id FROM tasks WHERE project_ref = ? AND assignee_id = ? AND seq IS NOT NULL AND seq < ? AND created_at <= ? AND (done_at IS NULL OR done_at >= ?) LIMIT 1", [$t['project_ref'], $p['id'], $t['seq'], "$d 23:59:59", "$d 00:00:00"]))) { $due = true; break; }
          }
          if ($due || in_array($d, $sentDays, true)) $workDays[] = $d;
          if ($due && !in_array($d, $sentDays, true)) $missed[] = $d;
        }
        $rows[] = ['id' => (int)$p['id'], 'name' => $p['name'], 'workDays' => count($workDays), 'sentDays' => count(array_intersect($sentDays, $days)), 'missed' => $missed,
          'updates' => count($ups), 'stuck' => count(array_filter($ups, fn($u) => $u['state'] === 'stuck')),
          'finished' => (int)(one("SELECT COUNT(*) AS n FROM tasks WHERE assignee_id = ? AND status = 'done' AND closed_by = ? AND done_at BETWEEN ? AND ?", [$p['id'], $p['id'], "$from 00:00:00", "$end 23:59:59"])['n'] ?? 0),
          'stepsAdded' => (int)(one('SELECT COUNT(*) AS n FROM tasks WHERE created_by = ? AND seq IS NOT NULL AND created_at BETWEEN ? AND ?', [$p['id'], "$from 00:00:00", "$end 23:59:59"])['n'] ?? 0)];
      }
      return ['from' => $from, 'end' => $end, 'today' => $day, 'days' => $days, 'people' => $rows];
    }
    case 'tasks.list': {
      $closed = ($in['status'] ?? 'open') === 'closed';
      $tasks = all(TASK_SELECT . ($closed ? " WHERE t.status IN ('done', 'cancelled') ORDER BY t.updated_at DESC LIMIT 200" : " WHERE t.status = 'open' ORDER BY u.name, t.id"));
      return ['tasks' => tasks_out($tasks, $day)];
    }
    case 'project.updates': { // Daily Projects: everything the team wrote on one project, day by day (newest first)
      $ref = txt($in['projectRef'] ?? '', 80, true, 'The project');
      $days = max(7, min(120, (int)($in['days'] ?? 30)));
      $from = date('Y-m-d', strtotime($day . ' -' . ($days - 1) . ' days'));
      $tasks = all(TASK_SELECT . ' WHERE t.project_ref = ? ORDER BY t.id', [$ref]);
      if (!$tasks) return ['today' => $day, 'from' => $from, 'since' => null, 'tasks' => [], 'updates' => [], 'comments' => [], 'fillBy' => setting('fill_by', '18:00')];
      $ids = array_map(fn($t) => (int)$t['id'], $tasks);
      $inq = implode(',', array_fill(0, count($ids), '?'));
      $ups = all("SELECT * FROM updates WHERE task_id IN ($inq) AND day >= ? ORDER BY day DESC, updated_at DESC", [...$ids, $from]);
      $photos = photos_of(array_map(fn($u) => (int)$u['id'], $ups));
      return [
        'today' => $day, 'from' => $from, 'fillBy' => setting('fill_by', '18:00'),
        'since' => min(array_map(fn($t) => $t['start_date'], $tasks)), // first day the team had work here
        'tasks' => array_map(fn($t) => ['id' => (int)$t['id'], 'title' => $t['title'], 'stepRef' => $t['step_ref'], 'status' => $t['status'],
          'assignee' => $t['assignee_name'], 'startDate' => $t['start_date'], 'doneAt' => $t['done_at'], 'repeat' => $t['repeat_kind'], 'skipSunday' => (bool)$t['skip_sunday']], $tasks),
        'updates' => array_map(fn($u) => ['taskId' => (int)$u['task_id']] + update_out($u, $photos), $ups),
        // messages between the manager and the person, for the project diary
        'comments' => array_map(fn($c) => ['id' => (int)$c['id'], 'taskId' => (int)$c['task_id'], 'by' => $c['name'], 'mine' => (int)$c['user_id'] === $me['id'], 'text' => $c['text'], 'at' => $c['at'],
            'photo' => !empty($c['photo']), 'kind' => $c['kind'], 'unread' => $c['kind'] === null && (int)$c['user_id'] !== $me['id'] && (int)$c['id'] > (int)($c['last_id'] ?? 0)], // not seen by me yet
          all("SELECT c.*, u.name, r.last_id FROM comments c JOIN users u ON u.id = c.user_id LEFT JOIN task_reads r ON r.task_id = c.task_id AND r.user_id = ?
               WHERE c.task_id IN ($inq) AND c.at >= ? ORDER BY c.at DESC", [$me['id'], ...$ids, $from . ' 00:00:00'])),
      ];
    }
    case 'tasks.linked': { // for Daily Projects: every team task given from a step (open, or closed this week)
      // finished ones for longer, so a step finished while Daily Projects was not opened still ticks itself (and is never made again)
      $since = date('Y-m-d H:i:s', time() - 7 * 86400);
      $doneSince = date('Y-m-d H:i:s', time() - 60 * 86400);
      $tasks = all(TASK_SELECT . " WHERE t.step_ref IS NOT NULL AND (t.status = 'open' OR t.updated_at >= ? OR (t.status = 'done' AND t.done_at >= ?)) ORDER BY t.id", [$since, $doneSince]);
      $fillBy = setting('fill_by', '18:00');
      $att = team_attention();
      $teamDays = [];
      foreach (all("SELECT DISTINCT t.project_ref, u.day FROM updates u JOIN tasks t ON t.id = u.task_id WHERE t.project_ref IS NOT NULL AND u.state <> 'stuck' AND u.day >= ? ORDER BY u.day",
        [date('Y-m-d', strtotime("$day -45 days"))]) as $r) $teamDays[$r['project_ref']][] = $r['day'];
      // the newest messages from the team that I have not seen (for the Today page)
      $msgs = array_map(fn($c) => ['id' => (int)$c['id'], 'taskId' => (int)$c['task_id'], 'projectRef' => $c['project_ref'], 'title' => $c['title'], 'by' => $c['name'], 'text' => $c['text'] !== '' ? $c['text'] : '📷 Photo', 'at' => $c['at']],
        all("SELECT c.*, u.name, t.project_ref, t.title FROM comments c JOIN tasks t ON t.id = c.task_id JOIN users u ON u.id = c.user_id
             LEFT JOIN task_reads r ON r.task_id = c.task_id AND r.user_id = ? WHERE c.user_id <> ? AND c.id > COALESCE(r.last_id, 0) AND c.kind IS NULL ORDER BY c.id DESC LIMIT 10", [$me['id'], $me['id']]));
      return ['today' => $day, 'fillBy' => $fillBy, 'late' => date('H:i') >= $fillBy, 'tasks' => tasks_out($tasks, $day), 'teamDays' => (object)$teamDays, 'messages' => $msgs,
        'alerts' => ['stuck' => count($att['stuck']), 'unread' => count($att['unread']), 'suggestions' => count($att['suggestions'])],
        'summary' => (function () use ($att) { // one line for the manager's Today page
          $due = array_values(array_filter($att['open'], fn($t) => $t['dueToday']));
          $missing = array_values(array_unique(array_map(fn($t) => $t['assignee']['name'], array_filter($due, fn($t) => !$t['today']))));
          return ['due' => count($due), 'sent' => count(array_filter($due, fn($t) => (bool)$t['today'])), 'notFilled' => $missing];
        })()];
    }
    case 'tasks.adopted': { // Daily Projects added these steps (written by the person) to the project: from now on they are normal steps
      $ids = array_slice(array_map('intval', (array)($in['ids'] ?? [])), 0, 200);
      if ($ids) q('UPDATE tasks SET from_staff = 0 WHERE id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')', $ids);
      return [];
    }
    case 'tasks.byRefs': { // for Daily Projects: the team tasks linked to these steps
      $refs = array_slice(array_filter(array_map('strval', (array)($in['stepRefs'] ?? []))), 0, 500);
      if (!$refs) return ['tasks' => []];
      $inq = implode(',', array_fill(0, count($refs), '?'));
      return ['tasks' => tasks_out(all(TASK_SELECT . " WHERE t.step_ref IN ($inq) ORDER BY t.id", $refs), $day)];
    }
    case 'task.save': {
      $id = (int)($in['id'] ?? 0);
      $title = txt($in['title'] ?? '', 300, true, 'The task');
      $assignee = one("SELECT id, active FROM users WHERE id = ?", [(int)($in['assigneeId'] ?? 0)]);
      // editing a task of someone who was switched off is fine as long as the person is not changed
      $same = $id && $assignee && ($was = one('SELECT assignee_id FROM tasks WHERE id = ?', [$id])) && (int)$was['assignee_id'] === (int)$assignee['id'];
      if (!$assignee || (!$assignee['active'] && !$same)) throw new ApiError('Choose who will do it.');
      $kind = in_array($in['repeat'] ?? '', ['daily', 'weekly', 'once'], true) ? $in['repeat'] : 'daily';
      $weekday = $kind === 'weekly' ? max(0, min(6, (int)($in['weekday'] ?? 1))) : null;
      $due = $kind === 'once' ? date_or_null($in['dueDate'] ?? null) : null;
      $vals = [$title, txt($in['details'] ?? '', 4000), (int)$assignee['id'], $kind, empty($in['skipSunday']) ? 0 : 1, $weekday, $due,
        txt($in['project'] ?? '', 200) ?: null, txt($in['projectRef'] ?? '', 80) ?: null, txt($in['stepRef'] ?? '', 80) ?: null, now()];
      if ($id) {
        $old = own_task($me, $id);
        if ($old['seq'] !== null && $old['project_ref'] && (int)$old['assignee_id'] !== (int)$assignee['id'] && $old['status'] === 'open') {
          throw new ApiError('This step is part of a given project. Use "Move to…" to change the person.');
        }
        // a closed task or a suggestion keeps its person (no move record: the report, the history and their list would be wrong)
        if ((int)$old['assignee_id'] !== (int)$assignee['id'] && $old['status'] !== 'open') throw new ApiError('Only an open task can go to someone else. Open it again (or answer the suggestion) first.');
        if ((int)$old['assignee_id'] !== (int)$assignee['id']) move_tasks($me, [$old], (int)$assignee['id']);
        q('UPDATE tasks SET title=?, details=?, assignee_id=?, repeat_kind=?, skip_sunday=?, weekday=?, due_date=?, project=?, project_ref=?, step_ref=?, updated_at=? WHERE id=?', [...$vals, $id]);
        q('UPDATE tasks SET needs_photo = ? WHERE id = ?', [empty($in['needsPhoto']) ? 0 : 1, $id]);
        if ($start = date_or_null($in['startDate'] ?? null)) q('UPDATE tasks SET start_date = ? WHERE id = ?', [$start, $id]);
        audit($me['id'], 'task_edit', "#$id $title");
      } else {
        $cid = client_id($in['clientId'] ?? null); // the form's id: a resend (reply lost) gives back the task already made
        if ($cid && ($dup = one('SELECT id FROM tasks WHERE created_by = ? AND client_id = ?', [$me['id'], $cid]))) return ['task' => tasks_out([own_task($me, (int)$dup['id'])], $day)[0]];
        if (!insert_once('INSERT INTO tasks (title, details, assignee_id, repeat_kind, skip_sunday, weekday, due_date, project, project_ref, step_ref, updated_at, created_by, start_date, created_at, client_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [...$vals, $me['id'], $day, now(), $cid])) {
          return ['task' => tasks_out([own_task($me, (int)one('SELECT id FROM tasks WHERE created_by = ? AND client_id = ?', [$me['id'], $cid])['id'])], $day)[0]]; // a double tap at the same moment: one task
        }
        $id = (int)db()->lastInsertId();
        q('UPDATE tasks SET needs_photo = ? WHERE id = ?', [empty($in['needsPhoto']) ? 0 : 1, $id]);
        audit($me['id'], 'task_new', "#$id $title");
        $start = date_or_null($in['startDate'] ?? null);
        if ($start && $start > $day) q('UPDATE tasks SET start_date = ? WHERE id = ?', [$start, $id]); // starts on a later day
        notify([(int)$assignee['id']], 'task', '📥 New task for you', $title . ($vals[7] ? ' · ' . $vals[7] : '') . ($start && $start > $day ? ' · starts ' . date('D j M', strtotime($start)) : ''), '/projects/#team-task=' . $id, 't' . $id);
      }
      return ['task' => tasks_out([own_task($me, $id)], $day)[0]];
    }
    case 'task.status': {
      $t = own_task($me, (int)($in['id'] ?? 0));
      $st = in_array($in['status'] ?? '', ['open', 'done', 'cancelled'], true) ? $in['status'] : 'open';
      if ($t['status'] === 'suggested') throw new ApiError('Answer the suggestion with Yes or Not now.');
      if ($st === 'cancelled' && $t['seq'] !== null && $t['project_ref']) throw new ApiError('This is a step of a given project: delete it (or take the project back) on your projects page.');
      if ($st === 'open' && !(int)(one('SELECT active FROM users WHERE id = ?', [$t['assignee_id']])['active'] ?? 0)) throw new ApiError('This person is switched off. Move the task to someone else first.');
      // only an open task can be closed: never overwrite the person's own Finished (or an earlier close) from an old screen
      if ($st !== 'open' && $t['status'] !== 'open') throw new ApiError('This task was already closed.', 409);
      if ($st === 'open' && $t['status'] !== 'open') q('UPDATE tasks SET reopened_at = ?, closed_from = done_at WHERE id = ?', [now(), $t['id']]);
      $upd = q('UPDATE tasks SET status = ?, done_at = ?, closed_by = NULL, updated_at = ? WHERE id = ?' . ($st === 'open' ? '' : " AND status = 'open'"), [$st, $st === 'open' ? null : now(), now(), $t['id']]); // closed by the manager, not by the person's Finished
      if ($st !== 'open' && !$upd->rowCount()) throw new ApiError('This task was already closed.', 409); // (closed at the same moment)
      if ($st !== $t['status']) notify([(int)$t['assignee_id']], 'task',
        ['done' => '✓ Your manager closed a task', 'cancelled' => '✖️ A task was cancelled', 'open' => '↩️ A task is open again'][$st], $t['title'], '/projects/#team-task=' . $t['id'], 't' . $t['id']);
      audit($me['id'], 'task_' . $st, "#{$t['id']} {$t['title']}");
      return ['task' => tasks_out([own_task($me, (int)$t['id'])], $day)[0]];
    }
    case 'users.list': // (the email only here, for the manager: never in what staff can read)
      return ['users' => array_map(fn($u) => public_user($u) + ['email' => (string)($u['email'] ?? '')], all('SELECT * FROM users ORDER BY active DESC, role, name'))];
    case 'user.save': {
      $id = (int)($in['id'] ?? 0);
      $name = txt($in['name'] ?? '', 80, true, 'The name');
      $role = ($in['role'] ?? 'staff') === 'admin' ? 'admin' : 'staff';
      $hasEmail = array_key_exists('email', $in); // (a save without it, like a rename, keeps the email)
      $email = txt($in['email'] ?? '', 120);
      if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) throw new ApiError('That email address is not right.');
      if ($id) {
        if (!one('SELECT id FROM users WHERE id = ?', [$id])) throw new ApiError('That person is not there any more. Reload the page.', 404);
        guard_owner($id, $me);
        if ($id === $me['id'] && $role !== 'admin') throw new ApiError('You cannot remove your own manager rights.');
        q('UPDATE users SET name = ?, role = ? WHERE id = ?', [$name, $role, $id]);
        if ($hasEmail) q('UPDATE users SET email = ? WHERE id = ?', [$email === '' ? null : $email, $id]);
        audit($me['id'], 'user_edit', "#$id $name");
      } else {
        $username = clean_username((string)($in['username'] ?? ''));
        if (!preg_match('/^[a-z0-9._-]{3,40}$/', $username)) throw new ApiError('Username: 3 to 40 small letters or numbers (dot, dash and underscore are fine). No spaces.');
        if (one('SELECT id FROM users WHERE username = ?', [$username])) throw new ApiError('That username is taken. Try another.');
        $pass = (string)($in['password'] ?? '');
        check_password_rules($pass);
        q('INSERT INTO users (username, name, role, pass_hash, must_change, active, created_at, email) VALUES (?, ?, ?, ?, 1, 1, ?, ?)',
          [$username, $name, $role, password_hash($pass, PASSWORD_DEFAULT), now(), $email === '' ? null : $email]);
        $id = (int)db()->lastInsertId();
        audit($me['id'], 'user_new', "#$id $username");
      }
      $u = one('SELECT * FROM users WHERE id = ?', [$id]);
      return ['user' => public_user($u) + ['email' => (string)($u['email'] ?? '')]];
    }
    case 'user.reset': {
      $u = one('SELECT * FROM users WHERE id = ?', [(int)($in['id'] ?? 0)]);
      if (!$u) throw new ApiError('Person not found.', 404);
      guard_owner((int)$u['id'], $me);
      $pass = (string)($in['password'] ?? '');
      check_password_rules($pass);
      q('UPDATE users SET pass_hash = ?, must_change = 1 WHERE id = ?', [password_hash($pass, PASSWORD_DEFAULT), $u['id']]);
      q('DELETE FROM tokens WHERE user_id = ?', [$u['id']]);
      q('DELETE FROM push_subs WHERE user_id = ?', [$u['id']]); // signed out everywhere: no more notifications either
      $k = 'u:' . $u['username'];
      q('DELETE FROM login_fails WHERE k = ? OR LEFT(k, ?) = ?', [$k, strlen($k) + 1, $k . '|']); // also the tries from their own phone
      audit($me['id'], 'user_reset', "#{$u['id']} {$u['username']}");
      return [];
    }
    case 'user.active': {
      $id = (int)($in['id'] ?? 0);
      if ($id === $me['id']) throw new ApiError('You cannot switch yourself off.');
      guard_owner($id, $me);
      $on = !empty($in['active']);
      if (!$on && one("SELECT id FROM tasks WHERE assignee_id = ? AND status = 'open' LIMIT 1", [$id])) {
        throw new ApiError('Move their open tasks to someone first (↔ Move all tasks to…), then switch them off.');
      }
      q('UPDATE users SET active = ? WHERE id = ?', [$on ? 1 : 0, $id]);
      if (!$on) {
        q('DELETE FROM tokens WHERE user_id = ?', [$id]);
        q('DELETE FROM push_subs WHERE user_id = ?', [$id]); // no more notifications on their phones
        // their suggestions still waiting for a yes: nobody would do them now
        q("UPDATE tasks SET status = 'cancelled', done_at = ?, closed_by = -2, updated_at = ? WHERE assignee_id = ? AND status = 'suggested'", [now(), now(), $id]);
      }
      audit($me['id'], $on ? 'user_on' : 'user_off', "#$id");
      return [];
    }
    case 'settings.save': {
      $fill = (string)($in['fillBy'] ?? '');
      if (!preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $fill)) throw new ApiError('Write the time like 18:00.');
      set_setting('fill_by', $fill);
      return ['fillBy' => $fill];
    }
  }
  throw new ApiError('Unknown request.', 404);
}

/**
 * One person's pending work for the morning email: each given project as one row (its current step = now),
 * and each other open task that is due today, late (past its by-date) or stuck. With the newest update on each.
 */
function morning_items(int $who, string $day): array {
  $tasks = tasks_out(all(TASK_SELECT . " WHERE t.assignee_id = ? AND t.status = 'open' ORDER BY t.seq, t.id", [$who]), $day);
  $late = fn($t) => $t['dueDate'] && $t['dueDate'] < $day ? $t['dueDate'] : null; // the same "late" as the screens: past its by-date
  $projects = []; $plain = [];
  foreach ($tasks as $t) {
    if ($t['seq'] !== null && $t['projectRef']) $projects[$t['projectRef']][] = $t;
    elseif ($t['dueToday'] || $late($t) || $t['stuck']) $plain[] = $t;
  }
  $ups = last_updates(array_map(fn($t) => $t['id'], $plain), array_keys($projects));
  $last = fn(string $key): ?array => $ups[$key] ?? null;
  $repeat = fn($t) => $t['repeat'] === 'daily' ? 'Daily' : ($t['repeat'] === 'weekly' ? 'Weekly (' . substr(WEEKDAYS[$t['weekday'] ?? 1], 0, 3) . ')' : '');
  $out = [];
  foreach ($projects as $ref => $list) {
    $cur = null;
    foreach ($list as $t) if (!$t['queued']) { $cur = $t; break; }
    $cur = $cur ?? $list[0];
    $lates = array_filter(array_map($late, $list));
    $out[] = ['kind' => 'project', 'title' => $cur['project'] ?: $cur['title'], 'about' => $cur['projectAbout'],
      'now' => str_ends_with((string)$cur['stepRef'], ':whole') ? '' : $cur['title'], // (given as one task: no step to name)
      'repeat' => '', 'lateSince' => $lates ? min($lates) : null, 'stuck' => (bool)array_filter($list, fn($t) => $t['stuck']), 'lastUpdate' => $last('p:' . $ref),
      'taskId' => $cur['id'], 'projectRef' => (string)$ref]; // (to open it from the People page)
  }
  foreach ($plain as $t) {
    $out[] = ['kind' => 'task', 'title' => $t['title'], 'about' => '', 'now' => '', 'repeat' => $repeat($t),
      'lateSince' => $late($t), 'stuck' => $t['stuck'], 'lastUpdate' => $last('t:' . $t['id']), 'taskId' => $t['id'], 'projectRef' => null];
  }
  return $out;
}

/** When the manager last pressed 📧 Morning email for this person, if it was today ('YYYY-MM-DD HH:MM:SS'), else null. */
function morning_sent_at(int $who, string $day): ?string {
  $at = setting('ms:' . $who, '');
  return substr($at, 0, 10) === $day ? $at : null;
}

/**
 * The newest update on each plain task ('t:<id>') and on each project, from any of its tasks, earlier steps too ('p:<ref>'):
 * its day and words (one line, cut to 80 letters).
 */
function last_updates(array $taskIds, array $refs): array {
  $refs = array_values(array_map('strval', $refs)); // (a ref like '123' is a number as an array key)
  $byRef = [];
  if ($refs) foreach (all('SELECT id, project_ref FROM tasks WHERE project_ref IN (' . implode(',', array_fill(0, count($refs), '?')) . ')', $refs) as $r) $byRef[(int)$r['id']] = $r['project_ref'];
  $ids = array_values(array_unique([...array_map('intval', $taskIds), ...array_keys($byRef)]));
  $newest = [];
  if ($ids) foreach (all('SELECT task_id, day, note, updated_at FROM updates WHERE task_id IN (' . implode(',', array_fill(0, count($ids), '?')) . ') ORDER BY day, updated_at', $ids) as $u) {
    $key = isset($byRef[(int)$u['task_id']]) ? 'p:' . $byRef[(int)$u['task_id']] : 't:' . $u['task_id'];
    $newest[$key] = $u; // (in day order: the last one is the newest)
  }
  $out = [];
  foreach ($newest as $key => $u) {
    $note = trim(preg_replace('/\s+/u', ' ', $u['note']) ?? '');
    $out[$key] = ['day' => $u['day'], 'note' => mb_strlen($note) > 80 ? rtrim(mb_substr($note, 0, 79)) . '…' : $note];
  }
  return $out;
}

/**
 * 🔁 Follow-up: every open task given to staff, each given project once (its current step), with what the manager
 * needs to judge it: the by-date, the newest update, how many due days went by with no update (silentDays: only days
 * it was due, so Sundays are off for Mon–Sat work), stuck, and when it was last chased.
 * The colour, the reason words and the order are worked out on the screen (followupRule in logic.js).
 */
function followup_rows(string $day): array {
  $raw = all(TASK_SELECT . " WHERE t.status = 'open' AND u.role = 'staff' ORDER BY t.seq, t.id");
  if (!$raw) return [];
  $rowOf = [];
  foreach ($raw as $r) $rowOf[(int)$r['id']] = $r;
  $projects = []; $plain = [];
  foreach (tasks_out($raw, $day) as $t) {
    if ($t['seq'] !== null && $t['projectRef']) $projects[(string)$t['projectRef']][] = $t;
    else $plain[] = $t;
  }
  $ups = last_updates(array_map(fn($t) => $t['id'], $plain), array_keys($projects));
  $items = []; // [the task the buttons work on, kind, title, step, ref, by-date, stuck, update key]
  foreach ($projects as $ref => $list) {
    $cur = null;
    foreach ($list as $t) if (!$t['queued']) { $cur = $t; break; }
    $cur = $cur ?? $list[0];
    $dues = array_filter(array_map(fn($t) => $t['dueDate'], $list));
    $items[] = [$cur, 'project', $cur['project'] ?: $cur['title'], str_ends_with((string)$cur['stepRef'], ':whole') ? '' : $cur['title'], (string)$ref,
      $dues ? min($dues) : null, (bool)array_filter($list, fn($t) => $t['stuck']), 'p:' . $ref];
  }
  foreach ($plain as $t) $items[] = [$t, 'task', $t['title'], '', $t['projectRef'], $t['dueDate'], $t['stuck'], 't:' . $t['id']];
  $ids = array_map(fn($x) => $x[0]['id'], $items);
  $in = implode(',', array_fill(0, count($ids), '?'));
  $chased = [];
  foreach (all("SELECT task_id, MAX(at) AS at FROM comments WHERE kind = 'chase' AND task_id IN ($in) GROUP BY task_id", $ids) as $r) $chased[(int)$r['task_id']] = $r['at'];
  $given = []; // when it last came to the person (a move, or given again): days before that are not theirs to have missed
  foreach (all("SELECT task_id, to_id, MAX(at) AS at FROM task_moves WHERE task_id IN ($in) GROUP BY task_id, to_id", $ids) as $r) $given[(int)$r['task_id'] . '|' . (int)$r['to_id']] = substr($r['at'], 0, 10);
  $out = [];
  foreach ($items as [$t, $kind, $title, $step, $ref, $due, $stuck, $key]) {
    $last = $ups[$key] ?? null;
    // silent: the due days from the day after the newest update (or from when it started being theirs) up to yesterday
    $from = max(array_filter([(string)$t['startDate'], substr((string)$t['createdAt'], 0, 10), (string)($t['turnSince'] ?? ''),
      substr((string)($t['reopenedAt'] ?? ''), 0, 10), $given[$t['id'] . '|' . $t['assignee']['id']] ?? '',
      $last ? date('Y-m-d', strtotime($last['day'] . ' +1 day')) : '', date('Y-m-d', strtotime($day . ' -60 days'))]));
    $silent = 0;
    if (!$t['queued']) for ($d = $from; $d < $day; $d = date('Y-m-d', strtotime($d . ' +1 day'))) if (due_on($rowOf[$t['id']], $d)) $silent++;
    $out[] = ['taskId' => $t['id'], 'kind' => $kind, 'title' => $title, 'step' => $step, 'projectRef' => $ref, 'person' => $t['assignee'],
      'repeat' => $t['repeat'], 'dueDate' => $due, 'lastUpdate' => $last, 'silentDays' => $silent, 'stuck' => $stuck, 'chasedAt' => $chased[$t['id']] ?? null];
  }
  return $out;
}

/** What the owner's app changed in the project's steps and has not saved yet (against the saved projects now):
 *  'add' = steps it sent that the saved project does not have, 'drop' = steps open in the saved project that it did not send. */
function pending_steps(string $ref, array $in): array {
  if (!(int)($in['assigneeId'] ?? 0)) return []; // taken back: only who it is with counts
  $data = dp_data();
  $saved = null;
  foreach ($data['projects'] ?? [] as $p) if (is_array($p) && (string)($p['id'] ?? '') === $ref) $saved = $p;
  $sent = array_values(array_filter(array_map(fn($s) => is_array($s) ? (string)($s['stepRef'] ?? '') : '', (array)($in['steps'] ?? [])), 'strlen'));
  $known = $saved ? array_map(fn($s) => (string)($s['id'] ?? ''), array_filter((array)($saved['steps'] ?? []), 'is_array')) : [];
  $open = $saved ? array_column(server_steps($saved, today()), 'stepRef') : [];
  return ['add' => array_values(array_diff($sent, $known, ["$ref:whole"])), 'drop' => array_values(array_diff($open, $sent))];
}

/** The whole-project task was replaced by steps today and already had today's update: it counts for the current step too. */
function carry_whole_update(string $ref, int $who): void {
  $day = today();
  if (setting('cw:' . md5($ref)) === $day) return; // carried once today already (never onto the next step again)
  $w = one("SELECT u.* FROM tasks t JOIN updates u ON u.task_id = t.id AND u.day = ? WHERE t.project_ref = ? AND t.step_ref = ? AND t.status = 'cancelled' AND t.done_at >= ? AND u.user_id = ? LIMIT 1",
    [$day, $ref, $ref . ':whole', $day . ' 00:00:00', $who]); // only their own words, for their own step
  if (!$w) return;
  $cur = one("SELECT id FROM tasks WHERE project_ref = ? AND seq IS NOT NULL AND status = 'open' AND assignee_id = ? AND step_ref <> ? ORDER BY seq, id LIMIT 1", [$ref, $who, $ref . ':whole']);
  if (!$cur) return; // no step of theirs yet: carried when there is one
  set_setting('cw:' . md5($ref), $day);
  if (one('SELECT id FROM updates WHERE task_id = ? AND day = ?', [$cur['id'], $day])) return;
  q('INSERT INTO updates (task_id, user_id, day, note, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [$cur['id'], $w['user_id'], $day, $w['note'], $w['state'] === 'finished' ? 'progress' : $w['state'], $w['created_at'], $w['updated_at']]);
}

/** A step the person adds to a project given to them (inside the project lock). Returns the task id. */
function add_staff_step(array $me, string $ref, string $title, array $mine, string $day, ?string $cid): int {
  $stepRef = 'w' . substr(hash('sha256', $me['id'] . ':' . ($cid ?? bin2hex(random_bytes(16)))), 0, 24); // made here from who + the phone's id
  if ($t = one('SELECT id FROM tasks WHERE step_ref = ? AND created_by = ?', [$stepRef, $me['id']])) return (int)$t['id']; // sent twice (reply lost): kept once
  $seq = (int)(one("SELECT MAX(seq) AS m FROM tasks WHERE project_ref = ? AND seq IS NOT NULL", [$ref])['m'] ?? 0) + 1; // after the closed steps too (see project_sync)
  $photo = (int)setting('pp:' . md5($ref), '0');
  q("INSERT INTO tasks (title, details, assignee_id, created_by, repeat_kind, skip_sunday, weekday, due_date, start_date, project, project_ref, step_ref, status, seq, needs_photo, from_staff, created_at, updated_at)
     VALUES (?, '', ?, ?, 'once', 1, NULL, NULL, ?, ?, ?, ?, 'open', ?, ?, 1, ?, ?)",
    [$title, $me['id'], $me['id'], $day, $mine[0]['project'], $ref, $stepRef, $seq, $photo, now(), now()]);
  $id = (int)db()->lastInsertId();
  // the project had no steps (it was one task with its name): the steps take its place
  q("UPDATE tasks SET status = 'cancelled', done_at = ?, updated_at = ? WHERE project_ref = ? AND step_ref = ? AND status = 'open'", [now(), now(), $ref, $ref . ':whole']);
  carry_whole_update($ref, $me['id']);
  audit($me['id'], 'step_added', "{$mine[0]['project']}: $title");
  notify(admin_ids(), 'update', "➕ {$me['name']} added a step", ($mine[0]['project'] ?: 'Project') . ': ' . $title, '/projects/#team-task=' . $id);
  return $id;
}

/** The work of project.sync (see there). Runs inside one transaction, one call per project at a time. */
function project_sync(array $me, array $in, string $ref, string $day): array {
  $name = txt($in['project'] ?? '', 200);
  // the project's short description (one line, at most 300): the team sees it under the project name
  if (array_key_exists('about', $in)) {
    $about = txt(preg_replace('/\s+/u', ' ', (string)$in['about']) ?? '', 1000); // (same limit as ABOUT_MAX in docs/ops.js)
    if ($about === '') q('DELETE FROM settings WHERE k = ?', ['pab:' . md5($ref)]); else set_setting('pab:' . md5($ref), $about);
  }
  $who = (int)($in['assigneeId'] ?? 0);
  // moved in Work Task (Move to…) after the owner's app last sent it, and the app still names the old person
  // (it did not see the move, say the new person finished every step first): the project stays with the new person
  if ($who && empty($in['_server']) && isset($in['_psc'])
    && ($mv = one("SELECT m.from_id, m.to_id, m.at FROM task_moves m JOIN tasks t ON t.id = m.task_id WHERE t.project_ref = ? AND t.seq IS NOT NULL AND m.regive = 0 ORDER BY m.at DESC, m.id DESC LIMIT 1", [$ref]))
    && (int)$mv['from_id'] === $who && strtotime($mv['at']) > (int)$in['_psc'] && one('SELECT id FROM users WHERE id = ? AND active = 1', [(int)$mv['to_id']])) $who = (int)$mv['to_id'];
  $photo = empty($in['needsPhoto']) ? 0 : 1;
  $open = all("SELECT * FROM tasks WHERE project_ref = ? AND seq IS NOT NULL AND status = 'open'", [$ref]);
  if (!$who) {
    // the person's own new steps are cancelled too, but Daily Projects still adds them to the project (so nothing is lost)
    foreach ($open as $t) q("UPDATE tasks SET status = 'cancelled', done_at = ?, updated_at = ? WHERE id = ?", [now(), now(), $t['id']]);
    if (empty($in['_server'])) audit($me['id'], 'project_taken_back', $name);
    $why = ['paused' => 'Your manager paused this project. It comes back to you when it starts again.', 'finished' => 'Your manager finished this project. Thank you!'][$in['reason'] ?? ''] ?? 'Your manager took this project back. Nothing more to do on it.';
    if ($open) notify(array_map(fn($t) => (int)$t['assignee_id'], $open), 'task', '📁 Off your list: ' . ($name ?: ($open[0]['project'] ?? 'a project')), $why, '/', 'p' . md5($ref));
    return ['tasks' => [], 'assigneeId' => 0];
  }
  $person = one('SELECT id, active FROM users WHERE id = ?', [$who]);
  if (!$person || !$person['active']) throw new ApiError('Choose who will do it.');
  // "photo needed" for the whole project: it changes a step only when the project's own setting changed,
  // so a photo rule the manager set on one step in Work Task is kept
  $pk = 'pp:' . md5($ref);
  $prev = setting($pk, '');
  set_setting($pk, (string)$photo);
  $photoFor = fn(int $cur): int => $prev === '' ? max($photo, $cur) : ((int)$prev !== $photo ? $photo : $cur);
  $byStep = [];
  foreach ($open as $t) $byStep[$t['step_ref']] = $t;
  $hadSome = (bool)array_filter($open, fn($t) => (int)$t['assignee_id'] === $who); // the project was theirs already: only new steps are news
  $current = fn() => one("SELECT id, title FROM tasks WHERE project_ref = ? AND seq IS NOT NULL AND status = 'open' AND assignee_id = ? ORDER BY seq, id LIMIT 1", [$ref, $who]);
  $before = $hadSome ? $current() : null;
  $news = []; // steps that are new for this person (made, opened again, or moved to them)
  $leftBy = []; // people whose steps went to the new person
  $steps = array_slice((array)($in['steps'] ?? []), 0, 300);
  $keep = [];
  $pending = (bool)one("SELECT id FROM tasks WHERE project_ref = ? AND from_staff = 1 AND status IN ('open', 'done') LIMIT 1", [$ref]); // steps the person added, not yet in the project (finished ones too)
  $skipped = []; // steps finished minutes ago: not made again now (the Daily Projects app tries again later)
  // open steps are numbered after the closed ones, so a finished step stays before them (its finish day starts the next step's turn)
  $base = 1 + (int)(one("SELECT MAX(seq) AS m FROM tasks WHERE project_ref = ? AND seq IS NOT NULL AND status IN ('done', 'cancelled')", [$ref])['m'] ?? -1);
  foreach (array_values($steps) as $j => $st) {
    $i = $base + $j;
    $stepRef = txt($st['stepRef'] ?? '', 80);
    $title = txt($st['title'] ?? '', 300);
    $details = txt($st['details'] ?? '', 4000);
    $due = is_string($st['dueDate'] ?? null) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $st['dueDate']) ? $st['dueDate'] : null; // "by" date of the step
    if ($stepRef === '' || $title === '') continue;
    if ($stepRef === "$ref:whole" && $pending) continue; // the person already added steps (not in the project yet): no "whole project" task
    $keep[$stepRef] = true;
    if (isset($byStep[$stepRef])) {
      $t = $byStep[$stepRef];
      if ((int)($t['from_staff'] ?? 0) && !empty($in['_server'])) q('UPDATE tasks SET from_staff = 0 WHERE id = ?', [$t['id']]); // in the SAVED project now: a normal step
      if ((int)$t['assignee_id'] !== $who) { $leftBy[] = (int)$t['assignee_id']; move_tasks($me, [$t], $who, false); $news[] = $title; } // a new person: the move note, and old messages count as read
      // details: only set when the task is made, so what the manager typed in Work Task is never replaced
      $np = $photoFor((int)$t['needs_photo']);
      if ($t['title'] !== $title || (int)$t['seq'] !== $i || ($t['project'] ?? '') !== $name || (int)$t['needs_photo'] !== $np || $t['due_date'] !== $due) {
        q('UPDATE tasks SET title = ?, seq = ?, project = ?, needs_photo = ?, due_date = ?, updated_at = ? WHERE id = ?', [$title, $i, $name ?: null, $np, $due, now(), $t['id']]);
      }
      continue;
    }
    // a step made into its own project (moved): only a task it already has stays; never made again, nor a cancelled one opened again
    if (!empty($st['moved']) && !one("SELECT id FROM tasks WHERE step_ref = ? AND status = 'open' AND seq IS NULL", [$stepRef])) continue;
    // the project with no steps was finished as one task: done, never made again (the owner decides to finish the project)
    if ($stepRef === "$ref:whole" && one("SELECT id FROM tasks WHERE project_ref = ? AND step_ref = ? AND status = 'done'", [$ref, $stepRef])) continue;
    // just finished by the person (the manager's step will tick itself in a moment): do not make it again.
    // Finished longer ago and the step is open again (un-ticked by the manager): it is made again below.
    if (one("SELECT id FROM tasks WHERE step_ref = ? AND status = 'done' AND done_at >= ?", [$stepRef, date('Y-m-d H:i:s', time() - 10 * 60)])) { $skipped[] = $stepRef; continue; }
    // the server's own sync (saved data, maybe not ticked yet): a step this person already finished is never made again
    if (!empty($in['_server']) && one("SELECT id FROM tasks WHERE project_ref = ? AND step_ref = ? AND status = 'done' LIMIT 1", [$ref, $stepRef])) { $skipped[] = $stepRef; continue; }
    // a single step given earlier: it becomes part of the project hand-over
    $single = one("SELECT * FROM tasks WHERE step_ref = ? AND status = 'open' AND seq IS NULL", [$stepRef]);
    // or this step's task from before the project was paused or taken back: opened again, so its notes and photos stay with it
    if (!$single && ($single = one("SELECT * FROM tasks WHERE project_ref = ? AND step_ref = ? AND seq IS NOT NULL AND status = 'cancelled' ORDER BY id DESC LIMIT 1", [$ref, $stepRef]))) {
      q("UPDATE tasks SET status = 'open', closed_from = done_at, done_at = NULL, closed_by = NULL, from_staff = 0, reopened_at = ?, updated_at = ? WHERE id = ?", [now(), now(), $single['id']]);
      $single['status'] = 'open';
      $single['reopened'] = true;
    }
    if ($single) {
      if ((int)$single['assignee_id'] !== $who || !empty($single['reopened'])) $news[] = $title;
      if ((int)$single['assignee_id'] !== $who && !empty($single['reopened'])) { // it was off everyone's list: just the new person's now
        $lastC = (int)(one('SELECT MAX(id) AS m FROM comments WHERE task_id = ?', [$single['id']])['m'] ?? 0);
        q('INSERT INTO task_reads (task_id, user_id, at, last_id) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE last_id = GREATEST(last_id, VALUES(last_id))', [$single['id'], $who, now(), $lastC]);
        q('UPDATE tasks SET assignee_id = ? WHERE id = ?', [$who, $single['id']]);
        q('INSERT INTO task_moves (task_id, from_id, to_id, at, regive) VALUES (?, ?, ?, ?, 1)', [$single['id'], (int)$single['assignee_id'], $who, now()]);
      } elseif ((int)$single['assignee_id'] !== $who) { $leftBy[] = (int)$single['assignee_id']; move_tasks($me, [$single], $who, false); }
      q("UPDATE tasks SET seq = ?, title = ?, details = IF(details IS NULL OR details = '', ?, details), project = ?, project_ref = ?, repeat_kind = ?, needs_photo = ?, due_date = ?, updated_at = ? WHERE id = ?", [$i, $title, $details, $name ?: null, $ref, 'once', max($photo, (int)$single['needs_photo']), $due, now(), $single['id']]);
      continue;
    }
    q("INSERT INTO tasks (title, details, assignee_id, created_by, repeat_kind, skip_sunday, weekday, due_date, start_date, project, project_ref, step_ref, status, seq, needs_photo, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'once', 1, NULL, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)",
      [$title, $details, $who, $me['id'], $due, $day, $name ?: null, $ref, $stepRef, $i, $photo, now(), now()]);
    $news[] = $title;
  }
  // 'cancelled', not 'done': only the person's own Finished means done (so an un-ticked step goes back to them, and is never ticked by itself)
  $n = $base + count($steps); // the person's own new steps stay at the end, after the project's steps
  $closed = [];
  // the server's own sync: a step opened again after it was ticked (their undo, Open again) waits for the owner's app to untick it
  $tickedAt = (array)($in['doneAt'] ?? []);
  foreach ($open as $t) {
    if (!empty($in['_server']) && isset($tickedAt[$t['step_ref']]) && !empty($t['reopened_at']) && strtotime((string)$t['reopened_at']) > strtotime((string)$tickedAt[$t['step_ref']]) - 120) { $keep[$t['step_ref']] = true; continue; }
    if (isset($keep[$t['step_ref']])) continue;
    if ((int)($t['from_staff'] ?? 0)) {
      if ((int)$t['assignee_id'] !== $who) { $leftBy[] = (int)$t['assignee_id']; move_tasks($me, [$t], $who, false); $news[] = $t['title']; }
      q('UPDATE tasks SET seq = ?, project = ? WHERE id = ?', [$n++, $name ?: null, $t['id']]);
      continue;
    }
    // -3: removed while it waited its turn, so it never starts the next step's turn (see turnSince)
    $waiting = (int)$t['seq'] > min(array_map(fn($o) => (int)$o['seq'], array_filter($open, fn($o) => (int)$o['assignee_id'] === (int)$t['assignee_id'])));
    q("UPDATE tasks SET status = 'cancelled', done_at = ?, closed_by = ?, updated_at = ? WHERE id = ?", [now(), $waiting ? -3 : null, now(), $t['id']]);
    if ((int)$t['assignee_id'] === $who && $t['step_ref'] !== "$ref:whole") $closed[] = $t['title']; // (the whole-project task simply makes way for the steps)
    if ((int)$t['assignee_id'] !== $who) $leftBy[] = (int)$t['assignee_id']; // someone else's step, gone as the project goes to a new person: they are told it is off their list
  }
  carry_whole_update($ref, $who);
  $leftBy = array_values(array_diff(array_unique($leftBy), [$who]));
  if ($leftBy) notify($leftBy, 'task', '📁 Off your list: ' . ($name ?: 'a project'), 'Your manager gave it to ' . user_name($who) . '.', '/', 'p' . md5($ref));
  if ($closed) notify([$who], 'task', count($closed) === 1 ? "✓ Step closed in $name" : '✓ ' . count($closed) . " steps closed in $name", 'Your manager closed: ' . implode(' · ', array_slice($closed, 0, 3)), '/', 'c' . md5($ref));
  $after = $hadSome && !$news ? $current() : null;
  // the order changed (not because a step was finished or closed): tell them which step is theirs now
  if ($before && $after && (int)$before['id'] !== (int)$after['id'] && one("SELECT id FROM tasks WHERE id = ? AND status = 'open'", [$before['id']])) notify([$who], 'task', "➡️ Your step now in $name", $after['title'], '/projects/#team-task=' . $after['id'], 'p' . md5($ref));
  if (empty($in['_server']) || $news || $closed) audit($me['id'], 'project_given', "$name → #$who");
  if ($news) {
    $n = count($news);
    notify([$who], 'task', $hadSome ? ($n === 1 ? "➕ New step in $name" : "➕ $n new steps in $name") : "📁 New project for you: $name",
      $hadSome ? implode(' · ', array_slice($news, 0, 3)) : "$n step" . ($n > 1 ? 's' : '') . '. First: ' . $news[0], '/', 'p' . md5($ref));
  }
  return ['tasks' => tasks_out(all(TASK_SELECT . " WHERE t.project_ref = ? AND t.seq IS NOT NULL AND t.status = 'open' ORDER BY t.seq", [$ref]), $day), 'skipped' => $skipped, 'assigneeId' => $who]; // assigneeId: who has the project now
}

/** A photo for today's update: made smaller (max 1600 px), turned the right way up, saved as JPEG. */
function add_photo(array $me, int $updateId): int {
  $u = one('SELECT * FROM updates WHERE id = ?', [$updateId]);
  // today's update, or one written offline in the last 2 days and sent now
  if (!$u || (int)$u['user_id'] !== $me['id'] || $u['day'] > today() || $u['day'] < date('Y-m-d', strtotime(today() . ' -2 days'))) throw new ApiError('Send the update first, then add the photo.', 403);
  $cid = client_id($_POST['clientId'] ?? null);
  if ($cid && ($dup = one('SELECT id FROM photos WHERE update_id = ? AND client_id = ?', [$updateId, $cid]))) return (int)$dup['id']; // sent before
  // only this person's photos count (the ones from before a move stay on the row, but are older than the take-over)
  if ((int)one('SELECT COUNT(*) AS n FROM photos WHERE update_id = ? AND created_at >= ?', [$updateId, $u['created_at']])['n'] >= MAX_PHOTOS) throw new ApiError('Up to ' . MAX_PHOTOS . ' photos per update.');
  $f = $_FILES['file'] ?? null;
  if (!$f || $f['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($f['tmp_name'])) throw new ApiError('The photo did not arrive. Try again.');
  if ($f['size'] > MAX_UPLOAD_BYTES) throw new ApiError('That photo is too big.');
  $mime = (new finfo(FILEINFO_MIME_TYPE))->file($f['tmp_name']);
  if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'], true)) throw new ApiError('Only photos can be added.');
  $jpeg = shrink_photo($f['tmp_name'], $mime);
  $dir = date('Y-m');
  if (!is_dir(UPLOAD_DIR . "/$dir")) mkdir(UPLOAD_DIR . "/$dir", 0750, true);
  $file = "$dir/" . bin2hex(random_bytes(12)) . '.jpg';
  file_put_contents(UPLOAD_DIR . "/$file", $jpeg);
  // the limit, again under a lock on the update: photos sent at the same moment are counted one after the other
  $saved = in_tx_with_alerts(function () use ($updateId, $u, $file, $jpeg, $cid) {
    one('SELECT id FROM updates WHERE id = ? FOR UPDATE', [$updateId]);
    if ((int)one('SELECT COUNT(*) AS n FROM photos WHERE update_id = ? AND created_at >= ?', [$updateId, $u['created_at']])['n'] >= MAX_PHOTOS) {
      @unlink(UPLOAD_DIR . '/' . $file);
      throw new ApiError('Up to ' . MAX_PHOTOS . ' photos per update.');
    }
    return insert_once('INSERT INTO photos (update_id, file, size, created_at, client_id) VALUES (?, ?, ?, ?, ?)', [$updateId, $file, strlen($jpeg), now(), $cid], $file) ? (int)db()->lastInsertId() : 0;
  });
  if (!$saved) {
    $dup = one('SELECT id FROM photos WHERE update_id = ? AND client_id = ?', [$updateId, $cid]); // the same send arrived twice at once: kept once
    if (!$dup) throw new ApiError('Something went wrong. Try again.');
    return (int)$dup['id'];
  }
  return $saved;
}

/**
 * Save a sent row (a message, a task, a photo). Two sends of the same one (same clientId) at the same moment both pass
 * the "sent before?" look: the second is stopped by the unique key — then its file (if any) goes and false is returned
 * (the first one is kept).
 */
function insert_once(string $sql, array $args, ?string $file = null): bool {
  try { q($sql, $args); return true; }
  catch (PDOException $e) {
    if ((int)($e->errorInfo[1] ?? 0) !== 1062) throw $e; // only "already there" (MySQL 1062)
    if ($file !== null) @unlink(UPLOAD_DIR . '/' . $file);
    return false;
  }
}

function shrink_photo(string $path, string $mime): string {
  $max = 1600;
  // a photo that says it is huge (made to fill the server's memory): refused before it is opened
  $tooBig = fn(int $w, int $h) => $w > 12000 || $h > 12000 || $w * $h > 50000000;
  if (extension_loaded('imagick') && ($mime === 'image/heic' || $mime === 'image/heif' || !function_exists('imagecreatefromstring'))) {
    try {
      Imagick::setResourceLimit(Imagick::RESOURCETYPE_MEMORY, 256 << 20);
      Imagick::setResourceLimit(Imagick::RESOURCETYPE_DISK, 1 << 30);
      $im = new Imagick();
      $im->pingImage($path);
      if ($tooBig($im->getImageWidth(), $im->getImageHeight())) throw new ApiError('That photo is too big.');
      $im->clear();
      $im->readImage($path);
      $im->autoOrient();
      $im->thumbnailImage($max, $max, true);
      $im->setImageFormat('jpeg');
      $im->setImageCompressionQuality(80);
      $im->stripImage();
      return $im->getImageBlob();
    } catch (ImagickException $e) {
      throw new ApiError('That photo could not be read. Try another.');
    }
  }
  $size = @getimagesize($path);
  if (!$size) throw new ApiError('That photo could not be read. Try another.');
  if ($tooBig((int)$size[0], (int)$size[1])) throw new ApiError('That photo is too big.');
  $img = @imagecreatefromstring((string)file_get_contents($path));
  if (!$img) throw new ApiError('That photo could not be read. Try another.');
  if ($mime === 'image/jpeg' && function_exists('exif_read_data')) {
    $o = (int)(@exif_read_data($path)['Orientation'] ?? 1);
    if ($o === 3) $img = imagerotate($img, 180, 0);
    elseif ($o === 6) $img = imagerotate($img, -90, 0);
    elseif ($o === 8) $img = imagerotate($img, 90, 0);
  }
  $w = imagesx($img); $h = imagesy($img);
  $s = min(1, $max / max($w, $h));
  if ($s < 1) $img = imagescale($img, (int)round($w * $s), (int)round($h * $s));
  ob_start();
  imagejpeg($img, null, 80); // re-saving also drops the hidden details (GPS place etc.)
  return (string)ob_get_clean();
}

function add_task_file(array $me, array $t): int {
  if ((int)one('SELECT COUNT(*) AS n FROM task_files WHERE task_id = ?', [$t['id']])['n'] >= 10) throw new ApiError('Up to 10 files per task.');
  $f = $_FILES['file'] ?? null;
  if (!$f || $f['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($f['tmp_name'])) throw new ApiError('The file did not arrive. Try again.');
  if ($f['size'] > MAX_UPLOAD_BYTES) throw new ApiError('That file is too big (15 MB at most).');
  $mime = (new finfo(FILEINFO_MIME_TYPE))->file($f['tmp_name']);
  $name = mb_substr(preg_replace('/[^\w .()-]/u', '_', (string)($f['name'] ?? 'file')) ?: 'file', 0, 200);
  if (in_array($mime, ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'], true)) { $bytes = shrink_photo($f['tmp_name'], $mime); $ext = 'jpg'; $mime = 'image/jpeg'; }
  elseif ($mime === 'application/pdf') { $bytes = (string)file_get_contents($f['tmp_name']); $ext = 'pdf'; }
  else throw new ApiError('Photos and PDF files only.');
  $dir = 'files/' . date('Y-m');
  if (!is_dir(UPLOAD_DIR . "/$dir")) mkdir(UPLOAD_DIR . "/$dir", 0750, true);
  $file = "$dir/" . bin2hex(random_bytes(12)) . ".$ext";
  file_put_contents(UPLOAD_DIR . "/$file", $bytes);
  // the limit, again under a lock on the task: files sent at the same moment are counted one after the other
  return in_tx_with_alerts(function () use ($me, $t, $file, $name, $mime, $bytes) {
    one('SELECT id FROM tasks WHERE id = ? FOR UPDATE', [$t['id']]);
    if ((int)one('SELECT COUNT(*) AS n FROM task_files WHERE task_id = ?', [$t['id']])['n'] >= 10) {
      @unlink(UPLOAD_DIR . '/' . $file);
      throw new ApiError('Up to 10 files per task.');
    }
    q('INSERT INTO task_files (task_id, user_id, file, name, mime, size, at) VALUES (?, ?, ?, ?, ?, ?, ?)', [$t['id'], $me['id'], $file, $name, $mime, strlen($bytes), now()]);
    return (int)db()->lastInsertId();
  });
}

/** An instruction file: only to the manager or the person doing the task. */
function send_task_file(int $id): void {
  $me = current_user();
  $f = one('SELECT f.*, t.assignee_id FROM task_files f JOIN tasks t ON t.id = f.task_id WHERE f.id = ?', [$id]);
  if (!$f || ($me['role'] !== 'admin' && (int)$f['assignee_id'] !== $me['id'])) throw new ApiError('File not found.', 404);
  $path = UPLOAD_DIR . '/' . $f['file'];
  if (!is_file($path)) throw new ApiError('File not found.', 404);
  header('Content-Type: ' . $f['mime']);
  header('Content-Disposition: inline; filename="' . str_replace('"', '', $f['name']) . '"');
  header('Cache-Control: private, max-age=86400'); header('Vary: Authorization', false); // kept only for the same sign-in (address bar / next person: asked again)
  header('Content-Length: ' . filesize($path));
  readfile($path);
}

/** Show a photo: only to the manager or the person who took it. */
function send_comment_photo(int $id): void {
  $me = current_user();
  $c = one('SELECT * FROM comments WHERE id = ?', [$id]);
  if (!$c || !$c['photo']) throw new ApiError('Photo not found.', 404);
  own_task($me, (int)$c['task_id']); // 404 for anyone else
  $path = UPLOAD_DIR . '/' . $c['photo'];
  if (!is_file($path)) throw new ApiError('Photo not found.', 404);
  header('Content-Type: image/jpeg');
  header('Cache-Control: private, max-age=86400'); header('Vary: Authorization', false); // kept only for the same sign-in (address bar / next person: asked again)
  header('Content-Length: ' . filesize($path));
  readfile($path);
}

function send_photo(int $id): void {
  $me = current_user();
  $p = one('SELECT p.*, u.user_id, u.task_id FROM photos p JOIN updates u ON u.id = p.update_id WHERE p.id = ?', [$id]);
  if (!$p) throw new ApiError('Photo not found.', 404);
  // the manager, the person who took it, or whoever has the task now (after a move they see its earlier photos too)
  if ($me['role'] !== 'admin' && (int)$p['user_id'] !== $me['id']) own_task($me, (int)$p['task_id']); // 404 for anyone else
  $path = UPLOAD_DIR . '/' . $p['file'];
  if (!is_file($path)) throw new ApiError('Photo not found.', 404);
  header('Content-Type: image/jpeg');
  header('Cache-Control: private, max-age=86400'); header('Vary: Authorization', false); // kept only for the same sign-in (address bar / next person: asked again)
  header('Content-Length: ' . filesize($path));
  readfile($path);
}
