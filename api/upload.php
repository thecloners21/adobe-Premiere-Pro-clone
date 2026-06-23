<?php
require_once __DIR__ . '/_lib.php';

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') json_out(['ok' => false, 'error' => 'POST richiesto'], 405);
if (!isset($_FILES['file'])) json_out(['ok' => false, 'error' => 'nessun file'], 400);

$f = $_FILES['file'];
if ($f['error'] !== UPLOAD_ERR_OK) json_out(['ok' => false, 'error' => 'upload error ' . $f['error']], 400);
if ($f['size'] > MAX_UPLOAD) json_out(['ok' => false, 'error' => 'file troppo grande'], 413);

$ext = strtolower(pathinfo($f['name'], PATHINFO_EXTENSION));
if (!in_array($ext, ALLOWED_EXT, true)) json_out(['ok' => false, 'error' => 'estensione non ammessa'], 415);

if (!is_dir(UP_DIR)) @mkdir(UP_DIR, 0775, true);
$name = safe_upload_name($f['name']);
$dest = UP_DIR . '/' . $name;

if (!move_uploaded_file($f['tmp_name'], $dest)) {
    // fallback per ambienti senza move_uploaded_file (CLI test)
    if (!@rename($f['tmp_name'], $dest)) json_out(['ok' => false, 'error' => 'salvataggio fallito'], 500);
}

json_out(['ok' => true, 'name' => $f['name'], 'path' => 'uploads/' . $name]);
