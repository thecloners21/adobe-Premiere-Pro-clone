# ClonePremiere — Manuale d'uso

Editor video multitraccia che gira nel browser, ispirato ad Adobe Premiere Pro.
Made by **The Cloners**.

---

## 1. Avvio

> ⚠️ **Non aprire `index.html` con doppio click.** I browser bloccano i moduli
> JavaScript sotto `file://`. L'app va servita via http.

**In locale:**
```bash
./avvia.sh          # avvia il server e apre il browser (porta 8099)
# oppure
php -S 127.0.0.1:8099    # poi apri http://127.0.0.1:8099/
```

**Su hosting:** carica la cartella e apri l'URL del sito. Serve PHP 8.1+.
Il render video di alta qualità (ffmpeg) richiede un hosting con `shell_exec` e
`ffmpeg` (es. VPS). Sugli hosting che non lo permettono, l'export avviene
automaticamente **nel browser** (vedi §10).

---

## 2. L'interfaccia

| Area | Funzione |
|------|----------|
| **Barra superiore** | Menu (Nuovo, Importa, Titolo, Salva/Apri, Esporta) e tema chiaro/scuro 🌙/☀️ |
| **Media** (sinistra) | I file importati. Si trascinano in timeline |
| **Programma** (centro) | Anteprima del montaggio + comandi di riproduzione |
| **Controllo effetti** (destra) | Effetti, keyframe, transizioni e testo della clip selezionata |
| **Timeline** (in basso) | Le tracce video (V) e audio (A) con le clip |

---

## 3. Importare i media

- **Importa media** dal menu, oppure **trascina** i file (video/audio/immagini)
  direttamente nel pannello *Media*.
- Ogni media mostra anteprima, tipo e durata.
- I formati supportati dipendono dal browser (MP4/WebM/MOV, MP3/WAV/OGG, PNG/JPG…).

---

## 4. Montaggio sulla timeline

- **Aggiungere una clip:** trascina un media dal pannello *Media* su una traccia.
  I video/immagini vanno sulle tracce **V**, l'audio sulle tracce **A**.
- **Spostare:** trascina la clip; puoi spostarla anche su un'altra traccia dello
  stesso tipo. Le clip si **agganciano** (snap) ai bordi delle altre e al cursore.
- **Tagliare (trim):** trascina i bordi sinistro/destro della clip.
- **Dividere:** porta il cursore (playhead) sul punto e premi **✂ Taglia** (o `S`).
- **Eliminare:** seleziona la clip e premi **🗑** (o `Canc`).
- **Zoom:** cursore *Zoom* nella barra della timeline.

**Testate traccia:** ogni traccia ha i pulsanti **M** (muto) e **S** (solo);
le tracce **audio** hanno anche **D** (ducking, vedi §13).

---

## 5. Riproduzione (transport) e scorciatoie

| Comando | Azione | Tasto |
|---------|--------|-------|
| ▶ / ⏸ | Play / Pausa | `Spazio` |
| ⏮ / ⏭ | Inizio / Fine | `Home` / `End` |
| ◀ / ▶ | Fotogramma indietro / avanti | `←` / `→` |
| ✂ | Dividi al playhead | `S` |
| 🗑 | Elimina clip selezionata | `Canc` |

Clic sul **righello** per spostare il cursore nel tempo.

---

## 6. Effetti

Seleziona una clip: nel pannello **Controllo effetti** trovi tre gruppi.

- **Movimento:** Posizione X/Y, Scala, Rotazione, Opacità, Capovolgi orizz./vert.
- **Colore:** Luminosità, Contrasto, Saturazione, Esposizione, Tonalità,
  Temperatura, Tinta.
- **Stile:** Sfocatura, Nitidezza, Vignettatura, Bianco e nero, Seppia.

Muovi gli slider: l'anteprima si aggiorna in tempo reale.

---

## 7. Keyframe (animazione degli effetti)

Accanto a ogni parametro c'è un **◆**.

1. Porta il cursore sul punto d'inizio dell'animazione.
2. Imposta il valore con lo slider e premi **◆**: crea un keyframe.
3. Sposta il cursore avanti, cambia il valore: viene creato un secondo keyframe.

Tra due keyframe il valore viene **interpolato** automaticamente (es. una
dissolvenza di opacità, un movimento, uno zoom). Il diamante diventa azzurro
quando il parametro è animato.

Sotto un parametro animato compare **↳ accelerazione**: scegli la curva
(Lineare, Ease In, Ease Out, Ease In/Out, Hold a scatti) per dare un movimento
più morbido o meccanico, come in Premiere.

> I keyframe sono resi al 100% nell'export **browser**. Nell'export server viene
> usato il valore base (vedi §10).

---

## 8. Transizioni

Le transizioni si creano **sovrapponendo due clip** sulla stessa traccia
(trascina la seconda in modo che copra in parte la prima). Nella zona di
sovrapposizione appare l'indicatore della transizione.

Seleziona la clip entrante e scegli il **tipo** in *Transizione in entrata*:
- Dissolvenza incrociata, Dissolvenza al nero, Dissolvenza al bianco,
  Tendina (→/←), Scorrimento (→/←), Spinta.

---

## 9. Titoli e testo

1. Menu **Titolo**: crea una clip-titolo nel pannello *Media*.
2. Trascinala su una traccia video (in alto, così sta sopra il video).
3. Selezionala e modifica nel pannello: testo, dimensione, colore,
   allineamento, grassetto, ombra.

I titoli hanno sfondo trasparente: si sovrappongono al video sottostante.

---

## 10. Esportare il video

Menu **Esporta video** → scegli risoluzione, formato (MP4/WebM) e **motore**:

- **Automatico:** usa il server (ffmpeg) se disponibile, altrimenti il browser.
- **Server (ffmpeg):** massima qualità e velocità. Richiede hosting compatibile.
- **Browser (MediaRecorder):** funziona ovunque, **in tempo reale** (l'export
  dura quanto il video). Cattura fedelmente *tutti* gli effetti, le transizioni
  e i keyframe dell'anteprima.

Premi **Avvia render**: a fine lavoro il file viene scaricato.

---

## 11. Salvare e riaprire il progetto

- **Salva / Apri:** salva il progetto sul server (database SQLite) e lo riapri.
- **Esporta progetto:** scarica un file del montaggio. Formati:
  - `.cpproj` — formato nativo completo;
  - **FCPXML** — interscambio con Premiere / Final Cut;
  - **EDL (CMX 3600)** — edit decision list classica.
- **Importa progetto:** ricarica un `.cpproj` o un **FCPXML**.

> Nota: i file `.cpproj`/FCPXML salvano il *montaggio* (clip, tagli, effetti),
> non i media. Dopo l'import potrebbe servire re-importare i file sorgente.

---

## 12. Tema chiaro / scuro

Pulsante 🌙/☀️ nella barra superiore. La scelta viene ricordata.

---

## 13. Audio avanzato (volume, pan, ducking, VU)

Seleziona una **clip audio**: nel pannello *Controllo effetti* trovi il gruppo **Audio**.

- **Volume con keyframe:** premi **◆** accanto a *Volume* per animare il volume nel
  tempo (es. una dissolvenza manuale). Come per gli effetti, compare la curva di
  **accelerazione** (Lineare/Ease In/Out…).
- **Pan (L↔R):** sposta il suono a sinistra o a destra nel campo stereo.
- **Fade in / Fade out:** dissolvenze automatiche d'ingresso/uscita.

**Ducking automatico:** attiva **D** sulla testata di una traccia audio (es. la
musica). Durante la riproduzione, quella traccia si **abbassa automaticamente**
quando le **altre** tracce audio (es. la voce) hanno del suono, e torna su quando
finiscono — come la funzione *Ducking* di Premiere.

**VU meter:** nella barra di riproduzione, sotto il monitor, il **VU meter
stereo** (L/R) mostra il livello d'uscita in tempo reale durante il play.

---

## 14. Persistenza automatica

Il progetto viene **salvato automaticamente nel browser**: chiudendo o
**ricaricando la pagina** ritrovi il montaggio com'era, **media inclusi**.

- La *struttura* del progetto (clip, tagli, effetti, keyframe, titoli) è salvata
  in `localStorage`; i *file media* sono conservati in **IndexedDB** e ricollegati
  al riavvio.
- Premendo **Nuovo** la cache locale viene azzerata.
- Il salvataggio è locale a quel browser/computer: per portare il progetto
  altrove usa **Salva** (server) o **Esporta progetto** (file).

---

## 15. Limiti noti

- Editor con le funzioni core: non riproduce il 100% di Adobe Premiere Pro.
- Export **server**: la dissolvenza `xfade` è applicata sulla traccia
  principale; le tracce superiori sono in sovrapposizione; gli effetti usano il
  valore base (i keyframe non sono interpolati lato server). Per la massima
  fedeltà usa l'export **browser**.
- I formati `.prproj` (binario proprietario) e AAF non sono supportati;
  l'interscambio avviene via EDL/FCPXML.

---

*The Cloners — software libero ispirato ai grandi classici.*
