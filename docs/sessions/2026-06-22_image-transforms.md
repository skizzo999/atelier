# Sessione 2026-06-22 (7) - Editing immagini: trasformazioni

## Obiettivo
Fase 1 dell'editing immagini: trasformazioni + pipeline di salvataggio binario.

## Cosa è stato fatto
- ImageViewer diviso in EditableImage (png/jpg/jpeg/webp) e ViewOnlyImage (resto).
- EditableImage: barra strumenti con ruota ⟲⟳, capovolgi ⇋⇅, ridimensiona
  (con blocco proporzioni), zoom/adatta, Salva (Ctrl+S) / Annulla (ripristina dal
  disco), indicatore "non salvato" + dimensioni LxA.
- Trasformazioni via canvas (rotate90 / flip / resizeCanvas), ognuna produce un
  nuovo canvas.
- Pipeline salvataggio binario atomico: `writeFileBinaryAtomic` (writeFile su .tmp
  + rename); permesso `fs:allow-write-file`.
- svg/gif/bmp/ico/avif restano view-only (canvas non li ri-encoda in modo affidabile).

## Limiti / decisioni
- Nessun "buffer" per le immagini: le modifiche non salvate si perdono cambiando
  file (per il testo c'è il buffer stringa; per le immagini servirebbe tenere il
  blob encodato per path). Da aggiungere.
- Editing solo per formati raster ri-encodabili da canvas (png/jpg/webp).

## Prossimi step
1. Ritaglio (crop) interattivo con selezione del rettangolo (fase 1b)
2. Buffer immagini (no perdita modifiche cambiando file)
3. Annotazioni/markup (fase 2)
4. Altri viewer: PDF, DOCX
