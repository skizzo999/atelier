# Prossimi step - Continuità

## Dove siamo arrivati
- Vault persistente + auto-apertura; FileTree con watcher; gestione file; ricerca
- Viewer immagini con editing (trasformazioni + ritaglio + buffer + salvataggio atomico)
- **Annotazioni immagini**: penna (2 penne configurabili/persistenti, slider
  opacità+spessore), frecce, forme (rettangolo/ellisse/triangolo/linea), testo.
  Overlay SVG in coord immagine, "Applica" = flatten sul canvas
- **Zoom/pan dinamico** unificato (hook `useImageViewport`): rotella verso il cursore,
  trascina per spostare; vale per tutti i formati, dentro e fuori da "Annota"
- **Annotazioni — selezione/modifica** (strumento Selez.): sposta, ridimensiona col box
  (testo/penna/rettangolo/ellisse), warp dei punti (freccia/linea che curva, triangolo a
  3 vertici), **rotazione 360° del testo**; pannello proprietà + elimina (Canc)
- **Pannello Informazioni** (rinomina/dimensioni/peso/DPI/percorso+copia), **Copia
  immagine**, **Apri in Explorer** (entrambi i viewer)
- **Regolazioni funzionali** (luminosità/contrasto/saturazione, preview live) e **OCR**
  (Tesseract.js, ita+eng; 1° uso scarica il modello lingua)
- **Gomma a pixel** nell'annotatore (cancella i pixel delle annotazioni, non la foto)
- **Viewer PDF avanzato**: zoom Ctrl+rotella fluido/centrato, selezione testo (vero +
  **OCR automatico** scansioni), nav laterale (miniature+indice), **ricerca** nel PDF e
  globale (anche nei PDF), **evidenziatore salvato nel PDF** (3 colori personalizzabili)
- **Editor DOCX vero stile Word** (TipTap + Mammoth + docx): apri ed è editabile con
  barra strumenti Atelier (titoli, B/I/U/barrato, liste, citazione, allineamenti…),
  **export in Markdown**, **salva** che sovrascrive il .docx (backup .bak)
- **Distribuzione**: GitHub Actions builda Win+macOS e pubblica la Release a ogni tag `v*`
- **Editor Markdown completo** a 3 viste: Codice / Ibrida (live preview) / Lettura
  - Ibrida copre: titoli, grassetto/corsivo/barrato, evidenziato, liste, task,
    citazioni annidate, righe, tabelle (monospazio), link, wikilink navigabile,
    callout con titolo, code block (highlight + label + ``` nascosti), immagini
    (`![]()` e `![[]]`, ricerca per nome nel vault)
  - Lettura allineata all'Ibrida (override del prose di Tailwind)
  - **Callout Ibrida** = identico alla Lettura (tipo come titolo + corpo); titolo
    reso via `::before`, non come widget, per evitare lo spazio fantasma dei
    cm-widgetBuffer di CM6
  - **Vista ricordata** tra sessioni (`mdView` persistito nello store)

## Cosa fare (in ordine)

> **Editor immagini COMPLETO** (incl. gomma a pixel). Prossimo grande blocco: i
> viewer per gli altri formati, che è il cuore del "workspace multi-formato".

### 1. Viewer altri formati (in corso)
- **PDF** → ✅ FATTO E RICCO (PdfViewer + lib pdfOcr/pdfSearch/pdfHighlights):
  zoom Ctrl+rotella fluido centrato, selezione testo (vero + **OCR automatico** sulle
  scansioni), navigazione laterale (miniature + indice), **ricerca nel PDF** (Ctrl+F) e
  **globale** (Ctrl+Shift+F entra nei PDF di testo), **evidenziatore salvato nel PDF**
  (3 colori personalizzabili, rimozione, auto-save come annotazioni /Highlight + JSON).
  Eventuali +: OCR anche nella ricerca globale, pagine /Rotate, appearance stream.
- **DOCX** → ✅ EDITOR VERO STILE WORD (DocxEditor, **TipTap/ProseMirror**): apri ed è
  editabile, barra strumenti Atelier (titoli, B/I/U/barrato/codice, liste, citazione,
  allineamenti, riga). Import Mammoth; **Salva** (Ctrl+S) SOVRASCRIVE il .docx via
  `lib/htmlToDocx.ts` (libreria `docx`), backup `.bak`. Fedeltà "Mammoth" (lossy, dichiarato).
  - Vista a **foglio A4** (pila di pagine bianche su sfondo grigio, stile Word/Docs) +
    **zoom** (Ctrl+rotella, −/%/+). Modifiche nel buffer del store (pallino tree, non
    perse cambiando file). `.bak` nascosti dal tree.
  - Da rendere "quasi professionale": **paginazione vera** (oggi le pagine A4 sono solo
    sfondo: il testo scorre continuo e può finire sul gap — la paginazione reale con
    margini per-pagina e split del contenuto è il pezzo grosso); tabelle (inserisci/righe/
    colonne), font/colore testo, UI link/immagini, "salva come nuovo file".
  - Editor docx FEDELE "vero": solo SuperDoc (AGPL/commerciale) — valutare se serve.
- pptx / xlsx → SheetJS / viewer dedicati ← PROSSIMO grande blocco formati

### 2. Stampa (trasversale)
- Funzione di stampa generica per tutti i tipi di file (non solo immagini), da
  integrare a fine progetto.

### 3. (Opzionale) OCR nativo Windows
- Sostituire/affiancare Tesseract con `Windows.Media.Ocr` (comando Rust/WinRT) per
  OCR 100% offline senza download del modello.

### 4. (Opzionale) Modifica ed esporta come PNG
- Per gif/svg/bmp/avif (oggi sola lettura): consentire le modifiche salvando un .png
  nuovo. Limiti: GIF perde l'animazione, SVG perde il vettoriale.

### 5. Tabelle boxate in Ibrida
- Renderizzarle come `<table>` vera. ATTENZIONE: i ViewPlugin non possono dare
  decorazioni a blocco (crasha). Va fatto con uno **StateField** che fornisce le
  decorazioni a blocco, oppure con `EditorView.decorations.from(field)`.

### 6. Rifiniture Ibrida
- Liste numerate stilizzate + annidamento, footnote `[^1]`, math `$...$` (KaTeX)
- Icona ↗ sui link esterni; rebuild dell'indice note/immagini sul watcher

### 7. Parte grafica
- Token colore (accent per pallini/selezione/link), tema unificato Codice/Ibrida/Lettura
- Code-split di CodeMirror e highlight.js (bundle > 500kB)

## Comandi utili
pnpm tauri dev          # Avvia sviluppo
git add . && git commit # Commit
git push                # Push su GitHub

## File principali
- src/store/appStore.ts                      (vaultPath, mode, mdView, penPresets, pdfHlColors, buffer)
- src/lib/{vault,fileOps,images,notes,search}.ts  (search ora estrae anche il testo dei PDF)
- src/lib/annotations.ts                      (tipi forme + disegno + bounds/warp/scale/rotazione)
- src/lib/{imageMeta,imageActions}.ts         (DPI/peso; copia appunti, apri in Explorer)
- src/lib/pdfOcr.ts                           (worker Tesseract persistente + box parole)
- src/lib/pdfSearch.ts                        (token testo+box per pagina; ricerca nel PDF)
- src/lib/pdfHighlights.ts                    (pdf-lib: leggi/scrivi evidenziazioni nel PDF)
- src/components/FileTree/FileTree.tsx        (albero + watcher + menu file)
- src/components/FileView/FileView.tsx        (routing per tipo)
- src/components/ImageViewer/ImageViewer.tsx  (viewer + editing + annotazioni + selezione + regola + OCR)
- src/components/ImageViewer/ImageInfoPanel.tsx (pannello Informazioni)
- src/components/PdfViewer/PdfViewer.tsx      (viewer PDF: zoom, OCR, nav, ricerca, evidenziatore)
- src/components/DocxEditor/DocxEditor.tsx    (editor DOCX TipTap: barra strumenti, import Mammoth, salva, export)
- src/lib/htmlToDocx.ts                        (HTML→DOCX con la libreria `docx`, per salvare le modifiche)
- src/components/Editor/Editor.tsx            (3 viste; marked + estensioni; immagini Lettura)
- src/components/CodeMirror/CodeMirrorEditor.tsx (bridge React↔CM6)
- src/components/CodeMirror/livePreview.ts    (decorazioni Ibrida)
- src/components/SearchPalette/SearchPalette.tsx  (Ctrl+P nomi, Ctrl+Shift+F contenuto incl. PDF)
- src-tauri/src/lib.rs                        (comando allow_path)

## Problemi noti
- CM6: niente decorazioni a blocco dai plugin (tabelle boxate → StateField)
- Bundle grande (code-split da fare)
- Indici note/immagini ricostruiti solo all'apertura vault
- Annotazioni: gli oggetti sono modificabili finché non si fa "Applica" (flatten
  distruttivo sul canvas); dopo l'Applica non sono più selezionabili
- Editing immagini solo per png/jpg/webp (limite di `canvas.toBlob`)
- OCR (Tesseract): il modello lingua è scaricato dalla rete al 1° uso (poi in cache);
  per il 100% offline serve l'OCR nativo Windows
- pnpm 11: serve `pnpm-workspace.yaml` con `verifyDepsBeforeRun: false` +
  `onlyBuiltDependencies` (esbuild, tesseract.js), altrimenti i comandi escono 1
