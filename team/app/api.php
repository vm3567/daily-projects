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
  return array_map(fn($t) => [
    'id' => (int)$t['id'], 'title' => $t['title'], 'details' => $t['details'] ?? '',
    'assignee' => ['id' => (int)$t['assignee_id'], 'name' => $t['assignee_name'] ?? ''],
    'repeat' => $t['repeat_kind'], 'skipSunday' => (bool)$t['skip_sunday'], 'weekday' => $t['weekday'] === null ? null : (int)$t['weekday'],
    'dueDate' => $t['due_date'], 'startDate' => $t['start_date'], 'project' => $t['project'] ?? '', 'projectRef' => $t['project_ref'], 'stepRef' => $t['step_ref'],
    'status' => $t['status'], 'createdAt' => $t['created_at'], 'doneAt' => $t['done_at'],
    'dueToday' => $t['status'] === 'open' && due_on($t, $day),
    'today' => update_out($todays[$t['id']] ?? null, $photos), 'last' => update_out($lasts[$t['id']] ?? null, $photos),
  ], $tasks);
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
      $tasks = all(TASK_SELECT . " WHERE t.assignee_id = ? AND (t.status = 'open' OR t.done_at >= ?) ORDER BY t.repeat_kind = 'once', t.due_date IS NULL, t.due_date, t.id", [$me['id'], $day . ' 00:00:00']);
      $out = tasks_out($tasks, $day);
      $due = array_values(array_filter($out, fn($t) => $t['dueToday'] || ($t['today'] !== null)));
      $other = array_values(array_filter($out, fn($t) => !$t['dueToday'] && $t['today'] === null && $t['status'] === 'open'));
      return ['today' => $day, 'tasks' => $due, 'other' => $other, 'fillBy' => setting('fill_by', '18:00')];
    }
    case 'update.save': {
      $t = own_task($me, (int)($in['taskId'] ?? 0));
      if ((int)$t['assignee_id'] !== $me['id']) throw new ApiError('Only the person doing the task can write its update.', 403);
      if ($t['status'] !== 'open' && !($t['done_at'] && substr($t['done_at'], 0, 10) === $day)) throw new ApiError('This task is closed.');
      $note = txt($in['note'] ?? '', 4000, true, 'The update');
      $state = in_array($in['state'] ?? '', ['progress', 'stuck', 'finished'], true) ? $in['state'] : 'progress';
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
      return ['task' => tasks_out([$t], $day)[0], 'updates' => array_map(fn($u) => update_out($u, $photos), $ups)];
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
      return ['today' => $day, 'fillBy' => $fillBy, 'late' => date('H:i') >= $fillBy, 'people' => array_map('public_user', $people), 'tasks' => $out];
    }
    case 'tasks.list': {
      $closed = ($in['status'] ?? 'open') === 'closed';
      $tasks = all(TASK_SELECT . ($closed ? " WHERE t.status <> 'open' ORDER BY t.updated_at DESC LIMIT 200" : " WHERE t.status = 'open' ORDER BY u.name, t.id"));
      return ['tasks' => tasks_out($tasks, $day)];
    }
    case 'tasks.linked': { // for Daily Projects: every team task given from a step (open, or closed this week)
      $since = date('Y-m-d H:i:s', time() - 7 * 86400);
      $tasks = all(TASK_SELECT . " WHERE t.step_ref IS NOT NULL AND (t.status = 'open' OR t.updated_at >= ?) ORDER BY t.id", [$since]);
      $fillBy = setting('fill_by', '18:00');
      return ['today' => $day, 'fillBy' => $fillBy, 'late' => date('H:i') >= $fillBy, 'tasks' => tasks_out($tasks, $day)];
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
        audit($me['id'], 'task_edit', "#$id $title");
      } else {
        q('INSERT INTO tasks (title, details, assignee_id, repeat_kind, skip_sunday, weekday, due_date, project, project_ref, step_ref, updated_at, created_by, start_date, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [...$vals, $me['id'], $day, now()]);
        $id = (int)db()->lastInsertId();
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
