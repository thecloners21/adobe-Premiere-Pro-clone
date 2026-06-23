# ClonePremiere — clone web di Adobe Premiere Pro

Editor video multitraccia che gira nel browser (HTML5 + JS moduli ES) con backend PHP + SQLite e render finale via **ffmpeg** (server) con **fallback MediaRecorder** (browser, offline).

## Avvio
**Importante: va servito via http, non aperto con doppio click.** I moduli ES (`<script type="module">`) sono bloccati dai browser sotto `file://` (errore CORS "origin null"). Usa:
```bash
./avvia.sh           # avvia php -S e apre il browser (porta 8099 di default)
# oppure
php -S 127.0.0.1:8099   # poi apri http://127.0.0.1:8099/
```
Su hosting: caricare la cartella; serve PHP 8.1+. Il render server-side richiede `ffmpeg` nel PATH e `shell_exec` abilitato (es. VPS). Senza, il client usa automaticamente il render nel browser.

## Architettura frontend (`assets/js/`, ES modules)
- **state.js** — modello progetto/EDL (`fps`, `width/height`, `media[]`, `tracks[]` con `clips[]`) + store osservabile (`store.on/emit`), selezione, `splitAtPlayhead()`, `duration()`. Una clip ha `start,in,out,gain,fadeIn,fadeOut,transition,fx{brightness,contrast,saturation,opacity,scale}`.
- **media.js** — import file (video/audio/immagini), `objectURL`, lettura metadati, thumbnail, decode audio per waveform; render del media bin; `runtime` (Map id→{element,thumb,audioBuffer}).
- **audio.js** — grafo Web Audio: gain per traccia, master, scheduling buffer sources con fade, mute; `drawWaveform()`.
- **effects.js** — `GLCompositor` WebGL: transform (posizione/scala/rotazione/flip), colore (brightness/contrast/saturation/exposure/hue/temperature/tint), stile (blur/sharpen/vignette/grayscale/sepia), opacità. `FX_PARAMS`/`FX_GROUPS` (registro per inspector e keyframe), `TRANSITIONS` (chiave→nome xfade). `comp.fill()` per le dissolvenze al nero/bianco.
- **preview.js** — motore di riproduzione: clock ancorato a `performance.now()` (indipendente dall'AudioContext, per non bloccarsi), compositing tracce video dal basso verso l'alto, **transizioni reali** tra clip sovrapposte (`drawTransition`: dissolve/dip-black/dip-white/wipe/slide/push), valutazione **keyframe** (`resolvedParams`), transport, playhead. `startLoop()` avvia il rAF.
- **timeline.js** — render righello/tracce/clip, zoom, drag&drop dal bin, spostamento clip (anche tra tracce dello stesso tipo), trim con maniglie, snap, waveform/thumb sulle clip.
- **inspector.js** — pannello "Controllo effetti" della clip selezionata (slider fx, audio gain/fade, transizione).
- **export.js** — `runExport`: server ffmpeg se disponibile, altrimenti `MediaRecorder` su `canvas.captureStream()` + audio (tempo reale, output WebM/MP4 secondo supporto browser).
- **project-io.js** — salva/apri su server, import/export file nativo `.cpproj` (JSON), upload media best-effort.
- **interchange.js** — export **EDL (CMX 3600)** e **FCPXML**, import **FCPXML** (formati di scambio che Premiere legge/scrive).
- **api-client.js** — fetch verso il backend.
- **main.js** — wiring: menu, transport, tastiera (Space play, S split, Canc elimina, ←/→ frame, Home/End), tema chiaro/scuro (persistito), badge motore, dialog export.

## Backend (`api/`, PHP 8.1 + SQLite)
- **_lib.php** — utility, `db()` (SQLite in `data/editor.sqlite`, tabella `projects`), `safe_upload_name`, `resolve_upload` (anti traversal), `ffmpeg_bin`, `can_exec`.
- **upload.php** — upload media in `uploads/` (whitelist estensioni, max 512MB).
- **project_save / project_list / project_load.php** — CRUD progetti su SQLite (JSON serializzato).
- **export.php** — `?probe=1` segnala se il server può renderizzare; in POST costruisce il **filter_complex ffmpeg** dall'EDL (overlay tracce video con `enable=between`, `eq` per colore, `colorchannelmixer` per opacità, `amix` per l'audio con `adelay`/`volume`) e scrive in `renders/`.

## Dati
- `data/` — SQLite + protetto da `.htaccess` (`Require all denied`).
- `uploads/` — media caricati (serviti staticamente, referenziati come `uploads/...`).
- `renders/` — output video.

## Tema
Toggle 🌙/☀️ in topbar; `data-theme="dark|light"` su `<html>`, override variabili CSS, scelta salvata in `localStorage` (`cp-theme`).

## Effetti, transizioni, keyframe, titoli (iterazione 2)
- **Effetti** (shader WebGL): Movimento (posX/posY/scala/rotazione/flipH/flipV/opacità), Colore (luminosità/contrasto/saturazione/esposizione/tonalità/temperatura/tinta), Stile (sfocatura/nitidezza/vignettatura/B&N/seppia).
- **Transizioni reali** create sovrapponendo due clip sulla stessa traccia: dissolvenza incrociata, al nero, al bianco, tendina, scorrimento, spinta. Tipo scelto nell'inspector. Preview blenda davvero; server usa **`xfade`** sulla traccia principale.
- **Keyframe**: pulsante ◆ accanto a ogni parametro fx aggiunge un keyframe al playhead; interpolazione lineare. Piena fedeltà nell'export **browser** (cattura il preview reale).
- **Titoli/testo**: pulsante "Titolo" crea una clip-titolo (canvas), editabile nell'inspector (testo/dimensione/colore/allineamento/grassetto/ombra); server via `drawtext`.

## Limiti noti — onestà tecnica
- Un **clone perfetto** di Premiere non è l'obiettivo: editor funzionante con le funzioni core.
- **Fedeltà export**: il render **browser** (MediaRecorder) cattura il preview reale → onora *tutti* gli effetti, le transizioni su ogni traccia e i keyframe. Il render **server (ffmpeg)** è massima qualità ma: `xfade` solo sulla traccia principale (le tracce superiori sono in overlay), effetti applicati col valore base (keyframe non interpolati lato server), transform parziale (scala/rotazione sì, offset XY centrato).
- Un solo elemento video per media in preview (clip multiple dallo stesso media in parallelo: futuro).
- `.prproj` nativo (binario gzip proprietario) e AAF non supportati per scelta; interscambio via EDL/FCPXML.
- WebCodecs come upgrade di precisione del seek (ora si usano elementi `<video>`).
