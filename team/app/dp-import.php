<?php
// One-time move of Daily Projects from GitHub to this server. Run on the server:
//   php dp-import.php <folder with the data files> <username of the owner> [--replace]
// It saves every file in the folder as one new version and makes that person the owner.
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__ . '/bootstrap.php';
require __DIR__ . '/auth.php';
require __DIR__ . '/dp.php';

[$dir, $username] = [$argv[1] ?? '', strtolower($argv[2] ?? '')];
$replace = in_array('--replace', $argv, true);
if (!is_dir($dir) || $username === '') { fwrite(STDERR, "Usage: php dp-import.php <folder> <username> [--replace]\n"); exit(1); }
$user = one('SELECT * FROM users WHERE username = ?', [$username]);
if (!$user || $user['role'] !== 'admin') { fwrite(STDERR, "No manager account called $username\n"); exit(1); }
dp_migrate();
$owner = (int)setting('dp_owner', '0');
if ($owner && $owner !== (int)$user['id']) { fwrite(STDERR, "The projects already belong to someone else.\n"); exit(1); }
$count = (int)one('SELECT COUNT(*) AS n FROM dp_commits')['n'];
if ($count > 1 && !$replace) { fwrite(STDERR, "Projects are already here ($count versions). Add --replace to load this folder on top as a new version.\n"); exit(1); }

$files = [];
$it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS));
foreach ($it as $f) {
  $rel = ltrim(str_replace('\\', '/', substr($f->getPathname(), strlen(rtrim($dir, '/')))), '/');
  if ($rel === '' || str_starts_with($rel, '.git/') || $rel === '.git') continue;
  if (!dp_path_ok($rel)) { fwrite(STDERR, "Skipping odd name: $rel\n"); continue; }
  $files[$rel] = dp_put_blob((string)file_get_contents($f->getPathname()));
}
if (!isset($files['data.json'])) { fwrite(STDERR, "No data.json in that folder.\n"); exit(1); }
$parent = dp_head((int)$user['id']);
$changes = [];
$old = dp_tree_files(one('SELECT tree FROM dp_commits WHERE id = ?', [$parent])['tree']);
foreach ($old as $path => $sha) if (!isset($files[$path])) $changes[] = ['path' => $path, 'sha' => null];
foreach ($files as $path => $sha) $changes[] = ['path' => $path, 'sha' => $sha];
$r = dp_commit(['id' => (int)$user['id']], $parent, $changes, 'Moved from GitHub');
set_setting('dp_owner', (string)$user['id']);
echo 'Imported ' . count($files) . " files as version {$r['commit']}. Owner: $username\n";
foreach ($files as $path => $sha) echo "  $path  " . strlen(dp_get_blob($sha)) . " bytes  sha1 $sha\n";
