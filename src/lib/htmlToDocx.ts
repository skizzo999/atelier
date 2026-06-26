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
} from 'docx'

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
    inlineRuns(el, next, out)
  })
}

function hasBlockChildren(el: Element): boolean {
  return Array.from(el.children).some((c) => BLOCK.has(c.tagName) || c.tagName === 'DIV')
}

function paragraphOf(el: HTMLElement, extra: Record<string, unknown> = {}): Paragraph {
  const runs: RunChild[] = []
  inlineRuns(el, {}, runs)
  return new Paragraph({ children: runs, ...extra })
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

// Converte il contenuto live dell'editor (per avere le dimensioni immagini) in un Blob .docx.
export async function htmlToDocxBlob(container: HTMLElement): Promise<Blob> {
  const ctx: Ctx = { numConfigs: [], counter: 0 }
  const children: (Paragraph | Table)[] = []
  convertBlocks(container, ctx, children)
  if (!children.length) children.push(new Paragraph({ children: [] }))
  const doc = new Document({
    ...(ctx.numConfigs.length ? { numbering: { config: ctx.numConfigs } } : {}),
    sections: [{ children }],
  })
  return Packer.toBlob(doc)
}
