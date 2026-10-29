<?php
// Team server: shared start for every request. This folder is OUTSIDE the website folder,
// so nobody can open these files from the internet.
declare(strict_types=1);

date_default_timezone_set('Asia/Kolkata');

const APP_DIR = __DIR__;
// Automatic tests (tests/php-server.test.mjs) point everything at a throwaway folder; never set on the live server.
define('TEST_DIR', (string)(getenv('WT_TEST_DIR') ?: ''));
define('ROOT_DIR', TEST_DIR ?: dirname(__DIR__));
define('UPLOAD_DIR', ROOT_DIR . '/uploads');
define('CONFIG_FILE', (TEST_DIR ?: APP_DIR) . '/config.php');
define('SETUP_CODE_FILE', (TEST_DIR ?: APP_DIR) . '/setup-code.txt');

const MAX_FAILS = 5;            // wrong passwords before a pause
const LOCK_MINUTES = 15;        // the pause
const TOKEN_DAYS = 60;          // stay signed in this long without using the app
const MAX_PHOTOS = 5;           // per update
const MAX_STEP_PHOTOS = 10;     // per ☑ step of a single task
const MAX_TASK_STEPS = 50;      // ☑ steps in one task
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

function now(): string { return date('Y-m-d H:i:s'); }
function today(): string { return date('Y-m-d'); }

function config(): ?array {
  static $c = null;
  if ($c === null && is_file(CONFIG_FILE)) $c = require CONFIG_FILE;
  return $c ?: null;
}

function db(): PDO {
  static $pdo = null;
  if ($pdo) return $pdo;
  $c = config();
  if (!$c) throw new ApiError('The server is not set up yet.', 503);
  $pdo = connect_db($c['db_host'], $c['db_name'], $c['db_user'], $c['db_pass']);
  migrate($pdo);
  return $pdo;
}

function connect_db(string $host, string $name, string $user, string $pass): PDO {
  $pdo = new PDO("mysql:host=$host;dbname=$name;charset=utf8mb4", $user, $pass, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES => false,
  ]);
  $pdo->exec("SET time_zone = '+05:30'");
  return $pdo;
}

class ApiError extends Exception {
  public int $status;
  public function __construct(string $message, int $status = 400) { parent::__construct($message); $this->status = $status; }
}

/** Make a folder (and its parents) if it is not there. Two requests at the same moment may both try: the second
 *  finds it made by the first, which is fine (no warning printed into the answer). */
function make_dir(string $dir): void {
  if (!is_dir($dir) && !@mkdir($dir, 0750, true) && !is_dir($dir)) throw new ApiError('Could not make a folder. Try again.', 500);
}

function q(string $sql, array $args = []): PDOStatement {
  $st = db()->prepare($sql);
  $st->execute($args);
  return $st;
}
function one(string $sql, array $args = []): ?array { $r = q($sql, $args)->fetch(); return $r ?: null; }
function all(string $sql, array $args = []): array { return q($sql, $args)->fetchAll(); }

function setting(string $key, string $default = ''): string {
  $r = one('SELECT v FROM settings WHERE k = ?', [$key]);
  return $r ? $r['v'] : $default;
}
function set_setting(string $key, string $value): void {
  q('INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [$key, $value]);
}

function audit(?int $userId, string $action, string $detail = ''): void {
  q('INSERT INTO audit (user_id, action, detail, at) VALUES (?, ?, ?, ?)', [$userId, $action, mb_substr($detail, 0, 500), now()]);
}

/**
 * The tables. Each step runs once; the number of steps done is kept in settings.schema.
 * To change the tables later: ADD a new step at the end, never edit an old one.
 */
function migrate(PDO $pdo): void {
  $steps = [
    "CREATE TABLE IF NOT EXISTS settings (k VARCHAR(40) PRIMARY KEY, v TEXT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    "CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(40) NOT NULL UNIQUE,
      name VARCHAR(80) NOT NULL,
      role ENUM('admin','staff') NOT NULL DEFAULT 'staff',
      pass_hash VARCHAR(255) NOT NULL,
      must_change TINYINT(1) NOT NULL DEFAULT 1,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL,
      last_login DATETIME NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    "CREATE TABLE IF NOT EXISTS tokens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      token_hash CHAR(64) NOT NULL UNIQUE,
      device VARCHAR(160) NOT NULL DEFAULT '',
      created_at DATETIME NOT NULL,
      last_used DATETIME NOT NULL,
      INDEX (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    "CREATE TABLE IF NOT EXISTS login_fails (
      id INT AUTO_INCREMENT PRIMARY KEY,
      k VARCHAR(120) NOT NULL,
      at DATETIME NOT NULL,
      INDEX (k, at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    "CREATE TABLE IF NOT EXISTS tasks (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(300) NOT NULL,
      details TEXT NULL,
      assignee_id INT NOT NULL,
      created_by INT NOT NULL,
      repeat_kind ENUM('daily','weekly','once') NOT NULL DEFAULT 'daily',
      skip_sunday TINYINT(1) NOT NULL DEFAULT 1,
      weekday TINYINT NULL,
      due_date DATE NULL,
      start_date DATE NOT NULL,
      project VARCHAR(200) NULL,
      project_ref VARCHAR(80) NULL,
      step_ref VARCHAR(80) NULL,
      status ENUM('open','done','cancelled') NOT NULL DEFAULT 'open',
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      done_at DATETIME NULL,
      INDEX (assignee_id, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    "CREATE TABLE IF NOT EXISTS updates (
      id INT AUTO_INCREMENT PRIMARY KEY,
      task_id INT NOT NULL,
      user_id INT NOT NULL,
      day DATE NOT NULL,
      note TEXT NOT NULL,
      state ENUM('progress','stuck','finished') NOT NULL DEFAULT 'progress',
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      UNIQUE KEY one_a_day (task_id, day),
      INDEX (day)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    "CREATE TABLE IF NOT EXISTS photos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      update_id INT NOT NULL,
      file VARCHAR(120) NOT NULL,
      size INT NOT NULL,
      created_at DATETIME NOT NULL,
      INDEX (update_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    "CREATE TABLE IF NOT EXISTS audit (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NULL,
      action VARCHAR(40) NOT NULL,
      detail VARCHAR(500) NOT NULL DEFAULT '',
      at DATETIME NOT NULL,
      INDEX (at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    // v2: staff can suggest tasks; messages on a task; who has read them
    "ALTER TABLE tasks MODIFY status ENUM('open','done','cancelled','suggested') NOT NULL DEFAULT 'open'",
    "CREATE TABLE IF NOT EXISTS comments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      task_id INT NOT NULL,
      user_id INT NOT NULL,
      text TEXT NOT NULL,
      at DATETIME NOT NULL,
      INDEX (task_id, at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    "CREATE TABLE IF NOT EXISTS task_reads (
      task_id INT NOT NULL,
      user_id INT NOT NULL,
      at DATETIME NOT NULL,
      last_id INT NOT NULL DEFAULT 0,
      PRIMARY KEY (task_id, user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    // v3: a whole project given to a person: its steps in order (only the first open one is due each day)
    "ALTER TABLE tasks ADD COLUMN seq INT NULL",
    // v4: "photo needed to finish"; instruction files from the manager on a task
    "ALTER TABLE tasks ADD COLUMN needs_photo TINYINT(1) NOT NULL DEFAULT 0",
    "CREATE TABLE IF NOT EXISTS task_files (
      id INT AUTO_INCREMENT PRIMARY KEY,
      task_id INT NOT NULL,
      user_id INT NOT NULL,
      file VARCHAR(160) NOT NULL,
      name VARCHAR(200) NOT NULL,
      mime VARCHAR(60) NOT NULL,
      size INT NOT NULL,
      at DATETIME NOT NULL,
      INDEX (task_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    // v5: a message or photo sent twice from the outbox (reply lost on a weak signal) is kept once
    "ALTER TABLE comments ADD COLUMN client_id VARCHAR(40) NULL, ADD UNIQUE KEY comment_once (user_id, client_id)",
    "ALTER TABLE photos ADD COLUMN client_id VARCHAR(40) NULL, ADD UNIQUE KEY photo_once (update_id, client_id)",
    // v6: who closed a task by their own Finished (empty when the manager closed it), so only they can undo it
    "ALTER TABLE tasks ADD COLUMN closed_by INT NULL",
    // v7: phone notifications: each phone's push address (and its keys to lock the message) for one person
    "CREATE TABLE IF NOT EXISTS push_subs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      endpoint TEXT NOT NULL,
      ep_hash CHAR(64) NOT NULL UNIQUE,
      p256dh VARCHAR(120) NOT NULL,
      auth VARCHAR(40) NOT NULL,
      created_at DATETIME NOT NULL,
      last_ok DATETIME NULL,
      INDEX (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    // v8: a step the person added to a project given to them, until the owner's Daily Projects has put it in the project
    "ALTER TABLE tasks ADD COLUMN from_staff TINYINT(1) NOT NULL DEFAULT 0",
    // v9: a second alert for Stuck; photos in messages, and editing your own message; a suggestion sent twice is kept once
    "ALTER TABLE updates ADD COLUMN alert2 TINYINT(1) NOT NULL DEFAULT 0",
    "ALTER TABLE comments ADD COLUMN photo VARCHAR(120) NULL, ADD COLUMN edited_at DATETIME NULL",
    "ALTER TABLE tasks ADD COLUMN client_id VARCHAR(60) NULL, ADD UNIQUE KEY task_once (created_by, client_id)",
    // v10: moves are recorded by the server (never read back from message text); when a closed task was opened again
    "CREATE TABLE IF NOT EXISTS task_moves (
      id INT AUTO_INCREMENT PRIMARY KEY,
      task_id INT NOT NULL,
      from_id INT NOT NULL,
      to_id INT NOT NULL,
      at DATETIME NOT NULL,
      INDEX (task_id), INDEX (from_id, at), INDEX (to_id, at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    "ALTER TABLE comments ADD COLUMN kind VARCHAR(10) NULL",
    "UPDATE comments c JOIN users u ON u.id = c.user_id SET c.kind = 'move' WHERE u.role = 'admin' AND c.text LIKE '↔ Moved from % to %'",
    "ALTER TABLE tasks ADD COLUMN reopened_at DATETIME NULL",
    // v11: the phone's id of an update, so a resend after a lost reply is known as the same save
    "ALTER TABLE updates ADD COLUMN client_id VARCHAR(60) NULL",
    // v12: when a reopened task had been closed (its closed days are not 'missed'); a re-give is not a move away from someone
    "ALTER TABLE tasks ADD COLUMN closed_from DATETIME NULL",
    "ALTER TABLE task_moves ADD COLUMN regive TINYINT(1) NOT NULL DEFAULT 0",
    // v13: each person's email address (optional), for the manager's morning email
    "ALTER TABLE users ADD COLUMN email VARCHAR(120) NULL",
    // v14: emails from the owner's Outlook Inbox already put in the Daily Projects Inbox (by message, and by email thread)
    "CREATE TABLE IF NOT EXISTS ol_seen (
      id INT AUTO_INCREMENT PRIMARY KEY,
      msg_hash CHAR(64) NOT NULL UNIQUE,
      conv_hash CHAR(64) NOT NULL,
      received_at DATETIME NULL,
      added_at DATETIME NOT NULL,
      INDEX (conv_hash), INDEX (added_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    // v15: 🔌 Connections — outside apps (with their own key: only its fingerprint is kept) and what they sent
    "CREATE TABLE IF NOT EXISTS connections (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(80) NOT NULL,
      key_hash CHAR(64) NOT NULL UNIQUE,
      key_end VARCHAR(4) NOT NULL,
      secret_enc VARCHAR(255) NOT NULL,
      callback_url VARCHAR(500) NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL,
      last_seen_at DATETIME NULL,
      last_error VARCHAR(300) NULL,
      rate_min INT NOT NULL DEFAULT 0,
      rate_n INT NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    "CREATE TABLE IF NOT EXISTS conn_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      conn_id INT NOT NULL,
      external_id VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
      kind VARCHAR(10) NOT NULL,
      title VARCHAR(200) NOT NULL,
      details TEXT NULL,
      link VARCHAR(1000) NULL,
      fields TEXT NULL,
      status VARCHAR(10) NOT NULL DEFAULT 'pending',
      reason VARCHAR(500) NULL,
      decided_at DATETIME NULL,
      callback_tries INT NOT NULL DEFAULT 0,
      callback_next_at DATETIME NULL,
      callback_ok_at DATETIME NULL,
      callback_failed TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      dp_task_id VARCHAR(40) NULL,
      UNIQUE KEY conn_ext (conn_id, external_id),
      INDEX (status), INDEX (callback_next_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    // v34: the 24 hours of trying to tell the app count from here (the decision, or a new decision address)
    "ALTER TABLE conn_items ADD COLUMN callback_since DATETIME NULL",
    // v35: when an update was written (on the phone, offline): the next offline one is compared with this, not with when it arrived
    "ALTER TABLE updates ADD COLUMN written_at DATETIME NULL",
    // v36: which sign-in linked a phone's notifications, so signing out on that phone stops them there (only there)
    "ALTER TABLE push_subs ADD COLUMN token_id INT NULL",
    // v37: the 🔔 list in the app — every notification is also kept here, so one missed on the phone (or never sent:
    // no phone linked) is still seen; read_at = opened from the list, or its task was opened
    "CREATE TABLE IF NOT EXISTS notifs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      kind VARCHAR(12) NOT NULL,
      title VARCHAR(160) NOT NULL,
      body VARCHAR(300) NOT NULL,
      url VARCHAR(255) NOT NULL,
      at DATETIME NOT NULL,
      read_at DATETIME NULL,
      INDEX (user_id, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    // v38: Stuck — "Waiting for what?" (Manager, Material, Another person, Other + a few words); NULL when not stuck
    "ALTER TABLE updates ADD COLUMN waiting_for VARCHAR(80) NULL",
    // v39: the kind of task (owner asked 24 Oct): NULL = a daily update; 'log' = 📒 a record (many short entries a day)
    "ALTER TABLE tasks ADD COLUMN kind VARCHAR(10) NULL",
    // v40: 📒 a record's entries (a line each); the day's update is made from them (so the lists, colours and diary work as before)
    "CREATE TABLE IF NOT EXISTS entries (
      id INT AUTO_INCREMENT PRIMARY KEY,
      task_id INT NOT NULL,
      user_id INT NOT NULL,
      update_id INT NOT NULL,
      text TEXT NOT NULL,
      at DATETIME NOT NULL,
      client_id VARCHAR(60) NULL,
      UNIQUE KEY entry_once (user_id, client_id),
      INDEX (task_id, at),
      INDEX (update_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    // v41: a photo can belong to one entry of a record (it is also on that day's update, so every photo list shows it)
    "ALTER TABLE photos ADD COLUMN entry_id INT NULL, ADD INDEX (entry_id)",
    // v42: ☑ steps inside a single task (owner, 29 Oct: "let staff add steps to single tasks too ... with photos, edit and add photos")
    "CREATE TABLE IF NOT EXISTS task_steps (
      id INT AUTO_INCREMENT PRIMARY KEY,
      task_id INT NOT NULL,
      title VARCHAR(300) NOT NULL,
      done_at DATETIME NULL,
      done_by INT NULL,
      created_by INT NOT NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      client_id VARCHAR(60) NULL,
      UNIQUE KEY tstep_once (created_by, client_id),
      INDEX (task_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    // v43: a step's photos
    "CREATE TABLE IF NOT EXISTS step_photos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      step_id INT NOT NULL,
      user_id INT NOT NULL,
      file VARCHAR(160) NOT NULL,
      size INT NOT NULL,
      created_at DATETIME NOT NULL,
      client_id VARCHAR(60) NULL,
      UNIQUE KEY sphoto_once (step_id, client_id),
      INDEX (step_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
  ];
  $pdo->exec($steps[0]);
  $done = (int)($pdo->query("SELECT v FROM settings WHERE k = 'schema'")->fetchColumn() ?: 0);
  $st = $pdo->prepare("INSERT INTO settings (k, v) VALUES ('schema', ?) ON DUPLICATE KEY UPDATE v = VALUES(v)");
  for ($i = max($done, 1); $i < count($steps); $i++) {
    try { $pdo->exec($steps[$i]); }
    catch (PDOException $e) { if (!in_array((int)($e->errorInfo[1] ?? 0), [1050, 1060, 1061], true)) throw $e; } // table / column / index already there
    $st->execute([(string)($i + 1)]); // saved after each step, so a failed step never runs the ones before it again
  }
}
