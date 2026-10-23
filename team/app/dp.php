<?php
// Daily Projects storage on this server. It works like the GitHub data repository it replaces:
// files are kept by the fingerprint of their content (never changed, never deleted), and every save
// is a version (commit) on top of the one before. If another computer saved first, the save is
// refused (409) and the app loads the newest version and tries again, exactly as with GitHub.
// Only the owner of the projects (settings.dp_owner) can reach any of it.
declare(strict_types=1);

define('DP_DIR', ROOT_DIR . '/dpdata');
const DP_MAX_BLOB = 40 * 1024 * 1024;

function dp_migrate(): void {
  static $done = false;
  if ($done) return;
  q("CREATE TABLE IF NOT EXISTS dp_commits (
    id CHAR(40) PRIMARY KEY, parent CHAR(40) NULL, tree CHAR(40) NOT NULL,
    message VARCHAR(300) NOT NULL DEFAULT '', user_id INT NULL, at DATETIME NOT NULL, INDEX (at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  q("CREATE TABLE IF NOT EXISTS dp_trees (id CHAR(40) PRIMARY KEY, files MEDIUMTEXT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  $done = true;
}

function dp_owner_check(array $me): void {
  $owner = (int)setting('dp_owner', '0');
  if (!$owner || $owner !== $me['id']) throw new ApiError('These projects belong to someone else.', 403);
}

function dp_blob_path(string $sha): string { return DP_DIR . '/blobs/' . substr($sha, 0, 2) . '/' . $sha; }

function dp_valid_sha($s): bool { return is_string($s) && preg_match('/^[a-f0-9]{40}$/', $s) === 1; }

/** Keep these bytes; returns their fingerprint. Text is kept squeezed (gzip) to save space. */
function dp_put_blob(string $bytes): string {
  if (strlen($bytes) > DP_MAX_BLOB) throw new ApiError('That file is too big.');
  $sha = sha1($bytes);
  $path = dp_blob_path($sha);
  if (is_file($path) || is_file($path . '.gz')) {
    try { dp_get_blob($sha); return $sha; } // already kept and whole
    catch (ApiError $e) { @unlink($path); @unlink($path . '.gz'); } // damaged: write it again
  }
  if (!is_dir(dirname($path))) mkdir(dirname($path), 0750, true);
  $gz = gzencode($bytes, 6);
  [$file, $data] = strlen($gz) < strlen($bytes) * 0.9 ? [$path . '.gz', $gz] : [$path, $bytes];
  $tmp = $file . '.' . bin2hex(random_bytes(4)) . '.tmp';
  if (file_put_contents($tmp, $data) === false || !rename($tmp, $file)) throw new ApiError('Could not save the file. Try again.', 500);
  return $sha;
}

function dp_blob_exists(string $sha): bool { $p = dp_blob_path($sha); return is_file($p) || is_file($p . '.gz'); }

function dp_get_blob(string $sha): string {
  $p = dp_blob_path($sha);
  if (is_file($p . '.gz')) $b = @gzdecode((string)file_get_contents($p . '.gz'));
  elseif (is_file($p)) $b = file_get_contents($p);
  else throw new ApiError('File not found.', 404);
  if ($b === false || sha1($b) !== $sha) throw new ApiError('Stored file is damaged.', 500); // never hand out a broken file as empty
  return $b;
}

function dp_tree_files(string $treeId): array {
  $t = one('SELECT files FROM dp_trees WHERE id = ?', [$treeId]);
  if (!$t) throw new ApiError('Version not found.', 404);
  return json_decode($t['files'], true) ?: [];
}

function dp_save_tree(array $files): string {
  ksort($files);
  $json = json_encode($files, JSON_UNESCAPED_SLASHES | JSON_FORCE_OBJECT);
  $id = sha1($json);
  q('INSERT IGNORE INTO dp_trees (id, files) VALUES (?, ?)', [$id, $json]);
  return $id;
}

/** The newest version; the very first time, an empty one. */
function dp_head(?int $userId = null): string {
  $head = setting('dp_head');
  if ($head !== '') return $head;
  $tree = dp_save_tree(['README.md' => dp_put_blob("# Daily Projects data\n")]);
  $id = sha1(random_bytes(20));
  q('INSERT INTO dp_commits (id, parent, tree, message, user_id, at) VALUES (?, NULL, ?, ?, ?, ?)', [$id, $tree, 'Start', $userId, now()]);
  set_setting('dp_head', $id);
  return $id;
}

function dp_path_ok(string $p): bool {
  return strlen($p) <= 300 && preg_match('#^[A-Za-z0-9._ ()-]+(/[A-Za-z0-9._ ()-]+)*$#', $p) === 1 && !preg_match('#(^|/)\.\.?(/|$)#', $p);
}

/**
 * Make one version on top of `parent`. Throws 409 when another computer saved first.
 * $alsoInTx: more database writes that must be saved with this version or not at all (e.g. "these emails are in").
 */
function dp_commit(array $me, string $parent, array $changes, string $message, ?callable $alsoInTx = null): array {
  if (!dp_valid_sha($parent)) throw new ApiError('Bad version.');
  if (count($changes) > 500) throw new ApiError('Too many changes at once.');
  // write new text files first (outside the lock: they are content-addressed, so harmless if unused)
  $plan = [];
  foreach ($changes as $c) {
    $path = (string)($c['path'] ?? '');
    if (!dp_path_ok($path)) throw new ApiError('Bad file name.');
    if (array_key_exists('content', $c)) $plan[$path] = dp_put_blob((string)$c['content']);
    elseif (($c['sha'] ?? null) === null) $plan[$path] = null;
    elseif (dp_valid_sha($c['sha']) && dp_blob_exists($c['sha'])) $plan[$path] = $c['sha'];
    else throw new ApiError('A file for this save is missing. Try again.');
  }
  $pdo = db();
  $pdo->beginTransaction();
  try {
    $row = one("SELECT v FROM settings WHERE k = 'dp_head' FOR UPDATE");
    if (!$row || $row['v'] !== $parent) { $pdo->rollBack(); throw new ApiError('Another device saved first.', 409); }
    $p = one('SELECT tree FROM dp_commits WHERE id = ?', [$parent]);
    $files = dp_tree_files($p['tree']);
    foreach ($plan as $path => $sha) { if ($sha === null) unset($files[$path]); else $files[$path] = $sha; }
    $tree = dp_save_tree($files);
    $id = sha1(random_bytes(20));
    q('INSERT INTO dp_commits (id, parent, tree, message, user_id, at) VALUES (?, ?, ?, ?, ?, ?)', [$id, $parent, $tree, mb_substr($message, 0, 300), $me['id'], now()]);
    q("UPDATE settings SET v = ? WHERE k = 'dp_head'", [$id]);
    if ($alsoInTx) $alsoInTx();
    $pdo->commit();
    return ['commit' => $id, 'tree' => $tree];
  } catch (ApiError $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    throw $e;
  } catch (Throwable $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    throw $e;
  }
}

/** dp.* requests. Returns null when `a` is not one of them. */
function dp_handle(string $a, array $in, array $me): ?array {
  if (!str_starts_with($a, 'dp.')) return null;
  dp_owner_check($me);
  dp_migrate();
  switch ($a) {
    case 'dp.head':
      return ['head' => dp_head($me['id'])];
    case 'dp.snapshot': {
      $id = (string)($in['commit'] ?? '') ?: dp_head($me['id']);
      if (!dp_valid_sha($id)) throw new ApiError('Bad version.');
      $c = one('SELECT tree FROM dp_commits WHERE id = ?', [$id]);
      if (!$c) throw new ApiError('Version not found.', 404);
      return ['commit' => $id, 'tree' => $c['tree'], 'entries' => (object)dp_tree_files($c['tree'])];
    }
    case 'dp.blobPut': {
      // no file at all (the request was cut off or too big for the server): an error, never an empty file
      $bytes = is_string($in['base64'] ?? null) ? base64_decode($in['base64'], true) : false;
      if ($bytes === false) throw new ApiError('The file did not arrive. Try again.');
      return ['sha' => dp_put_blob($bytes)];
    }
    case 'dp.commit':
      $r = dp_commit($me, (string)($in['parent'] ?? ''), (array)($in['changes'] ?? []), (string)($in['message'] ?? ''));
      $GLOBALS['sync_projects'] = true; // after the answer: given projects follow what was saved
      return $r;
    case 'dp.versions': { // for "go back to an earlier day": newest first, by following each version to the one before
      $rows = [];
      $id = dp_head($me['id']);
      for ($n = max(1, min(500, (int)($in['limit'] ?? 100))); $id && count($rows) < $n; $id = $c['parent']) {
        $c = one('SELECT id, parent, message, at FROM dp_commits WHERE id = ?', [$id]);
        if (!$c) break;
        $rows[] = ['id' => $c['id'], 'message' => $c['message'], 'at' => $c['at']];
      }
      return ['versions' => $rows];
    }
  }
  throw new ApiError('Unknown request.', 404);
}

/** GET ?a=dp.blob&sha=…: the file itself. It never changes, so the browser may keep it. */
function dp_send_blob(string $sha): void {
  $me = current_user();
  dp_owner_check($me);
  if (!dp_valid_sha($sha)) throw new ApiError('Bad file.', 400);
  $bytes = dp_get_blob($sha);
  header('Content-Type: application/octet-stream');
  header('Cache-Control: private, max-age=31536000, immutable'); header('Vary: Authorization', false); // only for the same sign-in
  header('Content-Length: ' . strlen($bytes));
  echo $bytes;
}
