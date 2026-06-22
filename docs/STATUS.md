# STATUS - Atelier

## Stato attuale
FileTree funzionante con espansione lazy delle cartelle. Sistema vault completo:
persistenza, apertura automatica dell'ultimo vault all'avvio, schermata Welcome.
Toggle modalità standard/developer (per ora solo gancio per funzioni future).
Da fare: gestione delle modifiche al filesystem a runtime e apertura file nell'editor.

## Cosa è fatto
- [x] Setup ambiente Windows 11, scaffold Tauri 2 + React + TypeScript
- [x] Layout base (sidebar + editor area) con Tailwind CSS
- [x] Plugin Tauri: fs, dialog, opener
- [x] **FileTree react-arborist con espansione lazy delle cartelle** (bug risolto)
- [x] **Scope permessi**: comando Rust `allow_path` (accesso ricorsivo alla cartella scelta)
- [x] **Store globale Zustand persistito** (localStorage): `vaultPath` + `mode`
- [x] **Sistema vault**: Welcome (Apri/Nuovo vault), auto-apertura ultimo vault, validazione esistenza al boot
- [x] **Toggle modalità standard/developer** (persistito)

## Cosa si sta facendo / prossimo
- Gestione modifiche filesystem a runtime (vault eliminato/spostato mentre l'app è aperta)
- Apertura file .md nell'editor

## Prossimi step (in ordine di priorità)
1. **Gestione FS a runtime**: fs watcher sul vault → se la root sparisce torna a Welcome;
   su cambi dei file refresh dell'albero (stile Obsidian).
   Quick win interim: ri-validare `exists` sul focus della finestra + gestire errori `readDir`.
2. Apertura file: click su .md → `readTextFile` → editor
3. Editor Markdown: integrazione TipTap
4. Salvataggio atomico: tmp file + rename
5. (opzionale) Migrazione persistenza a `tauri-plugin-store` quando servono più impostazioni
6. CI GitHub Actions + branch protection

## Note tecniche
- Progetto: C:\Users\matte\Desktop\Atelier\atelier
- Stack: Tauri 2 + React 19 + TypeScript + Tailwind v3 + Zustand 5 + react-arborist 3
- Plugin Tauri attivi: fs, dialog, opener
- Permessi fs: read-text-file, write-text-file, read-dir, mkdir, exists; dialog open/save
- Comando Rust custom: `allow_path` → `FsExt::fs_scope().allow_directory(path, recursive=true)`
- Persistenza: `zustand/persist` su localStorage (chiave `atelier-app`)
- **Problema aperto**: le modifiche al filesystem fatte fuori dall'app non vengono rilevate a runtime

## Per riprendere
Aprire nuova chat AI e incollare:
1. Contenuto di docs/STATUS.md (questo file)
2. Contenuto di docs/sessions/2026-06-22_fix-filetree-vault.md
3. Dire: "Continuiamo da dove abbiamo lasciato. Primo step: gestione modifiche filesystem a runtime (watcher), poi apertura file nell'editor."
