# Sessione 2026-06-22 (6) - Viewer immagini + routing per tipo

## Obiettivo
Avviare il routing dei viewer per tipo di file (cuore del multi-formato),
partendo dalle immagini.

## Cosa è stato fatto
- src/components/FileView/FileView.tsx: instrada il file selezionato in base al
  tipo (immagini → ImageViewer, tutto il resto → Editor testo). È il punto in cui
  aggiungeremo PDF, DOCX, ecc.
- src/components/ImageViewer/ImageViewer.tsx: legge l'immagine in binario
  (`readFile`) → blob URL; anteprima centrata con Adatta / 100% / zoom +/−;
  revoca dell'object URL alla chiusura.
- App usa `<FileView />` al posto di `<Editor />` diretto.
- Permesso `fs:allow-read-file`.
- Formati: png, jpg, jpeg, gif, webp, bmp, svg, ico, avif.

## Decisione editing immagini (concordata, da implementare)
- Scope: **trasformazioni base** (ruota/capovolgi/ritaglia/ridimensiona) +
  **annotazioni/markup** (penna, frecce, riquadri, testo).
- A fasi: prima le trasformazioni (mettono in piedi la pipeline
  `canvas → ri-encode → scrittura atomica`), poi le annotazioni (overlay canvas,
  "appiattite" sull'immagine al salvataggio).
- Annotazioni distruttive (incise nel file) in V1; non-distruttive più avanti.

## Prossimi step
1. Editing immagini fase 1: trasformazioni
2. Editing immagini fase 2: annotazioni/markup
3. Altri viewer: PDF (PDF.js), DOCX (Mammoth), poi pptx/xlsx (SheetJS)
4. Editor Ibrido / live preview (CodeMirror 6)

## Note tecniche
- Nessuna nuova dipendenza (solo permesso read-file).
- Servirà un modello dirty/salva per i binari: l'attuale è solo per il testo
  (buffer stringa). Lo aggiungeremo con l'editing immagini.
