# Sessione 2026-09-07 - Grafici Excel: perdita nel salvataggio, scatti, spostamento

## Obiettivo
Richiesta dell'utente: "negli excell va a scatti con i grafici e non riesco
neanche a spostarli liberamente, lo zoom va perfettamente, modifica solo
quella cosa dei grafici".

Prima di toccare il trascinamento ho controllato cosa succede a salvare un
file con grafici. Da lì è uscito un problema più grave di quello segnalato.

## Fatto

### Il salvataggio CANCELLAVA i grafici (difetto grave, silenzioso)
ExcelJS, quando riscrive un .xlsx, butta via le parti che non conosce.
Misurato sul file vero dell'utente (*Tracker degli investimenti di Google
Finanza.xlsx*): aprire, cambiare una cella e salvare faceva sparire **4 parti
grafiche su 4** e toglieva il riferimento `<drawing>` da entrambi i fogli.
Il file restava valido — e senza grafici. Nessun messaggio, nessun errore.

Nuovo `src/lib/xlsxPreserve.ts`: `preserveCharts(originale, salvato)` rimette
nel pacchetto appena scritto `xl/charts/**`, `xl/drawings/**` e i media
ancorati, ricrea la relazione nel foglio con un Id che non collide, rimette il
`<drawing>` in fondo al foglio (prima di `</worksheet>`, dove lo schema lo
vuole) e riunisce `[Content_Types].xml`. Non lancia mai: se qualcosa non torna
restituisce il file salvato com'era.

Verifica su file vero (`test-preserve.mjs`): 4/4 parti conservate, 2/2 fogli
col riferimento, 0 riferimenti rotti, la modifica alla cella intatta.

### I grafici di Google Sheets non si vedevano affatto
Il lettore ne trovava **zero** in quel file. Causa: l'esportazione di Google
scrive le cache dei valori VUOTE (`<c:numCache/>`), tenendo solo i riferimenti
`<c:f>`, e `parseChart` scartava le serie senza valori in cache. Ora una serie
è buona anche con la sola cache vuota, purché il riferimento ci sia: i valori
si risolvono dalle celle vive.

Altro difetto trovato strada facendo: `first(anchor, 'ext')` cercava fra tutti
i discendenti e pescava l'`<a:ext>` dentro il `graphicFrame` (la misura della
cornice) invece di quello dell'ancoraggio. Ora si guarda solo il figlio
diretto — il grafico ora è disegnato a 630×229 px, la misura vera del file,
non più quella dedotta da un ripiego.

### Gli scatti
Tre cause, tutte affrontate:
1. `ChartView` non era memoizzato: `onScroll` → `setScrollTop` → ridisegno
   dell'intero SVG a ogni evento di scorrimento. Ora è `memo`.
2. Il grafico stava nello stesso livello di disegno della griglia: ogni
   scorrimento ne obbligava il ridisegno. Ora `will-change: transform` lo
   mette su un livello suo.
3. **La causa vera**: la serie ha 973 punti disegnati su 630 px — più punti
   che pixel, con un attributo `points` da **25 kB** ricostruito e
   rasterizzato a ogni fotogramma. Ora si riduce a circa un punto per pixel
   tenendo **minimo e massimo** di ogni intervallo, così nessun picco sparisce:
   25,3 kB → 10 kB, e l'asse verticale legge ancora 0 → 399,04, cioè
   esattamente il minimo e il massimo dei 973 valori veri.

⚠ Nota di misura: il costo React dello scorrimento l'ho misurato (1,5-1,9 ms
per evento, con e senza `memo`: differenza dentro il rumore). Il costo di
*rasterizzazione* non l'ho potuto misurare col pannello nascosto — è lì che
agiscono i punti 2 e 3, ed è la conferma che manca.

### Spostare i grafici col mouse
- `ChartInfo` porta ora `fromOff`/`toOff` (scostamento fine dall'angolo della
  cella, in px) e `anchor` (quale disegno, quale ancoraggio): la posizione è
  precisa al pixel, non più agganciata alla griglia delle celle.
- Trascinamento: mentre si trascina si muove **solo** il `transform`
  dell'elemento, nessun ridisegno di React; lo stato si aggiorna una volta
  sola al rilascio. Il cursore si cambia sul `body`, non sull'elemento —
  React non riapplica uno stile che secondo lui non è cambiato e il `grab`
  andrebbe perso dopo il primo spostamento.
- `preserveCharts` accetta gli spostamenti e riscrive `<from>`/`<to>` dentro
  il disegno. Un `oneCellAnchor` non ha `<to>`: si sposta e basta, la misura
  resta quella di `<ext>`.

Verifica (`test-sposta-grafico.mjs`), su file vero **e** su un disegno di
prova con ancoraggio a due celle: posizione riletta identica a quella scritta
(scostamenti 17/9 e 41/23 px compresi), tipo/titolo/serie/riferimenti intatti,
4/4 parti grafiche, stesso numero di ancoraggi, Excel riapre il file, e senza
spostamenti il disegno resta **byte per byte** lo stesso.

Nel banco di prova col vero componente: trascinamento di +87/+43 px → la
posizione si sposta esattamente di +87/+43, Salva si accende.

## Da fare
- Confermare gli scatti sulla macchina dell'utente (la parte di
  rasterizzazione non è misurabile in headless).
- Ridimensionare i grafici col mouse: ora è tecnicamente possibile, il
  round-trip del disegno regge.
- Tema scuro — esplicitamente per ultimo.
