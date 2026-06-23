<?php
require_once __DIR__ . '/_lib.php';

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') json_out(['ok' => false, 'error' => 'POST richiesto'], 405);

$p = read_json_body();
if (!$p || !isset($p['tracks'])) json_out(['ok' => false, 'error' => 'progetto non valido'], 400);

$id = isset($p['id']) && is_string($p['id']) && $p['id'] !== '' ? $p['id'] : ('prj_' . bin2hex(random_bytes(6)));
$p['id'] = $id;
$name = isset($p['name']) ? substr((string)$p['name'], 0, 120) : 'Progetto';

try {
    $stmt = db()->prepare('INSERT INTO projects (id,name,json,updated) VALUES (:id,:n,:j,:u)
        ON CONFLICT(id) DO UPDATE SET name=:n, json=:j, updated=:u');
    $stmt->execute([
        ':id' => $id, ':n' => $name,
        ':j' => json_encode($p, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
        ':u' => date('Y-m-d H:i:s'),
    ]);
} catch (Throwable $e) {
    json_out(['ok' => false, 'error' => 'DB: ' . $e->getMessage()], 500);
}

json_out(['ok' => true, 'id' => $id]);
