# Prossimi step - Continuità

## Dove siamo arrivati
- App Tauri + React funzionante
- Layout: sidebar (FileTree) + area editor
- FileTree: pulsante "Apri cartella" funziona, mostra lista file
- Mancante: clic su file → apre contenuto in editor

## Cosa fare domani (in ordine)

### 1. FileTree interattivo
- Aggiungere stato per file selezionato
- Al click su file .md: leggere contenuto con Tauri fs API
- Passare contenuto al componente Editor

### 2. Editor Markdown
- Integrare TipTap in src/components/Editor/Editor.tsx
- Visualizzare contenuto file caricato
- Abilitare modifica testo

### 3. Salvataggio
- Pulsante "Salva" nell'header editor
- Scrivere contenuto su file con Tauri fs API
- Aggiornare stato "modificato/non salvato"

### 4. Cleanup
- Rimuovere/gestire funzione greet() di default
- Organizzare meglio i componenti

## Comandi utili
pnpm tauri dev          # Avvia sviluppo
git add . && git commit # Commit cambiamenti
git push                # Push su GitHub

## File principali da modificare
- src/components/FileTree/FileTree.tsx (aggiungere click handler)
- src/components/Editor/Editor.tsx (creare componente TipTap)
- src/App.tsx (gestire stato file selezionato e contenuto)