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
- [x] **Editor**: modifica, salvataggio (`Ctrl+S`), indicatore "non salvato", risync al focus
- [x] **Markdown**: toggle Codice (sorgente) / Lettura (renderizzato con marked + typography)

## Prossimi step (in ordine di priorità)
1. **Editor Ibrido / live preview** (terza vista stile Obsidian) → motore tipo CodeMirror 6
2. Hardening: salvataggio atomico (tmp + rename), sanitizzazione HTML in lettura
3. Gestione conflitti editor (modifiche locali non salvate + cambi esterni)
4. Comportamento reale della modalità developer
5. (opzionale) Migrazione persistenza a `tauri-plugin-store`
6. CI GitHub Actions + branch protection

## Note tecniche
- Progetto: C:\Users\matte\Desktop\Atelier\atelier
- Stack: Tauri 2 + React 19 + TypeScript + Tailwind v3 (+typography) + Zustand 5 + react-arborist 3 + marked 18
- Plugin Tauri: fs (feature `watch` attiva), dialog, opener
- Permessi fs: read-text-file, write-text-file, read-dir, mkdir, exists, watch, unwatch
- Comando Rust custom: `allow_path` → `FsExt::fs_scope().allow_directory(path, recursive=true)`
- Persistenza: `zustand/persist` su localStorage (chiave `atelier-app`)
- Editor: src/components/Editor/Editor.tsx (textarea + vista Lettura via marked)

## Problemi aperti
- Markdown renderizzato senza sanitizzazione HTML (da hardenare)
- Salvataggio diretto, non ancora atomico
- Risync editor solo al focus finestra (non real-time)

## Per riprendere
Aprire nuova chat AI e incollare:
1. Contenuto di docs/STATUS.md (questo file)
2. Contenuto di docs/sessions/2026-06-22_watcher-editor.md
3. Dire: "Continuiamo da dove abbiamo lasciato. Primo step: editor Ibrido / live preview (CodeMirror)."
