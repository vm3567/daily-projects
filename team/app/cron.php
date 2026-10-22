<?php
// The server's own work on a timer, for a Hostinger cron job every 5 minutes:
//   /usr/bin/php /home/u578596396/domains/worktask.in/app/cron.php
// It runs the same jobs as the requests do (given projects, Stuck alerts, the evening summary, the Outlook check,
// the project reminders) and sends the phone notifications. The jobs lock means cron and a request never run them together.
// Command line only: not reachable from the web (and refuses if it ever is).
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__ . '/bootstrap.php';
require __DIR__ . '/auth.php';
require __DIR__ . '/api.php';
require __DIR__ . '/dp.php';

if (!config()) { fwrite(STDERR, "The server is not set up yet.\n"); exit(1); }
$ran = team_jobs(true);
try { push_flush(); } catch (Throwable $e) { error_log('cron push: ' . $e->getMessage()); }
echo $ran ? "Jobs done.\n" : "Jobs are already running (skipped).\n";
