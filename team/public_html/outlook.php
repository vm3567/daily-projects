<?php
// Microsoft sends the owner back here after "Connect Outlook" (the Redirect URI: https://worktask.in/outlook.php).
// The real work is in ../app/outlook.php (not reachable from the web).
declare(strict_types=1);

$app = dirname(__DIR__) . '/app';
require $app . '/bootstrap.php';
require $app . '/auth.php';
require $app . '/api.php';
require $app . '/dp.php';

header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
header('Referrer-Policy: no-referrer'); // the sign-in code in this address never goes to another site
header('Content-Type: text/html; charset=utf-8');

[$ok, $words] = config() ? ol_callback($_GET) : [false, 'The server is not set up yet.'];
if (!$ok) http_response_code(400);
$e = fn(string $s) => htmlspecialchars($s, ENT_QUOTES);
?><!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Outlook · Work Task</title><link rel="stylesheet" href="styles.css"></head>
<body><main class="card stack">
<h1><?= $ok ? '📧 Outlook connected ✓' : '📧 Outlook not connected' ?></h1>
<p><?= $e($words) ?></p>
<p><a href="/?team">← Back to Work Task</a></p>
</main></body></html>
