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

### Fase 0 — Spike decisionale (30 min, PRIMA di scrivere codice)
Caricare 2-3 xlsx veri (con stili) sia con SheetJS CE sia con ExcelJS e decidere:
- **A**: SheetJS legge + ExcelJS scrive (best di entrambi, 2 dipendenze)
- **B**: solo ExcelJS (1 dipendenza MIT, legge+scrive stili, ma inattiva)
- Verificare: valori calcolati delle formule, celle unite, larghezze colonne, date.

### Fase 1 — XLSX Viewer (chiude la promessa "apri tutto")
1. `XlsxViewer` lazy (code-split come gli altri), routing FileView per xlsx/xls/csv
2. Griglia **nostra** virtualizzata (solo righe visibili, come PdfViewer): niente
   librerie griglia — è un viewer, non serve AG Grid. Intestazioni A-Z/1-n fisse
3. Tab dei fogli in basso (stile Excel), celle unite, larghezze colonne dal file,
   grassetto/colori base se leggibili, date e numeri formattati (cellNF)
4. Formule: mostra il **valore cached** dal file (niente ricalcolo, onesto)
5. Ricerca globale (Ctrl+Shift+F) dentro gli xlsx (estrazione testo celle)
6. Modale "Nuovo file": attivare xlsx (workbook vuoto 1 foglio)

### Fase 2 — XLSX Editing (a tappe, come fu per il DOCX)
7. Edit del valore cella (doppio click), buffer non salvato, Salva = riscrive
   il file (round-trip che preserva stili → dipende dallo spike), `.bak` 1ª volta
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
13. xlsx → CSV, CSV → xlsx (banali con le lib scelte); pptx → testo/PNG per slide

## Punti d'attenzione
- **Peso**: SheetJS/ExcelJS in import dinamico dentro il chunk del viewer (il
  bundle principale resta 490 kB)
- **CSV**: instradare anche .csv al viewer griglia (oggi finisce nell'editor testo)
- **xls vecchi** (BIFF): SheetJS li legge, ExcelJS no → un motivo per l'opzione A
- La ricerca globale già filtra i binari: aggiungere estrattore xlsx come per docx
