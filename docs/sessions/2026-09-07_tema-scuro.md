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

---

## Seguito: sei difetti del tema scuro segnalati dall'utente

### 1. Il lampo all'avvio
Il tema si applicava in un effetto di React, cioè **dopo** il primo disegno:
l'app dipingeva una volta chiara e poi saltava allo scuro. E `html`/`body` non
avevano fondo, quindi fra l'apertura della finestra e il primo disegno si
vedeva il bianco del browser.
- Uno script in `index.html` legge la stessa preferenza dello store e mette
  `data-tema` **prima** di qualsiasi disegno; dipinge anche il fondo a mano,
  perché il foglio di stile può non essere ancora arrivato.
- `html, body` hanno il fondo del tema.
- La finestra Tauri ha ora un `backgroundColor`: si apre prima che la webview
  dipinga, e senza colore quell'istante è bianco. Scelto il fondo scuro — un
  lampo scuro su tema chiaro si nota appena, uno bianco su tema scuro no.
- Provata la logica su 8 casi (nessuna preferenza, scelta esplicita, sistema,
  storage corrotto, versione vecchia senza il campo): tutti corretti.

Corretto anche il titolo della finestra, rimasto "Tauri + React + Typescript".

### 2. I .md non si vedevano
Non era la vista Lettura ma la **Ibrida**: i suoi colori stavano scritti a
mano in `livePreview.ts` e `tableEditor.ts`, tarati sul bianco. Titoli e
grassetti restavano quasi neri su fondo scuro. Ora sono variabili.
Verificato nel banco col componente vero: fondo bianco→#141d2d, corpo
#3f4a5c→#c3d0e2, titoli e grassetti #16202e→#eef3fb, link #2b6ef5→#4d8bff,
intestazioni di tabella #f2f6fb→#1b2536.

### 3. Lo sfondo dei .docx
La **scrivania** attorno al foglio restava chiara: una lastra larga mezzo
schermo in un'app scura. Ora segue il tema. Il FOGLIO resta bianco: quello è
il documento che stamperesti.

### 4. Le tab si schiacciavano
Larghezza minima perché una scheda non diventi illeggibile, la rotella scorre
la striscia in orizzontale (il mouse non ha un asse X e le ultime tab erano
irraggiungibili), e aprendo un file la sua scheda si porta da sola in vista.
La barra di scorrimento è nascosta: su una striscia alta 36 px si mangerebbe
l'altezza.

### 5. L'Explorer scendeva e nascondeva l'ultimo file
Selezionando un file compariva la barra di scorrimento orizzontale della
lista, che si mangia una decina di pixel di **altezza** e taglia l'ultima
riga. I nomi sono già troncati col percorso nel tooltip: la barra non serve,
ed è stata tolta.

### Controllo trasversale
Uno script confronta tutte le variabili **usate** in `src/` e in `index.html`
con quelle **definite**: 56 usate, 75 definite, nessuna mancante; e ogni
token del tema chiaro ha il suo corrispettivo nello scuro (l'unica
volutamente condivisa è `--at-blur`).

---

## Il difetto che ha bloccato l'app (e perché i banchi non l'hanno visto)

Aprendo un file qualsiasi l'app spariva: schermo vuoto, tutto fermo.

**Causa**: in `TabBar.tsx` avevo messo lo `useEffect` che porta in vista la
scheda attiva **sotto** l'uscita anticipata `if (openTabs.length === 0) return
null`. Con zero file aperti il componente esegue quattro hook; appena si apre
il primo file ne esegue cinque. React conta gli hook e pretende che il numero
non cambi: **errore #310**, e abbatte l'intero albero. Da qui lo schermo vuoto,
con qualunque tipo di file.

**Perché non l'ho visto**: i banchi montavano *un componente alla volta* —
l'editor, il foglio, la schermata di benvenuto — e nessuno montava la barra
delle tab. Ho verificato i colori, non il guscio.

Prima di questo avevo anche accusato il pezzo sbagliato: avevo tolto il
`backgroundColor` della finestra Tauri pensando fosse quello. Non era.

### Cosa è cambiato nel metodo
- Nuovo **`app-harness.mjs`**: monta l'**App intera** con Tauri simulato
  (fs, core, window, dialog, opener, shell) e un vault finto di tre file, poi
  li apre come farebbe l'utente. Col codice rotto riproduce il blocco e mostra
  l'errore #310; col codice corretto: tre file aperti, app viva, **zero
  messaggi in console**.
- Nuovo **`test-hook-dopo-uscita.mjs`**: scorre tutti i componenti e segnala
  ogni hook chiamato dopo un'uscita anticipata. Provato in entrambi i versi —
  rimettendo l'errore lo becca, sul codice corretto passa.

La funzione non è stata buttata: lo `useEffect` è tornato al suo posto,
**sopra** l'uscita anticipata, con un commento che spiega perché deve restare lì.

---

## "Nuovo file" sfondava il layout

Aprendo la finestra "Nuovo file" il pannello non era centrato: usciva dal
bordo sinistro e spingeva giù l'albero dei file.

**Causa**, e viene dal tema vetro, non da oggi: un elemento con
`backdrop-filter` diventa il **riferimento** dei discendenti in
`position: fixed`. L'Explorer è una cornice in vetro, e la finestra —
`fixed inset-0`, cioè "tutto lo schermo" — è renderizzata dentro di lui.
Misurato nel banco: il velo era **255×684** invece di 1280×720, esattamente
il riquadro della barra laterale.

Vale per ogni sovrapposizione aperta da lì: le due finestrelle di rinomina ed
eliminazione e il menu del tasto destro erano nella stessa condizione.

**Correzione**: nuovo componente `Sovrapposizione`, che porta il contenuto sul
`<body>` con un portale. Il problema sparisce per costruzione, oggi e per
qualsiasi cornice in vetro che verrà aggiunta domani.

Fatto anche l'inventario delle "trappole" a runtime: nell'app ce ne sono tre
(barra del titolo, Explorer, e il contenitore interno di react-arborist).
Le altre sovrapposizioni — foglio di calcolo, PDF, immagini, ricerca — vivono
nella scheda del contenuto, che non ha filtri: stanno bene dove sono.

### Prova nuova: `test-app-viva.mjs`
Prova di fumo dell'app intera guidata da un browser vero. Apre i file, apre la
finestra, e controlla che l'app resti viva, che il velo copra lo **schermo** e
che nessuna sovrapposizione resti intrappolata in una cornice. Verificata in
entrambi i versi: togliendo il portale fallisce con lo stesso numero visto sul
computer dell'utente (255×764 su 1280×800), rimettendolo torna verde.
