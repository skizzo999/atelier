import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  LevelFormat,
  ShadingType,
  LineRuleType,
  Header,
  Footer,
  PageNumber,
  Tab,
  TabStopType,
  PageOrientation,
  type ParagraphChild,
  type ISectionOptions,
} from 'docx'

// Impostazioni di pagina da scrivere nel .docx (px schermo: i twip = px*15 a 96dpi).
export interface DocxLayout {
  pageWidthPx: number // larghezza foglio (orientamento già applicato)
  pageHeightPx: number
  marginsPx: { top: number; bottom: number; left: number; right: number }
  headerLeft: string
  headerRight: string // può contenere {page}
  footerLeft: string
  pageNum: 'none' | 'page' | 'page-total' | 'page-of-total'
  paper?: string // colore foglio (#rrggbb)
}

const PX_TO_TWIP = 15 // 96px = 1 pollice = 1440 twip → 1px = 15 twip

// Converte un testo con {page} in run docx (campo "numero pagina corrente").
function textWithPageField(s: string): ParagraphChild[] {
  const out: ParagraphChild[] = []
  s.split('{page}').forEach((part, i) => {
    if (i > 0) out.push(new TextRun({ children: [PageNumber.CURRENT] }))
    if (part) out.push(new TextRun(part))
  })
  return out
}

// Run del numero di pagina per il piè (corrente + totale come campi Word veri).
function footerNumRuns(mode: DocxLayout['pageNum']): ParagraphChild[] {
  if (mode === 'page') return [new TextRun({ children: [PageNumber.CURRENT] })]
  if (mode === 'page-total')
    return [new TextRun({ children: [PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES] })]
  if (mode === 'page-of-total')
    return [new TextRun({ children: ['Pagina ', PageNumber.CURRENT, ' di ', PageNumber.TOTAL_PAGES] })]
  return []
}

// Paragrafo header/footer: testo a sinistra + (tab) contenuto a destra.
function hfParagraph(leftText: string, right: ParagraphChild[], contentWidthTwip: number): Paragraph {
  const children: ParagraphChild[] = []
  if (leftText) children.push(new TextRun(leftText))
  if (right.length) {
    children.push(new TextRun({ children: [new Tab()] }))
    children.push(...right)
  }
  return new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: contentWidthTwip }],
    children,
  })
}

// Converte l'HTML (semplificato, stile Mammoth) dell'editor in un .docx vero.
// Copre i casi prodotti da Mammoth: titoli, paragrafi, grassetto/corsivo/sottolineato/
// barrato, apici/pedici, liste (anche annidate), citazioni, tabelle, immagini, link.

type RunChild = TextRun | ImageRun
interface Fmt {
  bold?: boolean
  italics?: boolean
  underline?: boolean
  strike?: boolean
  sup?: boolean
  sub?: boolean
  color?: string // hex senza # (es. "FF0000")
  font?: string
  size?: number // half-points (12pt = 24)
  highlight?: string // hex senza # per lo sfondo evidenziatore
}

// Converte un colore CSS (#rgb, #rrggbb, rgb()) in hex "RRGGBB" per docx.
function cssToHex(c: string): string | undefined {
  const s = c.trim()
  let m = /^#?([0-9a-f]{6})$/i.exec(s)
  if (m) return m[1].toUpperCase()
  m = /^#?([0-9a-f]{3})$/i.exec(s)
  if (m)
    return m[1]
      .split('')
      .map((x) => x + x)
      .join('')
      .toUpperCase()
  m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s)
  if (m) return [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase()
  return undefined
}
interface Ctx {
  numConfigs: { reference: string; levels: ReturnType<typeof decimalLevels> }[]
  counter: number
}

const HEADING: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  H1: HeadingLevel.HEADING_1,
  H2: HeadingLevel.HEADING_2,
  H3: HeadingLevel.HEADING_3,
  H4: HeadingLevel.HEADING_4,
  H5: HeadingLevel.HEADING_5,
  H6: HeadingLevel.HEADING_6,
}
const BLOCK = new Set(['P', 'DIV', 'UL', 'OL', 'LI', 'TABLE', 'TR', 'TD', 'TH', 'BLOCKQUOTE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'])
const IMG_TYPE: Record<string, 'png' | 'jpg' | 'gif' | 'bmp'> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
}

function decimalLevels() {
  return [0, 1, 2, 3, 4].map((l) => ({
    level: l,
    format: LevelFormat.DECIMAL,
    text: `%${l + 1}.`,
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 * (l + 1), hanging: 360 } } },
  }))
}

function dataUriToBytes(uri: string): { bytes: Uint8Array; type: 'png' | 'jpg' | 'gif' | 'bmp' } | null {
  const m = /^data:(image\/[a-z+]+);base64,(.*)$/i.exec(uri)
  if (!m) return null
  const type = IMG_TYPE[m[1].toLowerCase()]
  if (!type) return null
  try {
    const bin = atob(m[2])
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return { bytes, type }
  } catch {
    return null
  }
}

function imageRunFrom(el: HTMLElement): ImageRun | null {
  try {
    const d = dataUriToBytes(el.getAttribute('src') || '')
    if (!d) return null
    const img = el as HTMLImageElement
    const w = img.naturalWidth || img.width || 300
    const h = img.naturalHeight || img.height || 200
    const scale = Math.min(1, 480 / w)
    return new ImageRun({
      type: d.type,
      data: d.bytes,
      transformation: { width: Math.round(w * scale), height: Math.round(h * scale) },
    })
  } catch {
    return null
  }
}

// Raccoglie i run inline di un elemento (salta i blocchi annidati: es. liste).
function inlineRuns(node: Node, fmt: Fmt, out: RunChild[]) {
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.nodeValue ?? ''
      if (text)
        out.push(
          new TextRun({
            text,
            bold: fmt.bold,
            italics: fmt.italics,
            underline: fmt.underline ? {} : undefined,
            strike: fmt.strike,
            superScript: fmt.sup,
            subScript: fmt.sub,
            color: fmt.color,
            font: fmt.font,
            size: fmt.size,
            shading: fmt.highlight
              ? { type: ShadingType.SOLID, color: fmt.highlight, fill: fmt.highlight }
              : undefined,
          }),
        )
      return
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return
    const el = child as HTMLElement
    const tag = el.tagName
    if (tag === 'BR') {
      out.push(new TextRun({ break: 1 }))
      return
    }
    if (tag === 'IMG') {
      const r = imageRunFrom(el)
      if (r) out.push(r)
      return
    }
    if (BLOCK.has(tag)) return // i blocchi annidati li gestisce convertBlocks
    const next: Fmt = { ...fmt }
    if (tag === 'STRONG' || tag === 'B') next.bold = true
    else if (tag === 'EM' || tag === 'I') next.italics = true
    else if (tag === 'U') next.underline = true
    else if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') next.strike = true
    else if (tag === 'SUP') next.sup = true
    else if (tag === 'SUB') next.sub = true
    // Stili inline (colore, font, dimensione) e evidenziatore (<mark>/sfondo).
    const st = el.style
    if (st.color) next.color = cssToHex(st.color) ?? next.color
    if (st.fontFamily) next.font = st.fontFamily.replace(/['"]/g, '').split(',')[0].trim()
    if (st.fontSize) {
      const px = parseFloat(st.fontSize)
      if (px > 0) next.size = Math.round(px * 1.5) // px → mezzi-punti (px*0.75pt*2)
    }
    const bg = st.backgroundColor || (tag === 'MARK' ? el.getAttribute('data-color') || '' : '')
    if (bg) next.highlight = cssToHex(bg) ?? next.highlight
    inlineRuns(el, next, out)
  })
}

function hasBlockChildren(el: Element): boolean {
  return Array.from(el.children).some((c) => BLOCK.has(c.tagName) || c.tagName === 'DIV')
}

const ALIGN: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
}

function paragraphOf(el: HTMLElement, extra: Record<string, unknown> = {}): Paragraph {
  const runs: RunChild[] = []
  inlineRuns(el, {}, runs)
  // Allineamento e interlinea dal CSS inline del paragrafo.
  const align = ALIGN[el.style.textAlign]
  const lh = parseFloat(el.style.lineHeight || '')
  const spacing = lh > 0 ? { line: Math.round(lh * 240), lineRule: LineRuleType.AUTO } : undefined
  return new Paragraph({ children: runs, alignment: align, spacing, ...extra })
}

function listToParagraphs(listEl: Element, ordered: boolean, level: number, ctx: Ctx, out: Paragraph[]) {
  let ref = ''
  if (ordered) {
    ref = `ol-${ctx.counter++}`
    ctx.numConfigs.push({ reference: ref, levels: decimalLevels() })
  }
  for (const li of Array.from(listEl.children)) {
    if (li.tagName !== 'LI') continue
    out.push(
      paragraphOf(li as HTMLElement, ordered ? { numbering: { reference: ref, level } } : { bullet: { level } }),
    )
    for (const child of Array.from(li.children)) {
      if (child.tagName === 'UL') listToParagraphs(child, false, level + 1, ctx, out)
      else if (child.tagName === 'OL') listToParagraphs(child, true, level + 1, ctx, out)
    }
  }
}

function tableOf(tableEl: Element, ctx: Ctx): Table | null {
  const rows: TableRow[] = []
  for (const tr of Array.from(tableEl.querySelectorAll('tr'))) {
    const cells: TableCell[] = []
    for (const td of Array.from(tr.querySelectorAll('td,th'))) {
      // Le celle possono contenere <p> (TipTap) o testo nudo (Mammoth).
      const cellChildren: (Paragraph | Table)[] = []
      convertBlocks(td, ctx, cellChildren)
      if (!cellChildren.length) {
        const runs: RunChild[] = []
        inlineRuns(td, td.tagName === 'TH' ? { bold: true } : {}, runs)
        cellChildren.push(new Paragraph({ children: runs }))
      }
      cells.push(new TableCell({ children: cellChildren }))
    }
    if (cells.length) rows.push(new TableRow({ children: cells }))
  }
  if (!rows.length) return null
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })
}

function convertBlocks(container: Node, ctx: Ctx, out: (Paragraph | Table)[]) {
  container.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue ?? ''
      if (text.trim()) out.push(new Paragraph({ children: [new TextRun(text.trim())] }))
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as HTMLElement
    if (el.classList.contains('docx-page-break')) return // separatore di pagina: ignora
    const tag = el.tagName
    if (HEADING[tag]) {
      out.push(paragraphOf(el, { heading: HEADING[tag] }))
    } else if (tag === 'P') {
      out.push(paragraphOf(el))
    } else if (tag === 'UL') {
      listToParagraphs(el, false, 0, ctx, out as Paragraph[])
    } else if (tag === 'OL') {
      listToParagraphs(el, true, 0, ctx, out as Paragraph[])
    } else if (tag === 'BLOCKQUOTE') {
      out.push(paragraphOf(el, { indent: { left: 720 } }))
    } else if (tag === 'PRE') {
      out.push(new Paragraph({ children: [new TextRun({ text: el.textContent ?? '', font: 'Consolas' })] }))
    } else if (tag === 'TABLE') {
      const t = tableOf(el, ctx)
      if (t) out.push(t)
    } else if (tag === 'IMG') {
      const r = imageRunFrom(el)
      if (r) out.push(new Paragraph({ children: [r] }))
    } else if (tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE') {
      // Riga del contentEditable: se contiene blocchi scendi, altrimenti un paragrafo.
      if (hasBlockChildren(el)) convertBlocks(el, ctx, out)
      else out.push(paragraphOf(el))
    } else if (BLOCK.has(tag)) {
      out.push(paragraphOf(el))
    } else if (hasBlockChildren(el)) {
      convertBlocks(el, ctx, out)
    } else {
      out.push(paragraphOf(el)) // elemento inline a livello blocco → un paragrafo
    }
  })
}

// Converte il contenuto dell'editor in un Blob .docx. Se passi `layout`, scrive
// anche formato/orientamento/margini e intestazioni/piè (con numeri di pagina veri).
export async function htmlToDocxBlob(container: HTMLElement, layout?: DocxLayout): Promise<Blob> {
  const ctx: Ctx = { numConfigs: [], counter: 0 }
  const children: (Paragraph | Table)[] = []
  convertBlocks(container, ctx, children)
  if (!children.length) children.push(new Paragraph({ children: [] }))

  const extra: Record<string, unknown> = {}
  if (layout) {
    const landscape = layout.pageWidthPx > layout.pageHeightPx
    const contentW = Math.round((layout.pageWidthPx - layout.marginsPx.left - layout.marginsPx.right) * PX_TO_TWIP)
    extra.properties = {
      page: {
        size: {
          width: Math.round(layout.pageWidthPx * PX_TO_TWIP),
          height: Math.round(layout.pageHeightPx * PX_TO_TWIP),
          orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
        },
        margin: {
          top: Math.round(layout.marginsPx.top * PX_TO_TWIP),
          bottom: Math.round(layout.marginsPx.bottom * PX_TO_TWIP),
          left: Math.round(layout.marginsPx.left * PX_TO_TWIP),
          right: Math.round(layout.marginsPx.right * PX_TO_TWIP),
        },
      },
    }
    if (layout.headerLeft || layout.headerRight) {
      extra.headers = {
        default: new Header({ children: [hfParagraph(layout.headerLeft, textWithPageField(layout.headerRight), contentW)] }),
      }
    }
    const fnum = footerNumRuns(layout.pageNum)
    if (layout.footerLeft || fnum.length) {
      extra.footers = {
        default: new Footer({ children: [hfParagraph(layout.footerLeft, fnum, contentW)] }),
      }
    }
  }

  const paperHex = layout?.paper ? cssToHex(layout.paper) : undefined
  const doc = new Document({
    ...(ctx.numConfigs.length ? { numbering: { config: ctx.numConfigs } } : {}),
    ...(paperHex && paperHex !== 'FFFFFF' ? { background: { color: paperHex } } : {}),
    sections: [{ ...extra, children } as ISectionOptions],
  })
  return Packer.toBlob(doc)
}
