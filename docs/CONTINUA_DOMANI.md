# Prossimi step - Continuità

> Aggiornato al 2026-08-02. Guida utente in `docs/guida/` (it+en, HTML+PDF);
> piano Office in `docs/PIANO_OFFICE.md`; diari in `docs/sessions/`;
> roadmap di chiusura in `docs/ROADMAP_CHIUSURA.md`.

## 🚀 v0.4.0 — la versione di CHIUSURA (2026-08-02)
Tag `v0.4.0` → release automatica Win+macOS (GitHub Actions). Dentro:

- **Modalità Developer** (il toggle nella titlebar ora fa davvero qualcosa):
  pannello inferiore ridimensionabile con **Terminale** (cwd persistente,
  storico, interrompi), **Git** (ramo, file cambiati, diff, aggiungi/commit/
  push, init) e **Strumenti** (JSON, regex, confronto testi, base64/URL/
  SHA-256). In più **editor di codice** con evidenziazione per linguaggio,
  numeri di riga e Ctrl+F, attivo in entrambe le modalità.
- **Excel**: i **grafici del file si vedono** (barre, linee, aree, torta,
  dispersione — in lettura) e la **validazione dati** mostra il menu a
  tendina nelle celle con elenco.
- **pptx**: solo visualizzatore + Presenta con le transizioni del file.
  L'editor slide è FUORI SCOPE per decisione dell'utente (2026-07-17):
  non riaprirlo senza una sua richiesta esplicita.

## ⚠ Da testare a mano dopo il riavvio completo di `pnpm tauri dev`
Terminale e Git dipendono dal permesso shell reale (capability nuova):
verificati finora solo con una shell simulata nell'harness. Tutto il resto è
verificato end-to-end.

## Coda (nessuna è impegnata: decide l'utente)
- Landing: `og.png` da rigenerare e **FORM_ENDPOINT vuoto** in
  `assets/main.js` (il form finge di funzionare e non salva le email) —
  è il blocker se un giorno si pubblica.
- Excel: creazione di grafici da Atelier, funzioni dinamiche di Excel 365.
- Set di icone SVG organico per i toolbar.

---

## Dove siamo arrivati

- **Release pubblicate**: v0.2.0 → v0.2.2 (tabelle, Cestino, DPI/OCR),
  **v0.3.0** (Excel completo + veste grafica fredda), **v0.4.0** (Developer).
- Editor completi: Markdown (3 viste, tabelle vere in Ibrida), DOCX (pagine
  A4), PDF (evidenziatore con .bak, moduli, OCR), immagini (annotazioni, DPI
  preservato), fogli di calcolo (motore formule 342 funzioni, grafici,
  validazione), presentazioni (viewer + Presenta).
- Sistema vault stile Obsidian, tab dei file, ricerca per nome (Ctrl+P) e nel
  contenuto (Ctrl+Maiusc+F), conversioni fra formati, Cestino.
- **Audit codice**: il file vive in
  `C:\Users\matte\Documents\Obsidian Vault\Atelier-analisi-codice.md`.

## Note operative
- Commit/push SOLO quando l'utente lo chiede; messaggi in italiano, chiusi da
  `Co-Authored-By: Claude <modello> <noreply@anthropic.com>`.
- L'utente testa a mano prima di ogni release; le modifiche Rust/config
  richiedono il riavvio di `pnpm tauri dev` (il reload Vite non basta).
- La guida utente va aggiornata a ogni feature nuova (it + en, poi PDF
  rigenerati con lo script Puppeteer nello scratchpad).
