# STATUS - Atelier

## Stato attuale
Editor Markdown **completo** a 3 viste (Codice / Ibrida / Lettura) con live preview
ricco in stile Obsidian. Viewer immagini ricco: editing + **annotazioni** con
**selezione/modifica** (sposta/ridimensiona/warp/rotazione testo), **zoom/pan dinamico**
unificato, **pannello Informazioni**, copia immagine, apri in Explorer, **regolazioni
funzionali** e **OCR**. **Viewer PDF avanzato**: selezione testo (vero + OCR automatico
sulle scansioni), zoom Ctrl+rotella fluido e centrato, navigazione laterale (miniature +
indice), ricerca nel PDF (Ctrl+F) e globale (Ctrl+Shift+F entra nei PDF), **evidenziatore
salvato dentro al PDF** (3 colori personalizzabili). **Viewer DOCX** (sola lettura,
Mammoth): HTML semantico in stile Lettura, pannello Info, ricerca (Ctrl+F), export in
Markdown. Pronti anche: sistema vault, file tree con watcher, gestione file, ricerca.
Prossimi: **editing DOCX**, stampa trasversale, pptx/xlsx.

## Cosa è fatto
- [x] Setup Tauri 2 + React 19 + TypeScript + Tailwind; layout sidebar + area editor
- [x] FileTree (react-arborist) con espansione lazy + **watcher filesystem** (live)
- [x] Comando Rust `allow_path` (scope fs ricorsivo sulla cartella scelta)
- [x] Store Zustand persistito: `vaultPath` + `mode`. Buffer non salvati (testo e immagini)
- [x] Sistema vault: Welcome (Apri/Nuovo), auto-apertura ultimo vault, validazione al boot
- [x] Gestione file: crea/rinomina/elimina (menu tasto destro su elemento o area vuota)
- [x] Ricerca: quick-open per nome (Ctrl+P) + contenuto (Ctrl+Shift+F) con highlight
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
- [x] **Viewer DOCX** (sola lettura, Mammoth): converte il .docx in HTML semantico
  (titoli, grassetto/corsivo, liste, tabelle, immagini base64), sanitizzato (DOMPurify)
  e reso con `prose prose-invert`. **Pannello Info** (nome/parole/peso/percorso+copia),
  **ricerca** nel documento (Ctrl+F, <mark> + scroll, X/Y), **export in Markdown**
  (convertToMarkdown, scrive un .md accanto e lo apre), **Apri in Explorer**. Solo .docx
  (il vecchio .doc binario non è supportato). Editing = step successivo
- [x] **Editor Markdown a 3 viste:**
  - **Codice**: CodeMirror 6 con syntax highlight markdown (oneDark)
  - **Lettura**: marked + DOMPurify (+ prose, allineato all'Ibrida)
  - **Ibrida** (live preview, CM6): titoli ATX+Setext, grassetto/corsivo/barrato,
    evidenziato `==`, liste puntate/task ☑, citazioni (annidate), righe, tabelle
    (monospazio), link, **wikilink navigabile**, **callout** (titolo = tipo + corpo,
    reso come `::before`, allineato alla Lettura), blocchi di codice (**syntax
    highlight** + label linguaggio + ``` nascosti), **immagini** (`![alt](path)` e
    `![[file]]`, cercate per nome in tutto il vault)
  - **Vista ricordata**: l'ultima scelta (Codice/Ibrida/Lettura) è persistita nello
    store (`mdView`), l'app riapre come l'hai lasciata invece di tornare a Codice
- [x] Salvataggio atomico (tmp+rename); `Ctrl+S`; indicatore "non salvato" (tree + editor);
  risync col disco al focus finestra
- [x] Navigazione wikilink: click su `[[nota]]` apre la nota (o la crea)

## Prossimi step (in ordine di priorità)
1. **Editing DOCX** (DA DECIDERE l'approccio): (a) workflow Markdown — si edita il .md
   esportato con l'editor esistente, il .docx resta intatto (semplice, no perdita);
   (b) editing vero che riscrive il .docx (writer tipo `docx`/`html-to-docx`, lossy e
   complesso). Consigliata la (a) per coerenza/sicurezza.
2. **Altri formati**: ✅ PDF e DOCX (view) → **pptx/xlsx** (SheetJS / viewer dedicati).
3. **Stampa** trasversale (a tutti i tipi di file, non solo immagini).
4. (Opzionale) **OCR nativo Windows** (Windows.Media.Ocr) per OCR 100% offline.
   - Vale anche per il PDF: oggi l'OCR scarica il modello al 1° uso (rete).
5. (Opzionale) **Modifica ed esporta come PNG** per gif/svg/bmp/avif (oggi sola lettura).
6. **Tabelle boxate in Ibrida** (via StateField — i plugin CM6 non possono dare decorazioni a blocco)
7. **Rifiniture Ibrida**: liste numerate/annidate, footnote, math (KaTeX), icona ↗ link esterni
8. **Parte grafica**: token colore, tema unificato; code-split di CodeMirror (bundle grande)

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
- Tabelle in Ibrida ancora monospazio (boxate = step futuro con StateField)
- **PDF evidenziatore**: pagine con `/Rotate` non gestite (coord potrebbero non combaciare);
  cross-reader senza appearance stream (Adobe sì, lettori minimali forse no); selezione che
  attraversa due pagine non gestita
- **PDF ricerca globale**: non OCR-izza le scansioni del vault (troppo pesante) → trova solo
  i PDF con testo vero; le scansioni si cercano aprendole (OCR + Ctrl+F)
- **PDF OCR**: modello lingua scaricato dalla rete al 1° uso (come OCR immagini)

## Per riprendere
Aprire nuova chat AI e incollare:
1. Contenuto di docs/STATUS.md (questo file)
2. Contenuto di docs/sessions/2026-06-24_annotatore-e-funzioni-foto.md
3. Dire: "Continuiamo da dove abbiamo lasciato. Prossimo step: gomma a pixel
   nell'annotatore, poi stampa trasversale."
