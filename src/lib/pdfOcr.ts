import { createWorker, type Worker } from 'tesseract.js'

// Una parola riconosciuta, con il box in pixel del canvas dato in pasto all'OCR.
export interface OcrWord {
  text: string
  x0: number
  y0: number
  x1: number
  y1: number
}

// Un solo worker Tesseract riusato per tutte le pagine/PDF (il modello lingua
// resta caricato: ricrearlo a ogni pagina sarebbe lentissimo). I job vengono
// accodati internamente, quindi va chiamato in sequenza.
let workerPromise: Promise<Worker> | null = null

function getWorker(): Promise<Worker> {
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
  const words: OcrWord[] = []
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        for (const w of line.words ?? []) {
          const t = w.text?.trim()
          if (t) words.push({ text: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 })
        }
      }
    }
  }
  return words
}
