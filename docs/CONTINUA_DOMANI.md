# Prossimi step - Continuità

## Dove siamo arrivati
- FileTree con espansione lazy + watcher filesystem (albero allineato al disco in tempo reale)
- Vault eliminato/spostato mentre l'app è aperta → torna alla Welcome
- Sistema vault persistente con auto-apertura dell'ultimo vault all'avvio
- Editor file: lettura, modifica, salvataggio (Ctrl+S), indicatore "non salvato",
  risync al focus finestra
- Markdown: toggle Codice (sorgente) / Lettura (renderizzato + sanitizzato DOMPurify)
- Gestione file: crea/rinomina/elimina file e cartelle (menu tasto destro + pulsanti root)

## Cosa fare (in ordine)

### 1. Editor Ibrido / live preview (la terza vista Obsidian)
- Le viste Codice e Lettura ci sono; manca l'Ibrida (markdown che si renderizza inline
  mentre scrivi, stile Obsidian Live Preview).
- Richiede un motore dedicato: valutare **CodeMirror 6** (è quello che usa Obsidian,
  supporta syntax highlight del sorgente + decorazioni per il live preview).
- Sostituirà/affiancherà la textarea attuale nella vista Codice.

### 2. Hardening editor
- Salvataggio atomico: scrivere su file tmp + rename (evita corruzione su crash)
- (fatto) Sanitizzazione dell'HTML in vista Lettura con DOMPurify

### 3. Gestione conflitti editor
- Se ci sono modifiche locali non salvate E il file cambia da fuori → scelta
  "tieni le mie / ricarica dal disco"

### 4. Modalità developer (comportamento reale)
- Oggi il toggle cambia solo lo stato: definire cosa mostra/abilita in developer

### 5. Opzionali
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
