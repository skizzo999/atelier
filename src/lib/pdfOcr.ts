import { createWorker, type Worker } from 'tesseract.js'

// Una parola riconosciuta, con il box in pixel del canvas dato in pasto all'OCR.
// `eol` = ultima parola della riga (per inserire un a-capo quando si copia).
export interface OcrWord {
  text: string
  x0: number
  y0: number
  x1: number
  y1: number
  eol?: boolean
}

// Sotto questa confidenza la parola è quasi sempre spazzatura (artefatti ai
// margini della scansione): la scartiamo.
const MIN_CONFIDENCE = 40

// Un solo worker Tesseract riusato per tutte le pagine/PDF (il modello lingua
// resta caricato: ricrearlo a ogni pagina sarebbe lentissimo). I job vengono
// accodati internamente, quindi va chiamato in sequenza.
let workerPromise: Promise<Worker> | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null

// Il worker trattiene decine di MB (modello lingua): dopo un po' di inattività
// lo terminiamo; alla prossima richiesta si ricrea (modello già in cache disco).
const IDLE_MS = 90_000

function scheduleIdleTerminate() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    const wp = workerPromise
    workerPromise = null
    idleTimer = null
    wp?.then((w) => w.terminate()).catch(() => {})
  }, IDLE_MS)
}

function getWorker(): Promise<Worker> {
  // Sospendi il timer di inattività finché c'è lavoro in corso.
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  if (!workerPromise) {
    // ita+eng come l'OCR immagini. Al primo uso scarica il modello (poi in cache).
    workerPromise = createWorker('ita+eng')
  }
  return workerPromise
}

// Riconosce il testo in un canvas e restituisce le parole con i loro box (px canvas).
export async function ocrCanvasWords(canvas: HTMLCanvasElement): Promise<OcrWord[]> {
  const worker = await getWorker()
  const { data } = await worker.recognize(canvas, {}, { blocks: true })
  scheduleIdleTerminate()
  const words: OcrWord[] = []
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        // Tieni solo le parole con testo e confidenza decente, riga per riga.
        const kept = (line.words ?? []).filter((w) => w.text?.trim() && w.confidence >= MIN_CONFIDENCE)
        kept.forEach((w, i) => {
          words.push({
            text: w.text,
            x0: w.bbox.x0,
            y0: w.bbox.y0,
            x1: w.bbox.x1,
            y1: w.bbox.y1,
            eol: i === kept.length - 1, // ultima parola della riga → a-capo
          })
        })
      }
    }
  }
  return words
}
