<?php
// ============================================================================
// Redwoods dashboard — cloud sync API (single router)
// Per-user accounts; saves each user's dashboard state per project.
// Endpoints (via ?action=):  register | login | logout | me | load | save
// ============================================================================
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

// --- Load server-side config (DB creds + signup code). Never committed to git. ---
$cfgPath = __DIR__ . '/config.php';
if (!is_file($cfgPath)) {
  http_response_code(500);
  echo json_encode(['error' => 'API not configured yet (missing config.php).']);
  exit;
}
$config = require $cfgPath;
if (!is_array($config)) {
  http_response_code(500);
  echo json_encode(['error' => 'Invalid server configuration.']);
  exit;
}

// --- Lightweight CSRF guard: require a custom header.
// Browsers forbid setting custom headers on cross-origin requests without CORS,
// so a simple HTML form on another site cannot forge these calls. ---
if (($_SERVER['HTTP_X_RWD'] ?? '') !== '1') {
  http_response_code(400);
  echo json_encode(['error' => 'Bad request.']);
  exit;
}

// --- Harden the session cookie, then start the session ---
// Keep users signed in ~30 days (so closing the browser doesn't log them out).
$lifetime = 60 * 60 * 24 * 30;
@ini_set('session.gc_maxlifetime', (string)$lifetime);
$secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
session_set_cookie_params([
  'lifetime' => $lifetime,
  'path'     => '/',
  'httponly' => true,
  'secure'   => $secure,
  'samesite' => 'Lax',
]);
session_name('rwd_sid');
session_start();

// --- Helpers ---
function out($data, int $code = 200): void {
  http_response_code($code);
  echo json_encode($data);
  exit;
}
function body(): array {
  $raw = file_get_contents('php://input');
  $j = json_decode($raw ?: '', true);
  return is_array($j) ? $j : [];
}
function db(array $c): PDO {
  $dsn = "mysql:host={$c['db_host']};dbname={$c['db_name']};charset=utf8mb4";
  return new PDO($dsn, $c['db_user'], $c['db_pass'], [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES   => false,
  ]);
}
function cleanProject($p): string {
  return preg_replace('/[^a-z0-9]/', '', strtolower((string)$p));
}

try {
  $pdo = db($config);
} catch (Throwable $e) {
  out(['error' => 'Database connection failed.'], 500);
}

$action = $_GET['action'] ?? '';

switch ($action) {

  case 'register': {
    $b    = body();
    $u    = trim((string)($b['username'] ?? ''));
    $p    = (string)($b['password'] ?? '');
    $code = (string)($b['code'] ?? '');
    if (!hash_equals((string)$config['signup_code'], $code)) {
      out(['error' => 'Invalid signup code.'], 403);
    }
    if (strlen($u) < 3 || strlen($u) > 40 || !preg_match('/^[A-Za-z0-9_.\-]+$/', $u)) {
      out(['error' => 'Username must be 3–40 chars: letters, numbers, _ . -'], 422);
    }
    if (strlen($p) < 8) {
      out(['error' => 'Password must be at least 8 characters.'], 422);
    }
    $hash = password_hash($p, PASSWORD_DEFAULT);
    try {
      $st = $pdo->prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
      $st->execute([$u, $hash]);
    } catch (PDOException $e) {
      if ($e->getCode() === '23000') out(['error' => 'That username is already taken.'], 409);
      out(['error' => 'Could not create account.'], 500);
    }
    session_regenerate_id(true);
    $_SESSION['uid']   = (int)$pdo->lastInsertId();
    $_SESSION['uname'] = $u;
    out(['ok' => true, 'username' => $u]);
  }

  case 'login': {
    $b = body();
    $u = trim((string)($b['username'] ?? ''));
    $p = (string)($b['password'] ?? '');
    $st = $pdo->prepare('SELECT id, password_hash FROM users WHERE username = ?');
    $st->execute([$u]);
    $row = $st->fetch();
    if (!$row || !password_verify($p, $row['password_hash'])) {
      usleep(400000); // slow down brute-force a little
      out(['error' => 'Wrong username or password.'], 401);
    }
    session_regenerate_id(true);
    $_SESSION['uid']   = (int)$row['id'];
    $_SESSION['uname'] = $u;
    out(['ok' => true, 'username' => $u]);
  }

  case 'logout': {
    $_SESSION = [];
    session_destroy();
    out(['ok' => true]);
  }

  case 'me': {
    out(['loggedIn' => isset($_SESSION['uid']), 'username' => $_SESSION['uname'] ?? null]);
  }

  case 'load': {
    if (!isset($_SESSION['uid'])) out(['error' => 'Not logged in.'], 401);
    $proj = cleanProject($_GET['project'] ?? '');
    if ($proj === '') out(['error' => 'Bad project.'], 422);
    $st = $pdo->prepare('SELECT data FROM states WHERE user_id = ? AND project = ?');
    $st->execute([$_SESSION['uid'], $proj]);
    $row = $st->fetch();
    out(['ok' => true, 'data' => $row ? json_decode($row['data'], true) : null]);
  }

  case 'save': {
    if (!isset($_SESSION['uid'])) out(['error' => 'Not logged in.'], 401);
    $b    = body();
    $proj = cleanProject($b['project'] ?? '');
    if ($proj === '') out(['error' => 'Bad project.'], 422);
    $data = json_encode($b['data'] ?? []);
    if ($data === false) out(['error' => 'Invalid data.'], 422);
    if (strlen($data) > 200000) out(['error' => 'Payload too large.'], 413);
    $st = $pdo->prepare(
      'INSERT INTO states (user_id, project, data) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = CURRENT_TIMESTAMP'
    );
    $st->execute([$_SESSION['uid'], $proj, $data]);
    out(['ok' => true]);
  }

  default:
    out(['error' => 'Unknown action.'], 404);
}
