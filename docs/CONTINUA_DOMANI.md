# Prossimi step - Continuità

> Aggiornato al 2026-07-02, sera. Per il dettaglio completo di ogni funzione vedi `docs/STATUS.md`.

## Dove siamo arrivati

- **Release pubblicate**: v0.2.0 (tabelle Obsidian in Ibrida + menu contestuale md),
  v0.2.1 (Cestino + igiene audit), v0.2.2 (DPI immagini, backup PDF, worker OCR, scope).
  Il tag `v*` builda Win+macOS e pubblica la Release in automatico (GitHub Actions).
- **Ultimo blocco (committato, NON ancora rilasciato)**: **sistema vault "vero" stile
  Obsidian** — `.atelier\vault.json` dentro ogni vault, **picker** all'avvio (lista vault
  conosciuti + Crea/Apri), picker anche quando apri una **seconda istanza** (heartbeat
  in localStorage). Testato dall'utente ✓.
- **Audit codice**: 17/24 voci chiuse. Il file vive in
  `C:\Users\matte\Documents\Obsidian Vault\Atelier-analisi-codice.md` (fuori dal repo);
  le 6 aperte sono mappate a fasi future nella sezione "Voci ancora aperte" del file.
- Editor completi: Markdown (3 viste, tabelle vere editabili in Ibrida), DOCX (pagine A4
  vere, legge anche i .docx esterni), PDF (evidenziatore con .bak), immagini (annotazioni,
  DPI preservato). File: drag-drop nel tree, import da Explorer, modale "Nuovo file",
  eliminazione nel Cestino.

## Cosa fare (in ordine)

1. **"Ultimi fix che mancano"** prima della prossima release (parole dell'utente):
   da confermare con lui quali intende — candidati naturali: le rifiniture piccole
   rimaste (BUG-5 indici in sessione, PERF-2 watcher churn) e/o bug emersi dal suo uso.
2. **Prossima release**: quando i fix sono chiusi ("poi lanciamo la .3").
3. **Direzione v0.3.0 da scegliere** (utente ancora indeciso):
   - **Excel/PPT** ← raccomandata (completa l'identità "apri qualsiasi file di lavoro");
     reality check già dato: xlsx viewer fattibile (SheetJS), xlsx editor = progetto
     grosso a tappe, pptx = viewer best-effort (nessun renderer OSS maturo)
   - **Modalità developer** — il toggle esiste ma è vuoto: va DEFINITA prima (10 min di
     chiacchierata su cosa deve contenere)
   - **Parte grafica** — per ultima, come ha sempre detto l'utente; include: token
     colore/tema unificato, **dialog chiusura custom** (il confirm nativo non gli
     piace), code-split del bundle (PERF-1)
4. **Rifiniture Ibrida** (dopo, insieme alle rifiniture base): liste numerate/annidate,
   footnote, KaTeX, md inline renderizzato nelle celle tabella.

## Note operative
- Commit/push SOLO quando l'utente lo chiede; messaggi in italiano, chiusi da
  `Co-Authored-By: Claude <modello> <noreply@anthropic.com>`.
- L'utente testa a mano prima di ogni release; le modifiche Rust/config richiedono
  riavvio di `pnpm tauri dev` (il reload Vite non basta).
- Se si apre lo stesso vault in due finestre non c'è lock (Obsidian lo impedisce, noi
  no): eventuale rifinitura futura.
