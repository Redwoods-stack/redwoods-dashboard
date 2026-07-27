<?php
// ============================================================================
// Redwoods dashboard — file attachment upload/serve (ISOLATED from api.php).
// Kept separate so a bug here can never break the site-wide login gate.
// Reuses the same PHP session (rwd_sid) to authenticate the user.
// Files are stored ABOVE public_html (next to rwd-config.php) so the Git
// auto-deploy never wipes them and the web server never serves them directly.
// Endpoints (via ?action=):  upload (POST multipart) | file (GET) | ping
// ============================================================================
declare(strict_types=1);

header('X-Content-Type-Options: nosniff');

const MAX_BYTES = 104857600; // 100 MB (also bounded by PHP upload_max_filesize/post_max_size)

// ext => mime, and whether it is safe to show inline in the browser
$ALLOWED = [
  'pdf'  => ['application/pdf', true],
  'xls'  => ['application/vnd.ms-excel', false],
  'xlsx' => ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', false],
  'csv'  => ['text/csv', false],
  'doc'  => ['application/msword', false],
  'docx' => ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', false],
  'ppt'  => ['application/vnd.ms-powerpoint', false],
  'pptx' => ['application/vnd.openxmlformats-officedocument.presentationml.presentation', false],
  'txt'  => ['text/plain; charset=utf-8', true],
  'png'  => ['image/png', true],
  'jpg'  => ['image/jpeg', true],
  'jpeg' => ['image/jpeg', true],
  'gif'  => ['image/gif', true],
  'webp' => ['image/webp', true],
];

function out_json($data, int $code = 200): void {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: no-store');
  echo json_encode($data);
  exit;
}

// --- Start the same session api.php uses, so we know who is logged in ---
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

$uid = isset($_SESSION['uid']) ? (int)$_SESSION['uid'] : 0;
$action = $_GET['action'] ?? '';

// Storage root ABOVE public_html (same level as rwd-config.php).
$storeRoot = dirname(__DIR__, 2) . '/rwd-uploads';

switch ($action) {

  case 'ping':
    out_json(['ok' => true, 'loggedIn' => $uid > 0, 'maxBytes' => MAX_BYTES]);

  case 'upload': {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') out_json(['error' => 'Use POST.'], 405);
    // CSRF guard: browsers can't set this custom header cross-origin without CORS.
    if (($_SERVER['HTTP_X_RWD'] ?? '') !== '1') out_json(['error' => 'Bad request.'], 400);
    if ($uid <= 0) out_json(['error' => 'Sign in to upload files.'], 401);

    // If the POST body exceeded post_max_size, PHP empties $_FILES/$_POST silently.
    if (empty($_FILES) && (int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 0) {
      out_json(['error' => 'File too large for the server. Ask your host to raise upload_max_filesize / post_max_size.'], 413);
    }
    if (!isset($_FILES['file']) || !is_array($_FILES['file'])) out_json(['error' => 'No file received.'], 400);

    $f = $_FILES['file'];
    if (($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
      $code = (int)($f['error'] ?? 0);
      $msg = ($code === UPLOAD_ERR_INI_SIZE || $code === UPLOAD_ERR_FORM_SIZE)
        ? 'File too large for the server. Ask your host to raise upload_max_filesize.'
        : 'Upload failed (error ' . $code . ').';
      out_json(['error' => $msg], 400);
    }
    if (!is_uploaded_file($f['tmp_name'])) out_json(['error' => 'Invalid upload.'], 400);
    if ((int)$f['size'] <= 0) out_json(['error' => 'Empty file.'], 400);
    if ((int)$f['size'] > MAX_BYTES) out_json(['error' => 'File exceeds the ' . (MAX_BYTES / 1048576) . ' MB limit.'], 413);

    $orig = (string)$f['name'];
    $ext = strtolower(pathinfo($orig, PATHINFO_EXTENSION));
    if (!isset($ALLOWED[$ext])) {
      out_json(['error' => 'That file type is not allowed. Use PDF, Excel, Word, PowerPoint, CSV, text, or an image.'], 415);
    }

    $userDir = $storeRoot . '/' . $uid;
    if (!is_dir($userDir) && !@mkdir($userDir, 0755, true) && !is_dir($userDir)) {
      out_json(['error' => 'Server storage is not writable. Contact the site owner.'], 500);
    }

    try {
      $id = bin2hex(random_bytes(16));
    } catch (Throwable $e) {
      $id = md5(uniqid((string)$uid, true));
    }

    $dest = $userDir . '/' . $id . '.bin';
    if (!move_uploaded_file($f['tmp_name'], $dest)) {
      out_json(['error' => 'Could not save the file.'], 500);
    }

    // Sanitize the display name; keep it human but harmless.
    $safeName = preg_replace('/[\r\n"\\\\]+/', ' ', $orig);
    $safeName = trim(mb_substr($safeName, 0, 180));
    if ($safeName === '') $safeName = 'file.' . $ext;

    $meta = ['name' => $safeName, 'ext' => $ext, 'size' => (int)$f['size'], 'ts' => time()];
    @file_put_contents($userDir . '/' . $id . '.json', json_encode($meta));

    out_json([
      'ok'   => true,
      'id'   => $id,
      'name' => $safeName,
      'ext'  => $ext,
      'size' => (int)$f['size'],
      'url'  => '/api/upload.php?action=file&id=' . $id,
    ]);
  }

  case 'file': {
    if ($uid <= 0) out_json(['error' => 'Sign in to view this file.'], 401);
    $id = (string)($_GET['id'] ?? '');
    if (!preg_match('/^[a-f0-9]{32}$/', $id)) out_json(['error' => 'Bad file id.'], 400);

    $userDir = $storeRoot . '/' . $uid;
    $path = $userDir . '/' . $id . '.bin';
    if (!is_file($path)) out_json(['error' => 'File not found.'], 404);

    $meta = [];
    $metaPath = $userDir . '/' . $id . '.json';
    if (is_file($metaPath)) { $j = json_decode((string)file_get_contents($metaPath), true); if (is_array($j)) $meta = $j; }

    $ext = strtolower((string)($meta['ext'] ?? ''));
    [$mime, $inline] = $ALLOWED[$ext] ?? ['application/octet-stream', false];
    $name = (string)($meta['name'] ?? ('file.' . ($ext ?: 'bin')));
    $name = preg_replace('/[\r\n"\\\\]+/', ' ', $name);

    header('Content-Type: ' . $mime);
    header('Content-Length: ' . (string)filesize($path));
    header('Content-Disposition: ' . ($inline ? 'inline' : 'attachment') . '; filename="' . $name . '"');
    header('Cache-Control: private, max-age=300');
    header('X-Content-Type-Options: nosniff');
    readfile($path);
    exit;
  }

  default:
    out_json(['error' => 'Unknown action.'], 404);
}
