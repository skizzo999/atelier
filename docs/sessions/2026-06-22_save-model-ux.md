# Sessione 2026-06-22 (4) - Modello salvataggio e UX

## Obiettivo
Bundle "sicurezza" (protezione modifiche non salvate + salvataggio atomico) e
migliorie UX richieste: rimozione tasti header, menu su area vuota dell'explorer,
indicatore "non salvato" anche nel tree.

## Cosa è stato fatto

### Salvataggio atomico
- `writeFileAtomic` in fileOps (scrive su `.tmp` poi `rename` sul file finale;
  su Windows `std::fs::rename` sostituisce il file → atomico).
- I file `.tmp` sono filtrati dall'albero.

### Modello modifiche non salvate (stile VS Code)
- Prima provato auto-save al cambio file, poi cambiato su richiesta: i file restano
  "sporchi" in memoria, non si scrive su disco finché non si salva esplicitamente.
- Buffer per file nello store Zustand (`dirtyBuffers: path -> contenuto`, non persistito).
- Cambiando file le modifiche non si perdono né si salvano; riaprendo il file si
  ritrovano. Il salvataggio (Ctrl+S / Salva) svuota il buffer.
- "dirty" derivato dallo store (condiviso tra editor ed explorer).

### UX explorer
- Indicatore "non salvato" (pallino arancio) di fianco al nome del file nell'explorer
  (oltre che nell'header editor).
- Rimossi i tasti "+ File" / "+ Cartella" dall'header.
- Menu contestuale sull'**area vuota** dell'explorer → Nuovo file / Nuova cartella
  nella radice del vault.
- Coordinamento buffer: la rinomina sposta il buffer sul nuovo path, l'eliminazione
  lo scarta (`clearBuffersUnder`).

## Stato finale
- Salvataggio atomico ed esplicito; nessuna perdita di modifiche cambiando file
- Indicatore non-salvato visibile nel tree
- Creazione file/cartelle anche da area vuota

## Decisioni / limiti
- Modello esplicito (no auto-save): i buffer vivono in memoria → si perdono se si
  chiude l'app senza salvare. Avviso-alla-chiusura come step futuro.
- Rinomina di una cartella con dentro file non salvati: i buffer annidati non vengono
  rimappati (caso raro).

## Prossimi step
1. Editor Ibrido / live preview (CodeMirror 6)
2. Ricerca / quick-open (file e contenuto)
3. Avviso "modifiche non salvate" alla chiusura dell'app
4. Gestione conflitti editor (buffer + modifiche esterne)

## Note tecniche
- Nessuna nuova dipendenza/permesso in questo blocco (rename/remove/write già presenti)
- Store: aggiunti dirtyBuffers + setBuffer/clearBuffer/clearBuffersUnder/moveBuffer
