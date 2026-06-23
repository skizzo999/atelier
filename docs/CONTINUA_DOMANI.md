# Prossimi step - Continuità

## Dove siamo arrivati
- Vault persistente + auto-apertura; FileTree con watcher; gestione file; ricerca
- Viewer immagini con editing (trasformazioni + ritaglio + buffer + salvataggio atomico)
- **Editor Markdown completo** a 3 viste: Codice / Ibrida (live preview) / Lettura
  - Ibrida copre: titoli, grassetto/corsivo/barrato, evidenziato, liste, task,
    citazioni annidate, righe, tabelle (monospazio), link, wikilink navigabile,
    callout con titolo, code block (highlight + label + ``` nascosti), immagini
    (`![]()` e `![[]]`, ricerca per nome nel vault)
  - Lettura allineata all'Ibrida (override del prose di Tailwind)

## Cosa fare (in ordine)

### 1. Annotazioni immagini (fase 2)
- Sopra il viewer immagini: penna a mano libera, frecce, riquadri, testo
- Overlay canvas, poi "flatten" sull'immagine al salvataggio (distruttivo in V1)
- Riusa la pipeline esistente (canvas → ri-encode → scrittura atomica)

### 2. Tabelle boxate in Ibrida
- Renderizzarle come `<table>` vera. ATTENZIONE: i ViewPlugin non possono dare
  decorazioni a blocco (crasha). Va fatto con uno **StateField** che fornisce le
  decorazioni a blocco, oppure con `EditorView.decorations.from(field)`.

### 3. Viewer altri formati
- PDF → PDF.js (view-only, scroll/zoom)
- DOCX → Mammoth.js (view, poi edit)
- pptx / xlsx → SheetJS / viewer dedicati

### 4. Rifiniture Ibrida
- Liste numerate stilizzate + annidamento, footnote `[^1]`, math `$...$` (KaTeX)
- Icona ↗ sui link esterni; rebuild dell'indice note/immagini sul watcher

### 5. Parte grafica
- Token colore (accent per pallini/selezione/link), tema unificato Codice/Ibrida/Lettura
- Code-split di CodeMirror e highlight.js (bundle > 500kB)

## Comandi utili
pnpm tauri dev          # Avvia sviluppo
git add . && git commit # Commit
git push                # Push su GitHub

## File principali
- src/store/appStore.ts                      (vaultPath, mode, selectedFile, buffer testo/immagini)
- src/lib/{vault,fileOps,images,notes,search}.ts
- src/components/FileTree/FileTree.tsx        (albero + watcher + menu file)
- src/components/FileView/FileView.tsx        (routing per tipo)
- src/components/ImageViewer/ImageViewer.tsx  (viewer + editing immagini)
- src/components/Editor/Editor.tsx            (3 viste; marked + estensioni; immagini Lettura)
- src/components/CodeMirror/CodeMirrorEditor.tsx (bridge React↔CM6)
- src/components/CodeMirror/livePreview.ts    (decorazioni Ibrida)
- src/components/SearchPalette/SearchPalette.tsx
- src-tauri/src/lib.rs                        (comando allow_path)

## Problemi noti
- CM6: niente decorazioni a blocco dai plugin (tabelle boxate → StateField)
- Bundle grande (code-split da fare)
- Indici note/immagini ricostruiti solo all'apertura vault
