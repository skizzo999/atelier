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
8. Tasto destro: aggiungi/elimina righe/colonne, rinomina/aggiungi foglio
   (riuso pattern menu delle tabelle md)
9. Selezione multi-cella + copia TSV (pattern già scritto in tableEditor)

### Fase 3 — PPTX Viewer (best-effort dichiarato)
10. Parser: unzip → `ppt/slides/slideN.xml` → shape con testo (posizione/corpo/
    dimensioni in EMU), immagini da `ppt/media/`, sfondi solidi → render HTML/SVG
    scalato per slide. Navigazione: miniature laterali (pattern PdfViewer)
11. Ricerca globale nel testo delle slide
12. (Dopo) PptxGenJS: creare pptx dalla modale Nuovo file + export

### Fase 4 — Convertitori Office (chiusura del cerchio)
13. xlsx → CSV, CSV → xlsx ✅ (fatti con la Fase 1); pptx → testo/PNG per slide

### Fase 5 — Verso l'Office "vero" (richiesto dall'utente il 2026-07-03)
Ambizione dichiarata: pacchetto Office completo dentro Atelier. Livelli, in ordine
di fattibilità/valore:
14. **Formattazione condizionale base**: valutare le regole semplici (cellIs
    greaterThan/lessThan/between, colorScale a 2-3 colori) lette da ExcelJS →
    applicare i colori nel viewer. Copre il rosso/verde del Tracker.
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
