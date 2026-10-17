<?php
// Only for testing on this Mac (php -S … dev-router.php): /projects/… comes from ../docs, like on worktask.in.
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (str_starts_with($path, '/projects')) {
  $rel = substr($path, strlen('/projects')) ?: '/';
  if ($rel === '/') $rel = '/index.html';
  $file = realpath(__DIR__ . '/../docs' . $rel);
  if (!$file || !str_starts_with($file, realpath(__DIR__ . '/../docs')) || !is_file($file)) { http_response_code(404); echo 'Not found'; return true; }
  $types = ['js' => 'text/javascript', 'css' => 'text/css', 'html' => 'text/html', 'json' => 'application/json', 'png' => 'image/png', 'webmanifest' => 'application/manifest+json', 'svg' => 'image/svg+xml'];
  header('Content-Type: ' . ($types[pathinfo($file, PATHINFO_EXTENSION)] ?? 'application/octet-stream'));
  header('Cache-Control: no-store');
  readfile($file);
  return true;
}
return false; // everything else: the normal team files
