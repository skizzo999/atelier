# Prossimi step - Continuità

## Dove siamo arrivati
- FileTree con espansione lazy delle cartelle funzionante (bug react-arborist risolto)
- Scope permessi risolto (comando Rust `allow_path`, accesso ricorsivo alla cartella scelta)
- Sistema vault completo: store Zustand persistito, Welcome (Apri/Nuovo vault),
  auto-apertura dell'ultimo vault all'avvio, validazione esistenza al boot
- Toggle modalità standard/developer persistito (per ora solo stato, nessun comportamento)

## Cosa fare (in ordine)

### 1. Gestione modifiche filesystem a runtime (URGENTE)
Problema: se il vault viene eliminato/spostato mentre l'app è aperta, l'app continua a mostrarlo.
- **Soluzione completa**: fs watcher (tauri-plugin-fs `watch`, feature Cargo `watch` + permesso
  `fs:allow-watch`) sul vault → su rimozione della root torna a Welcome; su cambi dei figli
  refresh dell'albero (stile Obsidian).
- **Quick win interim**: ri-validare `exists(vaultPath)` sul focus della finestra + gestire
  gli errori di `readDir` (se la cartella è sparita → torna a Welcome con messaggio).

### 2. Apertura file .md (1 ora)
- onClick su file (già loggato in console) → `readTextFile` → stato contenuto → componente Editor

### 3. Editor Markdown con TipTap (2 ore)
- Creare src/components/Editor/Editor.tsx con StarterKit
- Mostrare il contenuto del file caricato e abilitare la modifica

### 4. Salvataggio (1 ora)
- Pulsante "Salva", salvataggio atomico (tmp file + rename), stato modificato/salvato

### 5. Migrazione persistenza (opzionale)
- Da `zustand/persist` (localStorage) a `tauri-plugin-store` quando servono più impostazioni
  (cartella di default, tema, ecc.) — si fa una volta sola con un motivo concreto

### 6. CI e process (opzionale)
- GitHub Actions workflow, branch protection

## Comandi utili
pnpm tauri dev          # Avvia sviluppo
git add . && git commit # Commit cambiamenti
git push                # Push su GitHub

## File principali
- src/store/appStore.ts        (store globale: vaultPath + mode)
- src/lib/vault.ts             (apertura/creazione vault, scope)
- src/components/FileTree/FileTree.tsx
- src/components/Welcome/Welcome.tsx
- src/components/Editor/Editor.tsx   (da creare)
- src-tauri/src/lib.rs         (comando allow_path; qui andrà il watcher)

## Problemi noti
- Modifiche al filesystem esterne all'app non rilevate a runtime (vedi step 1)
- Il toggle Developer cambia solo lo stato, non ancora il comportamento
