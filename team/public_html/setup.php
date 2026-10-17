<?php
// One-time setup: the manager types the database password and makes the first (manager) account.
// Needs the setup code (kept in ../app/setup-code.txt, made by the installer). Afterwards it switches itself off.
declare(strict_types=1);

$app = dirname(__DIR__) . '/app';
require $app . '/bootstrap.php';

header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
$codeFile = SETUP_CODE_FILE;
$done = is_file(CONFIG_FILE);
$error = '';
$okMsg = '';
$v = fn(string $k, string $d = '') => htmlspecialchars((string)($_POST[$k] ?? $d), ENT_QUOTES);

if (!$done && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
  try {
    $code = is_file($codeFile) ? trim((string)file_get_contents($codeFile)) : '';
    if ($code === '' || !hash_equals($code, trim((string)($_POST['code'] ?? '')))) throw new Exception('The setup code is not right.');
    $dbName = trim((string)($_POST['db_name'] ?? ''));
    $dbUser = trim((string)($_POST['db_user'] ?? ''));
    $dbPass = (string)($_POST['db_pass'] ?? '');
    $name = trim((string)($_POST['name'] ?? ''));
    $user = strtolower(trim((string)($_POST['username'] ?? '')));
    $pass = (string)($_POST['password'] ?? '');
    if ($name === '') throw new Exception('Type your name.');
    if (!preg_match('/^[a-z0-9._-]{3,40}$/', $user)) throw new Exception('Username: 3 to 40 small letters or numbers, no spaces.');
    if (mb_strlen($pass) < 8) throw new Exception('Your password needs at least 8 characters.');
    if ($pass !== (string)($_POST['password2'] ?? '')) throw new Exception('The two passwords are not the same.');
    $dbHost = getenv('WT_DB_HOST') ?: 'localhost'; // only for testing on a computer
    try { $pdo = connect_db($dbHost, $dbName, $dbUser, $dbPass); }
    catch (Throwable $e) { throw new Exception('Could not open the database. Check the database name, user and password.'); }
    migrate($pdo);
    $st = $pdo->prepare("INSERT INTO users (username, name, role, pass_hash, must_change, active, created_at) VALUES (?, ?, 'admin', ?, 0, 1, ?)");
    $st->execute([$user, $name, password_hash($pass, PASSWORD_DEFAULT), now()]);
    // the first manager owns the projects from the start, so no other manager can ever reset or switch them off
    $pdo->prepare("INSERT INTO settings (k, v) VALUES ('dp_owner', ?) ON DUPLICATE KEY UPDATE v = v")->execute([(string)$pdo->lastInsertId()]);
    $cfg = "<?php\n// Made by setup.php. Keep private: it holds the database password.\nreturn " . var_export(['db_host' => $dbHost, 'db_name' => $dbName, 'db_user' => $dbUser, 'db_pass' => $dbPass], true) . ";\n";
    if (file_put_contents(CONFIG_FILE, $cfg) === false) throw new Exception('Could not save the settings file.');
    @chmod(CONFIG_FILE, 0600);
    @unlink($codeFile);
    if (!is_dir(UPLOAD_DIR)) @mkdir(UPLOAD_DIR, 0750, true);
    $done = true;
    $okMsg = 'All set. Your manager account is ready.';
  } catch (Throwable $e) {
    $error = $e->getMessage();
  }
}
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Work Task setup</title>
<link rel="stylesheet" href="styles.css">
</head>
<body>
<main class="narrow">
  <h1>Work Task setup</h1>
<?php if ($done): ?>
  <p class="ok"><?= htmlspecialchars($okMsg ?: 'This server is already set up.') ?></p>
  <p><a class="btn primary" href="./">Go to sign in</a></p>
<?php else: ?>
  <?php if ($error): ?><p class="err"><?= htmlspecialchars($error) ?></p><?php endif; ?>
  <form method="post" class="card stack" autocomplete="off">
    <label>Setup code (from Claude)<input name="code" required value="<?= $v('code') ?>"></label>
    <h2>Database (from Hostinger)</h2>
    <label>Database name<input name="db_name" required value="<?= $v('db_name', 'u578596396_worktask') ?>"></label>
    <label>Database user<input name="db_user" required value="<?= $v('db_user', 'u578596396_worktask') ?>"></label>
    <label>Database password<input name="db_pass" type="password" required></label>
    <h2>Your manager account</h2>
    <label>Your name<input name="name" required value="<?= $v('name') ?>" placeholder="Venkat"></label>
    <label>Username<input name="username" required value="<?= $v('username') ?>" placeholder="venkat" autocapitalize="none"></label>
    <label>Password (8 or more characters)<input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
    <label>Password again<input name="password2" type="password" required minlength="8" autocomplete="new-password"></label>
    <button class="btn primary" type="submit">Finish setup</button>
  </form>
<?php endif; ?>
</main>
</body>
</html>
