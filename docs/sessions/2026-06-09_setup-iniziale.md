# Sessione 2026-06-09 - Setup iniziale e ambiente

## Obiettivo
Setup ambiente di sviluppo Windows 11 per progetto Atelier (Tauri 2 + React + TS) e primo layout interfaccia.

## Cosa è stato fatto
- Installazione toolchain: Node.js 24.13.1, pnpm 11.5.2, Rust 1.96.0, Git 2.54.0, VS Code
- Scaffold progetto Tauri 2 con create-tauri-app (React + TypeScript)
- Risoluzione problemi:
  - pnpm richiedeva PowerShell come amministratore
  - esbuild build script approval (pnpm approve-builds)
  - Windows Defender bloccava binari in Obsidian Vault → aggiunta esclusione cartella
  - Smart App Control bloccava esecuzione binari non firmati → disabilitato
- Primo build e avvio app funzionante
- Git init, commit iniziale, push su GitHub privato (skizzo999/atelier)
- Creazione struttura cartelle docs/ per documentazione
- Layout base app: sidebar + editor area (tema scuro)
- Installazione dipendenze: @tiptap/react, @tiptap/starter-kit, react-arborist
- Installazione plugin Tauri: tauri-plugin-fs, tauri-plugin-dialog
- Configurazione permessi filesystem in capabilities/default.json
- Componente FileTree base funzionante (pulsante "Apri cartella" seleziona directory)

## Stato finale
- Ambiente setup completo e funzionante
- Repo GitHub privato attivo
- App con layout a due pannelli (sidebar sinistra, editor destra)
- FileTree: pulsante per selezionare cartella, visualizza lista file/cartelle (non ancora interattiva)

## Problemi riscontrati
- PowerShell 5.1 non supporta -Encoding utf8NoBOM → risolto con [System.IO.File]::WriteAllText()
- Permessi Tauri: servivano sia plugin frontend (npm) che backend (Rust)

## Prossimi step (da fare domani)
1. Rendere FileTree interattivo (clic su file → apre in editor)
2. Implementare editor Markdown con TipTap
3. Aggiungere salvataggio file
4. Gestione stato "file modificato/non salvato"