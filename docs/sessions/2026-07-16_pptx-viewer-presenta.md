# Sessione 2026-07-16 (2) - pptx: spike librerie, viewer fedele, Presenta

## Obiettivo
Primo blocco delle presentazioni: scegliere la libreria (regola reuse-first,
criterio = round-trip sui file veri) e consegnare viewer fedele + Presenta.

## Spike (su "Prova Atelier.pptx" del vault di test)
- **pptx-viewer-core (ChristopherVR) BOCCIATO**: load→save SENZA modifiche
  duplica i testi e doppio-escapa le entità (&amp;#x2022;); una modifica di
  prova non viene nemmeno scritta nel file. Niente round-trip = fuori.
- **@aiden0z/pptx-renderer PROMOSSO** (Apache-2.0, attivo): slide 960×540
  16:9 esatte, titolo Calibri 32pt bold posizionato, corsivo ok, forme SVG.
  API completa: goToSlide, setZoom, renderSlideToContainer,
  renderThumbnailToContainer, eventi, ricerca con highlight.
- PPTist restava il migliore ma AGPL (escluso) e Vue.

## Integrazione (PptxViewer.tsx riscritto)
- Rendering della libreria (import pigro), pipeline parseZip →
  buildPresentation → renderList windowed.
- **Miniature** nella barra laterale rese dalla libreria (click = goToSlide).
- **Zoom**: scoperto che setZoom è RELATIVO al contenitore (100 = tutta la
  larghezza) — niente misure DOM: fit = 96. +/− con zoomRef (chiusura
  stantia sui click rapidi, fixata). Su richiesta utente: il toggle
  miniature NON resetta lo zoom impostato.
- **Presenta**: overlay fullscreen (requestFullscreen con fallback), stage a
  dimensione modello scalato con transform (riempie lo schermo esatto),
  click/→/Spazio/Invio avanti, click destro/←/Backspace indietro, Esc esce
  (anche uscendo dal fullscreen di sistema), contatore n/N, resize gestito.

## Verifica
Harness browser col componente VERO + CSS di produzione (bundle esbuild con
stub tauri-fs→fetch): caricamento 2 slide, miniature 2/2 col contenuto
giusto, Presenta slide 1→2 con scala 1.333 esatta su 1280×720, Esc pulito,
zoom 96→126 coi click rapidi e mantenuto sul toggle. Build e tsc verdi.
Un bug vero trovato dal harness: renderThumbnailToContainer dichiara una
Promise ma restituisce un oggetto sincrono → .catch esplodeva e React
smontava tutto (Promise.resolve + try/catch).

## Guida aggiornata
docs/guida (it+en, HTML+PDF rigenerati): card pptx, FAQ "E le presentazioni
PowerPoint?", tabella scorciatoie "Nella presentazione".

## Prossimo: EDITOR SLIDE
Architettura decisa: il FILE resta la verità — chirurgia XML sullo zip pptx
(fflate già in casa), UI DOM nostra (riuso pattern gizmo annotazioni).
Passo 1: modulo pptxEdit (apri zip, elenca/modifica testi di una slide,
salva) con round-trip verificato headless; poi doppio click sul testo nel
viewer per editarlo.
