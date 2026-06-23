# Sessione 2026-06-23 - Annotazioni immagini + zoom/pan dinamico

## Obiettivo
Avviare la fase 2 del viewer immagini: annotazioni (penna, frecce, forme, testo) e
rendere lo zoom "carino e dinamico" su tutti i viewer.

## Cosa è stato fatto

### Annotazioni (src/lib/annotations.ts + ImageViewer.tsx)
- Overlay **SVG** sopra il canvas, in coordinate immagine (viewBox = dimensioni native):
  preview live e flatten su canvas usano la stessa geometria → coincidono al pixel.
- Strumenti: **penna** a mano libera, **freccia** (gambo fino alla base + triangolo
  della punta più largo del gambo), **forme** (rettangolo, ellisse/cerchio, triangolo,
  linea), **testo**.
- **Due penne configurabili e persistenti** (`penPresets` nello store, in `partialize`):
  slider **opacità** e **spessore** + colore. Default: Penna 1 rossa piena, Penna 2
  evidenziatore giallo semitrasparente.
- "Applica" = flatten sul canvas riusando `applyTransform` (buffer PNG + dirty +
  scrittura atomica). Distruttivo in V1.
- Draft tenuto in un `ref` autoritativo (no doppie aggiunte da StrictMode).

### Zoom/pan dinamico (hook useImageViewport)
- "Palco" con `transform: translate(tx,ty) scale(scale)` che contiene canvas/img +
  overlay insieme. Rotella = zoom **verso il cursore** (fino a 32×), trascina = pan,
  fit automatico, controlli −/%/+/Adatta.
- **Unificato**: stesso hook per immagini editabili (dentro e fuori da "Annota") e per
  i formati sola-lettura. In modalità normale il trascinamento sposta; in annota si
  disegna e il pan è con barra spazio / tasto centrale / strumento mano ✋.
- In modalità normale il wrapper non rimonta il canvas (display unico col transform),
  così non si perde l'immagine cambiando modalità.

## Problemi risolti
- **Punta freccia** poco leggibile col tratto spesso → gambo fermato alla base della
  testa + triangolo ~3× il gambo.
- **Testo "non scriveva"**: cliccando sull'overlay il `mousedown` spostava il focus al
  body (l'SVG non è focusabile) e l'input si chiudeva subito → fix con `preventDefault`
  sul mousedown dell'SVG + focus esplicito via ref.
- Vecchia misura manuale dell'overlay sostituita dal transform del viewport (più robusto).

## Perché alcuni formati restano sola-lettura
`canvas.toBlob` ri-codifica solo PNG/JPEG/WebP. Quindi editabili = png/jpg/jpeg/webp;
gif (animata) / svg (vettoriale) / bmp / ico / avif sono sola lettura. Eventuale editing
andrebbe esportato come PNG (con perdita di animazione/vettoriale).

## Prossimi step
1. **Selezione/modifica oggetti** annotati: sposta / ridimensiona dagli angoli / ruota +
   colore/opacità/spessore. Unico gizmo per testo e forme (copre il "testo manipolabile").
2. **Gomma a pixel** (raster, sul tratto della penna).
3. (Opzionale) Modifica ed esporta come PNG per i formati sola-lettura.

## Note tecniche
- File nuovo: src/lib/annotations.ts. Store: aggiunto `penPresets` (persistito).
- Commit della sessione: `94cc960` (annotazioni), `88b6061` (zoom/pan unificato).
- Regola da ricordare: per "titoli a blocco" in CM6 niente widget (vedi callout `::before`);
  per il focus su input creati al click, `preventDefault` sul mousedown del contenitore.
