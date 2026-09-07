// Il primo file "pesante" di una sessione costa mezzo secondo, e non per il
// file: è il pacchetto di codice che lo apre. Misurato: importare ExcelJS
// (915 kB) 560 ms, poi il primo foglio vero 162 ms — di cui 47 solo di
// riscaldamento del motore. Il codice è già sul disco: basta caricarlo
// PRIMA che serva, nei momenti in cui l'app non sta facendo niente.
//
// Gli specificatori qui sotto devono restare IDENTICI a quelli usati dai
// componenti, altrimenti l'impacchettatore crea un secondo pacchetto e il
// riscaldamento non serve a nulla.

type Caricatore = () => Promise<unknown>

/** Cosa serve per aprire ciascun tipo di file, in ordine di necessità. */
const PER_TIPO: Record<string, Caricatore[]> = {
  xlsx: [
    () => import('../components/XlsxViewer/XlsxViewer'),
    async () => {
      const ExcelJS = (await import('exceljs')).default
      // Un giro a vuoto su un foglio minuscolo: scalda anche il motore, non
      // solo il caricamento del modulo (162 ms → 115 sul file vero).
      const vuoto = new ExcelJS.Workbook()
      vuoto.addWorksheet('a').getCell('A1').value = 1
      const bytes = await vuoto.xlsx.writeBuffer()
      await new ExcelJS.Workbook().xlsx.load(bytes as ArrayBuffer)
    },
  ],
  docx: [() => import('../components/DocxEditor/DocxEditor'), () => import('mammoth')],
  pdf: [() => import('../components/PdfViewer/PdfViewer'), () => import('pdfjs-dist')],
  pptx: [() => import('../components/PptxViewer/PptxViewer'), () => import('@aiden0z/pptx-renderer')],
  testo: [() => import('../components/Editor/Editor')],
  immagine: [() => import('../components/ImageViewer/ImageViewer')],
}

const ESTENSIONI: Record<string, string> = {
  xlsx: 'xlsx',
  xlsm: 'xlsx',
  csv: 'xlsx',
  docx: 'docx',
  pdf: 'pdf',
  pptx: 'pptx',
  png: 'immagine',
  jpg: 'immagine',
  jpeg: 'immagine',
  gif: 'immagine',
  webp: 'immagine',
  svg: 'immagine',
}

/** Tipo di visualizzatore per un percorso; 'testo' è il ripiego. */
export function tipoDi(percorso: string): string {
  const ext = percorso.slice(percorso.lastIndexOf('.') + 1).toLowerCase()
  return ESTENSIONI[ext] ?? 'testo'
}

const fatti = new Set<string>()
const coda: string[] = []
let inCorso = false

// Un pezzo alla volta, e solo quando il browser è fermo: scaldare non deve
// mai rubare tempo a chi sta usando l'app.
function quandoLibero(f: () => void) {
  const ric = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
    .requestIdleCallback
  if (ric) ric(f, { timeout: 3000 })
  else setTimeout(f, 200)
}

async function svuotaCoda() {
  if (inCorso) return
  const tipo = coda.shift()
  if (!tipo) return
  inCorso = true
  for (const carica of PER_TIPO[tipo] ?? []) {
    try {
      await carica()
    } catch {
      // Un riscaldamento fallito non è un errore: il file si aprirà lo stesso,
      // solo un po' più lentamente.
      break
    }
  }
  inCorso = false
  if (coda.length) quandoLibero(() => void svuotaCoda())
}

/** Prepara il visualizzatore di un tipo, se non è già pronto. */
export function scalda(tipo: string): void {
  if (!PER_TIPO[tipo] || fatti.has(tipo)) return
  fatti.add(tipo)
  coda.push(tipo)
  quandoLibero(() => void svuotaCoda())
}

/** Come sopra, partendo da un percorso di file (per il passaggio del mouse). */
export function scaldaPerFile(percorso: string): void {
  scalda(tipoDi(percorso))
}

/**
 * All'avvio: prepara i visualizzatori dei tipi che l'utente ha davvero nel
 * vault, i più frequenti per primi. Chi non ha nessun .pptx non paga il
 * caricamento del renderer da 974 kB.
 */
export function scaldaPerVault(percorsi: string[]): void {
  const conteggio = new Map<string, number>()
  for (const p of percorsi) {
    const t = tipoDi(p)
    conteggio.set(t, (conteggio.get(t) ?? 0) + 1)
  }
  const ordinati = [...conteggio.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t)
  for (const t of ordinati) scalda(t)
}
