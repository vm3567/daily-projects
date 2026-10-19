// Phone notifications: the PHP server locks each message (RFC 8291) and signs its ticket (VAPID).
// Here Node's own crypto plays the phone: it must unlock the message and accept the signature.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createECDH, createDecipheriv, hkdfSync, randomBytes, createPublicKey, verify } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUSH = join(ROOT, 'team', 'app', 'push.php');
let php = true;
try { execFileSync('which', ['php'], { stdio: 'ignore' }); } catch { php = false; }
const skip = php ? false : 'php not installed';
const b64u = (b) => Buffer.from(b).toString('base64url');
const runPhp = (code, args) => execFileSync('php', ['-r', `require ${JSON.stringify(PUSH)}; ${code}`, '--', ...args], { encoding: 'utf8' });

function unlock(body, ua, auth) {
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body[20];
  const asPub = body.subarray(21, 21 + idlen);
  const shared = ua.computeSecret(asPub);
  const ikm = Buffer.from(hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPub]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const rest = body.subarray(21 + idlen);
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(rest.subarray(rest.length - 16));
  const plain = Buffer.concat([d.update(rest.subarray(0, rest.length - 16)), d.final()]);
  assert.equal(rs, 4096);
  assert.equal(plain[plain.length - 1], 2, 'last record ends with the 0x02 mark');
  return plain.subarray(0, plain.length - 1).toString('utf8');
}

test('push: the phone can unlock the message the server locked', { skip }, () => {
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  const auth = randomBytes(16);
  const msg = JSON.stringify({ kind: 'task', title: '📥 New task for you', body: 'Collect clay samples · Glaze trial' });
  const hex = runPhp('echo bin2hex(push_encrypt($argv[1], b64u_dec($argv[2]), b64u_dec($argv[3])));', [msg, b64u(ua.getPublicKey()), b64u(auth)]);
  assert.equal(unlock(Buffer.from(hex, 'hex'), ua, auth), msg);
});

test('push: the server ticket (VAPID) is signed correctly and names the push service', { skip }, () => {
  const out = runPhp('$k = ec_new(); openssl_pkey_export($k, $pem); echo vapid_header($argv[1], $pem, b64u(ec_raw_pub($k)), "https://worktask.in");',
    ['https://fcm.googleapis.com/fcm/send/abc123']);
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(out);
  assert.ok(m, out);
  const claims = JSON.parse(Buffer.from(m[2], 'base64url').toString());
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.sub, 'https://worktask.in');
  assert.ok(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 24 * 3600);
  const pub = Buffer.from(m[4], 'base64url');
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) }, format: 'jwk' });
  const ok = verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url'));
  assert.ok(ok, 'signature checks out');
});

test('push: only real push services are ever sent to', { skip }, () => {
  const ok = (u) => runPhp('echo push_endpoint_ok($argv[1]) ? "yes" : "no";', [u]) === 'yes';
  assert.ok(ok('https://fcm.googleapis.com/fcm/send/x'));
  assert.ok(ok('https://web.push.apple.com/QF1'));
  assert.ok(ok('https://updates.push.services.mozilla.com/wpush/v2/x'));
  assert.ok(!ok('http://fcm.googleapis.com/fcm/send/x'), 'no plain http');
  assert.ok(!ok('https://127.0.0.1/x'));
  assert.ok(!ok('https://fcm.googleapis.com.evil.example/x'));
  assert.ok(!ok('https://evil.example/https://fcm.googleapis.com/'));
});
