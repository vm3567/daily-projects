<?php
// Everything the team app can ask the server. Staff only ever reach their own tasks;
// every manager-only action checks require_admin() first.
declare(strict_types=1);

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function txt($v, int $max, bool $required = false, string $what = 'This'): string {
  $s = trim(preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/u', '', (string)($v ?? '')) ?? '');
  if ($required && $s === '') throw new ApiError("$what is empty.");
  return mb_substr($s, 0, $max);
}
function date_or_null($v): ?string {
  $v = (string)($v ?? '');
  if ($v === '') return null;
  if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) || !strtotime($v)) throw new ApiError('That date is not right.');
  return $v;
}

/** Is this task on the list for that day? */
function due_on(array $t, string $day): bool {
  if ($day < $t['start_date']) return false;
  $wd = (int)date('w', strtotime($day));
  if ($t['repeat_kind'] === 'daily') return !($t['skip_sunday'] && $wd === 0);
  if ($t['repeat_kind'] === 'weekly') return (int)$t['weekday'] === $wd;
  return true; // one-time: every day until finished
}

function photos_of(array $updateIds): array {
  if (!$updateIds) return [];
  $in = implode(',', array_fill(0, count($updateIds), '?'));
  $out = [];
  foreach (all("SELECT id, update_id FROM photos WHERE update_id IN ($in) ORDER BY id", array_values($updateIds)) as $p) $out[$p['update_id']][] = (int)$p['id'];
  return $out;
}

function update_out(?array $u, array $photos = []): ?array {
  if (!$u) return null;
  return ['id' => (int)$u['id'], 'day' => $u['day'], 'note' => $u['note'], 'state' => $u['state'], 'at' => $u['updated_at'], 'photos' => $photos[$u['id']] ?? []];
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
  $answered = []; // newest message from someone other than the person doing the task
  foreach (all("SELECT c.task_id, MAX(c.at) AS at FROM comments c JOIN tasks t ON t.id = c.task_id WHERE c.task_id IN ($in) AND c.user_id <> t.assignee_id GROUP BY c.task_id", $ids) as $r) $answered[$r['task_id']] = $r['at'];
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
  return array_map(fn($t) => [
    'id' => (int)$t['id'], 'title' => $t['title'], 'queued' => $queued($t), 'seq' => $t['seq'] === null ? null : (int)$t['seq'], 'details' => $t['details'] ?? '',
    'assignee' => ['id' => (int)$t['assignee_id'], 'name' => $t['assignee_name'] ?? ''],
    'repeat' => $t['repeat_kind'], 'skipSunday' => (bool)$t['skip_sunday'], 'weekday' => $t['weekday'] === null ? null : (int)$t['weekday'],
    'dueDate' => $t['due_date'], 'startDate' => $t['start_date'], 'project' => $t['project'] ?? '', 'projectRef' => $t['project_ref'], 'stepRef' => $t['step_ref'],
    'status' => $t['status'], 'createdAt' => $t['created_at'], 'doneAt' => $t['done_at'],
    'dueToday' => $t['status'] === 'open' && due_on($t, $day) && !$queued($t),
    'today' => update_out($todays[$t['id']] ?? null, $photos), 'last' => update_out($lasts[$t['id']] ?? null, $photos),
    'createdBy' => (int)$t['created_by'], 'needsPhoto' => (bool)($t['needs_photo'] ?? 0), 'files' => $files[$t['id']] ?? [],
    'messages' => $count[$t['id']] ?? 0, 'unread' => $unread[$t['id']] ?? 0, 'lastMessage' => $lastMsg[$t['id']] ?? null,
    // stuck: the newest update says "Stuck" (and the manager has not answered since)
    'stuck' => (function () use ($t, $todays, $lasts, $answered) {
      $u = $todays[$t['id']] ?? $lasts[$t['id']] ?? null;
      if (!$u || $u['state'] !== 'stuck' || $t['status'] !== 'open') return false;
      return !(isset($answered[$t['id']]) && $answered[$t['id']] >= $u['updated_at']);
    })(),
  ], $tasks);
}

function mark_read(array $taskIds, int $userId): void {
  foreach (array_unique($taskIds) as $id) {
    $last = (int)(one('SELECT MAX(id) AS m FROM comments WHERE task_id = ?', [(int)$id])['m'] ?? 0);
    q('INSERT INTO task_reads (task_id, user_id, at, last_id) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE at = VALUES(at), last_id = GREATEST(last_id, VALUES(last_id))', [(int)$id, $userId, now(), $last]);
  }
}

function comments_of(int $taskId): array {
  $meId = (int)($GLOBALS['me']['id'] ?? 0);
  return array_map(fn($c) => ['id' => (int)$c['id'], 'by' => $c['name'], 'byId' => (int)$c['user_id'], 'text' => $c['text'], 'at' => $c['at'], 'mine' => (int)$c['user_id'] === $meId],
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

function handle(string $a, array $in): array {
  if ($a === 'ping') return ['setUp' => (bool)config(), 'time' => now()];
  if ($a === 'login') return login((string)($in['username'] ?? ''), (string)($in['password'] ?? ''), (string)($_SERVER['HTTP_USER_AGENT'] ?? ''));

  $me = current_user();
  $GLOBALS['me'] = $me;
  $day = today();
  $dp = dp_handle($a, $in, $me);
  if ($dp !== null) return $dp;
  switch ($a) {
    case 'me':
      return ['user' => public_user($me), 'today' => $day];
    case 'logout':
      logout();
      return [];
    case 'password':
      change_password($me, (string)($in['old'] ?? ''), (string)($in['new'] ?? ''));
      return ['user' => public_user(one('SELECT * FROM users WHERE id = ?', [$me['id']]))];

    // ---------- staff: my tasks ----------
    case 'my.today': {
      $tasks = all(TASK_SELECT . " WHERE t.assignee_id = ? AND (t.status = 'open' OR t.done_at >= ?) ORDER BY t.repeat_kind = 'once', t.due_date IS NULL, t.due_date, t.project_ref, t.seq, t.id", [$me['id'], $day . ' 00:00:00']);
      $out = tasks_out($tasks, $day);
      $due = array_values(array_filter($out, fn($t) => $t['dueToday'] || ($t['today'] !== null)));
      $other = array_values(array_filter($out, fn($t) => !$t['dueToday'] && $t['today'] === null && $t['status'] === 'open'));
      // my suggestions: waiting for a yes, or said no this week (with the reason in the messages)
      $sugg = tasks_out(all(TASK_SELECT . " WHERE t.created_by = ? AND t.assignee_id = ? AND (t.status = 'suggested' OR (t.status = 'cancelled' AND t.updated_at >= ?)) ORDER BY t.id DESC",
        [$me['id'], $me['id'], date('Y-m-d H:i:s', time() - 7 * 86400)]), $day);
      mark_read(array_map(fn($t) => $t['id'], [...$due, ...$other, ...$sugg]), $me['id']); // shown now = read (the "new" marks above stay for this screen)
      return ['today' => $day, 'tasks' => $due, 'other' => $other, 'suggestions' => $sugg, 'fillBy' => setting('fill_by', '18:00')];
    }
    case 'update.save': {
      $t = own_task($me, (int)($in['taskId'] ?? 0));
      if ((int)$t['assignee_id'] !== $me['id']) throw new ApiError('Only the person doing the task can write its update.', 403);
      if ($t['status'] !== 'open' && !($t['done_at'] && substr($t['done_at'], 0, 10) === $day)) throw new ApiError('This task is closed.');
      $note = txt($in['note'] ?? '', 4000, true, 'The update');
      $state = in_array($in['state'] ?? '', ['progress', 'stuck', 'finished'], true) ? $in['state'] : 'progress';
      if ($state === 'finished' && $t['needs_photo']) {
        $n = one('SELECT COUNT(*) AS n FROM photos p JOIN updates u ON u.id = p.update_id WHERE u.task_id = ? AND u.day = ?', [$t['id'], $day]);
        if (!(int)$n['n']) throw new ApiError('A photo is needed to finish this task. Add a photo, then tap Finished.');
      }
      q('INSERT INTO updates (task_id, user_id, day, note, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE note = VALUES(note), state = VALUES(state), updated_at = VALUES(updated_at)',
        [$t['id'], $me['id'], $day, $note, $state, now(), now()]);
      if ($t['repeat_kind'] === 'once') {
        if ($state === 'finished') q("UPDATE tasks SET status = 'done', done_at = ?, updated_at = ? WHERE id = ?", [now(), now(), $t['id']]);
        elseif ($t['status'] === 'done') q("UPDATE tasks SET status = 'open', done_at = NULL, updated_at = ? WHERE id = ?", [now(), $t['id']]);
      }
      $u = one('SELECT * FROM updates WHERE task_id = ? AND day = ?', [$t['id'], $day]);
      return ['update' => update_out($u, photos_of([(int)$u['id']]))];
    }
    case 'photo.add':
      return ['photoId' => add_photo($me, (int)($in['updateId'] ?? 0))];
    case 'photo.delete': {
      $p = one('SELECT p.*, u.user_id, u.day FROM photos p JOIN updates u ON u.id = p.update_id WHERE p.id = ?', [(int)($in['id'] ?? 0)]);
      if (!$p || (int)$p['user_id'] !== $me['id'] || $p['day'] !== $day) throw new ApiError('You can only remove your own photos from today.', 403);
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
      return $out;
    }
    case 'comment.add': { // a message on a task: between the manager and the person doing it
      $t = own_task($me, (int)($in['taskId'] ?? 0));
      $text = txt($in['text'] ?? '', 2000, true, 'The message');
      q('INSERT INTO comments (task_id, user_id, text, at) VALUES (?, ?, ?, ?)', [$t['id'], $me['id'], $text, now()]);
      mark_read([(int)$t['id']], $me['id']);
      return ['comments' => comments_of((int)$t['id'])];
    }
    case 'suggest': { // staff: "I think this should be done" — it waits for the manager's yes
      $title = txt($in['title'] ?? '', 300, true, 'The task');
      $kind = in_array($in['repeat'] ?? '', ['daily', 'weekly', 'once'], true) ? $in['repeat'] : 'once';
      q("INSERT INTO tasks (title, details, assignee_id, created_by, repeat_kind, skip_sunday, weekday, due_date, start_date, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, NULL, ?, ?, 'suggested', ?, ?)",
        [$title, txt($in['details'] ?? '', 4000), $me['id'], $me['id'], $kind, $kind === 'once' ? date_or_null($in['dueDate'] ?? null) : null, $day, now(), now()]);
      $id = (int)db()->lastInsertId();
      audit($me['id'], 'task_suggested', "#$id $title");
      return ['task' => tasks_out([own_task($me, $id)], $day)[0]];
    }
  }

  // ---------- manager only ----------
  require_admin($me);
  switch ($a) {
    case 'team.today': {
      $people = all("SELECT * FROM users WHERE active = 1 AND role = 'staff' ORDER BY name");
      $tasks = all(TASK_SELECT . " WHERE (t.status = 'open' OR t.done_at >= ?) ORDER BY t.id", [$day . ' 00:00:00']);
      $out = array_values(array_filter(tasks_out($tasks, $day), fn($t) => $t['dueToday'] || $t['today'] !== null));
      $fillBy = setting('fill_by', '18:00');
      $att = team_attention();
      unset($att['open']);
      return ['today' => $day, 'fillBy' => $fillBy, 'late' => date('H:i') >= $fillBy, 'people' => array_map('public_user', $people), 'tasks' => $out] + $att;
    }
    case 'project.sync': {
      // Daily Projects: "this whole project is given to <person>". steps = the project's open steps, in order.
      // Makes a task for each new step, keeps titles and order up to date, moves them to a new person,
      // and closes tasks whose step is gone (ticked or deleted by the manager). assigneeId 0 = take the project back.
      $ref = txt($in['projectRef'] ?? '', 80, true, 'The project');
      $name = txt($in['project'] ?? '', 200);
      $who = (int)($in['assigneeId'] ?? 0);
      $photo = empty($in['needsPhoto']) ? 0 : 1;
      $open = all("SELECT * FROM tasks WHERE project_ref = ? AND seq IS NOT NULL AND status = 'open'", [$ref]);
      if (!$who) {
        foreach ($open as $t) q("UPDATE tasks SET status = 'cancelled', done_at = ?, updated_at = ? WHERE id = ?", [now(), now(), $t['id']]);
        audit($me['id'], 'project_taken_back', $name);
        return ['tasks' => []];
      }
      $person = one('SELECT id, active FROM users WHERE id = ?', [$who]);
      if (!$person || !$person['active']) throw new ApiError('Choose who will do it.');
      $byStep = [];
      foreach ($open as $t) $byStep[$t['step_ref']] = $t;
      $steps = array_slice((array)($in['steps'] ?? []), 0, 300);
      $keep = [];
      foreach (array_values($steps) as $i => $st) {
        $stepRef = txt($st['stepRef'] ?? '', 80);
        $title = txt($st['title'] ?? '', 300);
        if ($stepRef === '' || $title === '') continue;
        $keep[$stepRef] = true;
        if (isset($byStep[$stepRef])) {
          $t = $byStep[$stepRef];
          if ($t['title'] !== $title || (int)$t['seq'] !== $i || (int)$t['assignee_id'] !== $who || ($t['project'] ?? '') !== $name || (int)$t['needs_photo'] !== $photo) {
            q('UPDATE tasks SET title = ?, seq = ?, assignee_id = ?, project = ?, needs_photo = ?, updated_at = ? WHERE id = ?', [$title, $i, $who, $name ?: null, $photo, now(), $t['id']]);
          }
          continue;
        }
        // finished by the person already (the manager's step will tick itself): do not make it again
        if (one("SELECT id FROM tasks WHERE step_ref = ? AND status = 'done' AND updated_at >= ?", [$stepRef, date('Y-m-d H:i:s', time() - 30 * 86400)])) continue;
        // a single step given earlier: it becomes part of the project hand-over
        $single = one("SELECT id FROM tasks WHERE step_ref = ? AND status = 'open' AND seq IS NULL", [$stepRef]);
        if ($single) { q('UPDATE tasks SET seq = ?, assignee_id = ?, title = ?, project = ?, project_ref = ?, repeat_kind = ?, needs_photo = ?, updated_at = ? WHERE id = ?', [$i, $who, $title, $name ?: null, $ref, 'once', $photo, now(), $single['id']]); continue; }
        q("INSERT INTO tasks (title, details, assignee_id, created_by, repeat_kind, skip_sunday, weekday, due_date, start_date, project, project_ref, step_ref, status, seq, needs_photo, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'once', 1, NULL, NULL, ?, ?, ?, ?, 'open', ?, ?, ?, ?)",
          [$title, txt($st['details'] ?? '', 4000), $who, $me['id'], $day, $name ?: null, $ref, $stepRef, $i, $photo, now(), now()]);
      }
      foreach ($open as $t) if (!isset($keep[$t['step_ref']])) q("UPDATE tasks SET status = 'done', done_at = ?, updated_at = ? WHERE id = ?", [now(), now(), $t['id']]);
      audit($me['id'], 'project_given', "$name → #$who");
      return ['tasks' => tasks_out(all(TASK_SELECT . " WHERE t.project_ref = ? AND t.seq IS NOT NULL AND t.status = 'open' ORDER BY t.seq", [$ref]), $day)];
    }
    case 'task.file.add': // manager: an instruction photo / PDF on the task, for the person doing it
      return ['fileId' => add_task_file($me, own_task($me, (int)($in['taskId'] ?? 0)))];
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
      $kind = in_array($in['repeat'] ?? '', ['daily', 'weekly', 'once'], true) ? $in['repeat'] : $t['repeat_kind'];
      q("UPDATE tasks SET status = 'open', title = ?, repeat_kind = ?, skip_sunday = ?, weekday = ?, due_date = ?, start_date = ?, updated_at = ? WHERE id = ?", [
        txt($in['title'] ?? $t['title'], 300, true, 'The task'), $kind, array_key_exists('skipSunday', $in) ? (empty($in['skipSunday']) ? 0 : 1) : (int)$t['skip_sunday'],
        $kind === 'weekly' ? max(0, min(6, (int)($in['weekday'] ?? 1))) : null, $kind === 'once' ? date_or_null($in['dueDate'] ?? null) : null, $day, now(), $t['id']]);
      if (trim((string)($in['note'] ?? '')) !== '') q('INSERT INTO comments (task_id, user_id, text, at) VALUES (?, ?, ?, ?)', [$t['id'], $me['id'], txt($in['note'], 2000), now()]);
      audit($me['id'], 'task_approved', "#{$t['id']} {$t['title']}");
      return ['task' => tasks_out([own_task($me, (int)$t['id'])], $day)[0]];
    }
    case 'task.decline': {
      $t = own_task($me, (int)($in['id'] ?? 0));
      if ($t['status'] !== 'suggested') throw new ApiError('This suggestion was already answered.');
      q("UPDATE tasks SET status = 'cancelled', done_at = ?, updated_at = ? WHERE id = ?", [now(), now(), $t['id']]);
      $why = txt($in['reason'] ?? '', 2000);
      q('INSERT INTO comments (task_id, user_id, text, at) VALUES (?, ?, ?, ?)', [$t['id'], $me['id'], $why !== '' ? "Not now: $why" : 'Not now.', now()]);
      audit($me['id'], 'task_declined', "#{$t['id']} {$t['title']}");
      return [];
    }
    case 'tasks.list': {
      $closed = ($in['status'] ?? 'open') === 'closed';
      $tasks = all(TASK_SELECT . ($closed ? " WHERE t.status IN ('done', 'cancelled') ORDER BY t.updated_at DESC LIMIT 200" : " WHERE t.status = 'open' ORDER BY u.name, t.id"));
      return ['tasks' => tasks_out($tasks, $day)];
    }
    case 'tasks.linked': { // for Daily Projects: every team task given from a step (open, or closed this week)
      $since = date('Y-m-d H:i:s', time() - 7 * 86400);
      $tasks = all(TASK_SELECT . " WHERE t.step_ref IS NOT NULL AND (t.status = 'open' OR t.updated_at >= ?) ORDER BY t.id", [$since]);
      $fillBy = setting('fill_by', '18:00');
      $att = team_attention();
      return ['today' => $day, 'fillBy' => $fillBy, 'late' => date('H:i') >= $fillBy, 'tasks' => tasks_out($tasks, $day),
        'alerts' => ['stuck' => count($att['stuck']), 'unread' => count($att['unread']), 'suggestions' => count($att['suggestions'])],
        'summary' => (function () use ($att) { // one line for the manager's Today page
          $due = array_values(array_filter($att['open'], fn($t) => $t['dueToday']));
          $missing = array_values(array_unique(array_map(fn($t) => $t['assignee']['name'], array_filter($due, fn($t) => !$t['today']))));
          return ['due' => count($due), 'sent' => count(array_filter($due, fn($t) => (bool)$t['today'])), 'notFilled' => $missing];
        })()];
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
      if (!$assignee || !$assignee['active']) throw new ApiError('Choose who will do it.');
      $kind = in_array($in['repeat'] ?? '', ['daily', 'weekly', 'once'], true) ? $in['repeat'] : 'daily';
      $weekday = $kind === 'weekly' ? max(0, min(6, (int)($in['weekday'] ?? 1))) : null;
      $due = $kind === 'once' ? date_or_null($in['dueDate'] ?? null) : null;
      $vals = [$title, txt($in['details'] ?? '', 4000), (int)$assignee['id'], $kind, empty($in['skipSunday']) ? 0 : 1, $weekday, $due,
        txt($in['project'] ?? '', 200) ?: null, txt($in['projectRef'] ?? '', 80) ?: null, txt($in['stepRef'] ?? '', 80) ?: null, now()];
      if ($id) {
        own_task($me, $id);
        q('UPDATE tasks SET title=?, details=?, assignee_id=?, repeat_kind=?, skip_sunday=?, weekday=?, due_date=?, project=?, project_ref=?, step_ref=?, updated_at=? WHERE id=?', [...$vals, $id]);
        q('UPDATE tasks SET needs_photo = ? WHERE id = ?', [empty($in['needsPhoto']) ? 0 : 1, $id]);
        audit($me['id'], 'task_edit', "#$id $title");
      } else {
        q('INSERT INTO tasks (title, details, assignee_id, repeat_kind, skip_sunday, weekday, due_date, project, project_ref, step_ref, updated_at, created_by, start_date, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [...$vals, $me['id'], $day, now()]);
        $id = (int)db()->lastInsertId();
        q('UPDATE tasks SET needs_photo = ? WHERE id = ?', [empty($in['needsPhoto']) ? 0 : 1, $id]);
        audit($me['id'], 'task_new', "#$id $title");
      }
      return ['task' => tasks_out([own_task($me, $id)], $day)[0]];
    }
    case 'task.status': {
      $t = own_task($me, (int)($in['id'] ?? 0));
      $st = in_array($in['status'] ?? '', ['open', 'done', 'cancelled'], true) ? $in['status'] : 'open';
      q('UPDATE tasks SET status = ?, done_at = ?, updated_at = ? WHERE id = ?', [$st, $st === 'open' ? null : now(), now(), $t['id']]);
      audit($me['id'], 'task_' . $st, "#{$t['id']} {$t['title']}");
      return ['task' => tasks_out([own_task($me, (int)$t['id'])], $day)[0]];
    }
    case 'users.list':
      return ['users' => array_map('public_user', all('SELECT * FROM users ORDER BY active DESC, role, name'))];
    case 'user.save': {
      $id = (int)($in['id'] ?? 0);
      $name = txt($in['name'] ?? '', 80, true, 'The name');
      $role = ($in['role'] ?? 'staff') === 'admin' ? 'admin' : 'staff';
      if ($id) {
        if ($id === $me['id'] && $role !== 'admin') throw new ApiError('You cannot remove your own manager rights.');
        q('UPDATE users SET name = ?, role = ? WHERE id = ?', [$name, $role, $id]);
        audit($me['id'], 'user_edit', "#$id $name");
      } else {
        $username = clean_username((string)($in['username'] ?? ''));
        if (!preg_match('/^[a-z0-9._-]{3,40}$/', $username)) throw new ApiError('Username: 3 to 40 small letters or numbers (dot, dash and underscore are fine). No spaces.');
        if (one('SELECT id FROM users WHERE username = ?', [$username])) throw new ApiError('That username is taken. Try another.');
        $pass = (string)($in['password'] ?? '');
        check_password_rules($pass);
        q('INSERT INTO users (username, name, role, pass_hash, must_change, active, created_at) VALUES (?, ?, ?, ?, 1, 1, ?)',
          [$username, $name, $role, password_hash($pass, PASSWORD_DEFAULT), now()]);
        $id = (int)db()->lastInsertId();
        audit($me['id'], 'user_new', "#$id $username");
      }
      return ['user' => public_user(one('SELECT * FROM users WHERE id = ?', [$id]))];
    }
    case 'user.reset': {
      $u = one('SELECT * FROM users WHERE id = ?', [(int)($in['id'] ?? 0)]);
      if (!$u) throw new ApiError('Person not found.', 404);
      $pass = (string)($in['password'] ?? '');
      check_password_rules($pass);
      q('UPDATE users SET pass_hash = ?, must_change = 1 WHERE id = ?', [password_hash($pass, PASSWORD_DEFAULT), $u['id']]);
      q('DELETE FROM tokens WHERE user_id = ?', [$u['id']]);
      q('DELETE FROM login_fails WHERE k = ?', ['u:' . $u['username']]);
      audit($me['id'], 'user_reset', "#{$u['id']} {$u['username']}");
      return [];
    }
    case 'user.active': {
      $id = (int)($in['id'] ?? 0);
      if ($id === $me['id']) throw new ApiError('You cannot switch yourself off.');
      $on = !empty($in['active']);
      q('UPDATE users SET active = ? WHERE id = ?', [$on ? 1 : 0, $id]);
      if (!$on) q('DELETE FROM tokens WHERE user_id = ?', [$id]);
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

/** A photo for today's update: made smaller (max 1600 px), turned the right way up, saved as JPEG. */
function add_photo(array $me, int $updateId): int {
  $u = one('SELECT * FROM updates WHERE id = ?', [$updateId]);
  if (!$u || (int)$u['user_id'] !== $me['id'] || $u['day'] !== today()) throw new ApiError('Send the update first, then add the photo.', 403);
  if ((int)one('SELECT COUNT(*) AS n FROM photos WHERE update_id = ?', [$updateId])['n'] >= MAX_PHOTOS) throw new ApiError('Up to ' . MAX_PHOTOS . ' photos per update.');
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
  q('INSERT INTO photos (update_id, file, size, created_at) VALUES (?, ?, ?, ?)', [$updateId, $file, strlen($jpeg), now()]);
  return (int)db()->lastInsertId();
}

function shrink_photo(string $path, string $mime): string {
  $max = 1600;
  if (extension_loaded('imagick') && ($mime === 'image/heic' || $mime === 'image/heif' || !function_exists('imagecreatefromstring'))) {
    $im = new Imagick($path);
    $im->autoOrient();
    $im->thumbnailImage($max, $max, true);
    $im->setImageFormat('jpeg');
    $im->setImageCompressionQuality(80);
    $im->stripImage();
    return $im->getImageBlob();
  }
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
  q('INSERT INTO task_files (task_id, user_id, file, name, mime, size, at) VALUES (?, ?, ?, ?, ?, ?, ?)', [$t['id'], $me['id'], $file, $name, $mime, strlen($bytes), now()]);
  return (int)db()->lastInsertId();
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
  header('Cache-Control: private, max-age=86400');
  header('Content-Length: ' . filesize($path));
  readfile($path);
}

/** Show a photo: only to the manager or the person who took it. */
function send_photo(int $id): void {
  $me = current_user();
  $p = one('SELECT p.*, u.user_id FROM photos p JOIN updates u ON u.id = p.update_id WHERE p.id = ?', [$id]);
  if (!$p || ($me['role'] !== 'admin' && (int)$p['user_id'] !== $me['id'])) throw new ApiError('Photo not found.', 404);
  $path = UPLOAD_DIR . '/' . $p['file'];
  if (!is_file($path)) throw new ApiError('Photo not found.', 404);
  header('Content-Type: image/jpeg');
  header('Cache-Control: private, max-age=86400');
  header('Content-Length: ' . filesize($path));
  readfile($path);
}
