# STATUS - Atelier

## Stato attuale
Layout base implementato. FileTree seleziona cartella e mostra file (non ancora interattivo). Editor area vuota.

## Cosa è fatto
- [x] Setup ambiente Windows 11 (Node, Rust, Git, VS Code)
- [x] Scaffold Tauri 2 + React + TypeScript
- [x] Primo build e avvio app
- [x] Repo GitHub privato (skizzo999/atelier)
- [x] Documentazione progetto (docs/)
- [x] Layout base (sidebar + editor area)
- [x] Installazione dipendenze (TipTap, react-arborist)
- [x] Plugin Tauri filesystem e dialog configurati
- [x] FileTree: selezione cartella funzionante

## Cosa si sta facendo
- FileTree interattivo (clic su file → caricamento contenuto)
- Editor Markdown con TipTap

## Prossimi step
1. FileTree: rendere cliccabili i file .md → caricare contenuto in editor
2. Editor: integrare TipTap per visualizzazione/modifica Markdown
3. Salvataggio: pulsante "Salva" che scrive su filesystem
4. Stato: indicatore "modificato/non salvato"
5. Gestione tab multipli (opzionale, dopo MVP)

## Note tecniche
- Progetto: C:\Users\matte\Documents\Obsidian Vault\20_UniversalFileEditor\atelier
- Smart App Control: disabilitato
- Windows Defender: esclusa cartella atelier
- Obsidian: esclusi node_modules/ e target/ dall'indicizzazione
- Plugin Tauri attivi: fs, dialog, opener
- Struttura cartelle: src/components/FileTree, Editor, DocxViewer, PdfViewer, hooks, lib, types

## Per riprendere domani
Aprire nuova chat AI e incollare:
1. Contenuto di docs/STATUS.md (questo file)
2. Contenuto di docs/sessions/2026-06-09_setup-iniziale.md
3. Dire: "Continuiamo da dove abbiamo lasciato, prossimo step: FileTree interattivo + editor Markdown"