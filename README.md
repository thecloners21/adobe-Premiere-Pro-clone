# ClonePremiere 🎬

Editor video **multitraccia nel browser**, ispirato ad Adobe Premiere Pro.
Frontend HTML5 + JavaScript (moduli ES, nessun build), backend PHP + SQLite,
render finale con **ffmpeg** (server) e **fallback nel browser** (offline).

> Parte del progetto **[The Cloners](https://thecloners.altervista.org)** —
> software libero ispirato ai grandi classici.

## ▶️ Demo online
👉 **https://thecloners21.github.io/adobe-Premiere-Pro-clone/**

*(l'editor gira anche su GitHub Pages; le funzioni che richiedono PHP — salva/apri
sul server, render ffmpeg — usano automaticamente il fallback nel browser.)*

## ✨ Funzioni
- **Timeline multitraccia**: drag & drop, trim, taglio, spostamento, snap, zoom.
- **Strumenti pro**: **Ripple, Roll, Slip, Slide**, **marcatori** e **magnete**
  (snap) attivabile/disattivabile.
- **Anteprima in tempo reale** con compositing WebGL e **seek frame-accurate**
  (WebCodecs / `requestVideoFrameCallback`).
- **Effetti** (shader): Movimento (posizione/scala/rotazione/flip/opacità),
  Colore (luminosità/contrasto/saturazione/esposizione/tonalità/temperatura/tinta),
  Stile (sfocatura/nitidezza/vignettatura/B&N/seppia).
- **Color grading**: **curve RGB**, **ruote colore Lift/Gamma/Gain** (ombre/
  mezzitoni/luci) e **Secondaria HSL** (correzione su una sola banda di colore).
- **Maschere**: ellisse/rettangolo con sfumatura e inversione (ritaglio per clip).
- **Velocità clip**: slow & fast motion 10–400% con preset (video + audio).
- **Sequenze annidate (nesting)**: collassa la timeline in una sequenza-clip
  editabile come blocco unico (effetti/grading/maschere/velocità).
- **Libreria** Effetti e Transizioni con anteprime, applicabili con un clic.
- **Keyframe** su tutti i parametri, con **curve di accelerazione** (easing/Bézier).
- **Transizioni** vere: dissolvenza incrociata, al nero, al bianco, tendina,
  scorrimento, spinta (server via `xfade`).
- **Titoli avanzati**: stili preset, 10 font, contorno, banda *lower-third*,
  e **animazioni** (dissolvenze, scorrimenti, zoom, *macchina da scrivere*).
- **Audio avanzato**: mixer Web Audio, **keyframe di volume** con easing,
  **pan** stereo, **ducking** automatico, **VU meter**, fade, waveform.
- **Proxy** a bassa risoluzione per un editing fluido (export sempre a piena qualità).
- **Export video** MP4/WebM (server ffmpeg o browser MediaRecorder).
- **Progetti**: salva/apri (SQLite), import/export `.cpproj`, **FCPXML**, **EDL**.
- **Persistenza automatica**: il progetto (media inclusi) sopravvive al refresh
  (localStorage + IndexedDB).
- **Impostazioni**: sequenza (fps/risoluzione/sample rate), motore di render +
  **URL server ffmpeg**, proxy, **tema chiaro/scuro**.

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
