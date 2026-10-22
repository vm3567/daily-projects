<?php
// Outlook → Daily Projects Inbox. The owner connects their Outlook once (Microsoft sign-in); after that, every new email
// in their Outlook Inbox becomes one item in the Daily Projects 📥 Inbox (replies in the same thread join that item).
// No AI. Only the subject, the sender, the time, the first lines (bodyPreview) and the link to open it in Outlook are read:
// never attachments, never the whole email.
//
// Secrets (the client secret and the Microsoft sign-in) are kept locked (AES-256-GCM) in the settings table, with a key
// kept in config.php (never in git). They are never sent to the browser, never written in error messages or logs.
declare(strict_types=1);

const OL_SCOPES = 'offline_access User.Read Mail.ReadWrite'; // ReadWrite: for a later "draft a reply" (never sending)
const OL_EVERY = 600;        // check at most every 10 minutes (plus "Check now")
const OL_PAGES = 5;          // pages of 50 emails per check
const OL_STATE_SECONDS = 600; // the sign-in must come back within 10 minutes

class OlError extends Exception {}

// ---------------------------------------------------------------- addresses (tests point them at a fake Microsoft)

/** WT_MS_BASE: only for the automatic tests (with WT_TEST_DIR); never set on the live server. */
function ol_fake_base(): string { return TEST_DIR !== '' ? rtrim((string)(getenv('WT_MS_BASE') ?: ''), '/') : ''; }
function ol_login_base(): string { return ol_fake_base() ?: 'https://login.microsoftonline.com'; }
function ol_graph_base(): string { return ol_fake_base() ?: 'https://graph.microsoft.com'; }

/** The address Microsoft sends the owner back to: https://worktask.in/outlook.php (http only for this computer). */
function ol_redirect_uri(): string {
  $host = strtolower((string)($_SERVER['HTTP_HOST'] ?? ''));
  if (!preg_match('/^([a-z0-9.-]+|\[::1\])(:\d{1,5})?$/', $host)) $host = 'worktask.in';
  $name = preg_replace('/:\d+$/', '', $host);
  $local = in_array($name, ['127.0.0.1', 'localhost', '[::1]'], true);
  return ($local ? 'http' : 'https') . '://' . $host . '/outlook.php';
}

// ---------------------------------------------------------------- the lock for secrets

/** The key, from config.php; made once (and added to config.php) the first time it is needed. */
function ol_key(): string {
  static $k = null;
  if ($k !== null) return $k;
  $raw = (string)((config() ?? [])['enc_key'] ?? '');
  if ($raw === '') {
    if (!(int)(one("SELECT GET_LOCK('wt_key', 10) AS l")['l'] ?? 0)) throw new OlError('The server is busy. Try again.');
    try {
      $c = is_file(CONFIG_FILE) ? (require CONFIG_FILE) : null; // read again: another request may have just made it
      if (!is_array($c)) throw new OlError('The server is not set up yet.');
      $raw = (string)($c['enc_key'] ?? '');
      if ($raw === '') {
        $raw = bin2hex(random_bytes(32));
        $c['enc_key'] = $raw;
        $text = "<?php\n// Made by setup.php. Keep private: it holds the database password and the key that locks saved sign-ins.\nreturn " . var_export($c, true) . ";\n";
        $tmp = CONFIG_FILE . '.' . bin2hex(random_bytes(4)) . '.tmp';
        $perm = @fileperms(CONFIG_FILE);
        if (file_put_contents($tmp, $text) === false || !@chmod($tmp, $perm ? $perm & 0777 : 0600) || !rename($tmp, CONFIG_FILE)) {
          @unlink($tmp);
          throw new OlError('Could not save the lock key on the server.');
        }
        if (function_exists('opcache_invalidate')) @opcache_invalidate(CONFIG_FILE, true);
      }
    } finally {
      q("SELECT RELEASE_LOCK('wt_key')");
    }
  }
  return $k = hash('sha256', 'wt-outlook|' . $raw, true);
}

function ol_seal(string $plain): string {
  $iv = random_bytes(12);
  $tag = '';
  $ct = openssl_encrypt($plain, 'aes-256-gcm', ol_key(), OPENSSL_RAW_DATA, $iv, $tag);
  if ($ct === false) throw new OlError('Could not lock the secret.');
  return 'v1:' . base64_encode($iv . $tag . $ct);
}

/** The secret, or '' when there is none (or it cannot be opened: a changed key, say). */
function ol_open(string $box): string {
  if (!str_starts_with($box, 'v1:')) return '';
  $b = base64_decode(substr($box, 3), true);
  if ($b === false || strlen($b) < 29) return '';
  $p = openssl_decrypt(substr($b, 28), 'aes-256-gcm', ol_key(), OPENSSL_RAW_DATA, substr($b, 0, 12), substr($b, 12, 16));
  return $p === false ? '' : $p;
}

// ---------------------------------------------------------------- talking to Microsoft

/** [status, json]. Never follows redirects; the token is only sent to Microsoft's own address. $json: a JSON POST body. */
function ol_http(string $url, ?array $form = null, ?string $bearer = null, ?array $json = null, array $extra = []): array {
  $ch = curl_init($url);
  $h = ['Accept: application/json', ...$extra];
  if ($bearer !== null) $h[] = 'Authorization: Bearer ' . $bearer;
  if ($json !== null) $h[] = 'Content-Type: application/json';
  curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_HTTPHEADER => $h, CURLOPT_FOLLOWLOCATION => false]);
  if ($form !== null) { curl_setopt($ch, CURLOPT_POST, true); curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($form, '', '&')); }
  if ($json !== null) { curl_setopt($ch, CURLOPT_POST, true); curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($json, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE)); }
  $body = curl_exec($ch);
  $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
  if ($body === false) throw new OlError('Could not reach Microsoft. It will try again.');
  $j = json_decode((string)$body, true);
  return [$code, is_array($j) ? $j : []];
}

/** Microsoft's refusal in plain words (from its error codes only: nothing it sent back is shown as it is). */
function ol_ms_error(array $j): string {
  $e = (string)($j['error'] ?? '');
  $d = (string)($j['error_description'] ?? '');
  if ($e === 'consent_required' || preg_match('/AADSTS(65001|65004|90094|90095)\b/', $d)) return 'Microsoft says: needs admin approval — ask IT';
  if ($e === 'access_denied') return 'Microsoft says: the sign-in was not allowed. Press Connect again (or ask IT)';
  if (preg_match('/AADSTS(7000215|7000222|7000218)\b/', $d) || $e === 'invalid_client') return 'Microsoft says: the client secret is wrong or has expired — make a new one and save it here';
  if (preg_match('/AADSTS700016\b/', $d) || $e === 'unauthorized_client') return 'Microsoft says: the Application (client) ID was not found — check it';
  if (preg_match('/AADSTS(90002|900023)\b/', $d)) return 'Microsoft says: the Directory (tenant) ID was not found — check it';
  if (preg_match('/AADSTS50011\b/', $d)) return 'Microsoft says: the Redirect URI is not registered in the app — add it exactly as shown';
  if ($e === 'invalid_grant') return 'Sign-in expired — press Connect again';
  return 'Microsoft says: ' . (preg_match('/^[a-z_]{1,40}$/', $e) ? str_replace('_', ' ', $e) : 'something went wrong') . '. Try again';
}

function ol_token_url(): string { return ol_login_base() . '/' . rawurlencode(setting('ol_tenant')) . '/oauth2/v2.0/token'; }

/** A fresh access token from the saved sign-in (a new sign-in Microsoft hands back is saved). */
function ol_access_token(): string {
  $refresh = ol_open(setting('ol_refresh'));
  if ($refresh === '') throw new OlError('Sign-in expired — press Connect again');
  [$code, $j] = ol_http(ol_token_url(), [
    'client_id' => setting('ol_client'), 'client_secret' => ol_open(setting('ol_secret')),
    'grant_type' => 'refresh_token', 'refresh_token' => $refresh, 'scope' => OL_SCOPES,
  ]);
  if ($code !== 200 || !is_string($j['access_token'] ?? null) || $j['access_token'] === '') {
    $msg = ol_ms_error($j);
    if (($j['error'] ?? '') === 'invalid_grant') q("DELETE FROM settings WHERE k = 'ol_refresh'"); // no use any more: Connect again
    throw new OlError($msg);
  }
  if (is_string($j['refresh_token'] ?? null) && $j['refresh_token'] !== '' && $j['refresh_token'] !== $refresh) set_setting('ol_refresh', ol_seal($j['refresh_token']));
  return $j['access_token'];
}

function ol_graph_error(int $code): OlError {
  if ($code === 401) return new OlError('Sign-in expired — press Connect again');
  if ($code === 403) return new OlError('Microsoft says: needs admin approval — ask IT');
  return new OlError("Microsoft did not answer (error $code). It will try again.");
}

/** New emails in the Inbox since `since` (oldest first), a few pages at most. */
function ol_fetch(string $token, string $since): array {
  $all = ol_list($token, 'inbox', 'id,subject,from,receivedDateTime,bodyPreview,webLink,conversationId', 'receivedDateTime', $since);
  return array_values(array_filter($all, fn($m) => is_string($m['id'] ?? null) && $m['id'] !== ''));
}

/** Emails in a folder (inbox, sentitems) whose $field (receivedDateTime, sentDateTime) is after `since`, oldest first. */
function ol_list(string $token, string $folder, string $select, string $field, string $since): array {
  $q = ['$select' => $select, '$orderby' => "$field asc", '$filter' => "$field gt " . $since, '$top' => '50'];
  $url = ol_graph_base() . '/v1.0/me/mailFolders/' . $folder . '/messages?' . http_build_query($q, '', '&', PHP_QUERY_RFC3986);
  $all = [];
  for ($page = 0; $url !== '' && $page < OL_PAGES; $page++) {
    [$code, $j] = ol_http($url, null, $token);
    if ($code !== 200) throw ol_graph_error($code);
    foreach ((array)($j['value'] ?? []) as $m) if (is_array($m)) $all[] = $m;
    $next = (string)($j['@odata.nextLink'] ?? '');
    $url = str_starts_with($next, ol_graph_base() . '/') ? $next : ''; // the token never goes anywhere else
  }
  return $all;
}

// ---------------------------------------------------------------- emails → the Daily Projects saved data

function ol_one_line(string $s, int $max): string {
  $s = trim((string)preg_replace('/\s+/u', ' ', $s));
  return mb_strlen($s) > $max ? rtrim(mb_substr($s, 0, $max - 1)) . '…' : $s;
}

function ol_iso_now(): string { return gmdate('Y-m-d\TH:i:s') . '.000Z'; }

/** "22 Oct 10:15" in India time. */
function ol_when(string $iso): string {
  $t = strtotime($iso);
  return $t ? date('j M H:i', $t) : '';
}

function ol_link(string $url): ?string {
  $u = trim($url);
  return preg_match('#^https?://[^\s]+$#i', $u) && filter_var($u, FILTER_VALIDATE_URL) ? $u : null;
}

function ol_rand_id(string $prefix): string {
  $b = random_bytes(8);
  $out = $prefix;
  for ($i = 0; $i < 8; $i++) $out .= base_convert((string)(ord($b[$i]) % 36), 10, 36);
  return $out;
}

/** The email in the words used everywhere: subject, sender, time, first lines, link, thread. */
function ol_mail_parts(array $m): array {
  $from = $m['from']['emailAddress'] ?? [];
  return [
    'subject' => ol_one_line((string)($m['subject'] ?? ''), 200) ?: '(no subject)',
    'from' => ol_one_line((string)($from['name'] ?? '') ?: (string)($from['address'] ?? ''), 80) ?: 'unknown sender',
    'when' => ol_when((string)($m['receivedDateTime'] ?? '')),
    'preview' => ol_one_line((string)($m['bodyPreview'] ?? ''), 200),
    'link' => ol_link((string)($m['webLink'] ?? '')),
    'conv' => mb_substr((string)($m['conversationId'] ?? ''), 0, 400),
    'address' => (string)($from['address'] ?? ''),
    'id' => (string)($m['id'] ?? ''),
    'at' => ol_iso((string)($m['receivedDateTime'] ?? '')),
  ];
}

/** "2026-10-22T05:00:00.000Z" for a time Microsoft sends, or '' when it is not a time. */
function ol_iso(string $t): string {
  $u = $t !== '' ? strtotime($t) : false;
  return $u ? gmdate('Y-m-d\TH:i:s', $u) . '.000Z' : '';
}

/** The newest email of a thread, kept in its `mail` (for a later "draft a reply" in Outlook): the same as cleanMail() in docs/ops.js. */
function ol_mail_info(object $mail, array $x): void {
  if ($x['id'] !== '' && mb_strlen($x['id']) <= 400) $mail->messageId = $x['id'];
  $mail->fromName = mb_substr($x['from'], 0, 120);
  $addr = trim($x['address']);
  if (preg_match('/^[^\s@]+@[^\s@]+$/', $addr) && strlen($addr) <= 200) $mail->fromAddress = $addr; else unset($mail->fromAddress);
  $mail->subject = $x['subject'];
  if ($x['at'] !== '') $mail->at = $x['at']; // when the newest email came (the ✉ Replies page counts the days from it)
  $me = strtolower(setting('ol_account'));
  if ($me !== '' && strtolower($addr) === $me) $mail->fromMe = true; else unset($mail->fromMe); // your own email: nothing to answer
}

/**
 * Put one email into the saved data (objects, as read from data.json):
 *  - its thread is still an Inbox item → that item: "💬 N emails · latest from …", the newest start and link;
 *  - its thread became a step or a project → a short note there ('mail_note': not your work);
 *  - its thread was there before and was removed → a fresh "↩ New reply: …" item;
 *  - otherwise a new item "📧 subject — from name".
 * The same rules as the operations addInbox / updateInbox / addMailNote in docs/ops.js.
 */
function ol_apply(object $data, array &$hist, array $m, bool $threadSeen, string $at): string {
  $x = ol_mail_parts($m);
  $conv = $x['conv'];
  if (!isset($data->inbox) || !is_array($data->inbox)) $data->inbox = [];
  $projects = is_array($data->projects ?? null) ? $data->projects : [];
  if ($conv !== '') {
    foreach ($data->inbox as $it) {
      if (!is_object($it) || !is_object($it->mail ?? null) || ($it->mail->conversationId ?? null) !== $conv) continue;
      $n = max(1, (int)($it->mail->count ?? 1)) + 1;
      $it->mail->count = $n;
      ol_mail_info($it->mail, $x);
      $it->note = mb_substr("💬 $n emails · latest from {$x['from']} {$x['when']}" . ($x['preview'] !== '' ? "\n{$x['preview']}" : ''), 0, 600);
      if ($x['link']) $it->link = (object)['url' => $x['link'], 'title' => $x['subject']];
      return 'joined';
    }
    $onStep = null; $onProject = null;
    foreach ($projects as $p) {
      if (!is_object($p)) continue;
      foreach ((is_array($p->steps ?? null) ? $p->steps : []) as $s) {
        if (is_object($s) && is_object($s->mail ?? null) && ($s->mail->conversationId ?? null) === $conv) { $onStep = [$p, $s]; break 2; }
      }
      if (!$onProject && is_object($p->mail ?? null) && ($p->mail->conversationId ?? null) === $conv) $onProject = $p;
    }
    if ($onStep || $onProject) {
      [$p, $s] = $onStep ?: [$onProject, null];
      $text = "📧 New reply from {$x['from']} {$x['when']}" . ($s ? ' (step: ' . ol_one_line((string)($s->text ?? ''), 80) . ')' : '')
        . ($x['preview'] !== '' ? ': ' . ol_one_line($x['preview'], 120) : '');
      $text = mb_substr($text, 0, 1000);
      $id = ol_rand_id('ml');
      $note = ['id' => $id, 'text' => $text, 'stepId' => $s ? (string)$s->id : null, 'createdAt' => $at, 'updatedAt' => $at, 'mail' => true];
      if ($x['link']) $note['link'] = (object)['url' => $x['link'], 'title' => $x['subject']];
      if (!isset($p->workNotes) || !is_array($p->workNotes)) $p->workNotes = [];
      ol_mail_info($s ? $s->mail : $p->mail, $x); // the step / project remembers the newest email of its thread
      array_unshift($p->workNotes, (object)$note);
      $month = date('Y-m', strtotime($at));
      $hist[$month][] = (object)['id' => $id, 'projectId' => (string)$p->id, 'projectName' => (string)($p->name ?? ''), 'kind' => 'mail_note', 'detail' => $text, 'at' => $at];
      return 'note';
    }
  }
  $item = [
    'id' => ol_rand_id('ol'),
    'text' => mb_substr(($threadSeen ? "↩ New reply: {$x['subject']} — from {$x['from']}" : "📧 {$x['subject']} — from {$x['from']}"), 0, 1000),
    'createdAt' => $at,
  ];
  if ($x['link']) $item['link'] = (object)['url' => $x['link'], 'title' => $x['subject']];
  $item['note'] = mb_substr($x['when'] . ($x['preview'] !== '' ? " · {$x['preview']}" : ''), 0, 600);
  if ($conv !== '') { $item['mail'] = (object)['conversationId' => $conv, 'count' => 1]; ol_mail_info($item['mail'], $x); }
  $data->inbox[] = (object)$item;
  return $threadSeen ? 'reply' : 'new';
}

function ol_json(mixed $v): string {
  $s = json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
  if ($s === false) throw new OlError('Could not write the projects.');
  return $s . "\n";
}

/** The owner's saved projects: [head, files (path → sha), data (objects, as in data.json)]. Never a guess. */
function ol_load(): array {
  $owner = (int)setting('dp_owner', '0');
  if (!$owner) throw new OlError('No projects on this server yet.');
  $head = dp_head($owner);
  $files = dp_tree_files((string)one('SELECT tree FROM dp_commits WHERE id = ?', [$head])['tree']);
  if (!isset($files['data.json'])) throw new OlError('Open Daily Projects once first.');
  $data = json_decode(dp_get_blob($files['data.json']), false);
  if (!is_object($data)) throw new OlError('The saved projects could not be read.'); // never write over them
  return [$head, $files, $data];
}

/**
 * Change the saved projects as one new version: $change($data, $hist) changes the data (and adds history lines by month);
 * it returns false when there is nothing to save. Another device saved first: read again, change again (a few tries).
 */
function ol_write(callable $change, string $message): bool {
  $owner = (int)setting('dp_owner', '0');
  for ($try = 0; ; $try++) {
    [$head, $files, $data] = ol_load();
    $hist = [];
    if (!$change($data, $hist)) return false;
    $changes = [['path' => 'data.json', 'content' => ol_json($data)]];
    foreach ($hist as $month => $events) {
      $path = "history/$month.json";
      $list = isset($files[$path]) ? json_decode(dp_get_blob($files[$path]), false) : [];
      if (!is_array($list)) throw new OlError('The saved history could not be read.');
      $changes[] = ['path' => $path, 'content' => ol_json(array_merge($list, $events))];
    }
    try {
      dp_commit(['id' => $owner], $head, $changes, $message);
      return true;
    } catch (ApiError $e) {
      if ($e->status !== 409 || $try >= 4) throw $e;
      usleep(200000 * ($try + 1));
    }
  }
}

// ---------------------------------------------------------------- email replies (drafts only: the owner presses Send)

/** Where an email thread lives, by the id the app, the server and Claude use: an Inbox item, a step or a project with `mail`. */
function ol_find_target(object $data, string $id): ?array {
  if ($id === '') return null;
  foreach ((is_array($data->inbox ?? null) ? $data->inbox : []) as $it) {
    if (is_object($it) && (string)($it->id ?? '') === $id && is_object($it->mail ?? null)) return [$it, null];
  }
  foreach ((is_array($data->projects ?? null) ? $data->projects : []) as $p) {
    if (!is_object($p)) continue;
    if ((string)($p->id ?? '') === $id) return is_object($p->mail ?? null) ? [$p, $p] : null;
    foreach ((is_array($p->steps ?? null) ? $p->steps : []) as $s) {
      if (is_object($s) && (string)($s->id ?? '') === $id) return is_object($s->mail ?? null) ? [$s, $p] : null;
    }
  }
  return null;
}

function ol_reply_open(mixed $r): bool { return is_object($r) && in_array($r->state ?? '', ['ready', 'later'], true); }

/** A reply was sent, but a newer email came after it (the same as waitingAgain() in docs/rules.js). */
function ol_waiting_again(object $t): bool {
  $r = $t->reply ?? null;
  $at = strtotime((string)($t->mail->at ?? '')) ?: 0;
  $sent = is_object($r) ? (strtotime((string)($r->sentAt ?? '')) ?: 0) : 0;
  return is_object($r) && ($r->state ?? '') === 'sent' && $at && $sent && $at > $sent;
}

/**
 * Sent Items showed a reply in this thread, sent at $sentAt: each Inbox item / step / project of the thread whose reply is
 * ready or later, or which waits for a reply, is marked replied (the same as the operation mailReplied in docs/ops.js:
 * not your work). A reply sent before the thread's newest email does not count. Returns how many were marked.
 */
function ol_mark_replied(object $data, array &$hist, string $conv, string $sentAt): int {
  $sent = strtotime($sentAt);
  if ($conv === '' || !$sent) return 0;
  $iso = gmdate('Y-m-d\TH:i:s', $sent) . '.000Z';
  $places = [];
  foreach ((is_array($data->inbox ?? null) ? $data->inbox : []) as $it) if (is_object($it)) $places[] = [$it, null];
  foreach ((is_array($data->projects ?? null) ? $data->projects : []) as $p) {
    if (!is_object($p)) continue;
    $places[] = [$p, $p];
    foreach ((is_array($p->steps ?? null) ? $p->steps : []) as $s) if (is_object($s)) $places[] = [$s, $p];
  }
  $n = 0;
  foreach ($places as [$t, $p]) {
    if (!is_object($t->mail ?? null) || ($t->mail->conversationId ?? null) !== $conv) continue;
    $r = $t->reply ?? null;
    if (!(ol_reply_open($r) || !is_object($r) || ol_waiting_again($t))) continue;
    $at = strtotime((string)($t->mail->at ?? '')) ?: 0;
    if ($at && $sent < $at) continue; // sent before the newest email
    $reply = is_object($r) ? clone $r : (object)['text' => '', 'at' => $iso, 'by' => 'you', 'forMessageId' => $t->mail->messageId ?? null];
    unset($reply->laterUntil);
    $reply->state = 'sent';
    $reply->sentAt = $iso;
    $t->reply = $reply;
    if ($p) {
      $now = ol_iso_now();
      $hist[date('Y-m', strtotime($now))][] = (object)['id' => ol_rand_id('mr'), 'projectId' => (string)$p->id, 'projectName' => (string)($p->name ?? ''),
        'kind' => 'mail_replied', 'detail' => mb_substr('Replied in Outlook: ' . (string)($t->mail->subject ?? ''), 0, 2000), 'at' => $now];
    }
    $n++;
  }
  return $n;
}

/** Look in Sent Items since the last look: a reply sent in a thread that waits for one ticks it as replied. */
function ol_check_sent(string $token): void {
  $since = setting('ol_sent_since') ?: gmdate('Y-m-d\TH:i:s\Z', time() - 86400);
  $sent = ol_list($token, 'sentitems', 'conversationId,sentDateTime', 'sentDateTime', gmdate('Y-m-d\TH:i:s\Z', (int)strtotime($since) - 300));
  $last = strtotime($since);
  $by = []; // the newest reply of each thread
  foreach ($sent as $m) {
    $t = (string)($m['sentDateTime'] ?? '');
    $u = strtotime($t);
    $conv = mb_substr((string)($m['conversationId'] ?? ''), 0, 400);
    if (!$u || $conv === '') continue;
    $last = max($last, $u);
    if (!isset($by[$conv]) || strtotime($by[$conv]) < $u) $by[$conv] = $t;
  }
  if ($by) {
    ol_write(function (object $data, array &$hist) use ($by): bool {
      $n = 0;
      foreach ($by as $conv => $t) $n += ol_mark_replied($data, $hist, (string)$conv, $t);
      return $n > 0;
    }, '✉ Replied in Outlook');
  }
  set_setting('ol_sent_since', gmdate('Y-m-d\TH:i:s\Z', $last));
}

/**
 * "Open in Outlook (same thread)": a draft reply to the thread's newest email, with the saved reply text (read from the saved
 * projects, never from the browser) above the quoted email. Never sent: the owner presses Send. Returns the draft's link.
 */
function ol_draft(string $id): string {
  if (setting('ol_refresh') === '') throw new OlError('Outlook is not connected, so the reply opens as a new email instead.');
  [, , $data] = ol_load();
  $found = ol_find_target($data, $id);
  if (!$found) throw new OlError('That email is not in your projects any more.');
  [$t] = $found;
  $r = $t->reply ?? null;
  $text = ol_reply_open($r) ? (string)($r->text ?? '') : '';
  if (trim($text) === '') throw new OlError('There is no reply ready to put in Outlook. Write it first (it saves by itself).');
  $msg = (string)($t->mail->messageId ?? '');
  if ($msg === '') throw new OlError('This email has no Outlook id, so the reply opens as a new email instead.');
  $token = ol_access_token();
  [$code, $j] = ol_http(ol_graph_base() . '/v1.0/me/messages/' . rawurlencode($msg) . '/createReply', null, $token, ['comment' => $text]);
  if ($code === 404) throw new OlError('Outlook could not find that email any more (moved or deleted). The reply opens as a new email instead.');
  if ($code !== 201 && $code !== 200) throw ol_graph_error($code);
  $link = ol_link((string)($j['webLink'] ?? ''));
  if (!$link) throw new OlError('Outlook made the draft but sent no link. Look in your Drafts folder.');
  return $link;
}

/** The newest email's words as plain text (for Claude writing a reply on the Mac), cut to $max letters. */
function ol_mail_body(string $id, int $max = 6000): array {
  if (setting('ol_refresh') === '') throw new OlError('Outlook is not connected.');
  [, , $data] = ol_load();
  $found = ol_find_target($data, $id);
  if (!$found) throw new OlError('No email with that id in the projects.');
  [$t] = $found;
  $msg = (string)($t->mail->messageId ?? '');
  if ($msg === '') throw new OlError('This email has no Outlook id (it came before replies were kept).');
  $token = ol_access_token();
  $url = ol_graph_base() . '/v1.0/me/messages/' . rawurlencode($msg) . '?' . http_build_query(['$select' => 'body,from,subject,receivedDateTime'], '', '&', PHP_QUERY_RFC3986);
  [$code, $j] = ol_http($url, null, $token, null, ['Prefer: outlook.body-content-type="text"']);
  if ($code !== 200) throw ol_graph_error($code);
  $body = (string)($j['body']['content'] ?? '');
  if (strtolower((string)($j['body']['contentType'] ?? 'text')) === 'html') $body = html_entity_decode(strip_tags($body), ENT_QUOTES | ENT_HTML5, 'UTF-8');
  $body = trim((string)preg_replace("/\n{3,}/", "\n\n", str_replace("\r", '', $body)));
  $cut = mb_strlen($body) > $max;
  $from = $j['from']['emailAddress'] ?? [];
  return [
    'id' => $id, 'subject' => (string)($j['subject'] ?? ''), 'from' => (string)($from['name'] ?? ''), 'fromAddress' => (string)($from['address'] ?? ''),
    'received' => (string)($j['receivedDateTime'] ?? ''), 'body' => $cut ? mb_substr($body, 0, $max) . '…' : $body, 'cut' => $cut,
  ];
}

/** Put these emails into the owner's saved projects, as one new version (another device first: read again, try again). */
function ol_add(array $msgs): int {
  $owner = (int)setting('dp_owner', '0');
  if (!$owner) throw new OlError('No projects on this server yet.');
  dp_migrate();
  // only the emails not put in yet (one email once, even if Microsoft sends it again)
  $new = [];
  foreach ($msgs as $m) {
    $h = hash('sha256', (string)$m['id']);
    if (isset($new[$h]) || one('SELECT id FROM ol_seen WHERE msg_hash = ?', [$h])) continue;
    $new[$h] = $m;
  }
  if (!$new) return 0;
  ol_write(function (object $data, array &$hist) use ($new): bool {
    $threads = [];
    foreach ($new as $m) {
      $conv = (string)($m['conversationId'] ?? '');
      $ch = hash('sha256', 'c|' . $conv);
      $seen = $conv !== '' && (isset($threads[$ch]) || (bool)one('SELECT id FROM ol_seen WHERE conv_hash = ? LIMIT 1', [$ch]));
      ol_apply($data, $hist, $m, $seen, ol_iso_now());
      $threads[$ch] = true;
    }
    return true;
  }, '📧 ' . count($new) . ' email' . (count($new) === 1 ? '' : 's') . ' from Outlook');
  foreach ($new as $h => $m) {
    $r = strtotime((string)($m['receivedDateTime'] ?? ''));
    q('INSERT IGNORE INTO ol_seen (msg_hash, conv_hash, received_at, added_at) VALUES (?, ?, ?, ?)',
      [$h, hash('sha256', 'c|' . (string)($m['conversationId'] ?? '')), $r ? date('Y-m-d H:i:s', $r) : null, now()]);
  }
  return count($new);
}

/** Look for new emails (at most every 10 minutes, or now). Nothing happens when Outlook is not connected. */
function ol_check(bool $now = false): void {
  if (setting('ol_refresh') === '') return;
  if (!$now && (int)setting('ol_at', '0') > time() - OL_EVERY) return;
  if (!(int)(one("SELECT GET_LOCK('wt_outlook', 0) AS l")['l'] ?? 0)) return; // another request is checking
  try {
    set_setting('ol_at', (string)time());
    $token = ol_access_token();
    $since = setting('ol_since') ?: gmdate('Y-m-d\TH:i:s\Z', time() - 86400);
    // a few minutes back, in case two emails came in the same second (each email is still put in once)
    $msgs = ol_fetch($token, gmdate('Y-m-d\TH:i:s\Z', (int)strtotime($since) - 300));
    ol_add($msgs);
    $last = strtotime($since);
    foreach ($msgs as $m) $last = max($last, (int)strtotime((string)($m['receivedDateTime'] ?? '')));
    set_setting('ol_since', gmdate('Y-m-d\TH:i:s\Z', $last));
    ol_check_sent($token); // replies you sent in Outlook tick their emails as replied
    set_setting('ol_error', '');
  } catch (OlError $e) {
    set_setting('ol_error', $e->getMessage());
  } catch (Throwable $e) {
    error_log('outlook: ' . get_class($e) . ' @ ' . basename($e->getFile()) . ':' . $e->getLine()); // (never the message: it could hold an address)
    set_setting('ol_error', 'Could not check Outlook just now. It will try again.');
  } finally {
    q("SELECT RELEASE_LOCK('wt_outlook')");
  }
}

// ---------------------------------------------------------------- the owner's Settings section

function ol_status(): array {
  $at = (int)setting('ol_at', '0');
  return [
    'clientId' => setting('ol_client'), 'tenantId' => setting('ol_tenant'),
    'secretEnd' => setting('ol_secret') !== '' ? setting('ol_secret_end') : '', // only the last 4 letters, never the secret
    'redirectUri' => ol_redirect_uri(), 'scopes' => OL_SCOPES,
    'connected' => setting('ol_refresh') !== '', 'account' => setting('ol_account'),
    'lastCheck' => $at ? date('Y-m-d H:i:s', $at) : null,
    'addedToday' => (int)(one('SELECT COUNT(*) AS n FROM ol_seen WHERE added_at >= ?', [today() . ' 00:00:00'])['n'] ?? 0),
    'error' => setting('ol_error'), 'today' => today(),
  ];
}

function ol_forget_signin(): void {
  q("DELETE FROM settings WHERE k IN ('ol_refresh', 'ol_account', 'ol_oauth', 'ol_error')");
}

/** outlook.* requests (only the owner of the projects). Returns null when `a` is not one of them. */
function ol_handle(string $a, array $in, array $me): ?array {
  if (!str_starts_with($a, 'outlook.')) return null;
  if ($me['role'] !== 'admin' || (int)setting('dp_owner', '0') !== (int)$me['id']) throw new ApiError('Only the owner of the projects can set up Outlook.', 403);
  try {
    switch ($a) {
      case 'outlook.status':
        return ['outlook' => ol_status()];
      case 'outlook.save': {
        $client = trim((string)($in['clientId'] ?? ''));
        $tenant = trim((string)($in['tenantId'] ?? ''));
        $secret = trim((string)($in['secret'] ?? ''));
        if (!preg_match('/^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/i', $client)) throw new ApiError('The Application (client) ID looks like 8-4-4-4-12 letters and numbers. Copy it from Azure.');
        if (!preg_match('/^[A-Za-z0-9][A-Za-z0-9.-]{0,99}$/', $tenant)) throw new ApiError('The Directory (tenant) ID looks like 8-4-4-4-12 letters and numbers. Copy it from Azure.');
        if ($secret === '' && setting('ol_secret') === '') throw new ApiError('Type the client secret (its Value, not its ID).');
        if ($secret !== '' && (strlen($secret) < 8 || strlen($secret) > 300 || preg_match('/\s/', $secret))) throw new ApiError('That client secret does not look right. Copy its Value from Azure.');
        $changed = strtolower($client) !== strtolower(setting('ol_client')) || strtolower($tenant) !== strtolower(setting('ol_tenant'));
        set_setting('ol_client', $client);
        set_setting('ol_tenant', $tenant);
        if ($secret !== '') { set_setting('ol_secret', ol_seal($secret)); set_setting('ol_secret_end', substr($secret, -4)); }
        if ($changed) ol_forget_signin(); // another app: its sign-in must be made again
        audit($me['id'], 'outlook_setup', $secret !== '' ? 'details and secret' : 'details');
        return ['outlook' => ol_status()];
      }
      case 'outlook.connect': {
        if (setting('ol_client') === '' || setting('ol_tenant') === '' || ol_open(setting('ol_secret')) === '') throw new ApiError('Save the three Outlook details first.');
        $state = bin2hex(random_bytes(32));
        $verifier = rtrim(strtr(base64_encode(random_bytes(48)), '+/', '-_'), '=');
        $challenge = rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');
        $redirect = ol_redirect_uri();
        set_setting('ol_oauth', json_encode(['state' => hash('sha256', $state), 'verifier' => ol_seal($verifier), 'user' => (int)$me['id'], 'exp' => time() + OL_STATE_SECONDS, 'redirect' => $redirect]));
        $url = ol_login_base() . '/' . rawurlencode(setting('ol_tenant')) . '/oauth2/v2.0/authorize?' . http_build_query([
          'client_id' => setting('ol_client'), 'response_type' => 'code', 'redirect_uri' => $redirect, 'response_mode' => 'query',
          'scope' => OL_SCOPES, 'state' => $state, 'code_challenge' => $challenge, 'code_challenge_method' => 'S256', 'prompt' => 'select_account',
        ], '', '&', PHP_QUERY_RFC3986);
        return ['url' => $url];
      }
      case 'outlook.check':
        if (setting('ol_refresh') === '') throw new ApiError('Outlook is not connected. Press Connect Outlook first.');
        ol_check(true);
        return ['outlook' => ol_status()];
      case 'outlook.draft': // a draft reply in the same thread (never sent): the text and the email come from the saved projects
        $link = ol_draft(trim((string)($in['ref'] ?? '')));
        audit($me['id'], 'outlook_draft', '');
        return ['webLink' => $link];
      case 'outlook.disconnect':
        ol_forget_signin();
        audit($me['id'], 'outlook_off', '');
        return ['outlook' => ol_status()];
    }
  } catch (OlError $e) {
    throw new ApiError($e->getMessage());
  }
  throw new ApiError('Unknown request.', 404);
}

/** outlook.php: Microsoft sends the owner back here with ?code&state. [ok, words for the page]. No sign-in line needed. */
function ol_callback(array $get): array {
  try {
    $saved = json_decode(setting('ol_oauth'), true);
    $state = (string)($get['state'] ?? '');
    if (!is_array($saved) || $state === '' || !hash_equals((string)($saved['state'] ?? ''), hash('sha256', $state)))
      return [false, 'This sign-in link is not valid any more. Go back to Work Task and press Connect Outlook again.'];
    q("DELETE FROM settings WHERE k = 'ol_oauth'"); // used once
    if ((int)($saved['exp'] ?? 0) < time()) return [false, 'This sign-in took more than 10 minutes. Go back to Work Task and press Connect Outlook again.'];
    if ((int)($saved['user'] ?? 0) !== (int)setting('dp_owner', '0')) return [false, 'Only the owner of the projects can connect Outlook.'];
    if (isset($get['error'])) return [false, ol_ms_error(['error' => (string)$get['error'], 'error_description' => (string)($get['error_description'] ?? '')])];
    $code = (string)($get['code'] ?? '');
    if ($code === '' || strlen($code) > 4000) return [false, 'Microsoft did not send the sign-in back. Press Connect Outlook again.'];
    [$st, $j] = ol_http(ol_token_url(), [
      'client_id' => setting('ol_client'), 'client_secret' => ol_open(setting('ol_secret')), 'grant_type' => 'authorization_code',
      'code' => $code, 'redirect_uri' => (string)$saved['redirect'], 'code_verifier' => ol_open((string)$saved['verifier']), 'scope' => OL_SCOPES,
    ]);
    if ($st !== 200 || !is_string($j['refresh_token'] ?? null) || !is_string($j['access_token'] ?? null)) {
      $msg = ($j['error'] ?? '') === 'invalid_grant' ? 'Microsoft says: that sign-in was already used or too old. Press Connect again' : ol_ms_error($j);
      set_setting('ol_error', $msg);
      return [false, $msg];
    }
    [$st2, $meJ] = ol_http(ol_graph_base() . '/v1.0/me?%24select=mail,userPrincipalName', null, $j['access_token']);
    $account = $st2 === 200 ? ol_one_line((string)($meJ['mail'] ?? '') ?: (string)($meJ['userPrincipalName'] ?? ''), 120) : '';
    set_setting('ol_refresh', ol_seal($j['refresh_token']));
    set_setting('ol_account', $account);
    set_setting('ol_error', '');
    set_setting('ol_at', '0'); // look at once (the next request)
    // the first time: only the last 24 hours (after a long break too: never a flood of old emails)
    $since = strtotime(setting('ol_since')) ?: 0;
    if ($since < time() - 3 * 86400) set_setting('ol_since', gmdate('Y-m-d\TH:i:s\Z', time() - 86400));
    audit((int)$saved['user'], 'outlook_on', '');
    return [true, 'Outlook connected ✓' . ($account !== '' ? " ($account)" : '') . ' — you can close this.'];
  } catch (OlError $e) {
    return [false, $e->getMessage()];
  } catch (Throwable $e) {
    error_log('outlook callback: ' . get_class($e) . ' @ ' . basename($e->getFile()) . ':' . $e->getLine());
    return [false, 'Something went wrong on the server. Press Connect Outlook again in a minute.'];
  }
}
