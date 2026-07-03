import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib'

// HTML (semplificato, stile Mammoth/marked) → PDF con layout "documento":
// titoli/paragrafi/liste/citazioni/codice/immagini, TABELLE a griglia con bordi,
// a-capo e paginazione con le metriche vere dei font standard (Helvetica).
// Opzioni pagina: formato/orientamento, margini, colore foglio, intestazioni e
// piè con numero di pagina (usate da docx→pdf per rispettare la sezione Word).
// NON è un motore di stampa: fedeltà tipografica semplice; caratteri fuori da
// Latin-1 (emoji…) rimossi.

export interface PdfPageOptions {
  pageW?: number // punti
  pageH?: number
  margin?: { top: number; right: number; bottom: number; left: number } // punti
  paperHex?: string // colore foglio "#rrggbb"
  headerLeft?: string // può contenere {page}
  headerRight?: string
  footerLeft?: string
  pageNum?: 'none' | 'page' | 'page-total' | 'page-of-total'
}

interface Run {
  text: string
  bold: boolean
  italic: boolean
  code: boolean
}

interface Block {
  runs: Run[]
  size: number
  bold?: boolean
  indent: number
  bullet?: string
  gray?: boolean
  spaceAfter: number
  image?: Uint8Array
  imageType?: 'png' | 'jpg'
  table?: { rows: string[][]; headRows: number }
}

// WinAnsi: tieni Latin-1 + punteggiatura tipografica comune, il resto via.
function sanitize(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/–/g, '-')
    .replace(/—/g, '--')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7E\xA0-\xFF€]/g, '')
}

function hexToRgb(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

const HEAD_SIZE: Record<string, number> = { H1: 22, H2: 18, H3: 15, H4: 13, H5: 12, H6: 11 }

function dataUriBytes(src: string): { bytes: Uint8Array; type: 'png' | 'jpg' } | null {
  const m = /^data:image\/(png|jpe?g);base64,(.*)$/i.exec(src)
  if (!m) return null
  try {
    const bin = atob(m[2])
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return { bytes, type: m[1].toLowerCase() === 'png' ? 'png' : 'jpg' }
  } catch {
    return null
  }
}

function inlineRuns(node: Node, cur: Run, out: Run[]) {
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = sanitize(child.nodeValue ?? '')
      if (text) out.push({ ...cur, text })
      return
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return
    const el = child as HTMLElement
    const tag = el.tagName
    if (tag === 'BR') {
      out.push({ ...cur, text: '\n' })
      return
    }
    const next = { ...cur }
    if (tag === 'STRONG' || tag === 'B') next.bold = true
    else if (tag === 'EM' || tag === 'I') next.italic = true
    else if (tag === 'CODE') next.code = true
    inlineRuns(el, next, out)
  })
}

function pushTextBlock(el: HTMLElement, out: Block[], opts: Partial<Block> = {}) {
  const runs: Run[] = []
  inlineRuns(el, { text: '', bold: false, italic: false, code: false }, runs)
  if (!runs.length && !opts.bullet) return
  out.push({ runs, size: 11, indent: 0, spaceAfter: 7, ...opts })
}

function collectBlocks(container: Node, out: Block[], depth = 0) {
  container.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = sanitize(node.nodeValue ?? '').trim()
      if (t) out.push({ runs: [{ text: t, bold: false, italic: false, code: false }], size: 11, indent: 0, spaceAfter: 7 })
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as HTMLElement
    const tag = el.tagName

    if (HEAD_SIZE[tag]) {
      pushTextBlock(el, out, { size: HEAD_SIZE[tag], bold: true, spaceAfter: 10 })
    } else if (tag === 'P') {
      const img = el.querySelector('img')
      if (img && !el.textContent?.trim()) {
        const d = dataUriBytes(img.getAttribute('src') || '')
        if (d) out.push({ runs: [], size: 11, indent: 0, spaceAfter: 10, image: d.bytes, imageType: d.type })
        return
      }
      pushTextBlock(el, out)
    } else if (tag === 'UL' || tag === 'OL') {
      let i = 1
      for (const li of Array.from(el.children)) {
        if (li.tagName !== 'LI') continue
        const clone = li.cloneNode(true) as HTMLElement
        clone.querySelectorAll('ul,ol').forEach((s) => s.remove())
        pushTextBlock(clone, out, {
          indent: 16 + depth * 16,
          bullet: tag === 'OL' ? `${i}.` : '•',
          spaceAfter: 4,
        })
        i++
        for (const sub of Array.from(li.children)) {
          if (sub.tagName === 'UL' || sub.tagName === 'OL') collectBlocks(li, out, depth + 1)
        }
      }
    } else if (tag === 'BLOCKQUOTE') {
      const inner: Block[] = []
      collectBlocks(el, inner, depth)
      for (const b of inner) out.push({ ...b, indent: b.indent + 16, gray: true })
    } else if (tag === 'PRE') {
      const text = sanitize(el.textContent ?? '')
      for (const line of text.split('\n')) {
        out.push({
          runs: [{ text: line || ' ', bold: false, italic: false, code: true }],
          size: 9.5,
          indent: 8,
          spaceAfter: 1.5,
        })
      }
      out[out.length - 1].spaceAfter = 8
    } else if (tag === 'TABLE') {
      // Griglia vera: celle con testo (a-capo dentro la cella), bordi, testata.
      const rows: string[][] = []
      let headRows = 0
      for (const tr of Array.from(el.querySelectorAll('tr'))) {
        const cells = Array.from(tr.querySelectorAll('td,th')).map((c) => sanitize(c.textContent ?? '').trim())
        if (!cells.length) continue
        if (tr.querySelector('th') && rows.length === headRows) headRows++
        rows.push(cells)
      }
      if (rows.length) out.push({ runs: [], size: 9.5, indent: 0, spaceAfter: 10, table: { rows, headRows } })
    } else if (tag === 'IMG') {
      const d = dataUriBytes(el.getAttribute('src') || '')
      if (d) out.push({ runs: [], size: 11, indent: 0, spaceAfter: 10, image: d.bytes, imageType: d.type })
    } else if (tag === 'HR') {
      out.push({ runs: [], size: 11, indent: 0, spaceAfter: 12 })
    } else {
      collectBlocks(el, out, depth)
    }
  })
}

// Spezza un testo in righe che stanno in maxW (misura col font vero).
function wrapText(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (let word of words) {
    try {
      font.widthOfTextAtSize(word, size)
    } catch {
      word = word.replace(/[^\x20-\x7E]/g, '')
      if (!word) continue
    }
    const probe = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(probe, size) > maxW && line) {
      lines.push(line)
      line = word
    } else {
      line = probe
    }
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

export async function htmlToPdfBytes(container: HTMLElement, options: PdfPageOptions = {}): Promise<Uint8Array> {
  const pageW = options.pageW ?? 595.28 // A4
  const pageH = options.pageH ?? 841.89
  const margin = options.margin ?? { top: 57, right: 57, bottom: 57, left: 57 }
  const contentW = pageW - margin.left - margin.right
  const paper = options.paperHex ? hexToRgb(options.paperHex) : null

  const blocks: Block[] = []
  collectBlocks(container, blocks)

  const doc = await PDFDocument.create()
  const fonts = {
    normal: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
    code: await doc.embedFont(StandardFonts.Courier),
  }
  const fontOf = (r: Run, blockBold?: boolean): PDFFont => {
    if (r.code) return fonts.code
    const b = r.bold || blockBold
    return b && r.italic ? fonts.boldItalic : b ? fonts.bold : r.italic ? fonts.italic : fonts.normal
  }

  const addPage = (): PDFPage => {
    const p = doc.addPage([pageW, pageH])
    // Colore foglio: rettangolo di sfondo disegnato per primo.
    if (paper) p.drawRectangle({ x: 0, y: 0, width: pageW, height: pageH, color: paper })
    return p
  }
  let page = addPage()
  let y = pageH - margin.top
  const newPageIfNeeded = (need: number) => {
    if (y - need < margin.bottom) {
      page = addPage()
      y = pageH - margin.top
    }
  }
  const ink = rgb(0.12, 0.14, 0.16)
  const grayInk = rgb(0.42, 0.45, 0.5)
  const border = rgb(0.72, 0.74, 0.78)

  for (const b of blocks) {
    if (b.image) {
      try {
        const img = b.imageType === 'png' ? await doc.embedPng(b.image) : await doc.embedJpg(b.image)
        const wPt = Math.min(contentW, (img.width * 72) / 96)
        const hPt = (img.height / img.width) * wPt
        newPageIfNeeded(hPt)
        page.drawImage(img, { x: margin.left, y: y - hPt, width: wPt, height: hPt })
        y -= hPt + b.spaceAfter
      } catch {
        /* immagine non embeddabile: salta */
      }
      continue
    }

    if (b.table) {
      const { rows, headRows } = b.table
      const cols = Math.max(...rows.map((r) => r.length), 1)
      const colW = (contentW - b.indent) / cols
      const pad = 4
      const fSize = b.size
      const lineH = fSize * 1.32
      rows.forEach((row, ri) => {
        const head = ri < headRows
        const font = head ? fonts.bold : fonts.normal
        const cellLines = Array.from({ length: cols }, (_, c) => wrapText(row[c] ?? '', font, fSize, colW - pad * 2))
        const rowH = Math.max(...cellLines.map((l) => l.length)) * lineH + pad * 2
        newPageIfNeeded(rowH)
        for (let c = 0; c < cols; c++) {
          const x = margin.left + b.indent + c * colW
          page.drawRectangle({
            x,
            y: y - rowH,
            width: colW,
            height: rowH,
            borderColor: border,
            borderWidth: 0.7,
            color: head ? rgb(0.93, 0.94, 0.96) : paper ?? undefined,
          })
          cellLines[c].forEach((ln, li) => {
            page.drawText(ln, { x: x + pad, y: y - pad - fSize - li * lineH, size: fSize, font, color: ink })
          })
        }
        y -= rowH
      })
      y -= b.spaceAfter
      continue
    }

    const lineHeight = b.size * 1.45
    const maxW = contentW - b.indent
    const color = b.gray ? grayInk : ink

    type Seg = { text: string; font: PDFFont }
    const lines: Seg[][] = []
    let line: Seg[] = []
    let lineW = 0
    const flush = () => {
      lines.push(line)
      line = []
      lineW = 0
    }
    for (const r of b.runs) {
      const font = fontOf(r, b.bold)
      for (let word of r.text.split(/(\n)|\s+/g).filter((w) => w !== undefined && w !== '')) {
        if (word === '\n') {
          flush()
          continue
        }
        let wW: number
        try {
          wW = font.widthOfTextAtSize(word, b.size)
        } catch {
          word = word.replace(/[^\x20-\x7E]/g, '')
          if (!word) continue
          wW = font.widthOfTextAtSize(word, b.size)
        }
        const spaceW = line.length ? font.widthOfTextAtSize(' ', b.size) : 0
        if (lineW + spaceW + wW > maxW && line.length) flush()
        line.push({ text: (line.length ? ' ' : '') + word, font })
        lineW += spaceW + wW
      }
    }
    if (line.length) flush()
    if (!lines.length) {
      y -= b.spaceAfter
      continue
    }

    for (const ln of lines) {
      newPageIfNeeded(lineHeight)
      let x = margin.left + b.indent
      if (b.bullet && ln === lines[0]) {
        page.drawText(b.bullet, { x: margin.left + b.indent - 14, y: y - b.size, size: b.size, font: fonts.normal, color })
      }
      for (const seg of ln) {
        page.drawText(seg.text, { x, y: y - b.size, size: b.size, font: seg.font, color })
        x += seg.font.widthOfTextAtSize(seg.text, b.size)
      }
      y -= lineHeight
    }
    y -= b.spaceAfter
  }

  // Intestazioni e piè: passata finale (serve il totale pagine).
  const pages = doc.getPages()
  const total = pages.length
  const hfSize = 9
  const numText = (mode: PdfPageOptions['pageNum'], n: number) =>
    mode === 'page' ? `${n}` : mode === 'page-total' ? `${n} / ${total}` : mode === 'page-of-total' ? `Pagina ${n} di ${total}` : ''
  pages.forEach((p, i) => {
    const n = i + 1
    const sub = (s?: string) => sanitize((s ?? '').replace(/\{page\}/g, String(n)))
    const hl = sub(options.headerLeft)
    const hr = sub(options.headerRight)
    const fl = sub(options.footerLeft)
    const fr = numText(options.pageNum ?? 'none', n)
    const hy = pageH - margin.top / 2 - hfSize / 2
    const fy = margin.bottom / 2 - hfSize / 2
    if (hl) p.drawText(hl, { x: margin.left, y: hy, size: hfSize, font: fonts.normal, color: grayInk })
    if (hr) p.drawText(hr, { x: pageW - margin.right - fonts.normal.widthOfTextAtSize(hr, hfSize), y: hy, size: hfSize, font: fonts.normal, color: grayInk })
    if (fl) p.drawText(fl, { x: margin.left, y: fy, size: hfSize, font: fonts.normal, color: grayInk })
    if (fr) p.drawText(fr, { x: pageW - margin.right - fonts.normal.widthOfTextAtSize(fr, hfSize), y: fy, size: hfSize, font: fonts.normal, color: grayInk })
  })

  return doc.save()
}
