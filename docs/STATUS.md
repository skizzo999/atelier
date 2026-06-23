# STATUS - Atelier

## Stato attuale
Editor Markdown **completo** a 3 viste (Codice / Ibrida / Lettura) con live preview
ricco in stile Obsidian. Già pronti: sistema vault, file tree con watcher, gestione
file, ricerca, e viewer immagini con editing. Prossimo grande blocco: annotazioni
immagini (fase 2) e viewer per altri formati (PDF/DOCX).

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
- [x] **Editor Markdown a 3 viste:**
  - **Codice**: CodeMirror 6 con syntax highlight markdown (oneDark)
  - **Lettura**: marked + DOMPurify (+ prose, allineato all'Ibrida)
  - **Ibrida** (live preview, CM6): titoli ATX+Setext, grassetto/corsivo/barrato,
    evidenziato `==`, liste puntate/task ☑, citazioni (annidate), righe, tabelle
    (monospazio), link, **wikilink navigabile**, **callout** con titolo, blocchi di
    codice (**syntax highlight** + label linguaggio + ``` nascosti), **immagini**
    (`![alt](path)` e `![[file]]`, cercate per nome in tutto il vault)
- [x] Salvataggio atomico (tmp+rename); `Ctrl+S`; indicatore "non salvato" (tree + editor);
  risync col disco al focus finestra
- [x] Navigazione wikilink: click su `[[nota]]` apre la nota (o la crea)

## Prossimi step (in ordine di priorità)
1. **Annotazioni immagini (fase 2)**: penna, frecce, riquadri, testo
2. **Tabelle boxate in Ibrida** (via StateField — i plugin CM6 non possono dare decorazioni a blocco)
3. **Viewer altri formati**: PDF (PDF.js), DOCX (Mammoth), poi pptx/xlsx (SheetJS)
4. **Rifiniture Ibrida**: liste numerate/annidate, footnote, math (KaTeX), icona ↗ link esterni
5. **Parte grafica**: token colore, tema unificato; code-split di CodeMirror (bundle grande)

## Note tecniche
- Progetto: C:\Users\matte\Desktop\Atelier\atelier
- Stack: Tauri 2 + React 19 + TS + Tailwind v3 + Zustand 5 + react-arborist 3 +
  CodeMirror 6 (lang-markdown/GFM, language-data, theme-one-dark, @lezer/highlight,
  @lezer/markdown) + marked 18 + marked-highlight + highlight.js + DOMPurify
- Permessi fs: read-text-file, write-text-file, read-file, write-file, read-dir,
  mkdir, exists, rename, remove, watch, unwatch
- Comando Rust custom: `allow_path` → `FsExt::fs_scope().allow_directory(path, recursive)`
- Persistenza: `zustand/persist` (solo vaultPath+mode via `partialize`); selectedFile e buffer non persistiti
- Live preview: src/components/CodeMirror/livePreview.ts (decorazioni dall'albero
  sintattico + pass regex per `==`, `[[ ]]`, `![[ ]]`); tema in modalità Ibrida
  senza oneDark (aspetto "documento")
- **IMPORTANTE**: i ViewPlugin di CM6 **non** possono fornire decorazioni a blocco
  (block widget/replace multi-riga) → causano crash. Per le tabelle boxate serve uno StateField.
- Indici del vault (nome→path) per immagini (lib/images) e note (lib/notes), costruiti in App

## Problemi aperti
- Bundle > 500kB (CM6 + highlight.js): valutare code-split / lazy import
- Indici immagini/note ricostruiti solo all'apertura del vault (una nota creata in
  sessione è apribile via fallback, ma entra nell'indice al riavvio)
- Tabelle in Ibrida ancora monospazio (boxate = step futuro con StateField)

## Per riprendere
Aprire nuova chat AI e incollare:
1. Contenuto di docs/STATUS.md (questo file)
2. Contenuto di docs/sessions/2026-06-23_editor-md-completo.md
3. Dire: "Continuiamo da dove abbiamo lasciato. Prossimo step: annotazioni immagini (fase 2)."
