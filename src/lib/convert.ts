import { readFile, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { writeFileBinaryAtomic, uniquePathWithExt } from './fileOps'
import { IMAGE_MIME } from './mime'

// Conversioni tra formati, tutte offline con le librerie già in casa.
// Ogni opzione crea un NUOVO file accanto all'originale (mai sovrascritture)
// e ritorna il path creato (il primo, se più d'uno). Le librerie pesanti
// (pdf-lib, pdf.js, mammoth, marked, docx) sono import dinamici: il convertitore
// non pesa sul bundle principale.

export interface ConvertOption {
  id: string
  label: string
  run: (path: string) => Promise<string>
}

const extOf = (p: string) => p.split('.').pop()?.toLowerCase() ?? ''
const nameOf = (p: string) => p.split('\\').pop() ?? p

// ---------- helpers ----------

// Rasterizza un file immagine su canvas (SVG e formati esotici via <img>).
async function canvasFromImageFile(path: string): Promise<HTMLCanvasElement> {
  const bytes = await readFile(path)
  const blob = new Blob([bytes], { type: IMAGE_MIME[extOf(path)] ?? 'application/octet-stream' })
  const c = document.createElement('canvas')
  try {
    const bmp = await createImageBitmap(blob)
    c.width = bmp.width
    c.height = bmp.height
    c.getContext('2d')!.drawImage(bmp, 0, 0)
    bmp.close()
    return c
  } catch {
    /* SVG (o formato che createImageBitmap non regge): via <img> */
  }
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    c.width = img.naturalWidth || 1024
    c.height = img.naturalHeight || 1024
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return c
  } finally {
    URL.revokeObjectURL(url)
  }
}

function canvasToBlob(c: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error(`Encoding ${type} fallito`))), type, quality),
  )
}

async function writeBlobAs(original: string, ext: string, blob: Blob): Promise<string> {
  const dest = await uniquePathWithExt(original, ext)
  await writeFileBinaryAtomic(dest, new Uint8Array(await blob.arrayBuffer()))
  return dest
}

// Pagina HTML autonoma e leggibile (per md→html e docx→html).
function htmlPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:48rem;margin:2rem auto;padding:0 1rem;line-height:1.65;color:#1f2937}
img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #d1d5db;padding:4px 10px}
pre{background:#f3f4f6;padding:12px;border-radius:8px;overflow-x:auto}code{font-family:ui-monospace,monospace}
blockquote{border-left:3px solid #d1d5db;margin-left:0;padding-left:1em;color:#6b7280}
</style>
</head>
<body>
${body}
</body>
</html>`
}

// Il markdown reso in HTML (sanificato: il file può venire da fuori).
async function mdBodyOf(path: string): Promise<string> {
  const [{ marked }, { default: DOMPurify }] = await Promise.all([import('marked'), import('dompurify')])
  const text = await readTextFile(path)
  return DOMPurify.sanitize(await marked.parse(text))
}

// ---------- immagini ----------

async function imageToPdf(path: string): Promise<string> {
  const c = await canvasFromImageFile(path)
  const png = new Uint8Array(await (await canvasToBlob(c, 'image/png')).arrayBuffer())
  const { PDFDocument } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  const img = await doc.embedPng(png)
  const wPt = (c.width * 72) / 96 // pagina alla dimensione dell'immagine
  const hPt = (c.height * 72) / 96
  doc.addPage([wPt, hPt]).drawImage(img, { x: 0, y: 0, width: wPt, height: hPt })
  const dest = await uniquePathWithExt(path, 'pdf')
  await writeFileBinaryAtomic(dest, await doc.save())
  return dest
}

async function imageToFormat(path: string, kind: 'png' | 'jpeg' | 'webp'): Promise<string> {
  let c = await canvasFromImageFile(path)
  if (kind === 'jpeg') {
    // JPEG non ha trasparenza: fondo bianco.
    const c2 = document.createElement('canvas')
    c2.width = c.width
    c2.height = c.height
    const ctx = c2.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, c2.width, c2.height)
    ctx.drawImage(c, 0, 0)
    c = c2
  }
  return writeBlobAs(path, kind === 'jpeg' ? 'jpg' : kind, await canvasToBlob(c, `image/${kind}`, 0.95))
}

// ---------- PDF ----------

async function pdfDoc(path: string) {
  const [pdfjs, { default: PdfWorker }] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = PdfWorker
  const bytes = await readFile(path)
  const task = pdfjs.getDocument({ data: bytes })
  const pdf = await task.promise
  // destroy() sta sul loading task (in v6 il proxy non lo espone più).
  return { pdf, done: () => task.destroy() }
}

// Una PNG per pagina (~192 DPI); i nomi si incrementano da soli sulle collisioni.
async function pdfToPngs(path: string): Promise<string> {
  const { pdf, done } = await pdfDoc(path)
  try {
    let first = ''
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n)
      const vp = page.getViewport({ scale: 2 })
      const c = document.createElement('canvas')
      c.width = Math.floor(vp.width)
      c.height = Math.floor(vp.height)
      await page.render({ canvasContext: c.getContext('2d')!, viewport: vp, canvas: c }).promise
      const dest = await writeBlobAs(path, 'png', await canvasToBlob(c, 'image/png'))
      if (!first) first = dest
    }
    return first
  } finally {
    await done()
  }
}

async function pdfToTxt(path: string): Promise<string> {
  const { pdf, done } = await pdfDoc(path)
  try {
    const pages: string[] = []
    for (let n = 1; n <= pdf.numPages; n++) {
      const tc = await (await pdf.getPage(n)).getTextContent()
      pages.push(tc.items.map((it) => ('str' in it ? it.str : '')).join(' '))
    }
    const dest = await uniquePathWithExt(path, 'txt')
    await writeTextFile(dest, pages.join('\n\n'))
    return dest
  } finally {
    await done()
  }
}

// ---------- DOCX ----------

async function docxBuf(path: string): Promise<ArrayBuffer> {
  const bytes = await readFile(path)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

async function docxToMd(path: string): Promise<string> {
  const mammoth = await import('mammoth')
  const r = await (
    mammoth as unknown as { convertToMarkdown: (i: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }> }
  ).convertToMarkdown({ arrayBuffer: await docxBuf(path) })
  const dest = await uniquePathWithExt(path, 'md')
  await writeTextFile(dest, r.value)
  return dest
}

async function docxToHtml(path: string): Promise<string> {
  const mammoth = await import('mammoth')
  const r = await mammoth.convertToHtml({ arrayBuffer: await docxBuf(path) })
  const dest = await uniquePathWithExt(path, 'html')
  await writeTextFile(dest, htmlPage(nameOf(path), r.value))
  return dest
}

async function docxToTxt(path: string): Promise<string> {
  const mammoth = await import('mammoth')
  const r = await mammoth.extractRawText({ arrayBuffer: await docxBuf(path) })
  const dest = await uniquePathWithExt(path, 'txt')
  await writeTextFile(dest, r.value)
  return dest
}

async function docxToPdf(path: string): Promise<string> {
  const bytes = await readFile(path)
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const [mammoth, { default: DOMPurify }, { htmlToPdfBytes }, { parseDocxSettings }, { FORMATS }] =
    await Promise.all([
      import('mammoth'),
      import('dompurify'),
      import('./htmlToPdf'),
      import('./docxSectPr'),
      import('../components/DocxEditor/DocSettings'),
    ])
  // La "sezione" Word (formato/orientamento/margini/colore foglio/intestazioni/
  // piè) diventa le opzioni pagina del PDF: il convertito somiglia al documento.
  const pxToPt = (px: number) => (px * 72) / 96
  const cmToPt = (cm: number) => (cm / 2.54) * 72
  let opts: import('./htmlToPdf').PdfPageOptions = {}
  try {
    const s = parseDocxSettings(bytes)
    if (s) {
      const f = FORMATS[s.format ?? 'A4'] ?? FORMATS.A4
      opts = {
        pageW: pxToPt(s.landscape ? f.h : f.w),
        pageH: pxToPt(s.landscape ? f.w : f.h),
        margin: s.margins
          ? {
              top: cmToPt(s.margins.top),
              right: cmToPt(s.margins.right),
              bottom: cmToPt(s.margins.bottom),
              left: cmToPt(s.margins.left),
            }
          : undefined,
        paperHex: s.paper,
        headerLeft: s.headerLeft,
        headerRight: s.headerRight,
        footerLeft: s.footerLeft,
        pageNum: s.pageNum,
      }
    }
  } catch {
    /* sezione non leggibile: default A4 */
  }
  const r = await mammoth.convertToHtml({ arrayBuffer })
  const container = document.createElement('div')
  container.innerHTML = DOMPurify.sanitize(r.value)
  const dest = await uniquePathWithExt(path, 'pdf')
  await writeFileBinaryAtomic(dest, await htmlToPdfBytes(container, opts))
  return dest
}

// PDF → Word: estrazione del TESTO (righe ricostruite dalle coordinate),
// una pagina Word per pagina PDF. Niente layout grafico; scansioni → errore.
async function pdfToDocx(path: string): Promise<string> {
  const { pdf, done } = await pdfDoc(path)
  try {
    const { Document, Packer, Paragraph, TextRun, PageBreak } = await import('docx')
    const paras: InstanceType<typeof Paragraph>[] = []
    let anyText = false
    for (let n = 1; n <= pdf.numPages; n++) {
      const tc = await (await pdf.getPage(n)).getTextContent()
      // Raggruppa gli item in righe per coordinata y (PDF: y cresce verso l'alto).
      const items = tc.items
        .map((it) => ('str' in it ? { text: it.str, x: it.transform[4], y: it.transform[5] } : null))
        .filter((v): v is { text: string; x: number; y: number } => !!v && v.text.trim() !== '')
        .sort((a, b) => b.y - a.y || a.x - b.x)
      const lines: string[] = []
      let curY = Infinity
      let cur: string[] = []
      for (const it of items) {
        if (Math.abs(curY - it.y) > 4 && cur.length) {
          lines.push(cur.join(' '))
          cur = []
        }
        curY = it.y
        cur.push(it.text)
      }
      if (cur.length) lines.push(cur.join(' '))
      if (lines.length) anyText = true
      if (n > 1) paras.push(new Paragraph({ children: [new PageBreak()] }))
      for (const line of lines) paras.push(new Paragraph({ children: [new TextRun(line)] }))
    }
    if (!anyText) throw new Error('PDF senza testo (scansione): niente da convertire')
    const docx = new Document({ sections: [{ children: paras }] })
    return writeBlobAs(path, 'docx', await Packer.toBlob(docx))
  } finally {
    await done()
  }
}

// ---------- Markdown ----------

async function mdToPdf(path: string): Promise<string> {
  const { htmlToPdfBytes } = await import('./htmlToPdf')
  const container = document.createElement('div')
  container.innerHTML = await mdBodyOf(path)
  const dest = await uniquePathWithExt(path, 'pdf')
  await writeFileBinaryAtomic(dest, await htmlToPdfBytes(container))
  return dest
}


async function mdToDocx(path: string): Promise<string> {
  const body = await mdBodyOf(path)
  const container = document.createElement('div')
  container.innerHTML = body
  const { htmlToDocxBlob } = await import('./htmlToDocx')
  return writeBlobAs(path, 'docx', await htmlToDocxBlob(container))
}

async function mdToHtml(path: string): Promise<string> {
  const dest = await uniquePathWithExt(path, 'html')
  await writeTextFile(dest, htmlPage(nameOf(path), await mdBodyOf(path)))
  return dest
}

async function mdToTxt(path: string): Promise<string> {
  const container = document.createElement('div')
  container.innerHTML = await mdBodyOf(path)
  const dest = await uniquePathWithExt(path, 'txt')
  await writeTextFile(dest, container.textContent ?? '')
  return dest
}

// ---------- testo semplice ----------

async function txtToMd(path: string): Promise<string> {
  const dest = await uniquePathWithExt(path, 'md')
  await writeTextFile(dest, await readTextFile(path))
  return dest
}

// ---------- menu per tipo di file ----------

const IMG_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'ico', 'avif'])

// Le conversioni possibili per questo file (vuoto = niente tasto Converti).
// md→PDF e docx→PDF usano il nostro layout (lib/htmlToPdf): tipografia
// semplice, non fedeltà da motore di stampa. pdf→docx = solo testo.
export function optionsFor(path: string): ConvertOption[] {
  const ext = extOf(path)
  if (IMG_EXTS.has(ext)) {
    const out: ConvertOption[] = [{ id: 'pdf', label: 'PDF (.pdf)', run: imageToPdf }]
    if (ext !== 'png') out.push({ id: 'png', label: 'PNG (.png)', run: (p) => imageToFormat(p, 'png') })
    if (ext !== 'jpg' && ext !== 'jpeg') out.push({ id: 'jpg', label: 'JPEG (.jpg)', run: (p) => imageToFormat(p, 'jpeg') })
    if (ext !== 'webp') out.push({ id: 'webp', label: 'WebP (.webp)', run: (p) => imageToFormat(p, 'webp') })
    return out
  }
  if (ext === 'pdf') {
    return [
      { id: 'docx', label: 'Word (.docx) — solo testo', run: pdfToDocx },
      { id: 'png', label: 'Immagini PNG (una per pagina)', run: pdfToPngs },
      { id: 'txt', label: 'Testo (.txt)', run: pdfToTxt },
    ]
  }
  if (ext === 'docx') {
    return [
      { id: 'pdf', label: 'PDF (.pdf) — layout semplice', run: docxToPdf },
      { id: 'md', label: 'Markdown (.md)', run: docxToMd },
      { id: 'html', label: 'Pagina HTML (.html)', run: docxToHtml },
      { id: 'txt', label: 'Testo (.txt)', run: docxToTxt },
    ]
  }
  if (ext === 'md' || ext === 'markdown') {
    return [
      { id: 'docx', label: 'Word (.docx)', run: mdToDocx },
      { id: 'pdf', label: 'PDF (.pdf) — layout semplice', run: mdToPdf },
      { id: 'html', label: 'Pagina HTML (.html)', run: mdToHtml },
      { id: 'txt', label: 'Testo (.txt)', run: mdToTxt },
    ]
  }
  if (ext === 'txt') {
    return [{ id: 'md', label: 'Markdown (.md)', run: txtToMd }]
  }
  return []
}
