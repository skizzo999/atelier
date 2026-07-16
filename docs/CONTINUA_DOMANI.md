# Prossimi step - Continuità

> Aggiornato al 2026-07-16. Dettaglio funzioni in `docs/STATUS.md`; piano
> Office in `docs/PIANO_OFFICE.md`; diari in `docs/sessions/`.

## 🔧 Dopo la v0.3.0 (2026-07-15/16, committato)
- **Fix grave formattazione**: ExcelJS condivide l'oggetto style tra celle
  gemelle → copia privata (`ownStyle`) prima di ogni modifica di formato.
- **Motore formule VERO**: ~60 nomi di fast-formula-parser erano stub vuoti
  (MAX, MIN, CONFRONTA, SOMMA.PIÙ.SE…) → colmati con @formulajs/formulajs
  (MIT): **342 funzioni funzionanti** testate. OFFSET/INDIRECT esclusi
  (valore cached del file). Alias nuovi: SCEGLI, MEDIA/MAX/MIN.PIÙ.SE,
  TESTO.UNISCI.
- **Guida utente** in `docs/guida/`: HTML+PDF curati (Puppeteer, 16 pagine,
  numeri pagina), italiano E inglese. Da tenere AGGIORNATA a ogni feature;
  buona base per la pagina docs della landing.

## ✅ pptx passo 1 FATTO (2026-07-16, committato): viewer fedele + Presenta
Spike sui file veri: **pptx-viewer-core BOCCIATO** (round-trip corrompe già
senza modifiche), **@aiden0z/pptx-renderer PROMOSSO** (Apache-2.0) e
integrato nel PptxViewer: miniature della libreria, zoom relativo al
contenitore (fit=96, il toggle miniature NON resetta lo zoom — richiesta
utente), **Presenta** fullscreen (click/frecce avanti, Esc esce, scala
esatta). Verificato end-to-end nel harness col CSS di produzione. Guida
aggiornata (it+en) e PDF rigenerati.

## ▶ PROSSIMO: EDITOR SLIDE (pptx passo 2)
Architettura: il FILE resta la verità — **chirurgia XML sullo zip** (fflate
già in casa), UI DOM nostra (riuso pattern gizmo annotazioni immagini).
1. Modulo `src/lib/pptxEdit.ts`: apri zip, elenca i testi di una slide,
   modifica un run, salva → round-trip verificato headless sul file vero
   (il renderer rilegge, PowerPoint riapre).
2. UI: doppio click su un testo nel viewer → editing in place → Salva.
3. Poi: sposta/ridimensiona forme, aggiungi testo/immagini, riordino slide.
Poi in coda: backlog Excel v0.3.x (grafici, validazione dati, formati
numero completi), icone SVG toolbar, og.png landing, FORM_ENDPOINT landing.
Tag `v0.3.0` → release automatica Win+macOS (GitHub Actions). Dentro:
**pacchetto Excel completo** (griglia fedele + editor + motore formule
fast-formula-parser ~280 funzioni + tastiera completa + incolla ricco +
blocca riquadri + undo strutturale + tutto 9a-9i di PIANO_OFFICE.md) e
**nuova veste grafica** (tema freddo grigio/bianco/azzurro/blu, Explorer
stile Obsidian ridimensionabile/nascondibile, titlebar custom, TAB dei file
riordinabili col drag, pattern unico dei toolbar con primari a gradiente,
ConfirmDialog in-app, zero emoji). Landing già riconvertita alla stessa
palette (og.png da rigenerare; FORM_ENDPOINT del form ancora vuoto).

## ▶ PROSSIMO: blocco presentazioni (pptx)
Deciso dall'utente ("nuova versione e poi pensiamo a pptx"):
1. **PRIMA la ricerca librerie** (regola reuse-first): editor slide su
   canvas (Fabric.js/Konva) vs DOM nostro; criterio = round-trip sui pptx
   veri. Confronto da portare all'utente.
2. Tasto **Presenta** (fullscreen, frecce/click avanti, Esc esce).
3. Editor slide vero (testo, forme, immagini, riordino slide).
Poi in coda: backlog Excel v0.3.x (grafici, validazione dati, formati
numero completi), restyling fine dei toolbar con icone SVG, og.png landing.

## ⚡ Ripresa rapida (storico, 2026-07-08)
**Direzione dichiarata dall'utente: "ricreare interamente Excel dentro
Atelier"**. Excel = viewer fedele + editor + funzioni pro (9e) + **drop 1
di Excel-completo** (9f): **motore formule vero** (fast-formula-parser MIT,
~280 funzioni, ricalcolo live, alias italiani =SOMMA/=SE, `$` bloccati nel
fill), **barra della formula** (nome + fx), **Formato celle** (bordi per
lato/stile/colore + gradiente), **stili tabella predefiniti**, ordinamento
numerico. In più (2026-07-08, feedback utente): **modalità formula COMPLETA** (click
su una cella inserisce il riferimento, drag = range, ogni riferimento
COLORATO come Excel: riquadro tratteggiato sulla cella + testo dello stesso
colore nella formula), **fix allineamento** dell'overlay (celle e numero di
riga ad altezza fissa = geometria sempre uguale al modello, auto-fit riga
al font), **rowSpan vero** per le unioni verticali + **banner che
debordano** (titolo 42pt di "Pro e contro" era tagliato) e **fix clamp dei
range** (rowCount vs actualRowCount sui fogli sparsi). Terzo giro:
**auto-fit delle righe al contenuto come Google** (i template esportano
altezze stantie: banner in righe da 6pt — fix del glyph soup di Orario
settimanale e del titolo sovrapposto in Pro e contro) e **fill handle
visibile anche mentre scrivi** (il drag committa e poi riempie), **mini-menu
del tasto Canc** (Solo contenuto / Solo formattazione / Tutto; Backspace =
contenuto diretto). Tutto riprodotto e verificato in un harness browser col
componente VERO (0 righe fuori modello su Pro e contro e Orario, delta
overlay 0.00). L'utente ha detto "funziona tutto" su tutto il resto.
**2026-07-09 — ULTIMO MIGLIO fatto (sezione 9h, da testare)**: tastiera
completa (frecce/Invio scende/Tab/Ctrl+frecce/F2/scrivi-per-sostituire —
⚠ il click ora SELEZIONA come Excel, si edita scrivendo, con F2 o doppio
click), copia/incolla ricco (formule traslate + stili; Taglia svuota
l'origine all'incolla, un solo Ctrl+Z), blocca riquadri (round-trip nel
file + menu tasto destro), doppio click sul bordo colonna = auto-adatta.
**2026-07-09 sera — giro "SPAESAMENTO" fatto (9i, da testare)**: date/orari/
percentuali digitati riconosciuti, barra di stato Somma/Media/Conteggio,
autocompletamento formule (=SO → SOMMA…), F4 cicla i $, Ctrl+D/R, doppio
click sul fill handle, Shift+click, selezione multipla dalle intestazioni,
Ctrl+F trova nel foglio, e **formule traslate su inserimento/eliminazione
righe-colonne** (il buco di correttezza, chiuso con semantica Excel piena).
Release v0.3.0: la decide l'utente dopo il test di 9h+9i.
Tutto in sezione 9e-9i di PIANO_OFFICE.md; build verde, 78 test
headless, committato e pushato (5a1be0c).
**2026-07-11/12 — PARTE GRAFICA (da testare, NON committato)**: dopo il
feedback dell'utente sul giro 1 caldo ("troppo morto"), tema DEFINITIVO
freddo **grigio · bianco · azzurro · blu**: zinc→slate in tailwind.config,
bottoni fondamentali col gradiente azzurro→blu (.btn-accent) che si staccano
dai grigi, **Explorer stile Obsidian** (chevron, badge estensione, guide di
rientro, niente emoji), **barra del titolo custom** (decorations:false —
⚠ serve riavvio completo di `pnpm tauri dev`), **TAB per più file aperti**
(store openTabs + TabBar, ✕/click centrale, rimappa su rinomina/sposta),
**ConfirmDialog in-app** (via il confirm nativo, voce chiusa), emoji rimosse
dai toolbar. **Landing riconvertita alla stessa palette** (og.png da
rigenerare da og-source.svg). Landing blocker: FORM_ENDPOINT vuoto in
assets/main.js. Diario completo: docs/sessions/2026-07-11_tema-workshop.md.
Domani: test utente, set icone SVG organico, rifiniture, commit.
Prossimi:
1. L'utente testa 9e+9f → fix → commit quando lo dice lui.
2. **Backlog Excel-completo da prioritizzare con lui** (fine di 9f in
   PIANO_OFFICE.md): blocca riquadri, formati numero/date, unione celle da
   UI, trova e sostituisci, validazione dati, formule su insert/delete,
   grafici (Fase 15), CF dopo ogni edit.
3. **Blocco presentazioni**: tasto **Presenta** (fullscreen, frecce, Esc) +
   **editor slide** — PRIMA fare ricerca librerie (regola reuse-first:
   Fabric.js/Konva per canvas editing vs DOM nostro; confronto da portare
   all'utente)
4. Release quando lo dice lui.

---

## Dove siamo arrivati

- **Release pubblicate**: v0.2.0 (tabelle Obsidian in Ibrida + menu contestuale md),
  v0.2.1 (Cestino + igiene audit), v0.2.2 (DPI immagini, backup PDF, worker OCR, scope).
  Il tag `v*` builda Win+macOS e pubblica la Release in automatico (GitHub Actions).
- **Ultimo blocco (committato, NON ancora rilasciato)**: **sistema vault "vero" stile
  Obsidian** — `.atelier\vault.json` dentro ogni vault, **picker** all'avvio (lista vault
  conosciuti + Crea/Apri), picker anche quando apri una **seconda istanza** (heartbeat
  in localStorage). Testato dall'utente ✓.
- **Audit codice**: 19/24 voci chiuse (ultimi: PERF-1 code-split, bundle 3.5MB→490kB,
  e BUG-5 indici live). Il file vive in
  `C:\Users\matte\Documents\Obsidian Vault\Atelier-analisi-codice.md` (fuori dal repo);
  le 6 aperte sono mappate a fasi future nella sezione "Voci ancora aperte" del file.
- Editor completi: Markdown (3 viste, tabelle vere editabili in Ibrida), DOCX (pagine A4
  vere, legge anche i .docx esterni), PDF (evidenziatore con .bak), immagini (annotazioni,
  DPI preservato). File: drag-drop nel tree, import da Explorer, modale "Nuovo file",
  eliminazione nel Cestino.

## Cosa fare (in ordine)

1. ~~Ultimi fix~~ ✅ fatti (PERF-1 code-split + BUG-5 indici, sera del 2026-07-02).
   **Da testare a runtime**: apertura di md/PDF/DOCX/immagini dopo il code-split
   (spinner alla 1ª apertura per tipo), OCR, creazione .docx, ricerca nei PDF/DOCX.
2. **Prossima release ("la .3")**: la decide l'utente, quando ha testato.
3. **Direzione v0.3.0 DECISA: pacchetto Office (xlsx+pptx)** → scaletta completa,
   librerie e licenze verificate in **`docs/PIANO_OFFICE.md`** (partire dalla Fase 0,
   lo spike SheetJS vs ExcelJS). Le alternative scartate per ora erano:
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
