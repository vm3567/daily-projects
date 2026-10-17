<?php
// Sign in, sign out, passwords. Passwords are stored scrambled (password_hash); nobody can read them back.
declare(strict_types=1);

function client_ip(): string { return substr($_SERVER['REMOTE_ADDR'] ?? '', 0, 60); }

/** True while this name or this computer has had too many wrong passwords. */
function locked(string $username): bool {
  $since = date('Y-m-d H:i:s', time() - LOCK_MINUTES * 60);
  $count = fn(string $k) => (int)one('SELECT COUNT(*) AS n FROM login_fails WHERE k = ? AND at > ?', [$k, $since])['n'];
  return $count('u:' . $username) >= MAX_FAILS || $count('ip:' . client_ip()) >= MAX_FAILS * 10; // a whole factory can share one internet address
}

function clean_username(string $u): string { return strtolower(trim($u)); }

function check_password_rules(string $p): void {
  if (mb_strlen($p) < 8) throw new ApiError('The password needs at least 8 characters.');
  if (mb_strlen($p) > 200) throw new ApiError('That password is too long.');
}

function login(string $username, string $password, string $device): array {
  $username = clean_username($username);
  if ($username === '' || $password === '') throw new ApiError('Type your username and password.');
  if (locked($username)) throw new ApiError('Too many wrong tries. Wait ' . LOCK_MINUTES . ' minutes and try again.', 429);
  $user = one('SELECT * FROM users WHERE username = ?', [$username]);
  // the same slow check even for an unknown name, so nobody can find names by timing
  $ok = password_verify($password, $user['pass_hash'] ?? password_hash('not a real password', PASSWORD_DEFAULT));
  if (!$user || !$ok) {
    q('INSERT INTO login_fails (k, at) VALUES (?, ?), (?, ?)', ['u:' . $username, now(), 'ip:' . client_ip(), now()]);
    throw new ApiError('Wrong username or password.', 401);
  }
  if (!$user['active']) throw new ApiError('This account is switched off. Ask your manager.', 403);
  q('DELETE FROM login_fails WHERE k = ?', ['u:' . $username]);
  if (password_needs_rehash($user['pass_hash'], PASSWORD_DEFAULT)) {
    q('UPDATE users SET pass_hash = ? WHERE id = ?', [password_hash($password, PASSWORD_DEFAULT), $user['id']]);
  }
  $token = bin2hex(random_bytes(32));
  q('INSERT INTO tokens (user_id, token_hash, device, created_at, last_used) VALUES (?, ?, ?, ?, ?)',
    [$user['id'], hash('sha256', $token), mb_substr($device, 0, 160), now(), now()]);
  q('UPDATE users SET last_login = ? WHERE id = ?', [now(), $user['id']]);
  audit((int)$user['id'], 'login', $device);
  return ['token' => $token, 'user' => public_user($user)];
}

/** The signed-in person for this request, from the "Authorization: Bearer …" line. */
function current_user(): array {
  $h = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
  if (!preg_match('/^Bearer\s+([a-f0-9]{64})$/', $h, $m)) throw new ApiError('Please sign in.', 401);
  $hash = hash('sha256', $m[1]);
  $row = one('SELECT t.id AS token_id, t.last_used, u.* FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?', [$hash]);
  if (!$row || strtotime($row['last_used']) < time() - TOKEN_DAYS * 86400) throw new ApiError('Please sign in again.', 401);
  if (!$row['active']) throw new ApiError('This account is switched off. Ask your manager.', 403);
  if (strtotime($row['last_used']) < time() - 3600) q('UPDATE tokens SET last_used = ? WHERE id = ?', [now(), $row['token_id']]);
  $row['id'] = (int)$row['id'];
  $GLOBALS['token_id'] = (int)$row['token_id'];
  return $row;
}

function require_admin(array $me): void {
  if ($me['role'] !== 'admin') throw new ApiError('Only the manager can do this.', 403);
}

function public_user(array $u): array {
  return [
    'id' => (int)$u['id'], 'username' => $u['username'], 'name' => $u['name'], 'role' => $u['role'],
    'mustChange' => (bool)$u['must_change'], 'active' => (bool)$u['active'], 'lastLogin' => $u['last_login'] ?? null,
    'owner' => (int)$u['id'] === (int)setting('dp_owner', '0'), // owns the Daily Projects
  ];
}

function change_password(array $me, string $old, string $new): void {
  if (!password_verify($old, $me['pass_hash'])) throw new ApiError('Your current password is not right.');
  check_password_rules($new);
  if ($old === $new) throw new ApiError('Choose a new password, not the same one.');
  q('UPDATE users SET pass_hash = ?, must_change = 0 WHERE id = ?', [password_hash($new, PASSWORD_DEFAULT), $me['id']]);
  q('DELETE FROM tokens WHERE user_id = ? AND id <> ?', [$me['id'], $GLOBALS['token_id']]); // sign out other phones
  audit($me['id'], 'password_changed');
}

function logout(): void {
  if (isset($GLOBALS['token_id'])) q('DELETE FROM tokens WHERE id = ?', [$GLOBALS['token_id']]);
}
