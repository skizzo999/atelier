# Sessione 2026-06-22 (2) - Watcher filesystem e editor file

## Obiettivo
Gestire le modifiche al filesystem a runtime (bug del vault eliminato) e
implementare l'apertura/modifica/salvataggio dei file nell'editor.

## Cosa è stato fatto

### Watcher filesystem (gestione cambi a runtime)
- Abilitata la feature Cargo `watch` su `tauri-plugin-fs` (porta `notify` + debouncer);
  aggiunti permessi `fs:allow-watch` e `fs:allow-unwatch`.
- Watcher ricorsivo sul vault (debounce 300ms) in FileTree:
  - se la root del vault sparisce → `clearVault()` → torna alla Welcome;
  - altrimenti `reloadChildren` riconcilia l'albero col disco, preservando le
    cartelle aperte (i nuovi file compaiono, gli eliminati spariscono).
- Rete di sicurezza in App: ri-validazione del vault con `exists` al focus finestra.

### Apertura e modifica file nell'editor
- Selezione file: FileTree passa il path selezionato ad App via context/prop
  (`onSelectFile`), App lo passa a `<Editor>`.
- Editor (src/components/Editor/Editor.tsx):
  - legge il contenuto con `readTextFile`;
  - modifica in `textarea`, indicatore "modifiche non salvate" (pallino ambra);
  - **salvataggio** con `writeTextFile` + scorciatoia `Ctrl/Cmd+S`;
  - per i `.md` toggle **Codice** (sorgente) / **Lettura** (markdown renderizzato
    con `marked` + `@tailwindcss/typography`, classe `prose prose-invert`);
  - risincronizzazione col disco al focus finestra (se non ci sono modifiche locali).

## Stato finale
- Modifiche esterne al vault riflesse nell'albero in tempo reale
- Vault eliminato mentre l'app è aperta → torna alla Welcome
- File apribili, modificabili, salvabili; toggle Codice/Lettura per i markdown
- File modificato da fuori → ricaricato nell'editor al ritorno in focus

## Problemi / decisioni
- Risync editor legata al focus finestra (non real-time): evita i problemi del
  watch su singolo file quando un editor esterno salva con rename
- Conflitto (modifiche locali non salvate + cambi esterni): per ora si tengono le locali
- Rendering markdown via `dangerouslySetInnerHTML` senza sanitizzazione (da hardenare)
- Salvataggio diretto, non ancora atomico (tmp + rename)

## Prossimi step
1. Modalità **Ibrida / live preview** (terza vista Obsidian) → motore tipo CodeMirror 6
2. Hardening: salvataggio atomico (tmp + rename), sanitizzazione HTML in lettura
3. Gestione conflitti editor (tieni mie / ricarica disco)

## Note tecniche
- Nuove dipendenze: marked 18, @tailwindcss/typography 0.5; feature Cargo fs `watch`
- Nuovi file: src/components/Editor/Editor.tsx
- Permessi fs aggiunti: watch, unwatch (mkdir già aggiunto nella sessione precedente)
