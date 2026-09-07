# Sessione 2026-09-07 (2) - Benvenuto in vetro, e il tema scuro

## Obiettivo
"vai avanti con il prossimo step". Nella coda del restyle restavano due cose:
la schermata di benvenuto, mai passata dal tema vetro, e il tema scuro — che
l'utente aveva messo esplicitamente per ultimo.

## Fatto

### La schermata di benvenuto (commit 4d052de)
Era l'unica col vecchio fondo pieno: una lastra bianca sopra lo sfondo
sfumato, ed è la prima cosa che si vede aprendo l'app. Ora il fondo si vede
attraverso, la colonna dei vault è la stessa cornice in vetro dell'Explorer,
e le due schede galleggiano come il resto.

### Tema scuro: la fondazione
Il problema vero non era scegliere i colori: era che la palette stava dentro
`tailwind.config.js`, cioè **compilata**. Una palette lì è fissa per sempre.

I colori sono diventati variabili CSS: `tailwind.config.js` dichiara
`zinc-900` come `rgb(var(--z-900) / <alpha-value>)`, e `index.css` definisce
gli undici gradini due volte — una in `:root`, una in `:root[data-tema='scuro']`.
Ogni gradino conserva il suo RUOLO in entrambi i temi (900 = la carta su cui
si legge, 100 = il testo principale), quindi **nessun componente sa che tema
c'è**: le classi già scritte cambiano significato da sole.

`App` mette `data-tema` sulla radice del documento; lo stato è persistito e
ha tre posizioni — chiaro, scuro, come il sistema — con l'interruttore nella
barra del titolo (sole / luna / cerchio mezzo pieno). Con "come il sistema"
si ascolta `prefers-color-scheme` anche mentre l'app è aperta.

### Quello che non passa da Tailwind
Tre famiglie di colori vivevano scritte a mano e sarebbero rimaste chiare:
- **39 `bg-white`**. Quasi tutti erano menu, finestre e campi — cioè cromo —
  e sono diventati `bg-zinc-900`. Restano bianchi davvero soltanto la pagina
  di un PDF, il foglio di un documento Word e l'anteprima HTML: quelli non
  sono interfaccia, sono **carta**, e ricolorarli falserebbe ciò che
  stamperesti. La griglia di un foglio di calcolo invece è interfaccia
  (anche Excel e Sheets la scuriscono) e segue il tema.
- **La griglia e i grafici**, che disegnano con stili in linea e attributi
  SVG: ora usano variabili (`--gr-*`, `--ch-*`), valide anche dentro `fill`
  e `stroke`.
- **La sintassi del codice**: l'editor e highlight.js avevano toni scuri e
  saturi, giusti sul bianco e invisibili sul nero. Ora ci sono due set con
  gli stessi ruoli.

### Il caso che rischiava di rovinare tutto
I colori del TESTO delle celle vengono dal file. Sul fondo scuro, 209 celle
del file di prova erano nere pure: sarebbero sparite. Ora un colore quasi
nero (luminanza < 0,38) viene sollevato al testo del tema — a meno che la
cella abbia anche un fondo suo, perché lì la coppia colore/fondo l'ha scelta
chi ha fatto il file e resta leggibile com'è. Stessa regola per le serie dei
grafici, che ripiegano sulla palette dell'app quando sono quasi nere.

Verifica sul file vero, contando i colori calcolati di 849 celle:
- chiaro: 576 col testo del tema, **209 nere**, 10 verde scuro
- scuro: **793** col testo del tema (le nere sono state sollevate), più i
  colori chiari del file rimasti intatti

Un residuo dichiarato: un grigio medio scritto nel file (#666666, luminanza
0,40) resta com'è. Alzare la soglia per prenderlo avrebbe travolto anche i
colori voluti — un blu #2b6ef5 sta a 0,42.

### Nota di metodo
Due volte una misura è sembrata un difetto ed era il banco: col pannello del
browser nascosto **le transizioni non avanzano**, quindi ogni proprietà con
`transition-colors` resta inchiodata al valore di partenza. Tolta la
transizione, i valori cambiano correttamente. I banchi ora aggiungono una
marca temporale a css e js, perché il browser incorporato serviva la versione
in cache e mostrava il tema vecchio.

## Da fare
- Prova a mano dell'utente sui due temi.
- Release: dall'ultimo tag (v0.4.1) sono passati tema vetro, zoom, i grafici
  Excel e il tema scuro.
