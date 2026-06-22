# Sessione 2026-06-22 (3) - Gestione file e sanitizzazione

## Obiettivo
Aggiungere la gestione di file e cartelle dal tree (creare/rinominare/eliminare)
e sanitizzare l'HTML della vista Lettura. Rimandata la modalità Ibrida dell'editor.

## Decisione: ibrida rimandata
- Valutato TipTap vs CodeMirror 6 per la modalità Ibrida (live preview).
- TipTap → CM6 non è uno swap economico (paradigmi opposti: documento ProseMirror
  vs testo + decorazioni) e tiptap-markdown è lossy sul round-trip dei .md reali
  (rischio di riscrivere i file dell'utente al salvataggio).
- Quindi rimandata: quando si farà l'ibrida si andrà dritti su CodeMirror 6.

## Cosa è stato fatto

### Gestione file/cartelle
- src/lib/fileOps.ts: createFile, createFolder, renameEntry, deleteEntry
  (writeTextFile/mkdir/rename/remove) con check "esiste già".
- Permessi aggiunti: `fs:allow-rename`, `fs:allow-remove`.
- FileTree: menu tasto destro (cartella = Nuovo file/Nuova cartella/Rinomina/Elimina;
  file = Rinomina/Elimina), pulsanti "+ File" / "+ Cartella" per la radice del vault,
  modale nome (create/rename) e conferma eliminazione.
- Le modifiche al disco sono riflesse dal watcher; il nuovo file si apre subito
  nell'editor; rinomina/elimina del file aperto aggiorna/svuota l'editor.

### Stato selezione file nello store
- `selectedFile` spostato nello store Zustand (non persistito, via `partialize`):
  Editor lo legge dallo store, FileTree lo aggiorna. Serve a coordinare
  rename/delete con il file aperto.

### Sanitizzazione
- Vista Lettura: `DOMPurify.sanitize(marked.parse(content))` prima del render.

## Stato finale
- Si possono creare/rinominare/eliminare file e cartelle dall'app
- Vista Lettura markdown sanitizzata

## Problemi / decisioni
- Creazione in una cartella chiusa: l'elemento compare quando la cartella viene aperta
  (lazy load), il nuovo file però si apre comunque nell'editor
- Salvataggio ancora non atomico (tmp + rename) — prossimo hardening

## Prossimi step
1. Editor Ibrido / live preview (CodeMirror 6)
2. Hardening: salvataggio atomico (tmp + rename)
3. Gestione conflitti editor (locali non salvati + cambi esterni)
4. Comportamento reale della modalità developer

## Note tecniche
- Nuove dipendenze: dompurify 3.4
- Nuovi file: src/lib/fileOps.ts
- Permessi fs aggiunti: rename, remove
