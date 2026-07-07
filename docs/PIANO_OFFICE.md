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

### PROSSIMO (dopo il compact del 2026-07-04): "funzioni pro"
L'utente vuole le funzioni del menu tasto destro di Excel (suo screenshot):
Taglia/Copia/Incolla nel menu, Inserisci/Elimina righe-colonne (già fatte),
**Cancella contenuto**, **Filtro**, **Ordina** (per colonna), **Formato celle**
(grassetto/corsivo/colori/formati numero — ExcelJS li scrive), eventuale
mini-toolbar di formattazione sopra la griglia. Da fare sull'architettura
attuale, voce per voce; reuse-first check già fatto (Univer scartata).

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
16. **Motore formule SUBSET nostro** (il limite strutturale): HyperFormula è
    GPL → niente. Scrivere un subset MIT-nostro: aritmetica, SUM/AVERAGE/COUNT/
    MIN/MAX/IF/percentuali — copre l'80% dei fogli reali. Ricalcolo su modifica
    (Fase 2 editing) invece del solo valore cached. Le formule esotiche
    (GOOGLEFINANCE ecc.) restano cached, com'è giusto offline.

## Punti d'attenzione
- **Peso**: SheetJS/ExcelJS in import dinamico dentro il chunk del viewer (il
  bundle principale resta 490 kB)
- **CSV**: instradare anche .csv al viewer griglia (oggi finisce nell'editor testo)
- **xls vecchi** (BIFF): SheetJS li legge, ExcelJS no → un motivo per l'opzione A
- La ricerca globale già filtra i binari: aggiungere estrattore xlsx come per docx
