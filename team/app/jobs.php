<?php
// Work the server does by itself, so nothing waits for the owner's Daily Projects page being open:
// - given projects are kept in step with the saved projects (after every save, and once a day for steps that come back),
// - a second alert when someone has been Stuck for a day with no answer,
// - the evening summary for the managers.
// They run after an answer has been sent (any request), at most every 10 minutes (a save runs the project part at once).
declare(strict_types=1);

/** The owner's saved projects (data.json of the newest version), or null if there are none / it cannot be read. */
function dp_data(): ?array {
  $head = setting('dp_head', '');
  if ($head === '') return null;
  try {
    $c = one('SELECT tree FROM dp_commits WHERE id = ?', [$head]);
    if (!$c) return null;
    $files = dp_tree_files($c['tree']);
    if (!isset($files['data.json'])) return null;
    $d = json_decode(dp_get_blob($files['data.json']), true);
  } catch (Throwable $e) { return null; }
  return is_array($d) && isset($d['projects']) && is_array($d['projects']) ? $d : null;
}

/** The open steps of a given project, as Daily Projects sends them (the same rules as projectSteps() there). */
/** stepRef => when it was ticked, for the steps done in the saved projects. */
function server_done_at(array $p): array {
  $out = [];
  foreach ((array)($p['steps'] ?? []) as $s) if (!empty($s['done']) && !empty($s['id']) && !empty($s['doneAt'])) $out[(string)$s['id']] = (string)$s['doneAt'];
  return $out;
}

function server_steps(array $p, string $today): array {
  $steps = is_array($p['steps'] ?? null) ? $p['steps'] : [];
  $open = [];
  foreach ($steps as $s) {
    if (!empty($s['done']) || empty($s['id'])) continue;
    if (!empty($s['snoozedUntil']) && $s['snoozedUntil'] > $today) continue;
    $open[] = ['stepRef' => (string)$s['id'], 'title' => (string)($s['text'] ?? ''), 'details' => (string)($s['note'] ?? ''), 'dueDate' => $s['dueDate'] ?? null];
  }
  if ($open) return $open;
  if ($steps) return []; // steps all done or snoozed: nothing to do (the whole-project task is only for a project with no steps at all)
  return [['stepRef' => $p['id'] . ':whole', 'title' => (string)($p['name'] ?? 'Project'), 'details' => (string)($p['status'] ?? '')]];
}

/** One project.sync, one at a time per project (the same lock as the owner's app uses). */
function locked_project_sync(array $me, array $in, string $ref, string $day): array {
  $lk = 'ps:' . md5($ref);
  if (!(int)(one('SELECT GET_LOCK(?, 10) AS l', [$lk])['l'] ?? 0)) throw new ApiError('Busy, try again in a moment.', 503);
  try {
    if (!empty($in['_server']) && (int)setting('psc:' . md5($ref), '0') >= (int)($in['_since'] ?? PHP_INT_MAX)) return []; // the owner's app just sent it
    db()->beginTransaction();
    $out = project_sync($me, $in, $ref, $day);
    db()->commit();
    return $out;
  } catch (Throwable $e) {
    if (db()->inTransaction()) db()->rollBack();
    throw $e;
  } finally {
    q('SELECT RELEASE_LOCK(?)', [$lk]);
  }
}

/** Every given project, from the saved projects: new / returning steps reach the person, removed ones close. */
function server_sync_projects(): void {
  $owner = one('SELECT * FROM users WHERE id = ?', [(int)setting('dp_owner', '0')]);
  $data = $owner ? dp_data() : null;
  if (!$data) return;
  $today = today();
  $since = time();
  $savedAt = strtotime((string)(one('SELECT at FROM dp_commits WHERE id = ?', [setting('dp_head', '')])['at'] ?? '')) ?: 0;
  $prev = $GLOBALS['me'] ?? null;
  $GLOBALS['me'] = $owner; // as the owner (the owner is not told about their own changes)
  try {
    $given = [];
    foreach ($data['projects'] as $p) {
      if (!is_array($p) || empty($p['id']) || empty($p['team']['userId'])) continue;
      $given[(string)$p['id']] = $p;
    }
    // projects with steps on someone's list: still given? (taken back or deleted on another device: off the list)
    $refs = array_column(all("SELECT DISTINCT project_ref FROM tasks WHERE seq IS NOT NULL AND status = 'open' AND project_ref IS NOT NULL"), 'project_ref');
    foreach (array_unique([...array_keys($given), ...$refs]) as $ref) {
      $ref = (string)$ref;
      $psc = (int)setting('psc:' . md5($ref), '0');
      // the owner's app had changes not saved yet when it sent this project, and nothing was saved since: the saved copy is older
      // (until the saved projects show the person it was given to — whichever device saves next)
      $psp = json_decode(setting('psp:' . md5($ref), ''), true);
      $gp = $given[$ref] ?? null;
      $savedWho = $gp && ($gp['state'] ?? '') === 'active' ? (int)$gp['team']['userId'] : 0;
      if (is_array($psp) && (int)($psp['who'] ?? -1) === $savedWho && ($psp['base'] ?? '') !== setting('dp_head', '')) { q('DELETE FROM settings WHERE k = ?', ['psp:' . md5($ref)]); $psp = null; } // saved since
      if (is_array($psp) && (int)($psp['at'] ?? 0) > time() - 7 * 86400) continue;
      if ($psc > time() - 300) { // the owner's app sent this project minutes ago: it knows best — look again once that is over
        $retry = (int)setting('sync_retry', '0');
        if (!$retry || $retry > $psc + 301) set_setting('sync_retry', (string)($psc + 301));
        continue;
      }
      $p = $given[$ref] ?? null;
      $active = $p && ($p['state'] ?? '') === 'active';
      if (!$active && !one("SELECT id FROM tasks WHERE project_ref = ? AND seq IS NOT NULL AND status = 'open' LIMIT 1", [$ref])) continue; // nothing on anyone's list
      // moved to someone else in Work Task (Move to…), and the owner's app has not taken that over yet: follow the move
      $who = $active ? (int)$p['team']['userId'] : 0;
      if ($active) {
        $holders = array_map('intval', array_column(all("SELECT DISTINCT t.assignee_id FROM tasks t JOIN users u ON u.id = t.assignee_id WHERE t.project_ref = ? AND t.seq IS NOT NULL AND t.status = 'open' AND u.active = 1", [$ref]), 'assignee_id'));
        if (count($holders) === 1 && $holders[0] !== $who) $who = $holders[0];
        elseif (!$holders && ($mv = one("SELECT m.to_id, m.at FROM task_moves m JOIN tasks t ON t.id = m.task_id JOIN users u ON u.id = m.to_id WHERE t.project_ref = ? AND t.seq IS NOT NULL AND m.regive = 0 AND u.active = 1 ORDER BY m.at DESC, m.id DESC LIMIT 1", [$ref]))
          && strtotime($mv['at']) > (int)setting('psc:' . md5($ref), '0')) $who = (int)$mv['to_id']; // moved after the owner last gave it
      }
      $in = $p
        ? ['project' => (string)($p['name'] ?? ''), 'assigneeId' => $who, 'steps' => $active ? server_steps($p, $today) : [],
           'needsPhoto' => !empty($p['team']['needsPhoto']), 'reason' => $p['state'] ?? '', '_server' => true, 'doneAt' => server_done_at($p), '_since' => $since]
        : ['project' => '', 'assigneeId' => 0, 'steps' => [], '_server' => true, '_since' => $since, 'reason' => in_array($ref, array_column($data['projects'], 'id'), true) ? 'taken' : 'deleted'];
      try { locked_project_sync($owner, $in, $ref, $today); }
      catch (Throwable $e) { error_log("team sync $ref: " . $e->getMessage()); } // (a switched-off person, say): the others still go
    }
  } finally {
    $GLOBALS['me'] = $prev;
  }
}

/** Stuck for a day and nobody answered: the managers hear once more. */
function stuck_second_alerts(): void {
  $rows = all("SELECT u.id, u.task_id, u.note, t.title, t.assignee_id, us.name FROM updates u
      JOIN tasks t ON t.id = u.task_id JOIN users us ON us.id = u.user_id -- the person who wrote Stuck
      WHERE u.state = 'stuck' AND u.alert2 = 0 AND t.status = 'open' AND t.assignee_id = u.user_id AND u.updated_at < ? AND u.updated_at > ?
        AND u.day = (SELECT MAX(day) FROM updates WHERE task_id = u.task_id)
        AND NOT EXISTS (SELECT 1 FROM comments c WHERE c.task_id = u.task_id AND c.kind IS NULL AND c.user_id <> u.user_id AND c.at >= u.updated_at)",
    [date('Y-m-d H:i:s', time() - 86400), date('Y-m-d H:i:s', time() - 7 * 86400)]);
  foreach ($rows as $r) {
    q('UPDATE updates SET alert2 = 1 WHERE id = ?', [$r['id']]);
    notify(admin_ids(), 'stuck', "⚠️ {$r['name']} is still stuck (1 day, no answer)", $r['title'] . ': ' . $r['note'], '/#open=' . $r['task_id'], 'u' . $r['task_id']);
  }
}

/** Today's updates for the managers, once, after the "updates are due by" time. */
function evening_summary(): void {
  $day = today();
  if (date('H:i') < setting('fill_by', '18:00') || setting('sum_day') === $day) return;
  set_setting('sum_day', $day);
  $s = day_summary($day);
  if (!$s['due']) return;
  $body = [];
  if ($s['missing']) $body[] = 'No update: ' . implode(', ', $s['missing']);
  if ($s['stuck']) $body[] = 'Stuck: ' . implode(', ', $s['stuck']);
  notify(admin_ids(), $s['missing'] || $s['stuck'] ? 'stuck' : 'update', "📊 Today: {$s['sent']} of {$s['due']} updates in", $body ? implode(' · ', $body) : 'Everyone sent their update ✓', '/?team', 'sum');
}

/** Today in numbers: tasks due, updates sent, who has not sent, who is stuck (with days). */
function day_summary(string $day): array {
  $tasks = array_values(array_filter(tasks_out(all(TASK_SELECT . " WHERE t.status = 'open' OR t.done_at >= ?", [$day . ' 00:00:00']), $day),
    fn($t) => ($t['dueToday'] || $t['today']) && !($t['status'] === 'cancelled' && str_ends_with((string)$t['stepRef'], ':whole')))); // (a replaced whole-project task: its update counts on the step)
  $missing = []; $stuck = [];
  foreach ($tasks as $t) {
    if (!$t['today'] && $t['dueToday']) $missing[$t['assignee']['name']] = true;
    if ($t['stuck']) $stuck[$t['assignee']['name']] = true;
  }
  return ['due' => count($tasks), 'sent' => count(array_filter($tasks, fn($t) => (bool)$t['today'])), 'missing' => array_keys($missing), 'stuck' => array_keys($stuck)];
}

/** Called after each answer. The project part runs at once after a save; the rest at most every 10 minutes. */
function team_jobs(): void {
  $syncNow = !empty($GLOBALS['sync_projects']);
  $due = (int)setting('jobs_at', '0') <= time() - 600;
  $retryDue = ($r = (int)setting('sync_retry', '0')) && $r <= time();
  if (!$syncNow && !$due && !$retryDue) return;
  if (!(int)(one("SELECT GET_LOCK('wt_jobs', 0) AS l")['l'] ?? 0)) { // another request is doing it
    if ($syncNow) set_setting('sync_retry', (string)(time() + 5)); // this save's sync is owed: the next request runs it
    return;
  }
  $prev = $GLOBALS['me'] ?? null;
  try {
    $retry = (int)setting('sync_retry', '0');
    if ($retry && $retry <= time()) { set_setting('sync_retry', '0'); $syncNow = true; } // a project skipped minutes ago (see server_sync_projects)
    if ($syncNow || setting('dp_sync_day') !== today()) { set_setting('dp_sync_day', today()); server_sync_projects(); }
    if ($due) {
      set_setting('jobs_at', (string)time());
      $GLOBALS['me'] = ['id' => 0]; // the managers are told (nobody is "the one who did it")
      stuck_second_alerts();
      evening_summary();
    }
  } catch (Throwable $e) {
    error_log('team jobs: ' . $e->getMessage());
  } finally {
    $GLOBALS['me'] = $prev;
    q("SELECT RELEASE_LOCK('wt_jobs')");
  }
}
