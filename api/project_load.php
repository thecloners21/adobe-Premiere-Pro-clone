<?php
require_once __DIR__ . '/_lib.php';

$id = $_GET['id'] ?? '';
if ($id === '') json_out(['ok' => false, 'error' => 'id mancante'], 400);

try {
    $stmt = db()->prepare('SELECT json FROM projects WHERE id = :id');
    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
} catch (Throwable $e) {
    json_out(['ok' => false, 'error' => 'DB: ' . $e->getMessage()], 500);
}
if (!$row) json_out(['ok' => false, 'error' => 'progetto non trovato'], 404);

json_out(['ok' => true, 'project' => json_decode($row['json'], true)]);
