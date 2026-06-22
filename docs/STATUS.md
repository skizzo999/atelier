# STATUS - Atelier

## Stato attuale
App funzionante con: FileTree con espansione lazy + watcher filesystem (albero
sempre allineato al disco), sistema vault persistente con auto-apertura, ed editor
file con lettura/modifica/salvataggio e toggle Codice/Lettura per i markdown.
Prossimo grande pezzo: la modalità Ibrida (live preview) dell'editor.

## Cosa è fatto
- [x] Setup ambiente, scaffold Tauri 2 + React + TypeScript, layout Tailwind
- [x] FileTree react-arborist con espansione lazy delle cartelle
- [x] Scope permessi: comando Rust `allow_path` (accesso ricorsivo alla cartella scelta)
- [x] Store Zustand persistito (localStorage): `vaultPath` + `mode`
- [x] Sistema vault: Welcome (Apri/Nuovo vault), auto-apertura ultimo vault, validazione al boot
- [x] Toggle modalità standard/developer (persistito, ancora solo gancio)
- [x] **Watcher filesystem**: albero aggiornato in tempo reale; vault eliminato → torna a Welcome
- [x] **Apertura file**: click su file → contenuto nell'editor
- [x] **Editor**: modifica, salvataggio atomico (`Ctrl+S`, tmp+rename), risync al focus
- [x] **Modifiche non salvate stile VS Code**: buffer in memoria per file, nessuna perdita cambiando file, salvataggio esplicito
- [x] **Indicatore non-salvato** (pallino arancio) nel tree e nell'editor
- [x] **Markdown**: toggle Codice (sorgente) / Lettura (renderizzato con marked + typography), HTML sanitizzato (DOMPurify)
- [x] **Gestione file**: crea/rinomina/elimina file e cartelle (menu tasto destro su elemento o area vuota)
- [x] **Ricerca**: quick-open per nome (Ctrl+P, tutti i tipi di file) + ricerca contenuto (Ctrl+Shift+F, file testuali) con highlight del termine
- [x] **Viewer immagini + routing per tipo**: FileView instrada per tipo; immagini (png/jpg/gif/webp/bmp/svg/ico/avif) con zoom/adatta; resto → editor testo

## Prossimi step (in ordine di priorità)
1. **Editing immagini**: [x] trasformazioni (ruota/capovolgi/ridimensiona) + [x] buffer (no perdita cambiando file) — **manca ritaglio (crop) interattivo**; poi fase 2 annotazioni/markup
2. **Altri viewer**: PDF (PDF.js), DOCX (Mammoth), poi pptx/xlsx (SheetJS)
3. **Editor Ibrido / live preview** (terza vista stile Obsidian) → CodeMirror 6
4. Avviso "modifiche non salvate" alla chiusura dell'app
5. Gestione conflitti editor (buffer + modifiche esterne)
6. Modalità developer (comportamento reale + file di codice)
7. (opzionale) Migrazione persistenza a `tauri-plugin-store`; CI GitHub Actions

## Note tecniche
- Progetto: C:\Users\matte\Desktop\Atelier\atelier
- Stack: Tauri 2 + React 19 + TypeScript + Tailwind v3 (+typography) + Zustand 5 + react-arborist 3 + marked 18 + dompurify 3
- Plugin Tauri: fs (feature `watch` attiva), dialog, opener
- Permessi fs: read-text-file, write-text-file, read-file, write-file, read-dir, mkdir, exists, rename, remove, watch, unwatch
- Comando Rust custom: `allow_path` → `FsExt::fs_scope().allow_directory(path, recursive=true)`
- Persistenza: `zustand/persist` su localStorage, solo vaultPath+mode (`partialize`); selectedFile e dirtyBuffers nello store ma non persistiti
- Editor: src/components/Editor/Editor.tsx (textarea + vista Lettura via marked+DOMPurify; buffer non salvati nello store)
- Viewer per tipo: src/components/FileView/FileView.tsx (router), ImageViewer/ImageViewer.tsx
- Operazioni file: src/lib/fileOps.ts (incl. writeFileAtomic)
- Ricerca: src/lib/search.ts, src/components/SearchPalette/SearchPalette.tsx

## Problemi aperti
- Buffer non salvati (testo e immagini) in memoria → persi se si chiude l'app senza salvare (avviso-alla-chiusura da fare)
- Risync editor solo al focus finestra (non real-time)

## Per riprendere
Aprire nuova chat AI e incollare:
1. Contenuto di docs/STATUS.md (questo file)
2. Contenuto di docs/sessions/2026-06-22_image-transforms.md
3. Dire: "Continuiamo da dove abbiamo lasciato. Primo step: ritaglio (crop) immagini interattivo."
