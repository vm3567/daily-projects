<?php
// Daily Projects from the command line, for Claude's /today, /add, /review-projects and /restore on the Mac
// (they run this over SSH, see tools/tracker.mjs). Not reachable from the web.
//   php dp-cli.php export                 → {"head", "files": {path: text}} (data.json and history/*.json)
//   php dp-cli.php commit                 ← stdin {"parent", "changes": [...], "message"}; → {"commit"}; exit 3 if another device saved first
//   php dp-cli.php before <YYYY-MM-DD>    → {"commit", "at"} the last version saved on or before that day
//   php dp-cli.php tree <commit>          → {path: sha}
//   php dp-cli.php cat <commit> <path>    → the file's text at that version
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__ . '/bootstrap.php';
require __DIR__ . '/auth.php';
require __DIR__ . '/dp.php';
require __DIR__ . '/api.php';

function out($v): void { echo json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), "\n"; }
function fail(string $m, int $code = 1): void { fwrite(STDERR, $m . "\n"); exit($code); }

$owner = (int)setting('dp_owner', '0');
if (!$owner) fail('No projects on this server yet.');
dp_migrate();
$me = ['id' => $owner];
$cmd = $argv[1] ?? '';
try {
  switch ($cmd) {
    case 'export': {
      $head = dp_head($owner);
      $files = dp_tree_files(one('SELECT tree FROM dp_commits WHERE id = ?', [$head])['tree']);
      $text = [];
      foreach ($files as $path => $sha) if ($path === 'data.json' || preg_match('#^history/\d{4}-\d{2}\.json$#', $path)) $text[$path] = dp_get_blob($sha);
      out(['head' => $head, 'files' => $text]);
      break;
    }
    case 'commit': {
      $in = json_decode((string)stream_get_contents(STDIN), true);
      if (!is_array($in)) fail('Bad input.');
      try {
        $r = dp_commit($me, (string)($in['parent'] ?? ''), (array)($in['changes'] ?? []), (string)($in['message'] ?? 'via Claude'));
        try { server_sync_projects(); push_flush(); } catch (Throwable $e) { /* the team lists catch up on the next save */ }
      } catch (ApiError $e) {
        if ($e->status === 409) fail('Another device saved first.', 3);
        throw $e;
      }
      out($r);
      break;
    }
    case 'before': {
      $date = $argv[2] ?? '';
      if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) fail('Give a date like 2026-10-09.');
      // follow the versions back from the newest (two saves in the same second keep their real order)
      for ($id = dp_head($owner), $c = null; $id; $id = $c['parent']) {
        $c = one('SELECT id, parent, at FROM dp_commits WHERE id = ?', [$id]);
        if (!$c || $c['at'] <= $date . ' 23:59:59') break;
      }
      out($c && $c['at'] <= $date . ' 23:59:59' ? ['commit' => $c['id'], 'at' => $c['at']] : null);
      break;
    }
    case 'tree': {
      $c = one('SELECT tree FROM dp_commits WHERE id = ?', [$argv[2] ?? '']);
      if (!$c) fail('No such version.');
      out((object)dp_tree_files($c['tree']));
      break;
    }
    case 'cat': {
      $c = one('SELECT tree FROM dp_commits WHERE id = ?', [$argv[2] ?? '']);
      if (!$c) fail('No such version.');
      $files = dp_tree_files($c['tree']);
      $path = $argv[3] ?? '';
      if (!isset($files[$path])) fail('No such file in that version.');
      echo dp_get_blob($files[$path]);
      break;
    }
    default:
      fail('Commands: export | commit | before <date> | tree <commit> | cat <commit> <path>');
  }
} catch (ApiError $e) {
  fail($e->getMessage());
}
