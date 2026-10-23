<?php
// Sign in, sign out, passwords. Passwords are stored scrambled (password_hash); nobody can read them back.
declare(strict_types=1);

/** The computer's internet address. A phone or home line on IPv6 gets a whole block of addresses (a /64), so it counts as one place. */
function client_ip(): string {
  $ip = (string)($_SERVER['REMOTE_ADDR'] ?? '');
  if (!str_contains($ip, '.') && filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6)) $ip = inet_ntop(substr(inet_pton($ip), 0, 8) . str_repeat("\0", 8)) . '/64';
  return substr($ip, 0, 60);
}

/** True while this name from this computer, this name from anywhere, or this computer has had too many wrong passwords.
 *  $extra: tries already written for this attempt (counted before the slow password check, so tries sent at the same moment all count). */
function locked(string $username, int $extra = 0): bool {
  $since = date('Y-m-d H:i:s', time() - LOCK_MINUTES * 60);
  $count = fn(string $k) => (int)one('SELECT COUNT(*) AS n FROM login_fails WHERE k = ? AND at > ?', [$k, $since])['n'];
  // one name from every place: its tries from each address added up (a right password clears only that address's own,
  // so guesses spread over many addresses keep counting); (k = 'u:<name>': rows from before, kept until they expire)
  $name = 'u:' . $username;
  $everywhere = (int)one('SELECT COUNT(*) AS n FROM login_fails WHERE (k = ? OR LEFT(k, ?) = ?) AND at > ?', [$name, strlen($name) + 1, $name . '|', $since])['n'];
  return $count('u:' . $username . '|' . client_ip()) >= MAX_FAILS + $extra
    || $everywhere >= MAX_FAILS * 10 + $extra // a loose limit for one name from many places, so a stranger cannot easily lock someone out
    || $count('ip:' . client_ip()) >= MAX_FAILS * 10 + $extra; // a whole factory can share one internet address
}

/** A scrambled password nobody has, made the same way as real ones, so an unknown name takes as long as a real one. */
function dummy_hash(): string {
  $h = setting('dummy_hash', '');
  if ($h === '' || password_needs_rehash($h, PASSWORD_DEFAULT)) set_setting('dummy_hash', $h = password_hash(bin2hex(random_bytes(16)), PASSWORD_DEFAULT));
  return $h;
}

function clean_username(string $u): string { return strtolower(trim($u)); }
/** Every real username looks like this (setup and new accounts allow nothing else). */
function username_ok(string $u): bool { return preg_match('/^[a-z0-9._-]{3,40}$/', $u) === 1; }

/** Too many wrong tries: the error, the same everywhere. */
function too_many(): ApiError { return new ApiError('Too many wrong tries. Wait ' . LOCK_MINUTES . ' minutes and try again.', 429); }

function check_password_rules(string $p): void {
  if (mb_strlen($p) < 8) throw new ApiError('The password needs at least 8 characters.');
  if (mb_strlen($p) > 200) throw new ApiError('That password is too long.');
}

function login(string $username, string $password, string $device): array {
  $username = clean_username($username);
  if ($username === '' || $password === '') throw new ApiError('Type your username and password.');
  // a name no account can have (accents, '|', spaces…): only this computer's try is counted, so it can never
  // find a real account by a look-alike spelling, nor fill someone else's count
  if (!username_ok($username)) {
    if (locked('')) throw too_many();
    q('INSERT INTO login_fails (k, at) VALUES (?, ?)', ['ip:' . client_ip(), now()]);
    password_verify($password, dummy_hash()); // the same slow check, so it takes as long as a real name
    throw new ApiError('Wrong username or password.', 401);
  }
  if (locked($username)) throw too_many();
  // count this try first; it is taken off again below if the password is right
  $ids = [];
  foreach (['u:' . $username . '|' . client_ip(), 'ip:' . client_ip()] as $k) {
    q('INSERT INTO login_fails (k, at) VALUES (?, ?)', [$k, now()]);
    $ids[] = (int)db()->lastInsertId();
  }
  if (locked($username, 1)) throw too_many();
  $user = one('SELECT * FROM users WHERE username = ?', [$username]);
  if ($user && $user['username'] !== $username) $user = null; // the database ignores capitals and accents; only the exact name counts
  // the same slow check even for an unknown name, so nobody can find names by timing
  $ok = password_verify($password, $user['pass_hash'] ?? dummy_hash());
  if (!$user || !$ok) throw new ApiError('Wrong username or password.', 401);
  q('DELETE FROM login_fails WHERE k = ? OR id = ?', ['u:' . $username . '|' . client_ip(), $ids[1]]); // this address's tries, and this try off the computer's count
  if (!$user['active']) throw new ApiError('This account is switched off. Ask your manager.', 403);
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
  // the same limits as signing in, so a phone left signed in cannot be used to guess the password
  $keys = ['u:' . $me['username'] . '|' . client_ip(), 'ip:' . client_ip()];
  if (locked($me['username'])) throw too_many();
  // count this try first (as login() does), so tries sent at the same moment all count; taken off again if right
  $ids = [];
  foreach ($keys as $k) {
    q('INSERT INTO login_fails (k, at) VALUES (?, ?)', [$k, now()]);
    $ids[] = (int)db()->lastInsertId();
  }
  if (locked($me['username'], 1)) throw too_many();
  if (!password_verify($old, $me['pass_hash'])) throw new ApiError('Your current password is not right.');
  q('DELETE FROM login_fails WHERE k = ? OR id = ?', [$keys[0], $ids[1]]); // this address's tries only (guesses from elsewhere keep counting)
  check_password_rules($new);
  if ($old === $new) throw new ApiError('Choose a new password, not the same one.');
  q('UPDATE users SET pass_hash = ?, must_change = 0 WHERE id = ?', [password_hash($new, PASSWORD_DEFAULT), $me['id']]);
  q('DELETE FROM tokens WHERE user_id = ? AND id <> ?', [$me['id'], $GLOBALS['token_id']]); // sign out other phones
  q('DELETE FROM push_subs WHERE user_id = ?', [$me['id']]); // and their notifications (this phone links itself again right away)
  audit($me['id'], 'password_changed');
}

function logout(): void {
  if (isset($GLOBALS['token_id'])) q('DELETE FROM tokens WHERE id = ?', [$GLOBALS['token_id']]);
}
