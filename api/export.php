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
$efx = function(array $c) use ($n, $W, $H): array {
    $fx = $c['fx'] ?? [];
    $g = fn($k, $d = 0) => (float)($fx[$k] ?? $d);
    // un parametro keyframato? (almeno un keyframe nell'array)
    $hasKf = fn($k) => is_array($c['kf'][$k] ?? null) && count($c['kf'][$k]) > 0;
    /* espressione ffmpeg tempo-variante (virgole escapate per il filtergraph);
       se non ci sono keyframe restituisce il valore statico. $map trasforma il valore. */
    $kf = function($key, $map = null) use ($c, $g, $n, $hasKf) {
        $map = $map ?? fn($v) => $v;
        if (!$hasKf($key)) return $n($map($g($key)));
        $a = $c['kf'][$key];
        usort($a, fn($x, $y) => $x['t'] <=> $y['t']);
        $cnt = count($a);
        if ($cnt === 1) return $n($map((float)$a[0]['v']));
        $ease = $c['ease'][$key] ?? 'linear';
        $easeExpr = function($frac) use ($ease) {
            switch ($ease) {
                case 'in':    return "($frac*$frac)";
                case 'out':   return "(1-(1-$frac)*(1-$frac))";
                case 'inout': return "($frac*$frac*(3-2*$frac))";
                case 'hold':  return "0";
                default:      return $frac;
            }
        };
        $expr = $n($map((float)$a[$cnt - 1]['v']));        // dopo l'ultimo keyframe
        for ($i = $cnt - 2; $i >= 0; $i--) {
            $t0 = $n((float)$a[$i]['t']);   $t1 = $n((float)$a[$i + 1]['t']);
            $v0 = $n($map((float)$a[$i]['v'])); $v1 = $n($map((float)$a[$i + 1]['v']));
            $eased = $easeExpr("((t-$t0)/($t1-$t0))");
            $seg = "($v0+($v1-$v0)*$eased)";
            $expr = "if(lt(t\\,$t1)\\,$seg\\,$expr)";
        }
        return "if(lt(t\\," . $n((float)$a[0]['t']) . ")\\," . $n($map((float)$a[0]['v'])) . "\\,$expr)";
    };

    $f = [];
    if (!empty($fx['flipH'])) $f[] = 'hflip';
    if (!empty($fx['flipV'])) $f[] = 'vflip';
    if (abs($g('rotation')) > 0.01 || $hasKf('rotation')) {
        $aexpr = $kf('rotation', fn($v) => $v * M_PI / 180);
        $f[] = "rotate=a=$aexpr:ow=$W:oh=$H:c=black@0";
    }
    $anyEq = abs($g('brightness')) > 0.001 || abs($g('exposure')) > 0.001 || abs($g('contrast')) > 0.001 || abs($g('saturation')) > 0.001
          || $hasKf('brightness') || $hasKf('exposure') || $hasKf('contrast') || $hasKf('saturation');
    if ($anyEq) {
        $bexpr = "(" . $kf('brightness') . "+(" . $kf('exposure') . ")*0.3)";
        $cexpr = "(1+(" . $kf('contrast') . "))";
        $sexpr = "(1+(" . $kf('saturation') . "))";
        $f[] = "eq=eval=frame:brightness=$bexpr:contrast=$cexpr:saturation=$sexpr";
    }
    $h = $g('hue'); $gray = $g('grayscale');
    if (abs($h) > 0.01 || $gray > 0.01 || $hasKf('hue') || $hasKf('grayscale')) {
        $hexpr = $kf('hue');
        $sexpr = "(1-(" . $kf('grayscale') . "))";
        $f[] = "hue=h=$hexpr:s=$sexpr:eval=frame";
    }
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
    $clips = $t['clips'];
    usort($clips, fn($a, $b) => $a['start'] <=> $b['start']);
    foreach ($clips as $idx => $c) {
        $m = $mediaById[$c['mediaId']] ?? null; if (!$m) continue;
        $S = (float)$c['start']; $segDur = (float)$c['out'] - (float)$c['in']; $E = $S + $segDur;
        $seg = $buildClip($c, $m, true);

        // cross-dissolve con i vicini sovrapposti sulla stessa traccia (alpha fade)
        $fades = [];
        if ($idx > 0) {
            $prev = $clips[$idx - 1];
            $ovIn = ($prev['start'] + ((float)$prev['out'] - (float)$prev['in'])) - $S;
            if ($ovIn > 0.02) $fades[] = "fade=t=in:st=0:d={$n($ovIn)}:alpha=1";
        }
        if ($idx < count($clips) - 1) {
            $next = $clips[$idx + 1];
            $ovOut = $E - (float)$next['start'];
            if ($ovOut > 0.02) $fades[] = "fade=t=out:st={$n($segDur - $ovOut)}:d={$n($ovOut)}:alpha=1";
        }
        $shifted = 'sh' . ($lblSeq++);
        $chain = "[{$seg}]" . (count($fades) ? implode(',', $fades) . ',' : '') . "setpts=PTS+{$n($S)}/TB[{$shifted}]";
        $fc[] = $chain;

        $out = 'ov' . ($lblSeq++);
        $fc[] = "[{$base}][{$shifted}]overlay=eof_action=pass:enable='between(t,{$n($S)},{$n($E)})'[{$out}]";
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
