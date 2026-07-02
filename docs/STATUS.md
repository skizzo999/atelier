# STATUS - Atelier

## Stato attuale
Editor Markdown **completo** a 3 viste (Codice / Ibrida / Lettura) con live preview
ricco in stile Obsidian. Viewer immagini ricco: editing + **annotazioni** con
**selezione/modifica** (sposta/ridimensiona/warp/rotazione testo), **zoom/pan dinamico**
unificato, **pannello Informazioni**, copia immagine, apri in Explorer, **regolazioni
funzionali** e **OCR**. **Viewer PDF avanzato**: selezione testo (vero + OCR automatico
sulle scansioni), zoom Ctrl+rotella fluido e centrato, navigazione laterale (miniature +
indice), ricerca nel PDF (Ctrl+F) e globale (Ctrl+Shift+F entra in PDF e DOCX), **evidenziatore
salvato dentro al PDF** (3 colori personalizzabili). **Editor DOCX stile Word con PAGINE
A4 VERE** (TipTap + tiptap-pagination-plus): barra ricca (font/dimensione/colore/interlinea/
liste/tabelle/…), pannello Impostazioni documento (formato/orientamento/margini/header/piè
coi numeri pagina), salvataggio che riscrive il .docx (formattazione + sezione Word +
intestazioni/piè). Pronti anche: **vault stile Obsidian** (`.atelier\vault.json` + picker con lista vault,
anche per la 2ª istanza), file tree con watcher, gestione file (**Cestino**),
**drag-and-drop nel tree**, import da Explorer, **modale "Nuovo file"**, ricerca.
Sicurezza: **CSP di produzione** + **guardia chiusura** (UI provvisoria).
Release automatiche dai tag `v*` (ultima pubblicata: **v0.2.2**).
Prossimi: stampa trasversale, pptx/xlsx.

## Cosa è fatto
- [x] Setup Tauri 2 + React 19 + TypeScript + Tailwind; layout sidebar + area editor
- [x] FileTree (react-arborist) con espansione lazy + **watcher filesystem** (live)
- [x] Comando Rust `allow_path` (scope fs ricorsivo sulla cartella scelta)
- [x] Store Zustand persistito: `vaultPath` + `mode`. Buffer non salvati (testo e immagini)
- [x] **Sistema vault "vero" stile Obsidian**: ogni vault ha `\.atelier\vault.json`
  (nome/data, creato all'apertura; cartella-punto già nascosta da tree e ricerca).
  **Picker dei vault** (Welcome): lista dei vault conosciuti a sinistra (persistita,
  ✕ per toglierli dalla lista senza toccare il disco) + Crea/Apri a destra. Mostrato:
  al primo avvio, se il vault sparisce, e quando apri una **seconda istanza** di
  Atelier (heartbeat in localStorage condiviso, soglia 8s — la 2ª finestra parte dal
  picker invece di auto-aprire l'ultimo vault). Auto-apertura ultimo vault + validazione
  al boot come prima; l'indicizzazione parte solo a boot finito (scope fs già concesso)
- [x] Gestione file: crea/rinomina/elimina (menu tasto destro su elemento o area vuota).
  **Eliminare = Cestino di Windows** (comando Rust `trash_path`, crate `trash`), non
  cancellazione definitiva. I comandi Rust (`trash_path`, `set_hidden`) accettano solo
  percorsi dentro lo scope del vault (`ensure_in_scope`). Il `.bak` dei .docx segue il
  file su rinomina/spostamento e va nel Cestino con lui all'eliminazione
- [x] Ricerca: quick-open per nome (Ctrl+P) + contenuto (Ctrl+Shift+F) con highlight.
  File di servizio (`.tmp`/`.bak`/`.atelier`) esclusi come nel tree; cache testo PDF/DOCX
  invalidata via mtime (`stat`); `walkFiles` salta le cartelle-symlink (anti-ciclo) con
  limite di profondità 64
- [x] Viewer per tipo (FileView): **immagini** con editing (ruota/capovolgi/ridimensiona/
  **ritaglio** con scelta "applica"/"crea nuova foto"), buffer, salvataggio binario atomico
- [x] **Annotazioni immagini (fase 2)**: penna a mano libera (2 penne configurabili e
  persistenti, slider opacità+spessore), frecce (con punta), forme (rettangolo, ellisse,
  triangolo, linea), testo. Overlay SVG in coord immagine, "Applica" = flatten sul canvas
  (riusa la pipeline buffer+atomica, distruttivo in V1)
- [x] **Annotazioni — selezione/modifica** (strumento Selez.): sposta, ridimensiona col
  box (testo/penna/rettangolo/ellisse), warp dei punti di controllo (freccia/linea con
  centro che curva, triangolo a 3 vertici), **rotazione 360° del testo**; pannello
  proprietà (colore/opacità/spessore-dimensione), elimina (Canc)
- [x] **Zoom/pan dinamico** unificato (hook `useImageViewport`): rotella verso il cursore,
  trascina per spostare, fit auto, controlli −/%/+/Adatta. Vale per immagini editabili e
  sola-lettura, dentro e fuori da "Annota"
- [x] **Pannello Informazioni** (stile Foto di Windows): nome con rinomina inline,
  dimensioni, peso, DPI, tipo, percorso + copia; **Copia immagine** (PNG negli appunti);
  **Apri in Explorer** (plugin-opener). Su immagini editabili e sola-lettura
- [x] **Gomma a pixel** (annotatore): tratto a mano libera che cancella i pixel delle
  annotazioni (non tocca la foto). **Ordinata**: cancella solo i tratti precedenti, quindi
  dopo aver gommato si può ridisegnare sopra (preview con maschere per-gruppo, flatten con
  loop ordinato + destination-out → preview e salvato coincidono)
- [x] **Regolazioni funzionali** (modalità Regola): luminosità/contrasto/saturazione con
  preview live, Applica/Annulla/Reset (niente filtri estetici)
- [x] **OCR** (estrai testo): Tesseract.js lazy-load (ita+eng), risultato in modale con
  copia. Nota: 1° uso scarica il modello lingua dalla rete (poi in cache)
- [x] **Viewer PDF avanzato** (PDF.js + pdf-lib): scroll continuo, render pigro per
  pagina (IntersectionObserver), worker bundlato offline. In più:
  - **Zoom Ctrl+rotella** fluido (scale CSS istantaneo + ri-render nitido al rilascio,
    debounce) che tiene le pagine centrate; anche −/+/Adatta
  - **Selezione/copia testo** (text layer pdf.js) su PDF di testo
  - **OCR automatico** sulle pagine scansionate (Tesseract, worker persistente): in
    background trova le pagine senza testo, le riconosce e crea uno strato di testo
    selezionabile/cercabile (spazi+a-capo per copia leggibile, filtro confidenza)
  - **Navigazione laterale a scomparsa**: miniature (lazy) + indice/segnalibri del PDF
  - **Ricerca nel PDF** (Ctrl+F): testo vero + OCR, conteggio, prev/next, scroll e
    evidenziazione risultati (corrente in arancione)
  - **Ricerca globale** (Ctrl+Shift+F) ora entra anche nei PDF di testo (estrazione in
    cache); aprendo un risultato salta al match dentro al PDF
  - **Evidenziatore** (modalità a tasto): selezioni il testo → evidenzi; 3 colori
    personalizzabili (persistiti); rimozione con click (modalità spenta) → "Rimuovi";
    **salvataggio automatico DENTRO il PDF** come annotazioni /Highlight + JSON nel
    catalog per ricaricarle con coordinate esatte (riparte da base pulita, valida prima
    di sovrascrivere). Canvas renderizzato con annotationMode DISABLE (niente doppione)
  - **Pannello Informazioni** (nome/pagine/peso/percorso+copia), **Apri in Explorer**
- [x] **Editor DOCX stile Word, con PAGINE VERE** (TipTap/ProseMirror): apri un .docx ed è
  **subito editabile**, su **fogli A4 reali** (paginazione automatica con
  **tiptap-pagination-plus**, MIT/v3 — il fai-da-te a decorazioni sfarfallava). Pagine
  bianche centrate, staccate, **zoom** (Ctrl+rotella, −/%/+).
  - **Barra** (set del TipTap Simple Editor + pro): annulla/ripeti, **5 tipi** (P, H1-H4),
    **carattere**, **dimensione**, **interlinea** (nostra, `lib/lineHeight.ts`, per
    paragrafo), liste (puntata/numerata/**attività**), blocco codice, citazione, B/I/
    barrato/codice/sottolineato, **popover unico colore testo + evidenziatore**, link,
    **apice/pedice**, allineamenti, immagine (da file), riga, Typography
  - **⚙️ Impostazioni documento** (pannello 2 tab): formato (A4/Letter/Legal/A3/A5),
    **orientamento**, **margini** (cm), spazio tra pagine, **colore foglio**; e
    **intestazioni** (sx/dx con `{page}`) + **piè** (testo a sinistra, **numero pagina a
    destra** in 3 stili: numero / n/tot / "Pagina n di tot"). Il **totale** lo calcoliamo
    noi (l'estensione conosce solo {page})
  - **Import**: Mammoth (docx→HTML→TipTap, DOMPurify)
  - **Salva** (Ctrl+S / 💾): **SOVRASCRIVE** il .docx (`lib/htmlToDocx.ts`, libreria `docx`).
    Preserva: titoli, B/I/U/barrato, apici/pedici, **colore/font/dimensione/evidenziato**,
    **allineamento/interlinea**, liste annidate, citazioni, tabelle, immagini; e scrive la
    **sezione Word** (formato/orientamento/margini) + **intestazioni/piè con campi numero
    pagina veri** (corrente+totale calcolati da Word). **Backup `.bak`** la 1ª volta;
    **buffer** non salvato (pallino tree, non perde uscendo)
  - **Persistenza impostazioni**: Mammoth in apertura legge solo il corpo → formato/
    orientamento/margini/header/piè/numero pagina/colore foglio sono salvati in un **file
    affianco `<nome>.docx.atelier`** (JSON, nascosto come il `.bak`) e **riletti+applicati
    SUBITO all'apertura** (niente flash del foglio bianco). Il colore foglio va anche nel .docx
  - **Export in Markdown**, **Apri in Explorer**. Fedeltà "Mammoth" in import (non
    byte-perfect). Solo .docx
- [x] **Editor Markdown a 3 viste:**
  - **Codice**: CodeMirror 6 con syntax highlight markdown (oneDark)
  - **Lettura**: marked + DOMPurify (+ prose, allineato all'Ibrida)
  - **Ibrida** (live preview, CM6): titoli ATX+Setext, grassetto/corsivo/barrato,
    evidenziato `==`, liste puntate/task ☑, citazioni (annidate), righe, **tabelle
    vere editabili** (vedi bullet sotto), link, **wikilink navigabile**, **callout** (titolo = tipo + corpo,
    reso come `::before`, allineato alla Lettura), blocchi di codice (**syntax
    highlight** + label linguaggio + ``` nascosti), **immagini** (`![alt](path)` e
    `![[file]]`, cercate per nome in tutto il vault)
  - **Vista ricordata**: l'ultima scelta (Codice/Ibrida/Lettura) è persistita nello
    store (`mdView`), l'app riapre come l'hai lasciata invece di tornare a Codice
- [x] **Tabelle stile Obsidian in Ibrida** (`CodeMirror/tableEditor.ts`): la tabella md è
  un **widget a blocco da StateField** (unico modo in CM6) con **celle contentEditable**:
  scrivi nel testo, la struttura resta; ogni battuta ri-serializza il markdown nel doc
  (eco soppressa via `dataset.md` in `updateDOM` → il cursore non salta). **Tasto destro
  sulla cella**: menu Riga (prima/dopo/sposta/duplica/elimina), Colonna (idem), Ordina
  A→Z/Z→A. **Selezione multi-cella** trascinando (stile Excel): Ctrl+C = TSV, Canc = svuota.
  Bottoni **+ riga** (sotto) e **+ colonna** (bordo destro) su hover. Tab/Invio navigano
  (Tab su ultima cella = nuova riga), Esc esce dopo la tabella. Celle = testo semplice
  (il md inline nelle celle non è renderizzato, v2)
- [x] **Menu tasto destro nei .md** (Codice+Ibrida): Aggiungi collegamento `[[ ]]`/link
  `[]()`, Formattazione (grassetto/corsivo/barrato/evidenziato/codice), Paragrafo
  (titoli/liste/attività/citazione — toggle), Inserisci (tabella/blocco codice/callout/
  riga), Taglia/Copia/Incolla/Seleziona tutto. Nota: Incolla usa `clipboard.readText`
  (se il webview lo nega → Ctrl+V)
- [x] **Aria in Ibrida**: spazio sotto i titoli (`blockspace` padding-bottom) e
  `padding-bottom: 30vh` a fine nota (scroll oltre l'ultima riga, come Obsidian)
- [x] **Header**: mostra il percorso completo del file aperto (prima solo il vault)
- [x] **Drag-and-drop nel tree**: sposti file/cartelle trascinandoli (react-arborist
  `onMove` + `rename` su disco); buffer non salvati rimappati (anche interi sottoalberi,
  via `movePathPrefix` nello store — vale pure per la rinomina), selezione aggiornata.
  Collisione di nome in destinazione = spostamento saltato (log in console)
- [x] **Import trascinando da fuori**: file trascinati da Explorer di Windows sull'albero
  → **copiati nella radice del vault** (mai sovrascritti: suffisso "-importato") e aperti.
  Overlay blu "Rilascia per importare". Le cartelle non arrivano dal drop HTML5 (saltate)
- [x] **Modale "Nuovo file"** (bottone in sidebar + tasto destro explorer): nome a sinistra,
  tipo a destra (md/docx/txt; placeholder disabilitati xlsx/pptx; cascata "Programmazione"
  con html/css/js/ts/py/java/php/json). Estensione digitata a mano = tipo auto-selezionato.
  I **.docx nuovi sono DOCX veri** (un file da 0 byte non era apribile — era il bug
  "Impossibile aprire il documento")
- [x] **Sicurezza**: CSP severa in produzione (script-src 'self'+wasm, whitelist IPC/OCR/blob)
  con devCsp permissiva per Vite; **guardia chiusura** (`onCloseRequested` + confirm nativo,
  UI provvisoria) se ci sono modifiche non salvate
- [x] **Igiene v0.2.2** (audit): DPI originale preservato nel salvataggio immagini
  (`applyDpi`: PNG pHYs + JPEG JFIF; qualità lossy 0.92→0.95); evidenziatore PDF fa il
  **backup `.bak`** (nascosto) alla 1ª scrittura; `.tmp` rimossi se il rename atomico
  fallisce; worker OCR terminato dopo 90s di inattività; MIME immagini in `lib/mime.ts`;
  la creazione vault non concede più lo scope sulla cartella genitore
- [x] Salvataggio atomico (tmp+rename); `Ctrl+S`; indicatore "non salvato" (tree + editor);
  risync col disco al focus finestra
- [x] Navigazione wikilink: click su `[[nota]]` apre la nota (o la crea)

## Prossimi step (in ordine di priorità)
1. **Altri formati**: ✅ PDF e DOCX (view+edit) → **pptx/xlsx** (SheetJS / viewer dedicati).
   Nella modale "Nuovo file" ci sono già i placeholder (disabilitati).
2. **Stampa** trasversale (a tutti i tipi di file, non solo immagini).
3. (Opzionale) **OCR nativo Windows** (Windows.Media.Ocr) per OCR 100% offline.
   - Vale anche per il PDF: oggi l'OCR scarica il modello al 1° uso (rete).
4. (Opzionale) **Modifica ed esporta come PNG** per gif/svg/bmp/avif (oggi sola lettura).
5. **Rifiniture Ibrida**: liste numerate/annidate, footnote, math (KaTeX), icona ↗ link
   esterni, md inline renderizzato dentro le celle tabella
6. **Parte grafica**: token colore, tema unificato; code-split di CodeMirror (bundle grande);
   **dialog chiusura** → modale custom in-app (il confirm nativo non piace)

> L'**editor immagini è completo**: trasformazioni, ritaglio, annotazioni con
> selezione/modifica/rotazione, **gomma a pixel**, regolazioni, info/copia/OCR/Explorer.

## Note tecniche
- Progetto: C:\Users\matte\Desktop\Atelier\atelier
- Stack: Tauri 2 + React 19 + TS + Tailwind v3 + Zustand 5 + react-arborist 3 +
  CodeMirror 6 (lang-markdown/GFM, language-data, theme-one-dark, @lezer/highlight,
  @lezer/markdown) + marked 18 + marked-highlight + highlight.js + DOMPurify
- Permessi fs: read-text-file, write-text-file, read-file, write-file, read-dir,
  mkdir, exists, rename, remove, watch, unwatch
- Comando Rust custom: `allow_path` → `FsExt::fs_scope().allow_directory(path, recursive)`
- Persistenza: `zustand/persist` (vaultPath + mode + **mdView** + **penPresets** via
  `partialize`); selectedFile e buffer non persistiti
- Annotazioni: `src/lib/annotations.ts` (tipi `Shape`, disegno su canvas condiviso
  preview/flatten); overlay SVG in `ImageViewer` con coord immagine (viewBox); le forme
  sono in pixel-immagine così preview e salvato coincidono
- Viewport immagini: hook `useImageViewport(containerRef, dims, wheelEnabled)` — un
  "palco" con `transform: translate+scale`; coord puntatore→immagine via la bounding rect
  trasformata dell'overlay
- **Formati immagine editabili = png/jpg/jpeg/webp**: il limite è `canvas.toBlob`, che
  ri-codifica solo questi. gif/svg/bmp/ico/avif sono sola-lettura (GIF perderebbe i
  fotogrammi, SVG è vettoriale). Eventuale editing → esportazione come PNG
- Input testo annotazione: `preventDefault` sul `mousedown` dell'SVG, altrimenti il
  browser sposta il focus al body e l'input si chiude subito
- Selezione/modifica annotazioni: `controlPoints`/`moveControl` (warp), `boundsOf`/
  `scaleShape`/`translateShape` (box resize), `rot` su ShapeBase (rotazione attorno al
  centro, hit-test/resize nel frame locale via `toLocal`/`rotatePt`)
- Metadati immagine: `src/lib/imageMeta.ts` (DPI da PNG pHYs / JPEG JFIF, peso);
  azioni in `src/lib/imageActions.ts` (copia PNG appunti, revealItemInDir)
- OCR: `tesseract.js` importato in lazy (chunk a parte); `ita+eng`; il modello lingua
  è scaricato al 1° uso (CSP `null` lo consente) e poi in cache
- **pnpm 11**: `pnpm-workspace.yaml` con `onlyBuiltDependencies` (esbuild, tesseract.js)
  e `verifyDepsBeforeRun: false` — senza, il build-script ignorato di tesseract fa
  uscire 1 dai comandi pnpm (blocca tsc/build/tauri)
- Live preview: src/components/CodeMirror/livePreview.ts (decorazioni dall'albero
  sintattico + pass regex per `==`, `[[ ]]`, `![[ ]]`); tema in modalità Ibrida
  senza oneDark (aspetto "documento")
- **IMPORTANTE (drag-and-drop)**: `dragDropEnabled: false` nella finestra (tauri.conf.json)
  è OBBLIGATORIO — il gestore drag-drop nativo di Tauri su Windows/WebView2 intercetta
  e rompe il drag HTML5 della pagina (react-arborist non partiva proprio). Con false:
  il drag interno funziona e i file esterni arrivano come drop HTML5 (nome+contenuto,
  niente path OS → per questo l'import COPIA il file invece di linkarlo)
- **IMPORTANTE**: i ViewPlugin di CM6 **non** possono fornire decorazioni a blocco
  (block widget/replace multi-riga) → causano crash. Per le tabelle boxate serve uno StateField.
- **IMPORTANTE (widget buffer)**: ogni `Decoration.replace` con widget viene avvolto da
  CM6 in `cm-widgetBuffer` (span inline invisibili). Su un widget `display:block`
  questi buffer creano un line-box alto quanto la `line-height` della riga → spazio
  "fantasma" sopra/sotto, non eliminabile via line-height. Soluzione usata per il
  titolo callout: niente widget, hide del marker + pseudo-elemento `::before`
  (`content: attr(data-callout)`). Vale come regola generale per i "titoli a blocco".
- Indici del vault (nome→path) per immagini (lib/images) e note (lib/notes), costruiti in App
- **PDF** (componente `PdfViewer.tsx`, lib `pdfOcr`/`pdfSearch`/`pdfHighlights`):
  - Render HiDPI (canvas a devicePixelRatio). Zoom: `scale` target (immediato, dimensione
    segnaposto) vs `renderScale` (debounce, rasterizzazione); il contenuto è scalato via
    CSS `scale(k)` finché non si ri-rasterizza nitido → zoom fluido senza lag
  - Text layer: pdf.js `TextLayer` per i PDF di testo; per le scansioni uno strato `.ocrLayer`
    costruito dai box delle parole OCR (coord a scala 1, stiramento scaleX a larghezza box)
  - Tutto in coord **scala 1** (punti PDF): token ricerca, parole OCR, rettangoli evidenziatore
  - Evidenziatore: annotazioni `/Highlight` (QuadPoints, y-flip via `page.getHeight()`) +
    JSON `AtelierHighlights` nel catalog (ricarica esatta). `annotationMode: DISABLE` nel
    render così il canvas non "cuoce" le annotazioni (le disegna solo l'overlay)
  - Salvataggio: `writeHighlights` riparte da una **base pulita** (strip delle nostre annot.)
    e **valida** l'output (riapre con pdf-lib) prima di sovrascrivere col file atomico

## Problemi aperti
- Bundle > 500kB (CM6 + highlight.js): valutare code-split / lazy import
- Indici immagini/note ricostruiti solo all'apertura del vault (una nota creata in
  sessione è apribile via fallback, ma entra nell'indice al riavvio)
- Tabelle in Ibrida: md inline nelle celle mostrato grezzo (render = step futuro)
- **PDF evidenziatore**: pagine con `/Rotate` non gestite (coord potrebbero non combaciare);
  cross-reader senza appearance stream (Adobe sì, lettori minimali forse no); selezione che
  attraversa due pagine non gestita
- **PDF ricerca globale**: non OCR-izza le scansioni del vault (troppo pesante) → trova solo
  i PDF con testo vero; le scansioni si cercano aprendole (OCR + Ctrl+F)
- **PDF OCR**: modello lingua scaricato dalla rete al 1° uso (come OCR immagini)
- **DOCX editor** (`DocxEditor.tsx`, `DocSettings.tsx`, `lib/htmlToDocx.ts`, `lib/lineHeight.ts`):
  - **Paginazione**: la fai-da-te a decorazioni sfarfallava (loop misura↔modifica) → si usa
    **tiptap-pagination-plus** (MIT, v3, mantenuta). html-docx-js scartato (usa `with`, Vite 7
    non lo parsa) → libreria **docx** per la scrittura. SuperDoc/TipTap-Pro-Pages = a
    pagamento/AGPL, non usati.
  - **Salva** SOVRASCRIVE il .docx (backup `.bak` 1ª volta + buffer non salvato). Import via
    Mammoth = semplificato → la formattazione non catturata in apertura si perde. Da provare
    a fondo in Word: sezione (margini/orientamento), header/footer coi campi numero pagina,
    tabelle/immagini/liste annidate.
  - **Interlinea**: estensione nostra (`lib/lineHeight.ts`) — quella di TipTap la mette sul
    mark inline e non funzionava sui nostri nodi. `@tiptap/core` aggiunto come dep diretta
    (serviva per l'augmentation dei comandi).
  - **Numero pagina totale**: pagination-plus conosce solo `{page}` → il totale lo calcoliamo
    noi a schermo (conta le pagine); nel .docx invece si usano i campi Word veri (TOTAL_PAGES).
  - **Persistenza impostazioni**: file affianco `<nome>.docx.atelier` (JSON) scritto al
    salvataggio e riletto+applicato all'apertura (prima di mostrare la pagina → no flash).
    Colore foglio anche nel .docx (Document background). File `.atelier` nascosti dal tree.
  - **Limite noto**: i .docx creati in Word (non da Atelier) → Atelier non ne rilegge la
    sezione (margini/orientamento/header di Word); al 1° salvataggio vengono riscritti coi
    default (il `.bak` protegge). Per leggerli servirebbe un parser dello `sectPr` (unzip XML).
  - Da fare se serve: **font Google bundlati**; intestazioni inline alla Word (l'estensione
    non le supporta, solo via pannello).

## Per riprendere
Leggere `docs/CONTINUA_DOMANI.md` (stato sintetico + prossimi passi in ordine) e,
per il dettaglio delle funzioni, questo file. L'audit del codice con le voci
aperte/chiuse sta in `C:\Users\matte\Documents\Obsidian Vault\Atelier-analisi-codice.md`.
