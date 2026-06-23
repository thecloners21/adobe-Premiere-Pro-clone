<?php
require_once __DIR__ . '/_lib.php';

try {
    $rows = db()->query('SELECT id, name, updated FROM projects ORDER BY updated DESC')->fetchAll(PDO::FETCH_ASSOC);
} catch (Throwable $e) {
    json_out(['ok' => true, 'projects' => []]); // nessuna tabella ancora
}
json_out(['ok' => true, 'projects' => $rows]);
