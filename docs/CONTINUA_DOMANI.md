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

### 0. Routing viewer per tipo di file (cuore del multi-formato) — IN CORSO
- FileView instrada per tipo. Fatto: immagini → ImageViewer. Da fare:
  - docx → Mammoth.js (view/edit)
  - pdf → PDF.js (view-only)
  - poi pptx, xlsx (SheetJS) e altri
- File di codice → legati alla modalità developer (più avanti)

### 0b. Editing immagini (in corso)
- [x] Fase 1: trasformazioni (ruota/capovolgi/ridimensiona) + salvataggio binario
  atomico (writeFileBinaryAtomic). Solo png/jpg/webp.
- [x] Buffer immagini: blob PNG per path, le modifiche non salvate sopravvivono al
  cambio file (pallino nel tree); coordinato con rinomina/elimina
- [x] Ritaglio (crop) interattivo con selezione del rettangolo (fase 1b)
- [ ] Fase 2: annotazioni/markup (penna, frecce, riquadri, testo)
- [ ] Fase 2: annotazioni/markup (penna, frecce, riquadri, testo) → overlay canvas,
  flatten al salvataggio. Distruttive in V1.

### 1. Editor Ibrido / live preview (la terza vista Obsidian)
- [x] Base CodeMirror 6 (vista "Codice", highlight markdown).
- [x] Vista **Ibrida** (livePreview.ts): decorazioni inline che nascondono i
  marcatori e formattano titoli/grassetto/corsivo/inline-code/link; la sintassi
  grezza appare sulla riga attiva. Toggle "Ibrida" nell'header.
- [x] Aspetto "documento" (font proporzionale, sfondo app, spaziatura); allineata anche la Lettura
- [x] Sintassi: titoli ATX+Setext, grassetto/corsivo/barrato, evidenziato ==, liste puntate,
  task list, citazioni, righe, tabelle, link, code inline/blocco
- [x] Evidenziazione sintassi nei blocchi di codice (Ibrida: codeLanguages+HighlightStyle; Lettura: highlight.js)
- [x] Wikilink [[nota]] e callout > [!tipo] (Ibrida + Lettura)
- [x] Immagini inline: `![alt](path)` e `![[file]]` (embed), risolte per nome in
  tutto il vault (indice in App), con placeholder "non trovata"
- [x] Code block: nascosti i ``` + etichetta linguaggio; tabelle boxate (widget)
- [ ] Liste numerate stilizzate/annidate, footnote, math (KaTeX)
- [ ] Icona ↗ link esterni; risoluzione immagini in sottocartelle già coperta dall'indice
- [ ] Valutare default "Ibrida" per i .md; code-split di CM6 (bundle grande)

## .md CHIUSO — domani: annotazioni immagini (fase 2), viewer PDF/DOCX

### 2. (fatto) Ricerca / quick-open
- Ctrl+P quick-open per nome (tutti i tipi), Ctrl+Shift+F ricerca contenuto
  (file testuali), highlight del termine all'apertura
- Da migliorare: indice mantenuto dal watcher; ricerca contenuto nei binari (coi viewer)

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
