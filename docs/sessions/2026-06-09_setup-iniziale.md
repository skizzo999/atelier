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
- **Migrazione a Tailwind CSS** (sostituito CSS custom con utility classes)
- **Implementazione react-arborist** per file tree (caricamento lazy, struttura ad albero)

## Stato finale
- Ambiente setup completo e funzionante
- Repo GitHub privato attivo
- App con layout a due pannelli (sidebar sinistra, editor destra) usando Tailwind
- FileTree: react-arborist installato, visualizza cartelle e file, ma espansione cartelle ha ancora bug da risolvere
- Tailwind CSS configurato e funzionante

## Problemi riscontrati
- PowerShell 5.1 non supporta -Encoding utf8NoBOM → risolto con [System.IO.File]::WriteAllText()
- Permessi Tauri: servivano sia plugin frontend (npm) che backend (Rust)
- Tailwind v4 installato di default → disinstallato, installato v3 per config classica
- react-arborist: mutazione stato React vs riferimenti interni della libreria → problema ancora aperto, richiede debug

## Prossimi step (da fare domani)
1. **Fix react-arborist**: risolvere problema espansione cartelle (mutazione stato vs re-render)
2. **Developer mode context**: creare Zustand store con mode: 'standard' | 'developer'
3. **Apertura file**: collegare click su file .md → lettura contenuto → visualizzazione in editor
4. **Editor Markdown**: integrare TipTap per visualizzazione/modifica Markdown
5. **Salvataggio**: implementare salvataggio atomico (tmp + rename)
6. Sistemare commit messages con git rebase (opzionale)
7. Configurare branch protection e CI GitHub Actions

## Note tecniche
- Progetto: C:\Users\matte\Documents\Obsidian Vault\20_UniversalFileEditor\atelier
- Stack confermato: Tauri 2 + React + TypeScript + Tailwind CSS
- Plugin Tauri attivi: fs, dialog, opener
- Struttura cartelle: src/components/FileTree, Editor, DocxViewer, PdfViewer, hooks, lib, types
- react-arborist richiede mutazione in-place + shallow copy per triggerare re-render corretti