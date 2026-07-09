# Piano pacchetto Office (xlsx + pptx) — v0.3.x

> Scritto il 2026-07-03, prima di iniziare. Obiettivo: aprire (e poi modificare)
> Excel e PowerPoint dentro Atelier, tutto offline, zero licenze a pagamento.

## Librerie e licenze (verificate 2026-07)

| Lib | Licenza | Uso | Note |
|---|---|---|---|
| **SheetJS CE** (`xlsx`) | Apache-2.0 | LETTURA xlsx/xls/ods/csv | La più completa in lettura (20+ formati). ⚠ Su npm è ferma a 0.18.5 (CVE note): installare la 0.20.x dal **loro CDN** (`https://cdn.sheetjs.com/xlsx-latest/xlsx-latest.tgz`). ⚠ La CE **non scrive gli stili** (colori/bordi = SheetJS Pro, a pagamento) |
| **ExcelJS** | MIT | SCRITTURA con stili + round-trip | Legge E scrive stili. ⚠ Inattiva da fine 2023 (funziona, ma niente fix) |
| **fflate** | MIT | unzip pptx | Già in casa (usata per docxSectPr) |
| **PptxGenJS** | MIT | CREARE pptx (dopo) | Solo scrittura, non lettura |
| ~~Handsontable~~ | commerciale | griglia | NO |
| ~~HyperFormula~~ (ricalcolo formule) | GPLv3/commerciale | — | NO: v1 mostra i valori già calcolati salvati nel file |

**Renderer pptx maturi open-source: non esistono** (pptxjs & co. sono jQuery
abbandonati). Strada: **parser nostro** — pptx è uno ZIP di XML come il docx,
abbiamo già tutta l'esperienza (fflate + DOMParser, vedi `docxSectPr.ts`).

## Scaletta

### Fase 0 — Spike decisionale ✅ FATTA (2026-07-03)
**Scelta: B — solo ExcelJS 4.4.0** (MIT, 1 dipendenza). Verificato su file generato
con stili: legge valori, formule col risultato cached, date, numFmt (€/%/decimali),
grassetto/corsivo/colori/fill, celle unite (con `master.address` per le coperte),
larghezze colonne, più fogli — e il **round-trip di modifica preserva tutto**.
SheetJS rimandata a quando serviranno .xls (BIFF) / .ods.

### Fase 1 — XLSX Viewer ✅ FATTA (2026-07-03, da testare dall'utente)
Implementato `XlsxViewer.tsx` (chunk lazy, ExcelJS 915 kB caricata solo qui):
griglia virtualizzata nostra (finestra di righe, header A-Z e numeri riga sticky),
tab dei fogli in basso (costruzione pigra + cache per foglio), celle unite
(colSpan; rowspan solo visivamente parziale), stili base (grassetto/corsivo/
colori/sfondo/allineamento), date e numeri in formato italiano, formule = valore
cached, tetto 10.000 righe con avviso "troncato". CSV → stesso viewer (parser
nostro `lib/csv.ts`, separatore auto ; o ,). Modale Nuovo file: xlsx attivo
(workbook vero, non 0 byte). Ricerca globale dentro gli xlsx (cache mtime).
Converti: xlsx→CSV (primo foglio), CSV→xlsx/md.
Rifinito sui 5 file reali dell'utente (template Google Sheets): colori a tema
(palette da theme1.xml + tint), altezze riga vere (virtualizzazione a prefissi),
dimensioni font per cella, unioni orizzontali (colSpan) e verticali (niente
rowSpan vero ma sfondo del master propagato — no buchi bianchi), checkbox ☑/☐,
CSV con celle multiriga quotate. **Limiti dichiarati**: niente grafici embedded
(nessuna lib JS li renderizza), niente formattazione condizionale (andrebbe
valutata), numFmt custom con abbreviazioni (es. 4.363.599M) resi come numero
pieno. Piano originale:
1. `XlsxViewer` lazy (code-split come gli altri), routing FileView per xlsx/xls/csv
2. Griglia **nostra** virtualizzata (solo righe visibili, come PdfViewer): niente
   librerie griglia — è un viewer, non serve AG Grid. Intestazioni A-Z/1-n fisse
3. Tab dei fogli in basso (stile Excel), celle unite, larghezze colonne dal file,
   grassetto/colori base se leggibili, date e numeri formattati (cellNF)
4. Formule: mostra il **valore cached** dal file (niente ricalcolo, onesto)
5. Ricerca globale (Ctrl+Shift+F) dentro gli xlsx (estrazione testo celle)
6. Modale "Nuovo file": attivare xlsx (workbook vuoto 1 foglio)

### Fase 2 — XLSX Editing (a tappe, come fu per il DOCX)
7. ✅ FATTO e testato dall'utente (2026-07-03): CLICK SINGOLO → input a cella
   piena (altezza/font veri); capisce numeri it (1.234,56), VERO/FALSO, vuoto;
   booleane = checkbox cliccabili; **MINI-MOTORE FORMULE nostro** (niente eval,
   CSP intatta: parser a discesa ricorsiva) — aritmetica con riferimenti,
   SUM/SOMMA, MEDIA/AVERAGE, CONTA/COUNT, MIN, MAX su range; il risultato va
   nel file come cached (lo vede anche Excel); 11/11 test sul file reale.
   Formule fuori dal subset salvate senza risultato. Modifiche SUBITO nel
   workbook ExcelJS in memoria → Salva/Ctrl+S = writeBuffer che preserva
   stili/formati/merge, `.bak` nascosto 1ª volta, buffer per-file che
   sopravvive al cambio file, pallino + guardia chiusura. Celle orario (date
   1899) mostrate come ore. CSV in sola lettura per ora.
   → Il motore è il SEME della Fase 16: estenderlo lì (IF, ricalcolo a catena
   delle celle dipendenti — oggi ricalcola solo la cella editata).
8. ✅ FATTO (2026-07-03 sera): menu tasto destro sulla griglia (aggiungi riga
   sopra/sotto, duplica, elimina; colonna sx/dx, elimina; svuota selezione);
   fogli: ＋ nuovo, doppio click sul tab = rinomina, ✕ elimina (con conferma).
   Refactor buffer: ora si bufferizza l'INTERO workbook per file (regge le
   operazioni strutturali, dove il buffer per-cella si rompeva)
9. ✅ FATTO: selezione multi-cella col drag (tinta blu sopra i fill), Ctrl+C
   = TSV incollabile in Excel, Canc = svuota, Esc = deseleziona; il click
   singolo resta editing (drag ≠ click, come tableEditor)
9b. ✅ Rifiniture dal test utente (2026-07-03 sera): **incolla multi-cella**
   (TSV → distribuito dalle celle di destinazione, sia con selezione sia
   incollando dentro l'editor di cella); **fogli nuovi con griglia vera**
   (60×26 minimo, +30 righe oltre l'usato — prima erano vuoti e ineditabili);
   **ridimensionamento colonne/righe** trascinando i bordi delle intestazioni
   (persistito nel file: px→chars e px→pt); **formattazione condizionale con
   semantica Excel corretta** (priorità crescente, primo-vince per proprietà,
   stopIfTrue) — riverificata sul Tracker: max/min/148 rialzi, font bianco
   del massimo preservato

### Fase 3 — PPTX Viewer (best-effort dichiarato) ✅ FATTA (2026-07-03 sera)
10. ✅ Parser nostro `lib/pptx.ts` (fflate + DOMParser): slide in ordine dalla
    presentazione, forme con posizione/dimensione EMU→px (ereditarietà dei
    placeholder dal layout, 1 livello), testo con run stilati (sz/b/i/colore/
    allineamento/bullet), sfondi e riempimenti pieni (srgbClr + schemeClr via
    theme1.xml), immagini da ppt/media. Gli r:id letti dal DOM con fallback
    regex (i DOM non-browser perdono gli attributi namespaced). Verificato su
    un deck reale generato con PptxGenJS: 8/8 asserzioni. `PptxViewer.tsx`:
    slide impilate con zoom/adatta, miniature laterali, testo bianco di
    default sugli sfondi scuri. FUORI (dichiarato): gruppi trasformati,
    gradienti, tabelle, grafici, animazioni, master (solo layout)
11. ✅ Ricerca globale nel testo delle slide (regex sugli <a:t>, cache mtime)
12. ✅ PptxGenJS 4.0.1 (MIT): "Nuovo file → PowerPoint" crea un deck vero con
    una slide vuota — VIA l'ultimo placeholder "presto" dalla modale.
    Converti: pptx → TXT

### Fase 4 — Convertitori Office (chiusura del cerchio)
13. xlsx → CSV, CSV → xlsx ✅ (fatti con la Fase 1); pptx → testo/PNG per slide

### Fase 2.6 — Editing avanzato (chiusura blocco xlsx, 2026-07-03 notte)
9c. ✅ **Fill handle** (quadratino blu sull'angolo della selezione): trascina e
    continua la serie — numeri con passo, date con passo in giorni, testo+numero
    ("Voce 1"→"Voce 2"), altrimenti copia ciclica; anteprima durante il drag;
    logica testata 8/8. ✅ **Ctrl+Z / Ctrl+Y** (annulla/ripeti, max 100 op):
    copre edit di cella, incolla multi-cella, svuota, fill; le operazioni
    STRUTTURALI (righe/colonne) azzerano la cronologia (gli indici slittano).
    ✅ Selezione senza testo nativo di disturbo; click su lettera/numero =
    seleziona colonna/riga intera.
    **Decisione reuse-first (verificata via web)**: FortuneSheet/Luckysheet =
    archiviati; il successore attivo è Univer, MA l'import/export xlsx è nel
    tier Pro a pagamento e il round-trip perderebbe ciò che il suo modello non
    rappresenta → si resta su ExcelJS + griglia nostra. Toolbar formattazione/
    ordina/filtra/blocca riquadri = Fase 2.5 dopo le presentazioni.

9d. ✅ Rifiniture UX Excel (2026-07-04): **editing in place** — click e scrivi,
    niente casella di testo visibile (input trasparente che eredita font/
    colore/allineamento della cella; la cella attiva ha solo il bordo blu 2px);
    **bordo di selezione spesso** disegnato come overlay sul range (2px #1a73e8)
    col **fill handle** sull'angolo; **trascina il bordo per SPOSTARE le celle**
    (anteprima tratteggiata, clamp ai bordi del foglio, una sola op in
    cronologia → Ctrl+Z la annulla; sposta i VALORI, non gli stili — v1).

### 9e. "Funzioni pro" ✅ (2026-07-07, da testare a mano)
Le funzioni del menu tasto destro di Excel (screenshot dell'utente), fatte
sull'architettura attuale (reuse-first check già fatto, Univer scartata):
- **Menu tasto destro riorganizzato**: Taglia / Copia / Incolla (TSV; esistono
  anche Ctrl+X/C/V da tastiera), sottomenu **Riga** e **Colonna** (le voci
  strutturali di prima), sottomenu **Ordina intervallo** (A→Z / Z→A),
  **Crea un filtro / Rimuovi filtro**, **Cancella contenuto** (ex "Svuota",
  ora annullabile con Ctrl+Z). Il tasto destro fuori dalla selezione la
  sposta sulla cella cliccata, come Excel.
- **Ordina intervallo**: ordina le righe della selezione per la colonna
  cliccata; semantica Excel (numeri/date prima del testo, vuote sempre in
  fondo, testo case-insensitive); si spostano i VALORI, gli stili restano
  (come "Ordina intervallo" di Sheets); una sola op → annullabile.
- **Toolbar formato celle** sopra la griglia: grassetto/corsivo/sottolineato/
  barrato, dimensione carattere, colore testo, colore riempimento (+ nessun
  riempimento), allineamento orizzontale, formato numero (automatico / 0,00 /
  percentuale / valuta €). Tutto scritto in ExcelJS (font/fill/alignment/
  numFmt) e **annullabile**: la cronologia ora registra anche gli STILI
  (snapshot JSON prima/dopo). Agisce sulla selezione o sulla cella in
  modifica; i controlli mostrano lo stato della cella-ancora del range.
- **Filtro**: "Crea un filtro" scrive un **autoFilter vero** nel workbook
  (round-trip in Excel/Sheets verificato); pulsanti ▼ sulla riga di
  intestazione, dropdown coi valori unici della colonna (spunte, Tutti/
  Nessuno, conteggi); le righe filtrate diventano `row.hidden` nel file →
  anche i file GIÀ filtrati da Excel/Sheets si aprono filtrati (righe
  nascoste = altezza 0 nella griglia). Limite v1: i criteri (quali valori
  sono esclusi) vivono in memoria per file+foglio, non nel file (ExcelJS
  non modella i filterColumn).
- Rifinitura: il click su una cella imposta anche la selezione 1×1 (toolbar
  e fill handle sanno su cosa agire); durante l'editing l'overlay di
  selezione sparisce (il bordo lo dà la cella attiva).
- Test: 23 assert headless (ordinamento, parse autoFilter, righe nascoste,
  round-trip, snapshot stili per l'undo) su "Elenco delle cose da fare.xlsx".

### 9f. Verso "Excel intero dentro Atelier" — drop 1 ✅ (2026-07-07, da testare)
Obiettivo dichiarato dall'utente: ricreare Excel dentro Atelier. Primo drop:
- **Barra della formula** (casella nome + fx, sopra la griglia): mostra il
  contenuto grezzo della cella attiva; scrivi lì e Invio applica (Esc annulla);
  nella casella nome digiti un riferimento (es. `B12`) e salti alla cella.
- **Motore formule vero** → Fase 16 ✅ (fast-formula-parser, ~280 funzioni,
  ricalcolo live a catena, alias italiani). La SOMMA ora si aggiorna quando
  cambi una cella da cui dipende.
- **Blocco riferimenti `$`**: il fill handle trascina le FORMULE come Excel
  (riferimenti relativi traslati, `$colonna`/`$riga` bloccati, stringhe nelle
  formule intatte); `shiftRefsAbs` in formulaEngine.ts.
- **Formato celle completo** (dialog da toolbar o tasto destro): bordi per
  lato/perimetro con stile (sottile/medio/spesso/doppio/tratteggiato/
  punteggiato) e colore; riempimento a **gradiente** (2 colori + direzione,
  anteprima live) — scritto come vero gradient fill xlsx e renderizzato come
  linear-gradient CSS. Tutto annullabile (snapshot ora include anche border).
- **Formati tabella predefiniti** (bottone "Tabella"): 6 stili (intestazione
  piena + righe alternate + bordi coordinati) applicati alla selezione.
- **Ordinamento**: etichette chiare (Crescente 1→9 A→Z / Decrescente) e le
  stringhe numeriche ("1.234,56" incollato come testo) ordinano come numeri.
- Bordi tratteggiati/punteggiati/doppi ora renderizzati fedelmente anche in
  lettura; scorciatoie della griglia disattivate mentre scrivi negli input.
- Test: 27 assert headless (alias IT, shift $, ricalcolo con catene/cicli/
  VLOOKUP/IF, cached preservati, 3 file veri, gradiente, sort numerico).

### 9g. Rifiniture da feedback ✅ (2026-07-08, da testare)
Dal primo giro di prova dell'utente su 9f:
- **Modalità formula**: mentre scrivi una formula (=...), il click su
  un'altra cella ne INSERISCE il riferimento nella formula (click
  consecutivi lo sostituiscono, come Excel; digitando un operatore il
  prossimo click aggiunge un nuovo riferimento); vale sia scrivendo nella
  cella sia nella barra fx.
- **FIX allineamento selezione** ("non è centrato"): le righe con testo
  renderizzavano più alte del modello (padding verticale UA dei td, 1px
  sopra+sotto, + line box del font) e il bordo di selezione derivava —
  l'errore si accumulava riga dopo riga. Fix strutturale: contenuto delle
  celle in un div ad ALTEZZA FISSA (la geometria resa coincide SEMPRE col
  modello) + `py-0` sui td + **auto-fit dell'altezza riga al font** per le
  righe senza altezza esplicita (come fa Excel). Verificato nel browser:
  delta overlay 0.00 su tutti e 4 i lati, righe 21.00 esatte, riga con
  font 14pt → 29.00.
- **FIX clamp dei range**: `actualRowCount/actualColumnCount` di ExcelJS
  sono CONTEGGI delle righe/colonne piene, non ultimi indici → sui fogli
  sparsi SUM(E1:H1) veniva troncata (dava 22 invece di 88); ora
  rowCount/columnCount. Verificato live: modifica E1 → SUM ricalcolata 96.
- **Harness browser riusabile**: XlsxViewer VERO bundlato con stub Tauri
  (esbuild) e servito in preview Chromium — selezioni trascinate, editing,
  formule e misure DOM sul componente reale. Da rifare a ogni giro di
  verifica del lavoro Excel (script in scratchpad di sessione: build-app.mjs
  + app.html + server.js, ricrearli è questione di minuti).

Secondo giro (2026-07-08, dopo il test dell'utente su Pro e contro):
- **Colori in modalità formula** (come Excel): ogni riferimento nella
  formula prende un colore ciclico; la cella/range referenziata ha un
  riquadro TRATTEGGIATO dello stesso colore con velo all'8%; il testo del
  riferimento è colorato uguale (specchio dietro l'input: testo dell'input
  trasparente + caret visibile, span colorati sotto — vale sia nella cella
  sia nella barra fx). `parseFormulaRefs` garantisce specchio 1:1 col testo.
  In più: **trascinando in modalità formula si costruisce un RANGE**
  (=SUM(E1:F2 in un gesto).
- **rowSpan VERO per le unioni verticali** (era il "Lisbona." clippato):
  il master occupa tutte le righe del blocco; le coperte spariscono solo se
  il master è dentro la finestra virtualizzata (fuori → td vuoti, niente
  slittamenti; master nascosto dal filtro → fallback).
- **Banner che debordano** (era il titolo 42pt tagliato): i template Google
  mettono font enormi in righe basse con vAlign top — il testo DEVE uscire
  sotto (overflow visibile quando il font è più alto della riga), come
  rende Sheets. Il clip rigido del primo giro lo tagliava a metà.
- Fix: anche il NUMERO di riga è in un contenitore ad altezza fissa (le
  righe spaziatrici da 7,5pt venivano gonfiate a 19px dal testo "1").
- Verificato su "Pro e contro.xlsx" nel browser: 0 righe fuori modello,
  delta overlay 0.00/-0.33 subpixel; titolo e "Lisbona, Portogallo" interi.

Terzo giro (2026-07-08, feedback utente su Orario settimanale + fill handle):
- **AUTO-FIT delle righe al contenuto, come mostra Google**: gli export dei
  template scrivono altezze "stantie" (banner ORARIO SETTIMANALE 21pt in
  righe da 6pt: Google a schermo le rialza da sé, ExcelJS non espone il
  flag customHeight — verificato). Regola: riga vuota = altezza del file
  (spaziatori intatti); riga con contenuto = almeno il font più alto, e
  per il testo A CAPO le righe stimate col canvas (textWidth / larghezza
  colonne, fattore 1.1, cap 20 righe); i master con rowSpan non contano.
  Fix del "glyph soup" del banner Orario (3 testi sovrapposti in 16px) e
  della sovrapposizione titolo/"Prima destinazione" in Pro e contro (il
  titolo ora vive nella SUA riga, 144px). Sempre: modello = reso, al pixel.
- **Fill handle visibile anche mentre scrivi** (bug segnalato: "clicco e
  il quadratino non appare"): l'overlay di selezione resta durante
  l'editing; trascinare quadratino o bordo COMMITTA prima il testo in
  scrittura e poi riempie/sposta (verificato: 5 scritto → drag → 5,6,7).
- Verifica browser: Orario r1/r2 37px puliti, Pro r4 144px, righe fuori
  modello: zero su entrambi i file.
- **Mini-menu del tasto Canc** (richiesta utente): con una selezione,
  Canc apre "Cancella dalla selezione…" → Solo contenuto / Solo
  formattazione / Tutto (contenuto+formato, UNA operazione → un solo
  Ctrl+Z); **Backspace** cancella direttamente il solo contenuto, senza
  menu. "Cancella formattazione" anche nel menu tasto destro. Verificato
  nel browser: grassetto tolto e valore intatto con "Solo formattazione",
  Backspace diretto, SUM ricalcolata dopo la cancellazione.

### Analisi "è davvero come Excel?" (2026-07-08, richiesta dall'utente
prima di dichiarare chiuso il blocco xlsx — release v0.3.x rinviata)
Verdetto: il core è solido MA mancano cose che un utente Excel nota nei
primi 10 minuti. **"Ultimo miglio" consigliato PRIMA di chiudere il blocco**:
1. **Navigazione con tastiera** (il gap più visibile in assoluto): frecce
   per muoversi tra le celle, Shift+frecce estende la selezione,
   Ctrl+frecce salta ai bordi dei dati, Invio committa e SCENDE, Tab va a
   destra, **scrivi-per-sostituire** (digiti su una cella selezionata e
   sostituisce), F2 per editare. Oggi la griglia è solo-mouse.
2. **Copia/incolla RICCO interno**: oggi il copia è TSV (testo formattato);
   copiare una cella con =SOMMA e incollarla incolla il NUMERO. Come
   Excel: incolla le FORMULE traslate (shiftRefsAbs c'è già) + gli stili;
   verso l'esterno resta TSV.
3. **Blocca riquadri**: leggere ws.views frozen (xSplit/ySplit) dal file
   (i template li usano!) e renderli sticky; voce di menu per impostarli.
4. Piccoli: doppio click sul bordo colonna = auto-fit larghezza.

### 9h. Ultimo miglio ✅ (2026-07-09, da testare a mano)
I 4 punti dell'analisi, fatti e verificati nell'harness browser:
1. **Tastiera completa**: frecce muovono il fuoco (Shift estende, Ctrl salta
   ai bordi dei dati stile Excel), Invio committa e SCENDE (Shift+Invio
   sale), Tab destra/sinistra, PagSu/PagGiù, Home/Ctrl+Home, Ctrl+A
   seleziona tutto, **F2** edita, **scrivi-per-sostituire** (digiti su una
   cella selezionata e il testo sostituisce il contenuto). In modalità
   "scrittura" le frecce committano e si spostano; in F2/doppio click
   muovono il caret (come le due modalità di Excel). ⚠ CAMBIO UX: il click
   singolo ora SELEZIONA (come Excel), si edita scrivendo/F2/doppio click.
2. **Copia/incolla ricco interno**: Ctrl+C/X cattura valori+FORMULE+stili;
   l'incolla interno trasla i riferimenti delle formule (dr/dc, $ rispettati)
   e porta i formati; il Taglia marca e SVUOTA L'ORIGINE all'incolla (una
   sola op → un solo Ctrl+Z ripristina tutto; annullo in ordine inverso per
   i range sovrapposti). Verso l'esterno resta TSV; l'incolla riconosce la
   propria copia confrontando il testo di sistema.
3. **Blocca riquadri**: letti dal file (ws.views frozen) e scritti nel file
   (round-trip); righe bloccate SEMPRE renderizzate (fuori finestra
   virtuale) e sticky con sfondo opaco + linea di demarcazione; colonne
   bloccate sticky anche nelle lettere di intestazione; menu tasto destro
   "Blocca riquadri" (righe fino a / colonne fino a / riga e colonna qui /
   sblocca). Verificato: scroll a 400px, righe 1-2 inchiodate a y 24/45.
4. **Doppio click sul bordo colonna = auto-adatta** larghezza al contenuto
   (misura canvas, cap 500px, celle unite escluse).
Limite noto (cosmetico): una formula incollata su un range completamente
vuoto mostra il testo della formula finché una dipendenza non ha un valore.

### 9i. Giro "spaesamento" ✅ (2026-07-09, da testare a mano)
Obiettivo dichiarato dall'utente: chi arriva da Excel deve sentirsi a casa,
"l'unica differenza devono essere i colori". Gli 8 punti dell'analisi:
- **Date/orari/percentuali digitati**: `05/07/2026`, `5/7`, `8:30`, `12,5%`
  diventano valori VERI (data/ora/numero) col formato numero implicito,
  come Excel — prima diventavano testo e i calcoli non funzionavano.
  Display date/ore ora in UTC (convenzione dei seriali ExcelJS): fixa anche
  gli orari che venivano mostrati spostati di fuso.
- **Barra di stato**: selezioni ≥2 celle → Somma/Media/Conteggio in basso
  a destra (il riflesso condizionato di chi usa Excel).
- **Autocompletamento formule**: digiti `=SO` → dropdown con SOMMA,
  SOMMA.SE… (nomi italiani E inglesi); frecce per scegliere, Tab/Invio
  inserisce `NOME(`.
- **F4** mentre scrivi una formula: cicla i `$` del riferimento al caret
  (A1 → $A$1 → A$1 → $A1), anche nella barra fx.
- **Ctrl+D / Ctrl+R** (riempi giù/destra, formule traslate) e **doppio
  click sul fill handle** = riempi fino alla fine dei dati adiacenti.
- **Shift+click** estende la selezione; **trascinando sulle intestazioni**
  si selezionano più righe/colonne intere.
- **Ctrl+F trova nel foglio**: barra flottante, evidenzia gialla su tutti i
  match (max 500), Invio/Shift+Invio salta tra i risultati.
- **FORMULE TRASLATE su inserimento/eliminazione righe-colonne** (il buco
  di correttezza): `adjustFormula` in formulaEngine.ts con semantica Excel
  — riferimenti spostati, range allargati/accorciati, #REF! su ciò che è
  stato eliminato, `$` conservati, stringhe e riferimenti con foglio
  intatti; le formule CONDIVISE vengono prima materializzate (gli indirizzi
  dei master diventano stantii dopo lo splice). Verificato live: insert
  riga sopra → =SOMMA(E1:F1) diventa =SUM(E2:F2), risultato invariato.
- Test: 28 assert headless nuovi (traslazioni, date, workbook vero) +
  verifica interattiva in harness (barra stato, autocomplete, Ctrl+F,
  insert riga). Totale suite: 78 assert.

**Backlog "Excel intero"** (dopo l'ultimo miglio, da prioritizzare):
grafici in lettura (Fase 15 — il Tracker ne ha uno invisibile oggi),
validazione dati/dropdown (i template li usano), formati numero
personalizzati + date dai seriali + più valute, unione celle da UI, trova
e sostituisci nel foglio, traslazione formule su insert/delete
righe-colonne (oggi corrompono i riferimenti in silenzio!), selezione non
contigua Ctrl+click, Alt+Invio a capo in cella, ricalcolo CF dopo ogni
edit, spill del testo sulle vuote adiacenti, commenti, stampa.

### Fase 5 — Verso l'Office "vero" (richiesto dall'utente il 2026-07-03)
Ambizione dichiarata: pacchetto Office completo dentro Atelier. Livelli, in ordine
di fattibilità/valore:
14. ✅ FATTA (2026-07-03 sera): regole **cellIs** (>, <, >=, <=, =, <>, between)
    ed **espressioni** nel subset del motore (confronti, AND/OR, shift dei
    riferimenti relativi con semantica Excel, $ assoluti) con memoizzazione.
    Verificata sul Tracker reale: max/min evidenziati + 148 rialzi in 82 ms.
    Fuori: colorScale/dataBar/iconSet (rare nei file utente, eventualmente poi).
    ⚠ Statica: si ricalcola al load/rebuild del foglio, non a ogni edit di cella.
15. **Grafici in lettura**: parse di `chart1.xml` (linee/barre/torta base) →
    ridisegnati con SVG nostro nella posizione dell'ancora. Progetto da 2-3
    sessioni; niente interattività (il dropdown "12 Months" del template Google
    è data-validation + ricalcolo → dipende dal punto 16).
16. ✅ FATTA (2026-07-07) — **con reuse-first, non da zero**: HyperFormula è
    GPL → niente; scelta **fast-formula-parser 1.0.19 (MIT)**: ~280 funzioni
    Excel (IF, VLOOKUP, COUNTIF, testo, date, statistiche…), parser LL(1),
    81 kB gzip in chunk pigro. Integrazione in `src/lib/formulaEngine.ts`:
    il workbook resta ExcelJS (round-trip intatto), il parser legge le celle
    via hook onCell/onRange. **Ricalcolo live a catena** dopo ogni modifica
    (dipendenze risolte in ricorsione con memo + guardia sui cicli; i result
    vanno anche nel file, così ogni app li vede). Formule fuori supporto
    (GOOGLEFINANCE…) tengono il cached, com'è giusto offline. L'utente può
    scrivere i nomi ITALIANI (=SOMMA, =SE, =CONTA.SE… ~60 alias) e lo stile
    italiano `;`/virgola decimale: nel file va il canonico inglese.
    ⚠ Il parser NON è rientrante: pool di istanze per profondità di
    ricorsione (bug verificato con test, istanza singola = stato corrotto).
    ⚠ Le operazioni strutturali su righe/colonne NON traslano le formule
    esistenti (limite ExcelJS, backlog).

## Punti d'attenzione
- **Peso**: SheetJS/ExcelJS in import dinamico dentro il chunk del viewer (il
  bundle principale resta 490 kB)
- **CSV**: instradare anche .csv al viewer griglia (oggi finisce nell'editor testo)
- **xls vecchi** (BIFF): SheetJS li legge, ExcelJS no → un motivo per l'opzione A
- La ricerca globale già filtra i binari: aggiungere estrattore xlsx come per docx
