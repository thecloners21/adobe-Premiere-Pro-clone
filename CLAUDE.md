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
- **audio.js** — grafo Web Audio: gain per traccia, master, scheduling buffer sources con fade, mute; `drawWaveform()`. **Audio avanzato**: pan stereo per clip (`StereoPanner`), envelope di **volume da keyframe** (`setValueCurveAtTime`, easing campionato), **ducking** automatico per traccia (`applyDucking`, curva su trackGain), **VU meter** stereo (`getLevels()` via `AnalyserNode` L/R, disegnato in `preview.js`).
- **persist.js** — persistenza locale automatica: struttura progetto in `localStorage` (`cp-autosave-v1`), **blob dei media in IndexedDB** (`clonepremiere/media`); ripristino al refresh in `main.js` con `rehydrateFromBlob`/`rehydrateTitle` (media.js). Azzerata da "Nuovo".
- **effects.js** — `GLCompositor` WebGL: transform (posizione/scala/rotazione/flip), colore (brightness/contrast/saturation/exposure/hue/temperature/tint), stile (blur/sharpen/vignette/grayscale/sepia), opacità. **Curve RGB** (color grading): LUT 256x1 su texture unit 1 nello shader (`uLUT`/`uUseLUT`), costruita da `buildCurveLUT(curves)` con `makeCurveSampler` (Hermite monotona Fritsch–Carlson); `isIdentityCurves` salta la LUT. `FX_PARAMS`/`FX_GROUPS`, `TRANSITIONS`. `comp.fill()` per le dissolvenze.
- **curveeditor.js** — editor curve interattivo (canvas) per `clip.curves` ({rgb,r,g,b} = punti {x,y}); drag/aggiungi/rimuovi punti, tab canale, reset. Aggiorna `clip.curves`; l'anteprima si ridisegna da rAF (LUT in cache per clip in `preview.js`); autosave via `store.emit('touch')`.
- **Bilanciamento colore (Lift/Gamma/Gain)**: `clip.color` ({shadows,mids,highlights} = {color,lum}); `computeLGG`/`isNeutralColor` in effects.js → uniform vec3 `uLift/uGamma/uGain` (+`uUseLGG`), shader `pow(c*gain+lift, 1/gamma)`; cache per clip in preview; UI nell'inspector (gruppo "Bilanciamento colore", emit('touch')). Curve e LGG renderizzati anche nelle transizioni; export browser li cattura.
- **preview.js** — motore di riproduzione: clock ancorato a `performance.now()` (indipendente dall'AudioContext, per non bloccarsi), compositing tracce video dal basso verso l'alto, **transizioni reali** tra clip sovrapposte (`drawTransition`: dissolve/dip-black/dip-white/wipe/slide/push), valutazione **keyframe** (`resolvedParams`), transport, playhead. `startLoop()` avvia il rAF.
- **timeline.js** — render righello/tracce/clip, zoom, drag&drop dal bin, spostamento clip (anche tra tracce dello stesso tipo), trim con maniglie, snap, waveform/thumb sulle clip. **Strumenti pro (#6)**: `store.tool` (select/ripple/roll/slip/slide) + `store.snap` (magnete); `rippleTrim`/`rollTrim`/`slipDrag`/`slideDrag` (invarianti di durata validati); **marcatori** su `project.markers` resi sul righello (clic=vai, doppio clic=elimina). Pulsante **✕** sul bin → `removeMediaFully` (clip+runtime+objectURL+blob).
- **inspector.js** — pannello "Controllo effetti" della clip selezionata (slider fx, audio gain/fade, transizione). **Velocità/Durata**: gruppo con slider 10–400% + preset (25/50/100/200/400%), durata risultante live (`speedDurGroup`/`applySpeed`, emit `'speed'`).
- **Velocità clip (slow/fast motion)**: `clip.speed` (1 = normale). Helper centrali in state.js: `clipDur(clip)=(out-in)/speed` (durata timeline), `srcAt(clip,localT)=in+localT*speed` (mappa tempo timeline→sorgente), `clipSpeed`. Playback: `el.playbackRate=speed` + seek con `srcAt` (preview.js); audio via `src.playbackRate` e schedulazione in tempo di output con `stop()` (audio.js). Timeline: larghezza/snap/indicatori e tutti gli strumenti (trim, ripple/roll/slip/slide) convertono il delta px in sorgente con `*speed` (per-clip); badge `%` sulla clip. Render server: `setpts=(PTS-STARTPTS)/speed` (video) e catena `atempo` (audio) in export.php; durate via `cdur`. Interscambio EDL/FCPXML usa `clipDur` sul lato timeline.
- **export.js** — `runExport`: server ffmpeg se disponibile, altrimenti `MediaRecorder` su `canvas.captureStream()` + audio (tempo reale, output WebM/MP4 secondo supporto browser).
- **project-io.js** — salva/apri su server, import/export file nativo `.cpproj` (JSON), upload media best-effort.
- **interchange.js** — export **EDL (CMX 3600)** e **FCPXML**, import **FCPXML** (formati di scambio che Premiere legge/scrive).
- **webcodecs.js** (#7) — `seekExact` (seek frame-accurate via `requestVideoFrameCallback`, con `VideoFrame` WebCodecs quando disponibile), `grabFrame`, `makeProxy` (proxy a bassa risoluzione via canvas+MediaRecorder). `precisionLabel()` per il badge. In `preview.js`: `elementFor` usa il proxy in editing, `setExportMode(true)` forza gli originali in export.
- **settings.js** (#7/Impostazioni) — preferenze app in `localStorage` (`cp-settings-v1`): `defaultEngine`, `serverBase` (endpoint ffmpeg remoto, usato da `api-client.js`), `proxyWidth`. Le impostazioni di *sequenza* (fps/risoluzione/sampleRate) restano nel progetto. Dialog "Impostazioni" in `main.js` (`openSettings`).
- **api-client.js** — fetch verso il backend; l'endpoint base è `serverBase()` (Impostazioni) + `api/`.
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
- **Titoli/testo**: pulsante "Titolo" crea una clip-titolo (canvas), editabile nell'inspector; server via `drawtext`. **Titoli avanzati (#8)**: `TITLE_FONTS`, `TITLE_STYLES` (preset stile), `TITLE_ANIMS`; modello esteso (font/italic/stroke{color,width}/bg+bgOpacity/band/anim{type,dur}); `renderTitleCanvas` disegna contorno, banda lower-third e supporta `typeProgress` (typewriter); `titleAnimOpts(ti,localT,clipLen)` → opts (alpha/slide/scale/typeProgress) applicati in `preview.drawClip`. Animazioni browser-only (l'export server resta statico via drawtext).

## Limiti noti — onestà tecnica
- Un **clone perfetto** di Premiere non è l'obiettivo: editor funzionante con le funzioni core.
- **Fedeltà export**: il render **browser** (MediaRecorder) cattura il preview reale → onora *tutti* gli effetti, le transizioni su ogni traccia e i keyframe. Il render **server (ffmpeg)**: `xfade` solo sulla traccia principale (le tracce superiori sono in overlay). I **keyframe sono interpolati lato server** per luminosità/contrasto/saturazione/esposizione/tonalità/B&N/rotazione (espressioni tempo-varianti `eq eval=frame`/`hue`/`rotate`); opacità/scala/posizione keyframate restano browser-only. Offset XY transform centrato.
- **Velocità clip**: l'audio cambia anche di tono (come Premiere senza "Mantieni tono"). Reverse non supportato (i `<video>` HTML non riproducono all'indietro in modo affidabile). Il render server usa `atempo` concatenato; l'export browser cattura il preview reale.
- Un solo elemento video per media in preview (clip multiple dallo stesso media in parallelo: futuro).
- `.prproj` nativo (binario gzip proprietario) e AAF non supportati per scelta; interscambio via EDL/FCPXML.
- WebCodecs come upgrade di precisione del seek (ora si usano elementi `<video>`).
