# STATUS - Atelier

## Stato attuale
Layout base con Tailwind CSS funzionante. FileTree con react-arborist implementato ma espansione cartelle ha bug da risolvere. Developer mode context da implementare.

## Cosa è fatto
- [x] Setup ambiente Windows 11 (Node, Rust, Git, VS Code)
- [x] Scaffold Tauri 2 + React + TypeScript
- [x] Primo build e avvio app
- [x] Repo GitHub privato (skizzo999/atelier)
- [x] Documentazione progetto (docs/)
- [x] Layout base (sidebar + editor area)
- [x] **Tailwind CSS configurato** (migrato da CSS custom)
- [x] Installazione dipendenze (TipTap, react-arborist)
- [x] Plugin Tauri filesystem e dialog configurati
- [x] FileTree: react-arborist installato, visualizzazione base funzionante

## Cosa si sta facendo
- Fix react-arborist (espansione cartelle non funziona correttamente)
- Developer mode context (Zustand store)
- Apertura file .md in editor

## Prossimi step (in ordine di priorità)
1. **URGENTE**: Fix react-arborist - risolvere bug espansione cartelle
2. Developer mode context - Zustand store con mode: 'standard' | 'developer'
3. Apertura file - click su .md → lettura contenuto → editor
4. Editor Markdown - TipTap integration
5. Salvataggio atomico - tmp file + rename
6. CI GitHub Actions - workflow build automatico
7. Branch protection - GitHub settings

## Note tecniche
- Progetto: C:\Users\matte\Documents\Obsidian Vault\20_UniversalFileEditor\atelier
- Smart App Control: disabilitato
- Windows Defender: esclusa cartella atelier
- Obsidian: esclusi node_modules/ e target/ dall'indicizzazione
- Plugin Tauri attivi: fs, dialog, opener
- Tailwind CSS: v3 configurato con utility classes
- **Problema aperto**: react-arborist richiede mutazione in-place + shallow copy stato React per re-render corretti

## Per riprendere domani
Aprire nuova chat AI e incollare:
1. Contenuto di docs/STATUS.md (questo file)
2. Contenuto di docs/sessions/2026-06-09_setup-iniziale.md
3. Dire: "Continuiamo da dove abbiamo lasciato. Primo step: fix react-arborist espansione cartelle, poi developer mode context."