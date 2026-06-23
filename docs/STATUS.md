# STATUS - Atelier

## Stato attuale
Editor Markdown **completo** a 3 viste (Codice / Ibrida / Lettura) con live preview
ricco in stile Obsidian. Già pronti: sistema vault, file tree con watcher, gestione
file, ricerca, viewer immagini con editing + **annotazioni** (penna/frecce/forme/
testo) e **zoom/pan dinamico** unificato. In corso: trasformare l'annotatore in un
piccolo editor (selezione/modifica oggetti + gomma). Prossimo grande blocco dopo:
viewer per altri formati (PDF/DOCX).

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
- [x] **Zoom/pan dinamico** unificato (hook `useImageViewport`): rotella verso il cursore,
  trascina per spostare, fit auto, controlli −/%/+/Adatta. Vale per immagini editabili e
  sola-lettura, dentro e fuori da "Annota"
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
1. **Annotatore — selezione/modifica oggetti**: selezionare un'annotazione e
   spostarla / ridimensionarla dagli angoli / ruotarla + cambiare colore, opacità,
   spessore. Un unico sistema di gizmo per testo E forme (copre il "testo manipolabile").
2. **Annotatore — gomma a pixel** (raster, sul tratto della penna).
3. (Opzionale) **Modifica ed esporta come PNG** per gif/svg/bmp/avif (oggi sola lettura).
4. **Tabelle boxate in Ibrida** (via StateField — i plugin CM6 non possono dare decorazioni a blocco)
5. **Viewer altri formati**: PDF (PDF.js), DOCX (Mammoth), poi pptx/xlsx (SheetJS)
6. **Rifiniture Ibrida**: liste numerate/annidate, footnote, math (KaTeX), icona ↗ link esterni
7. **Parte grafica**: token colore, tema unificato; code-split di CodeMirror (bundle grande)

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

## Problemi aperti
- Bundle > 500kB (CM6 + highlight.js): valutare code-split / lazy import
- Indici immagini/note ricostruiti solo all'apertura del vault (una nota creata in
  sessione è apribile via fallback, ma entra nell'indice al riavvio)
- Tabelle in Ibrida ancora monospazio (boxate = step futuro con StateField)

## Per riprendere
Aprire nuova chat AI e incollare:
1. Contenuto di docs/STATUS.md (questo file)
2. Contenuto di docs/sessions/2026-06-23_annotazioni-e-zoom.md
3. Dire: "Continuiamo da dove abbiamo lasciato. Prossimo step: selezione/modifica
   degli oggetti annotati (sposta/ridimensiona/ruota + colore/opacità/spessore), poi gomma a pixel."
