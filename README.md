# ClonePremiere 🎬

Editor video **multitraccia nel browser**, ispirato ad Adobe Premiere Pro.
Frontend HTML5 + JavaScript (moduli ES, nessun build), backend PHP + SQLite,
render finale con **ffmpeg** (server) e **fallback nel browser** (offline).

> Parte del progetto **[The Cloners](https://thecloners.altervista.org)** —
> software libero ispirato ai grandi classici.

## ▶️ Demo online
👉 **https://dplusos21.github.io/adobe-Premiere-Pro-clone/**

*(l'editor gira anche su GitHub Pages; le funzioni che richiedono PHP — salva/apri
sul server, render ffmpeg — usano automaticamente il fallback nel browser.
Dopo il trasferimento del repo all'org, la demo sarà su
`https://thecloners21.github.io/adobe-Premiere-Pro-clone/`.)*

## ✨ Funzioni
- **Timeline multitraccia**: drag & drop, trim, taglio, spostamento, snap, zoom.
- **Anteprima in tempo reale** con compositing WebGL.
- **Effetti** (shader): Movimento (posizione/scala/rotazione/flip/opacità),
  Colore (luminosità/contrasto/saturazione/esposizione/tonalità/temperatura/tinta),
  Stile (sfocatura/nitidezza/vignettatura/B&N/seppia).
- **Keyframe** su tutti i parametri (interpolazione).
- **Transizioni** vere: dissolvenza incrociata, al nero, al bianco, tendina,
  scorrimento, spinta (server via `xfade`).
- **Titoli/testo** sovrapponibili.
- **Audio**: mixer Web Audio, volume/fade, waveform.
- **Export video** MP4/WebM (server ffmpeg o browser MediaRecorder).
- **Progetti**: salva/apri (SQLite), import/export `.cpproj`, **FCPXML**, **EDL**.
- **Tema** chiaro/scuro.

## 🚀 Avvio
> Non aprire `index.html` con doppio click (i moduli ES sono bloccati da `file://`).
```bash
./avvia.sh            # avvia php -S e apre il browser
# oppure
php -S 127.0.0.1:8099 # poi apri http://127.0.0.1:8099/
```
Serve **PHP 8.1+**. Il render server-side richiede `ffmpeg` e `shell_exec`.

## 📖 Documentazione
- **[MANUALE.md](MANUALE.md)** — guida d'uso completa.
- **[CLAUDE.md](CLAUDE.md)** — architettura tecnica.

## 🧱 Stack
HTML5 · CSS · JavaScript (ES modules) · WebGL · Web Audio · PHP 8.1 · SQLite · ffmpeg

## 📄 Licenza
MIT
