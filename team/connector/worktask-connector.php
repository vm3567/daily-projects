<?php
/*
 * Work Task connector - one file that lets your app send tasks and approvals to Work Task,
 * and get the owner's decisions (approved / rejected) back.
 *
 * How to use it - 3 steps:
 *
 * 1. Put this file in your app's folder.
 *    If you downloaded it from Work Task (Settings > Connections), the address, key and secret below are
 *    already filled in. If not, paste them below from the box Work Task showed you.
 *
 * 2. Send something to Work Task:
 *
 *      require_once __DIR__ . '/worktask-connector.php';
 *      wt_push([
 *        'external_id' => 'PO-1001',            // your own number for it (same number again = an update)
 *        'kind'        => 'approval',           // 'approval' = waits for Approve / Reject; 'task' = goes to the task list
 *        'title'       => 'Approve PO 1001',
 *        'details'     => 'Clay order for March',
 *        'link'        => 'https://your-app.example/po/1001',
 *        'fields'      => ['Amount' => '12,500', 'Vendor' => 'ABC Minerals'],
 *      ]);
 *      wt_withdraw('PO-1001');                  // you took it back (no decision needed any more)
 *
 * 3. Get the decision back - choose one way:
 *
 *    a) A page in your app that Work Task calls (put its address in Work Task as the "Decision address"):
 *
 *      require_once __DIR__ . '/worktask-connector.php';
 *      wt_receive_decision(function ($externalId, $status, $reason) {
 *        // $status is 'approved' or 'rejected'; $reason may be empty. Mark it in your app here.
 *      });
 *
 *    b) Or ask Work Task now and then (for example every 5 minutes):
 *
 *      foreach (wt_decisions($lastTime) as $d) { ... $d['external_id'], $d['status'], $d['reason'], $d['decided_at'] ... }
 *      // keep the answer's newest decided_at as $lastTime for the next time (a decision may come twice: that is fine)
 *
 * Keep the key and the secret private. If they leak, press "Rotate key" in Work Task and put the new ones here.
 * Needs PHP 7.4 or newer, with curl.
 */

const WT_ADDRESS = 'https://YOUR-WORK-TASK-ADDRESS/api/';
const WT_KEY = 'PASTE-YOUR-KEY-HERE';
const WT_SECRET = 'PASTE-YOUR-SIGNING-SECRET-HERE';

/** Call Work Task. Returns its answer as an array, or throws RuntimeException with the reason in plain words. */
function wt_call(string $action, array $body): array {
  $ch = curl_init(WT_ADDRESS . '?a=' . rawurlencode($action));
  curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . WT_KEY, 'Content-Type: application/json', 'Accept: application/json'],
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_CONNECTTIMEOUT => 8,
    CURLOPT_TIMEOUT => 15,
  ]);
  $raw = curl_exec($ch);
  $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
  $error = curl_error($ch);
  if ($raw === false) throw new RuntimeException('Could not reach Work Task: ' . $error);
  $answer = json_decode((string)$raw, true);
  if (!is_array($answer) || empty($answer['ok'])) {
    $why = is_array($answer) && isset($answer['error']) ? (string)$answer['error'] : 'error ' . $code;
    throw new RuntimeException('Work Task said: ' . $why);
  }
  return $answer;
}

/** Send a task or an approval (the same external_id again = an update). Returns ['id' => …, 'status' => …]. */
function wt_push(array $item): array {
  return wt_call('connect.push', $item);
}

/** You took it back: Work Task marks it withdrawn. */
function wt_withdraw(string $externalId): array {
  return wt_call('connect.withdraw', ['external_id' => $externalId]);
}

/** The decisions made since that time ('' = all). Each: external_id, status, reason, decided_at, item_id. */
function wt_decisions(string $since = ''): array {
  $answer = wt_call('connect.decisions', $since === '' ? [] : ['since' => $since]);
  return isset($answer['decisions']) && is_array($answer['decisions']) ? $answer['decisions'] : [];
}

/** Is this really from Work Task? The time must be within 5 minutes, and the signature must match. */
function wt_signature_ok(string $body, string $timestamp, string $signature, ?int $now = null): bool {
  if (!preg_match('/^[0-9]{1,12}$/', $timestamp)) return false;
  if (abs(($now === null ? time() : $now) - (int)$timestamp) > 300) return false;
  $expected = 'sha256=' . hash_hmac('sha256', $timestamp . '.' . $body, WT_SECRET);
  return hash_equals($expected, $signature);
}

/** Your decision address: checks the message, then calls $onDecision($externalId, $status, $reason). Answers 200 or 401. */
function wt_receive_decision(callable $onDecision): void {
  $body = (string)file_get_contents('php://input');
  $timestamp = (string)($_SERVER['HTTP_X_WORKTASK_TIMESTAMP'] ?? '');
  $signature = (string)($_SERVER['HTTP_X_WORKTASK_SIGNATURE'] ?? '');
  header('Content-Type: application/json');
  if (!wt_signature_ok($body, $timestamp, $signature)) {
    http_response_code(401);
    echo '{"ok":false,"error":"The signature is not right."}';
    return;
  }
  $d = json_decode($body, true);
  if (!is_array($d) || ($d['event'] ?? '') !== 'decision' || !isset($d['external_id'], $d['status'])) {
    http_response_code(400);
    echo '{"ok":false,"error":"Not a decision."}';
    return;
  }
  $onDecision((string)$d['external_id'], (string)$d['status'], (string)($d['reason'] ?? ''));
  http_response_code(200);
  echo '{"ok":true}';
}
