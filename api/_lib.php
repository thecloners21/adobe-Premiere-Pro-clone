<?php
/* =====================================================================
   _lib.php — utility comuni, SQLite, sicurezza
   ===================================================================== */
declare(strict_types=1);

const ROOT      = __DIR__ . '/..';
const DATA_DIR  = ROOT . '/data';
const UP_DIR    = ROOT . '/uploads';
const REND_DIR  = ROOT . '/renders';
const DB_PATH   = DATA_DIR . '/editor.sqlite';

const MAX_UPLOAD = 512 * 1024 * 1024; // 512 MB
const ALLOWED_EXT = ['mp4','webm','mov','mkv','ogv','m4v','mp3','wav','ogg','m4a','aac','flac','png','jpg','jpeg','gif','webp','bmp'];

function json_out($data, int $code = 200): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function read_json_body(): array {
    $raw = file_get_contents('php://input');
    if ($raw === '' || $raw === false) return [];
    $d = json_decode($raw, true);
    return is_array($d) ? $d : [];
}

function db(): PDO {
    static $pdo = null;
    if ($pdo) return $pdo;
    if (!is_dir(DATA_DIR)) @mkdir(DATA_DIR, 0775, true);
    $pdo = new PDO('sqlite:' . DB_PATH);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->exec('CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        json TEXT NOT NULL,
        updated TEXT NOT NULL
    )');
    return $pdo;
}

/* nome file sicuro e univoco dentro uploads/ */
function safe_upload_name(string $orig): string {
    $ext = strtolower(pathinfo($orig, PATHINFO_EXTENSION));
    if (!in_array($ext, ALLOWED_EXT, true)) $ext = 'bin';
    $base = preg_replace('/[^A-Za-z0-9._-]+/', '_', pathinfo($orig, PATHINFO_FILENAME));
    $base = substr($base, 0, 60) ?: 'media';
    return $base . '_' . bin2hex(random_bytes(4)) . '.' . $ext;
}

/* verifica che un path uploads sia interno alla cartella (anti traversal) */
function resolve_upload(string $rel): ?string {
    $rel = str_replace('\\', '/', $rel);
    $rel = ltrim(preg_replace('#^.*uploads/#', '', $rel), '/');
    if ($rel === '' || strpos($rel, '..') !== false) return null;
    $full = UP_DIR . '/' . basename($rel);
    return is_file($full) ? $full : null;
}

function ffmpeg_bin(): ?string {
    foreach (['ffmpeg', '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'] as $c) {
        $out = @shell_exec(escapeshellarg($c) . ' -version 2>/dev/null');
        if ($out && stripos($out, 'ffmpeg version') !== false) return $c;
    }
    return null;
}

function can_exec(): bool {
    if (!function_exists('shell_exec')) return false;
    $disabled = array_map('trim', explode(',', (string)ini_get('disable_functions')));
    return !in_array('shell_exec', $disabled, true) && !in_array('proc_open', $disabled, true);
}
