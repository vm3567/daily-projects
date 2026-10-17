<?php
// Quick tests of the Work Task server's building blocks (no database needed).
// Run: php team/tests/unit.php   (npm test runs it too). Exit code 0 = all passed.
declare(strict_types=1);

$tmp = sys_get_temp_dir() . '/wt-unit-' . getmypid();
@mkdir($tmp, 0700, true);
putenv("WT_TEST_DIR=$tmp");

$app = dirname(__DIR__) . '/app';
require $app . '/bootstrap.php';
require $app . '/auth.php';
require $app . '/api.php';
require $app . '/dp.php';

$passed = 0;
$failed = [];
function check(string $name, bool $ok): void {
  global $passed, $failed;
  if ($ok) $passed++; else $failed[] = $name;
}
function throws(callable $fn, int $status = 0): bool {
  try { $fn(); } catch (ApiError $e) { return !$status || $e->status === $status; }
  return false;
}

// ---- the throwaway folder is used, never the real one
check('test folder is used for config and data', CONFIG_FILE === "$tmp/config.php" && UPLOAD_DIR === "$tmp/uploads" && DP_DIR === "$tmp/dpdata");

// ---- dates and days (India)
check('date_or_null: empty is null', date_or_null('') === null && date_or_null(null) === null);
check('date_or_null: a real date', date_or_null('2026-10-17') === '2026-10-17');
check('date_or_null: 30 February refused', throws(fn() => date_or_null('2026-02-30')));
check('date_or_null: wrong shape refused', throws(fn() => date_or_null('17-10-2026')));

$daily = ['repeat_kind' => 'daily', 'skip_sunday' => 1, 'weekday' => null, 'start_date' => '2026-10-01', 'seq' => null];
check('daily Mon-Sat: due on Saturday', due_on($daily, '2026-10-17'));
check('daily Mon-Sat: not due on Sunday', !due_on($daily, '2026-10-18'));
check('daily incl. Sunday: due on Sunday', due_on(['skip_sunday' => 0] + $daily, '2026-10-18'));
check('not due before its start day', !due_on($daily, '2026-09-30'));
$weekly = ['repeat_kind' => 'weekly', 'weekday' => 1] + $daily;
check('weekly Monday: due on Monday only', due_on($weekly, '2026-10-19') && !due_on($weekly, '2026-10-20'));
$once = ['repeat_kind' => 'once'] + $daily;
check('one-time: due every working day until finished', due_on($once, '2026-10-17') && due_on($once, '2026-10-20'));

// ---- text
check('txt: control characters removed, trimmed', txt("  Kiln\x07 check \x00 ", 100) === 'Kiln check');
check('txt: cut to the limit (letters, not bytes)', txt('ஆஆஆஆஆ', 3) === 'ஆஆஆ');
check('txt: required and empty refused', throws(fn() => txt('   ', 10, true)));

// ---- sign-in helpers
check('username: trimmed and small letters', clean_username('  Venkat ') === 'venkat');
check('username rules', username_ok('valar.k') && !username_ok('va') && !username_ok('a b') && !username_ok('vénkat') && !username_ok('a|b'));
check('password: 8 characters needed', throws(fn() => check_password_rules('short')) && !throws(fn() => check_password_rules('long-enough')));
$_SERVER['REMOTE_ADDR'] = '2001:db8:aa:bb:1:2:3:4';
$a = client_ip();
$_SERVER['REMOTE_ADDR'] = '2001:db8:aa:bb:9:9:9:9';
check('IPv6: one /64 network counts as one place', $a === client_ip() && str_ends_with($a, '/64'));
$_SERVER['REMOTE_ADDR'] = '103.21.5.9';
check('IPv4 kept as it is', client_ip() === '103.21.5.9');

// ---- ids from the phone (once-only)
check('client_id: good id kept', client_id('ab12cd34-ef56') === 'ab12cd34-ef56');
check('client_id: bad ids ignored', client_id('x') === null && client_id('../../etc') === null && client_id(123) === null);

// ---- project storage: file names and fingerprints
check('path ok: normal names', dp_path_ok('data.json') && dp_path_ok('history/2026-10.json') && dp_path_ok('files/ab12/photo (1).jpg'));
check('path refused: going up or hidden tricks', !dp_path_ok('../x') && !dp_path_ok('a/../b') && !dp_path_ok('/etc/passwd') && !dp_path_ok('a//b') && !dp_path_ok('./a') && !dp_path_ok(''));
check('sha check', dp_valid_sha(str_repeat('a', 40)) && !dp_valid_sha(str_repeat('a', 39)) && !dp_valid_sha(str_repeat('G', 40)));

$text = str_repeat('{"projects":[]} ', 2000);
$sha = dp_put_blob($text);
check('text blob: saved squeezed (gzip) and read back the same', is_file(dp_blob_path($sha) . '.gz') && dp_get_blob($sha) === $text);
check('same content = same fingerprint, stored once', dp_put_blob($text) === $sha && $sha === sha1($text));
$bin = random_bytes(5000);
$bsha = dp_put_blob($bin);
check('photo-like blob: stored as it is, read back the same', is_file(dp_blob_path($bsha)) && dp_get_blob($bsha) === $bin);
check('missing blob: clear error', throws(fn() => dp_get_blob(str_repeat('0', 40)), 404));
file_put_contents(dp_blob_path($sha) . '.gz', 'not gzip');
check('damaged blob: refused, never empty text', throws(fn() => dp_get_blob($sha)));

// ---- photos: made smaller, turned to JPEG, details removed
if (function_exists('imagecreatetruecolor')) {
  $im = imagecreatetruecolor(3000, 2000);
  imagefill($im, 0, 0, imagecolorallocate($im, 200, 60, 30));
  $png = "$tmp/big.png";
  imagepng($im, $png);
  $jpeg = shrink_photo($png, 'image/png');
  $info = getimagesizefromstring($jpeg);
  check('photo: shrunk to 1600 px and saved as JPEG', $info && $info[0] === 1600 && $info[1] === 1067 && $info['mime'] === 'image/jpeg');
  file_put_contents("$tmp/fake.png", 'not an image');
  check('fake photo: refused', throws(fn() => shrink_photo("$tmp/fake.png", 'image/png')));
}

// ---- clean up
$rm = function (string $d) use (&$rm) { foreach (glob("$d/{,.}*", GLOB_BRACE) ?: [] as $f) { if (in_array(basename($f), ['.', '..'], true)) continue; is_dir($f) ? $rm($f) : unlink($f); } @rmdir($d); };
$rm($tmp);

echo "PHP unit tests: $passed passed, " . count($failed) . " failed\n";
foreach ($failed as $f) echo "  FAIL $f\n";
exit($failed ? 1 : 0);
