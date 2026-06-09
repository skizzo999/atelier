# Prossimi step - Continuità

## Dove siamo arrivati
- App Tauri + React funzionante
- **Tailwind CSS configurato** (utility classes funzionanti)
- Layout: sidebar (FileTree) + area editor
- FileTree: react-arborist installato, seleziona cartella, mostra file
- **Problema**: espansione cartelle non funziona correttamente (mutazione stato React)

## Cosa fare domani (in ordine)

### 1. Fix react-arborist (URGENTE - 30 min)
- Debug mutazione stato vs re-render
- Soluzione: mutazione in-place parentNode.data.children + shallow copy setTreeData
- Test: click su cartella → si espande mostrando figli

### 2. Developer mode context (40 min)
- Installare Zustand: pnpm add zustand
- Creare store: src/store/appStore.ts
- Aggiungere mode: 'standard' | 'developer'
- Persistenza con tauri-plugin-store
- Integrare in App.tsx

### 3. Apertura file .md (1 ora)
- Gestire onActivate in FileTree
- Leggere contenuto file con Tauri fs API
- Passare contenuto a componente Editor
- Visualizzare testo in textarea base (poi TipTap)

### 4. Editor Markdown con TipTap (2 ore)
- Integrare TipTap in src/components/Editor/Editor.tsx
- Configurare estensioni base (StarterKit)
- Visualizzare contenuto file caricato
- Abilitare modifica testo

### 5. Salvataggio (1 ora)
- Pulsante "Salva" nell'header
- Salvataggio atomico: tmp file + rename
- Aggiornare stato "modificato/non salvato"

### 6. CI e process (30 min - opzionale)
- GitHub Actions workflow
- Branch protection settings
- git rebase per fix commit messages

## Comandi utili
pnpm tauri dev          # Avvia sviluppo
git add . && git commit # Commit cambiamenti
git push                # Push su GitHub (se rete ok)

## File principali da modificare
- src/components/FileTree/FileTree.tsx (fix espansione cartelle)
- src/store/appStore.ts (creare - nuovo file)
- src/components/Editor/Editor.tsx (creare TipTap)
- src/App.tsx (gestire stato file selezionato e contenuto)

## Problemi noti
- react-arborist: mutazione diretta stato React rompe riferimenti interni
- Soluzione tentata: shallow copy [...prevData] dopo mutazione in-place
- Da verificare se funziona o serve approccio diverso (key prop, ecc.)