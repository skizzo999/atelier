# Sessione 2026-06-09 - Setup iniziale e ambiente

## Obiettivo
Setup ambiente di sviluppo Windows 11 per progetto Atelier (Tauri 2 + React + TS).

## Cosa è stato fatto
- Installazione toolchain: Node.js 24.13.1, pnpm 11.5.2, Rust 1.96.0, Git 2.54.0, VS Code
- Scaffold progetto Tauri 2 con create-tauri-app (React + TypeScript)
- Risoluzione problemi:
  - pnpm richiedeva PowerShell come amministratore
  - esbuild build script approval (pnpm approve-builds)
  - Windows Defender bloccava binari in Obsidian Vault → aggiunta esclusione cartella
  - Smart App Control bloccava esecuzione binari non firmati → disabilitato
- Primo build e avvio app funzionante (finestra "Welcome to Tauri + React")
- Git init, commit iniziale, push su GitHub privato (skizzo999/atelier)

## Stato finale
- Ambiente setup completo e funzionante
- Repo GitHub privato attivo con primo commit
- App Tauri + React + TS scaffold in esecuzione

## Prossimi step
- Creare struttura cartelle componenti (FileTree, Editor, DocxViewer, PdfViewer)
- Installare dipendenze V1.1 (TipTap, react-arborist)
- Iniziare implementazione V1.1: apertura file Markdown, editor base, salvataggio
