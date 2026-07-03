import * as pdfjsLib from 'pdfjs-dist'
import type { PDFPageProxy } from 'pdfjs-dist'
import type { OcrWord } from './pdfOcr'

// Un rettangolo in coordinate a scala 1 (punti PDF), y verso il basso.
export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

// Un pezzo di testo con il suo box (parola OCR oppure item di pdf.js).
export interface Token extends Box {
  text: string
}

// Estrae i token di una pagina: dalle parole OCR se è una scansione,
// altrimenti dal contenuto testo di pdf.js (box calcolati a scala 1).
export async function tokensForPage(page: PDFPageProxy, ocrWords?: OcrWord[]): Promise<Token[]> {
  if (ocrWords && ocrWords.length) {
    return ocrWords.map((w) => ({ text: w.text, x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1 }))
  }
  const vp = page.getViewport({ scale: 1 })
  const tc = await page.getTextContent()
  const tokens: Token[] = []
  for (const item of tc.items) {
    if (!('str' in item) || !item.str) continue
    const tx = pdfjsLib.Util.transform(vp.transform, item.transform)
    const h = Math.hypot(tx[2], tx[3]) // altezza font in px viewport (scala 1)
    const x0 = tx[4]
    const y1 = tx[5]
    // Un item può essere una riga intera (anche 100+ caratteri): spezzato in
    // PAROLE con posizioni interpolate sulla larghezza, così la ricerca
    // evidenzia il punto preciso e non l'intero blocco di testo.
    const str = item.str
    const len = str.length
    const re = /\S+/g
    let m: RegExpExecArray | null
    while ((m = re.exec(str))) {
      const sFrac = m.index / len
      const eFrac = (m.index + m[0].length) / len
      tokens.push({
        text: m[0],
        x0: x0 + item.width * sFrac,
        y0: y1 - h,
        x1: x0 + item.width * eFrac,
        y1,
      })
    }
  }
  return tokens
}

// Cerca la query (già minuscola) nei token: restituisce, per ogni occorrenza,
// i box dei token che la contengono (uno o più, anche su righe diverse).
export function searchTokens(tokens: Token[], queryLower: string): Box[][] {
  if (!queryLower) return []
  let pageStr = ''
  const ranges: { s: number; e: number; box: Box }[] = []
  for (const t of tokens) {
    const text = t.text.replace(/\s+/g, ' ').trim()
    if (!text) continue
    if (pageStr) pageStr += ' '
    const s = pageStr.length
    pageStr += text
    ranges.push({ s, e: pageStr.length, box: t })
  }
  const hay = pageStr.toLowerCase()
  const hits: Box[][] = []
  let from = 0
  for (;;) {
    const idx = hay.indexOf(queryLower, from)
    if (idx < 0) break
    const end = idx + queryLower.length
    const boxes = ranges.filter((r) => r.s < end && r.e > idx).map((r) => r.box)
    if (boxes.length) hits.push(boxes)
    from = idx + queryLower.length
  }
  return hits
}
