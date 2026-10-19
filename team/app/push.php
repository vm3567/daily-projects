<?php
// Phone notifications (Web Push), like new mail: the server sends a short, locked (encrypted) message
// to the phone's push service (Google for Android Chrome, Apple for iPhone, Mozilla for Firefox).
// No outside libraries: the locking (RFC 8291) and the server's signature (VAPID, RFC 8292) are done here.
// The server's own key pair is made once and kept in the settings table (never sent to a phone, only its public half).
declare(strict_types=1);

const PUSH_HOSTS = '~^https://(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/~';
const EC_PUB_DER_PREFIX = "\x30\x59\x30\x13\x06\x07\x2a\x86\x48\xce\x3d\x02\x01\x06\x08\x2a\x86\x48\xce\x3d\x03\x01\x07\x03\x42\x00";

function b64u(string $s): string { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
function b64u_dec(string $s): string { return (string)base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4), true); }

/** A phone's push address must be a real push service: the server never sends to any other address. */
function push_endpoint_ok(string $url): bool { return strlen($url) <= 1000 && (bool)preg_match(PUSH_HOSTS, $url); }

function ec_new(): OpenSSLAsymmetricKey {
  $k = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
  if (!$k) throw new RuntimeException('Could not make a key.');
  return $k;
}
/** The 65-byte public point (04 || x || y) of a key. */
function ec_raw_pub($key): string {
  $d = openssl_pkey_get_details($key)['ec'];
  return "\x04" . str_pad($d['x'], 32, "\0", STR_PAD_LEFT) . str_pad($d['y'], 32, "\0", STR_PAD_LEFT);
}
function ec_pub_from_raw(string $raw) {
  if (strlen($raw) !== 65 || $raw[0] !== "\x04") return false;
  $pem = "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode(EC_PUB_DER_PREFIX . $raw), 64, "\n") . "-----END PUBLIC KEY-----\n";
  return openssl_pkey_get_public($pem);
}

/** The server's key pair, made the first time it is needed. Returns [private PEM, public (base64url)]. */
function vapid_keys(): array {
  $v = setting('vapid', '');
  if ($v === '') {
    $k = ec_new();
    openssl_pkey_export($k, $pem);
    // two requests at the same moment: the first one wins, both use it
    q("INSERT IGNORE INTO settings (k, v) VALUES ('vapid', ?)", [json_encode(['priv' => $pem, 'pub' => b64u(ec_raw_pub($k))])]);
    $v = setting('vapid', '');
  }
  $j = json_decode($v, true);
  return [$j['priv'], $j['pub']];
}

/** The server's signature for one push service (a short ticket, good for 12 hours). */
function vapid_header(string $endpoint, string $privPem, string $pub, string $subject): string {
  $p = parse_url($endpoint);
  $aud = $p['scheme'] . '://' . $p['host'] . (isset($p['port']) ? ':' . $p['port'] : '');
  $data = b64u(json_encode(['typ' => 'JWT', 'alg' => 'ES256'])) . '.' . b64u(json_encode(['aud' => $aud, 'exp' => time() + 12 * 3600, 'sub' => $subject], JSON_UNESCAPED_SLASHES));
  if (!openssl_sign($data, $der, openssl_pkey_get_private($privPem), OPENSSL_ALGO_SHA256)) throw new RuntimeException('Could not sign.');
  return 'vapid t=' . $data . '.' . b64u(der_to_raw_sig($der)) . ', k=' . $pub;
}
/** openssl gives the signature in DER; push services want the plain 64 bytes (r || s). */
function der_to_raw_sig(string $der): string {
  $i = 2;
  if (ord($der[1]) & 0x80) $i += ord($der[1]) & 0x7f;
  $out = '';
  for ($n = 0; $n < 2; $n++) {
    $len = ord($der[$i + 1]);
    $int = ltrim(substr($der, $i + 2, $len), "\0");
    $out .= str_pad($int, 32, "\0", STR_PAD_LEFT);
    $i += 2 + $len;
  }
  return $out;
}

/** Lock the message so only that phone can read it (RFC 8291, aes128gcm). */
function push_encrypt(string $payload, string $uaPubRaw, string $authSecret): string {
  $uaPub = ec_pub_from_raw($uaPubRaw);
  if (!$uaPub || strlen($authSecret) !== 16) throw new RuntimeException('Bad phone keys.');
  $as = ec_new();
  $asPub = ec_raw_pub($as);
  $shared = openssl_pkey_derive($uaPub, $as);
  if ($shared === false) throw new RuntimeException('Could not lock the message.');
  $ikm = hash_hkdf('sha256', $shared, 32, "WebPush: info\0" . $uaPubRaw . $asPub, $authSecret);
  $salt = random_bytes(16);
  $cek = hash_hkdf('sha256', $ikm, 16, "Content-Encoding: aes128gcm\0", $salt);
  $nonce = hash_hkdf('sha256', $ikm, 12, "Content-Encoding: nonce\0", $salt);
  $ct = openssl_encrypt($payload . "\x02", 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $tag);
  return $salt . pack('N', 4096) . chr(65) . $asPub . $ct . $tag;
}

// ---------------------------------------------------------------- what to send, and to whom

/** Keep a message for these people; it goes out after the answer has been sent (so nothing waits for Google or Apple). */
function notify(array $userIds, string $kind, string $title, string $body, string $url = '/', string $tag = ''): void {
  $meId = (int)($GLOBALS['me']['id'] ?? 0);
  foreach (array_unique(array_map('intval', $userIds)) as $uid) {
    if ($uid <= 0 || $uid === $meId) continue; // never to the person who did it
    $GLOBALS['push_out'][$uid][] = ['kind' => $kind, 'title' => mb_substr($title, 0, 120), 'body' => mb_substr($body, 0, 240), 'url' => $url, 'tag' => $tag];
  }
}
/** The managers (all of them, signed in on any phone). */
function admin_ids(): array { return array_map(fn($r) => (int)$r['id'], all("SELECT id FROM users WHERE role = 'admin' AND active = 1")); }

/** Several things for one person in one go (a whole project, say): one notification, not twenty. */
function push_merge(array $list): array {
  if (count($list) === 1) return $list[0];
  $kind = in_array('task', array_column($list, 'kind'), true) ? 'task' : $list[0]['kind'];
  $lines = array_map(fn($m) => $m['title'] . ($m['body'] !== '' ? ': ' . $m['body'] : ''), $list);
  return ['kind' => $kind, 'title' => '🔔 ' . count($list) . ' new things in Work Task', 'body' => mb_substr(implode("\n", array_slice($lines, 0, 4)), 0, 240), 'url' => '/', 'tag' => 'many'];
}

/** Send what was kept. Called once the answer is on its way. Dead phone addresses are removed. */
function push_flush(): void {
  $out = $GLOBALS['push_out'] ?? [];
  $GLOBALS['push_out'] = [];
  if (!$out || !function_exists('curl_multi_init')) return;
  $ids = array_keys($out);
  $in = implode(',', array_fill(0, count($ids), '?'));
  $subs = all("SELECT s.* FROM push_subs s JOIN users u ON u.id = s.user_id WHERE u.active = 1 AND s.user_id IN ($in)", $ids);
  if (!$subs) return;
  if (($log = getenv('WT_PUSH_LOG')) !== false && $log !== '') { // tests only: write what would be sent, send nothing
    foreach ($subs as $s) file_put_contents($log, json_encode(['user' => (int)$s['user_id'], 'msg' => push_merge($out[(int)$s['user_id']])], JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND);
    return;
  }
  [$priv, $pub] = vapid_keys();
  $subject = 'https://' . preg_replace('/[^a-z0-9.:-]/i', '', $_SERVER['HTTP_HOST'] ?? 'worktask.in');
  $mh = curl_multi_init();
  $handles = [];
  foreach ($subs as $s) {
    if (!push_endpoint_ok($s['endpoint'])) continue;
    $msg = push_merge($out[(int)$s['user_id']]);
    try { $body = push_encrypt(json_encode($msg, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), b64u_dec($s['p256dh']), b64u_dec($s['auth'])); }
    catch (Throwable $e) { continue; }
    $ch = curl_init($s['endpoint']);
    curl_setopt_array($ch, [
      CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8, CURLOPT_CONNECTTIMEOUT => 4,
      CURLOPT_FOLLOWLOCATION => false, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
      CURLOPT_HTTPHEADER => ['Content-Type: application/octet-stream', 'Content-Encoding: aes128gcm', 'TTL: 86400', 'Urgency: high',
        'Authorization: ' . vapid_header($s['endpoint'], $priv, $pub, $subject)],
    ]);
    curl_multi_add_handle($mh, $ch);
    $handles[] = [$ch, (int)$s['id']];
  }
  do { $st = curl_multi_exec($mh, $running); if ($running) curl_multi_select($mh, 1.0); } while ($running && $st === CURLM_OK);
  foreach ($handles as [$ch, $id]) {
    $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    if ($code === 404 || $code === 410) q('DELETE FROM push_subs WHERE id = ?', [$id]); // the phone said no more (app removed, or turned off)
    elseif ($code >= 200 && $code < 300) q('UPDATE push_subs SET last_ok = ? WHERE id = ?', [now(), $id]);
    elseif ($code) error_log("push: $code from " . parse_url((string)curl_getinfo($ch, CURLINFO_EFFECTIVE_URL), PHP_URL_HOST));
    curl_multi_remove_handle($mh, $ch);
    curl_close($ch);
  }
  curl_multi_close($mh);
}

/** The API part: the public key, and this phone's address on / off. */
function push_handle(string $a, array $in, array $me): ?array {
  switch ($a) {
    case 'push.key':
      return ['key' => vapid_keys()[1]];
    case 'push.subscribe': {
      $ep = (string)($in['endpoint'] ?? '');
      $p256 = (string)($in['keys']['p256dh'] ?? '');
      $auth = (string)($in['keys']['auth'] ?? '');
      if (!push_endpoint_ok($ep) || strlen(b64u_dec($p256)) !== 65 || strlen(b64u_dec($auth)) !== 16) throw new ApiError('This phone cannot get notifications.');
      // one phone = one row; if someone else signs in on the same phone, it becomes theirs
      q('INSERT INTO push_subs (user_id, endpoint, ep_hash, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), p256dh = VALUES(p256dh), auth = VALUES(auth)',
        [$me['id'], $ep, hash('sha256', $ep), $p256, $auth, now()]);
      return ['on' => true];
    }
    case 'push.unsubscribe':
      q('DELETE FROM push_subs WHERE ep_hash = ? AND user_id = ?', [hash('sha256', (string)($in['endpoint'] ?? '')), $me['id']]);
      return ['on' => false];
    case 'push.test': {
      $n = (int)(one('SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ?', [$me['id']])['n'] ?? 0);
      if (!$n) throw new ApiError('Notifications are not on for this phone yet.');
      $GLOBALS['push_out'][$me['id']][] = ['kind' => 'task', 'title' => '🔔 Test from Work Task', 'body' => 'Notifications work on this phone.', 'url' => '/', 'tag' => 'test'];
      return ['phones' => $n];
    }
  }
  return null;
}
