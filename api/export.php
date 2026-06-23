<?php
require_once __DIR__ . '/_lib.php';
setlocale(LC_NUMERIC, 'C');

/* ---- probe ---- */
if (isset($_GET['probe'])) {
    $bin = can_exec() ? ffmpeg_bin() : null;
    json_out(['server' => (bool)$bin, 'ffmpeg' => $bin ? trim(explode("\n", (string)shell_exec(escapeshellarg($bin) . ' -version'))[0]) : null]);
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') json_out(['ok' => false, 'error' => 'POST richiesto'], 405);
if (!can_exec()) json_out(['ok' => false, 'error' => 'exec disabilitato'], 501);
$bin = ffmpeg_bin();
if (!$bin) json_out(['ok' => false, 'error' => 'ffmpeg non trovato'], 501);

$body = read_json_body();
$project = $body['project'] ?? null;
$opts    = $body['opts'] ?? [];
if (!$project || empty($project['tracks'])) json_out(['ok' => false, 'error' => 'progetto non valido'], 400);

[$W, $H] = array_map('intval', explode('x', ($opts['res'] ?? '1280x720') . 'x0'));
$W = $W ?: 1280; $H = $H ?: 720;
$fps = max(1, (int)($project['fps'] ?? 30));
$fmt = ($opts['fmt'] ?? 'mp4') === 'webm' ? 'webm' : 'mp4';
$n = fn($v) => rtrim(rtrim(sprintf('%.5f', (float)$v), '0'), '.') ?: '0';

/* font per i titoli */
$fontFile = null;
foreach (['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf', '/Library/Fonts/Arial.ttf'] as $ff)
    if (is_file($ff)) { $fontFile = $ff; break; }

$mediaById = [];
foreach ($project['media'] as $m) $mediaById[$m['id']] = $m;

/* durata */
$D = 0.0;
foreach ($project['tracks'] as $t)
    foreach ($t['clips'] as $c)
        $D = max($D, (float)$c['start'] + ((float)$c['out'] - (float)$c['in']));
if ($D <= 0) json_out(['ok' => false, 'error' => 'timeline vuota'], 400);

function media_path(array $m): ?string {
    if (!empty($m['serverSrc'])) return resolve_upload($m['serverSrc']);
    if (!empty($m['src']) && strpos($m['src'], 'uploads/') !== false) return resolve_upload($m['src']);
    return null;
}

/* transType -> nome xfade ffmpeg */
$XF = ['dissolve'=>'fade','dipblack'=>'fadeblack','dipwhite'=>'fadewhite','wipeleft'=>'wipeleft',
       'wiperight'=>'wiperight','slideleft'=>'slideleft','slideright'=>'slideright','push'=>'slideleft'];

/* ----- inputs ffmpeg (uno per clip con file) ----- */
$inputs = [];          // array di array di args
$clipInput = [];       // clipId => indice input
$transparentTitles = false;

function add_input(array &$inputs, array $args): int { $inputs[] = $args; return count($inputs) - 1; }

foreach ($project['tracks'] as $t) {
    foreach ($t['clips'] as $c) {
        $m = $mediaById[$c['mediaId']] ?? null;
        if (!$m) continue;
        if (($m['kind'] ?? '') === 'title') continue; // generato via filtro, niente input
        $path = media_path($m);
        if (!$path) json_out(['ok' => false, 'error' => 'media non sul server: ' . ($m['name'] ?? '')], 422);
        $dur = (float)$c['out'] - (float)$c['in'];
        if (($m['kind'] ?? '') === 'image')
            $clipInput[$c['id']] = add_input($inputs, ['-loop','1','-t',$n($dur),'-i',$path]);
        else
            $clipInput[$c['id']] = add_input($inputs, ['-i',$path]);
    }
}

/* ----- catena effetti per una clip ----- */
$efx = function(array $c) use ($n): array {
    $fx = $c['fx'] ?? [];
    $g = fn($k, $d = 0) => (float)($fx[$k] ?? $d);
    $f = [];
    if (!empty($fx['flipH'])) $f[] = 'hflip';
    if (!empty($fx['flipV'])) $f[] = 'vflip';
    $rot = $g('rotation');
    if (abs($rot) > 0.01) $f[] = 'rotate=' . $n($rot * M_PI / 180) . ':ow=rotw(' . $n($rot * M_PI / 180) . '):oh=roth(' . $n($rot * M_PI / 180) . '):c=black@0';
    $b = $g('brightness') + $g('exposure') * 0.3;
    if (abs($b) > 0.001 || abs($g('contrast')) > 0.001 || abs($g('saturation')) > 0.001)
        $f[] = 'eq=brightness=' . $n($b) . ':contrast=' . $n(1 + $g('contrast')) . ':saturation=' . $n(1 + $g('saturation'));
    $h = $g('hue'); $gray = $g('grayscale');
    if (abs($h) > 0.01 || $gray > 0.01) $f[] = 'hue=h=' . $n($h) . ':s=' . $n(1 - $gray);
    $tm = $g('temperature'); $ti = $g('tint');
    if (abs($tm) > 0.01 || abs($ti) > 0.01) $f[] = 'colorbalance=rm=' . $n($tm * 0.3) . ':bm=' . $n(-$tm * 0.3) . ':gm=' . $n($ti * 0.3);
    if ($g('blur') > 0.01) $f[] = 'boxblur=' . $n($g('blur') * 4) . ':1';
    if ($g('sharpen') > 0.01) $f[] = 'unsharp=5:5:' . $n($g('sharpen') * 1.5);
    if ($g('sepia') > 0.4) $f[] = 'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131';
    if ($g('vignette') > 0.01) $f[] = 'vignette=PI/4';
    return $f;
};

/* drawtext per un titolo */
$titleFilter = function(array $m) use ($fontFile, $W, $H): string {
    $ti = $m['title'] ?? [];
    // le virgolette singole proteggono ':' e ',' nel filtergraph; basta gestire backslash, apostrofo e newline
    $text = str_replace('\\', '\\\\', (string)($ti['text'] ?? ''));
    $text = str_replace("'", "\u{2019}", $text);
    $text = str_replace("\n", '\n', $text);
    $size = (int)($ti['fontSize'] ?? 80);
    $col = ltrim((string)($ti['color'] ?? '#ffffff'), '#');
    $x = ($ti['align'] ?? 'center') === 'left' ? 'w*0.08' : (($ti['align'] ?? '') === 'right' ? 'w*0.92-tw' : '(w-tw)/2');
    $y = ($ti['valign'] ?? 'middle') === 'top' ? 'h*0.12' : (($ti['valign'] ?? '') === 'bottom' ? 'h*0.85' : '(h-th)/2');
    $f = "drawtext=text='{$text}':fontcolor=0x{$col}:fontsize={$size}:x={$x}:y={$y}";
    if (!empty($ti['shadow'])) $f .= ":shadowcolor=black@0.6:shadowx=2:shadowy=3";
    if ($fontFile) $f .= ":fontfile='{$fontFile}'";
    return $f;
};

$fc = [];
$lblSeq = 0;

/* costruisce lo stream video di una clip (length = clipLen). $alpha=true per overlay */
$buildClip = function(array $c, array $m, bool $alpha) use (&$fc, $clipInput, $efx, $titleFilter, $W, $H, $fps, $n, &$lblSeq): string {
    $dur = (float)$c['out'] - (float)$c['in'];
    $IN = (float)$c['in']; $OUT = (float)$c['out'];
    $lbl = 'seg' . ($lblSeq++);
    $chain = [];
    if (($m['kind'] ?? '') === 'title') {
        $bg = $alpha ? 'black@0.0' : 'black';
        $chain[] = "color=c={$bg}:s={$W}x{$H}:r={$fps}:d={$n($dur)}";
        $chain[] = $titleFilter($m);
    } else {
        $i = $clipInput[$c['id']];
        if (($m['kind'] ?? '') === 'image') $src = "[{$i}:v]setpts=PTS-STARTPTS";
        else $src = "[{$i}:v]trim=start={$n($IN)}:end={$n($OUT)},setpts=PTS-STARTPTS";
        $chain[] = $src;
        $chain[] = "scale={$W}:{$H}:force_original_aspect_ratio=decrease";
        $chain[] = "pad={$W}:{$H}:(ow-iw)/2:(oh-ih)/2:black";
    }
    // imposta l'alpha PRIMA degli effetti, così la trasparenza viene preservata
    if ($alpha) $chain[] = "format=yuva420p";
    foreach ($efx($c) as $f) $chain[] = $f;
    $chain[] = "fps={$fps}";
    if ($alpha) {
        $op = max(0, min(1, (float)(($c['fx']['opacity']) ?? 1)));
        if ($op < 0.999) $chain[] = "colorchannelmixer=aa={$n($op)}";
    } else {
        $chain[] = "format=yuv420p";
    }
    $chain[] = "setsar=1";
    $fc[] = implode(',', $chain) . "[{$lbl}]";
    return $lbl;
};

/* ----- traccia principale (bottom video con clip): xfade + concat + gap neri ----- */
$videoTracks = array_values(array_filter($project['tracks'], fn($t) => $t['type'] === 'video'));
$mainTrack = null;
for ($i = count($videoTracks) - 1; $i >= 0; $i--) if (!empty($videoTracks[$i]['clips']) && empty($videoTracks[$i]['mute'])) { $mainTrack = $videoTracks[$i]; break; }

$base = null; $baseDur = 0.0;
if ($mainTrack) {
    $clips = $mainTrack['clips'];
    usort($clips, fn($a, $b) => $a['start'] <=> $b['start']);
    foreach ($clips as $c) {
        $m = $mediaById[$c['mediaId']] ?? null; if (!$m) continue;
        $segDur = (float)$c['out'] - (float)$c['in'];
        $seg = $buildClip($c, $m, false);
        if ($base === null) {
            if ((float)$c['start'] > 0.01) {
                $bk = 'bk' . ($lblSeq++);
                $fc[] = "color=c=black:s={$W}x{$H}:r={$fps}:d={$n($c['start'])},format=yuv420p,setsar=1[{$bk}]";
                $out = 'mt' . ($lblSeq++);
                $fc[] = "[{$bk}][{$seg}]concat=n=2:v=1:a=0[{$out}]";
                $base = $out; $baseDur = (float)$c['start'] + $segDur;
            } else { $base = $seg; $baseDur = $segDur; }
            continue;
        }
        $gap = (float)$c['start'] - $baseDur;
        if ($gap > 0.01) {
            $bk = 'bk' . ($lblSeq++);
            $fc[] = "color=c=black:s={$W}x{$H}:r={$fps}:d={$n($gap)},format=yuv420p,setsar=1[{$bk}]";
            $out = 'mt' . ($lblSeq++);
            $fc[] = "[{$base}][{$bk}][{$seg}]concat=n=3:v=1:a=0[{$out}]";
            $base = $out; $baseDur += $gap + $segDur;
        } elseif ($gap < -0.01) {
            $ov = -$gap;
            $tr = $XF[$c['transType'] ?? 'dissolve'] ?? 'fade';
            $offset = $baseDur - $ov;
            $out = 'mt' . ($lblSeq++);
            $fc[] = "[{$base}][{$seg}]xfade=transition={$tr}:duration={$n($ov)}:offset={$n($offset)}[{$out}]";
            $base = $out; $baseDur += $segDur - $ov;
        } else {
            $out = 'mt' . ($lblSeq++);
            $fc[] = "[{$base}][{$seg}]concat=n=2:v=1:a=0[{$out}]";
            $base = $out; $baseDur += $segDur;
        }
    }
}
if ($base === null) {
    $fc[] = "color=c=black:s={$W}x{$H}:r={$fps}:d={$n($D)},format=yuv420p,setsar=1[mt0]";
    $base = 'mt0';
}

/* ----- tracce video superiori: overlay posizionato ----- */
$upper = [];
foreach (array_reverse($videoTracks) as $t)         // dal basso verso l'alto
    if ($t !== $mainTrack && !empty($t['clips']) && empty($t['mute'])) $upper[] = $t;

foreach ($upper as $t) {
    foreach ($t['clips'] as $c) {
        $m = $mediaById[$c['mediaId']] ?? null; if (!$m) continue;
        $S = (float)$c['start']; $E = $S + ((float)$c['out'] - (float)$c['in']);
        $seg = $buildClip($c, $m, true);
        $shift = 'sh' . ($lblSeq++);
        $fc[] = "[{$seg}]setpts=PTS+{$n($S)}/TB[{$shift}]";
        $out = 'ov' . ($lblSeq++);
        $fc[] = "[{$base}][{$shift}]overlay=eof_action=pass:enable='between(t,{$n($S)},{$n($E)})'[{$out}]";
        $base = $out;
    }
}
$vout = $base;

/* ----- audio: tutte le clip con audio ----- */
$alabels = []; $an = 0;
foreach ($project['tracks'] as $t) {
    if (!empty($t['mute'])) continue;
    foreach ($t['clips'] as $c) {
        $m = $mediaById[$c['mediaId']] ?? null;
        if (!$m || empty($m['hasAudio']) || !isset($clipInput[$c['id']])) continue;
        $i = $clipInput[$c['id']];
        $S = (float)$c['start']; $IN = (float)$c['in']; $OUT = (float)$c['out'];
        $Sms = (int)round($S * 1000);
        $gain = max(0, (float)($c['gain'] ?? 1));
        $lbl = 'au' . ($an++);
        $fc[] = "[{$i}:a]atrim=start={$n($IN)}:end={$n($OUT)},asetpts=PTS-STARTPTS,adelay={$Sms}|{$Sms},volume={$n($gain)}[{$lbl}]";
        $alabels[] = "[{$lbl}]";
    }
}
if ($an === 0) { $fc[] = "anullsrc=channel_layout=stereo:sample_rate=48000[aout]"; $aout = 'aout'; }
elseif ($an === 1) { $aout = trim($alabels[0], '[]'); }
else { $fc[] = implode('', $alabels) . "amix=inputs={$an}:normalize=0:dropout_transition=0[aout]"; $aout = 'aout'; }

/* ----- comando ----- */
if (!is_dir(REND_DIR)) @mkdir(REND_DIR, 0775, true);
$outName = 'render_' . bin2hex(random_bytes(5)) . '.' . $fmt;
$outPath = REND_DIR . '/' . $outName;

$cmd = [$bin, '-y'];
foreach ($inputs as $args) $cmd = array_merge($cmd, $args);
$cmd[] = '-filter_complex'; $cmd[] = implode(';', $fc);
$cmd = array_merge($cmd, ['-map', "[{$vout}]", '-map', "[{$aout}]", '-r', (string)$fps, '-t', $n($D)]);
if ($fmt === 'webm') $cmd = array_merge($cmd, ['-c:v','libvpx-vp9','-b:v','0','-crf','33','-c:a','libopus','-b:a','160k']);
else $cmd = array_merge($cmd, ['-c:v','libx264','-pix_fmt','yuv420p','-preset','veryfast','-crf','20','-c:a','aac','-b:a','192k','-movflags','+faststart']);
$cmd[] = $outPath;

$cmdStr = implode(' ', array_map('escapeshellarg', $cmd)) . ' 2>&1';
$log = (string)shell_exec($cmdStr);

if (!is_file($outPath) || filesize($outPath) < 1024)
    json_out(['ok' => false, 'error' => 'render fallito', 'log' => substr($log, -2500)], 500);

json_out(['ok' => true, 'url' => 'renders/' . $outName, 'log' => substr($log, -400)]);
