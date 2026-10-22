<?php
// The one address the team app talks to: /api/?a=<what>. The real work is in ../../app (not reachable from the web).
declare(strict_types=1);

$app = dirname(__DIR__, 2) . '/app';
require $app . '/bootstrap.php';
require $app . '/auth.php';
require $app . '/api.php';
require $app . '/dp.php';

// Daily Projects (the manager's own app) may ask too, with the manager's sign-in.
$allowed = ['https://vm3567.github.io', 'http://127.0.0.1:8080', 'http://localhost:8080'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $allowed, true)) {
  header("Access-Control-Allow-Origin: $origin");
  header('Vary: Origin');
  header('Access-Control-Allow-Headers: Authorization, Content-Type');
  header('Access-Control-Allow-Methods: GET, POST');
  header('Access-Control-Max-Age: 86400');
}
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }

header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

$a = (string)($_GET['a'] ?? '');
function send_dp_blob_safe(string $sha): void { dp_migrate(); dp_send_blob($sha); }
try {
  if ($a === 'photo' && ($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') { send_photo((int)($_GET['id'] ?? 0)); exit; }
  if ($a === 'task.file' && ($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') { send_task_file((int)($_GET['id'] ?? 0)); exit; }
  if ($a === 'comment.photo' && ($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') { send_comment_photo((int)($_GET['id'] ?? 0)); exit; }
  if ($a === 'dp.blob' && ($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') { send_dp_blob_safe((string)($_GET['sha'] ?? '')); exit; }
  $get = ($_SERVER['REQUEST_METHOD'] ?? '') === 'GET';
  if ($get && $a === 'connect.decisions') $in = ['since' => (string)($_GET['since'] ?? '')]; // 🔌 an app may also ask with GET
  elseif (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') throw new ApiError('Use POST.', 405);
  elseif (str_starts_with($_SERVER['CONTENT_TYPE'] ?? '', 'multipart/form-data')) $in = $_POST;
  else {
    $raw = (string)file_get_contents('php://input');
    $in = trim($raw) === '' ? [] : json_decode($raw, true);
    // never carry on with nothing in place of what was sent (a cut emoji, for example): say so instead
    if (!is_array($in)) throw new ApiError('The server could not read this request.', 400);
  }
  $out = handle($a, $in);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode(['ok' => true] + $out, JSON_UNESCAPED_UNICODE);
  // the answer goes first; then the server's own work (given projects, alerts) and the phone notifications
  if (function_exists('litespeed_finish_request')) litespeed_finish_request();
  elseif (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
  if (config()) team_jobs();
  try { push_flush(); } catch (Throwable $e) { error_log('push: ' . $e->getMessage()); }
} catch (ApiError $e) {
  http_response_code($e->status);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode(['ok' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
  error_log('team api: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
  http_response_code(500);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode(['ok' => false, 'error' => 'Something went wrong on the server. Try again in a minute.']);
}
