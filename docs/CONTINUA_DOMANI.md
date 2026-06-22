# Prossimi step - Continuità

## Dove siamo arrivati
- FileTree con espansione lazy + watcher filesystem (albero allineato al disco in tempo reale)
- Vault eliminato/spostato mentre l'app è aperta → torna alla Welcome
- Sistema vault persistente con auto-apertura dell'ultimo vault all'avvio
- Editor file: lettura, modifica, salvataggio (Ctrl+S), indicatore "non salvato",
  risync al focus finestra
- Markdown: toggle Codice (sorgente) / Lettura (renderizzato + sanitizzato DOMPurify)
- Gestione file: crea/rinomina/elimina (menu tasto destro su elemento o area vuota)
- Salvataggio atomico (tmp+rename); modifiche non salvate stile VS Code (buffer in
  memoria, nessuna perdita cambiando file); pallino "non salvato" nel tree

## Cosa fare (in ordine)

### 1. Editor Ibrido / live preview (la terza vista Obsidian)
- Le viste Codice e Lettura ci sono; manca l'Ibrida (markdown che si renderizza inline
  mentre scrivi, stile Obsidian Live Preview).
- Richiede un motore dedicato: valutare **CodeMirror 6** (è quello che usa Obsidian,
  supporta syntax highlight del sorgente + decorazioni per il live preview).
- Sostituirà/affiancherà la textarea attuale nella vista Codice.

### 2. Ricerca / quick-open
- Cercare file per nome (quick-open) e cercare nel contenuto del vault
- Appena il vault ha tanti file diventa essenziale per navigarlo

### 3. Avviso modifiche non salvate alla chiusura
- I buffer non salvati sono in memoria: intercettare la chiusura della finestra
  Tauri e avvisare/salvare

### 4. Gestione conflitti editor
- Se ci sono modifiche non salvate (buffer) E il file cambia da fuori → scelta
  "tieni le mie / ricarica dal disco"

### 5. Modalità developer (comportamento reale)
- Oggi il toggle cambia solo lo stato: definire cosa mostra/abilita in developer

### 6. Opzionali
- Migrazione persistenza a `tauri-plugin-store`
- CI GitHub Actions + branch protection

## Comandi utili
pnpm tauri dev          # Avvia sviluppo
git add . && git commit # Commit cambiamenti
git push                # Push su GitHub

## File principali
- src/store/appStore.ts                  (store: vaultPath + mode + selectedFile)
- src/lib/vault.ts                       (apertura/creazione vault, scope)
- src/lib/fileOps.ts                     (crea/rinomina/elimina file e cartelle)
- src/components/FileTree/FileTree.tsx   (albero + watcher + menu file)
- src/components/Editor/Editor.tsx       (lettura/modifica/salvataggio + viste md)
- src/components/Welcome/Welcome.tsx     (schermata iniziale)
- src/App.tsx                            (boot, layout)
- src-tauri/src/lib.rs                   (comando allow_path)

## Problemi noti
- Salvataggio non atomico (vedi step 2)
- Risync editor solo al focus finestra (non real-time)
- Creazione in cartella chiusa: l'elemento compare all'apertura della cartella (lazy load)
