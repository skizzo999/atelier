# Prossimi step - Continuità

## Dove siamo arrivati
- Vault persistente + auto-apertura; FileTree con watcher; gestione file; ricerca
- Viewer immagini con editing (trasformazioni + ritaglio + buffer + salvataggio atomico)
- **Annotazioni immagini**: penna (2 penne configurabili/persistenti, slider
  opacità+spessore), frecce, forme (rettangolo/ellisse/triangolo/linea), testo.
  Overlay SVG in coord immagine, "Applica" = flatten sul canvas
- **Zoom/pan dinamico** unificato (hook `useImageViewport`): rotella verso il cursore,
  trascina per spostare; vale per tutti i formati, dentro e fuori da "Annota"
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

### 1. Annotatore — selezione/modifica oggetti (PROSSIMO)
- Strumento "selezione": click su un'annotazione esistente per selezionarla.
- Gizmo con maniglie: **sposta** (drag), **ridimensiona** dagli angoli (bounding box),
  **ruota** (maniglia in alto). Stesso sistema per testo E forme → copre il "testo
  manipolabile" (ridimensiona la casella col testo, gira, sposta).
- Pannello proprietà nella toolbar quando c'è una selezione: cambia colore, opacità,
  spessore dell'oggetto selezionato.
- Le forme hanno coord immagine; servirà un `id` per oggetto e hit-testing nell'SVG.

### 2. Annotatore — gomma a pixel
- Gomma raster sul tratto a mano libera (scelta dell'utente: pixel, non per-oggetto).
- Va gestita sul livello annotazioni prima del flatten (es. composito su un canvas
  annotazioni separato, con `globalCompositeOperation = 'destination-out'`).

### 3. (Opzionale) Modifica ed esporta come PNG
- Per gif/svg/bmp/avif (oggi sola lettura): consentire le modifiche salvando un .png
  nuovo. Limiti: GIF perde l'animazione, SVG perde il vettoriale.

### 4. Tabelle boxate in Ibrida
- Renderizzarle come `<table>` vera. ATTENZIONE: i ViewPlugin non possono dare
  decorazioni a blocco (crasha). Va fatto con uno **StateField** che fornisce le
  decorazioni a blocco, oppure con `EditorView.decorations.from(field)`.

### 5. Viewer altri formati
- PDF → PDF.js (view-only, scroll/zoom)
- DOCX → Mammoth.js (view, poi edit)
- pptx / xlsx → SheetJS / viewer dedicati

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
- src/store/appStore.ts                      (vaultPath, mode, mdView, penPresets, buffer testo/immagini)
- src/lib/{vault,fileOps,images,notes,search}.ts
- src/lib/annotations.ts                      (tipi forme + disegno su canvas annotazioni)
- src/components/FileTree/FileTree.tsx        (albero + watcher + menu file)
- src/components/FileView/FileView.tsx        (routing per tipo)
- src/components/ImageViewer/ImageViewer.tsx  (viewer + editing + annotazioni + viewport zoom/pan)
- src/components/Editor/Editor.tsx            (3 viste; marked + estensioni; immagini Lettura)
- src/components/CodeMirror/CodeMirrorEditor.tsx (bridge React↔CM6)
- src/components/CodeMirror/livePreview.ts    (decorazioni Ibrida)
- src/components/SearchPalette/SearchPalette.tsx
- src-tauri/src/lib.rs                        (comando allow_path)

## Problemi noti
- CM6: niente decorazioni a blocco dai plugin (tabelle boxate → StateField)
- Bundle grande (code-split da fare)
- Indici note/immagini ricostruiti solo all'apertura vault
- Annotazioni: flatten distruttivo in V1 (gli oggetti non sono più modificabili dopo
  "Applica"); la selezione/modifica oggetti è il prossimo step
- Editing immagini solo per png/jpg/webp (limite di `canvas.toBlob`)
