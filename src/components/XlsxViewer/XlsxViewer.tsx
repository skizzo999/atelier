import { useEffect, useRef, useState } from 'react'
import { readFile, readTextFile, exists } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import type { Workbook, Worksheet, Cell, CellValue } from 'exceljs'
import { revealInExplorer } from '../../lib/imageActions'
import { writeFileBinaryAtomic } from '../../lib/fileOps'
import { useAppStore } from '../../store/appStore'
import { ConvertButton } from '../Convert/ConvertButton'
import { parseCsv } from '../../lib/csv'

// Modifiche non salvate per file (chiave "foglio:riga:col" → valore): vivono a
// livello modulo così sopravvivono al cambio file, come gli altri buffer.
const xlsxEditBuffers = new Map<string, Map<string, CellValue>>()

// Interpreta l'input dell'utente: numero (virgola italiana), booleano,
// formula (=...; senza motore di ricalcolo il risultato arriverà da Excel),
// vuoto → null, altrimenti testo.
function parseInput(raw: string): CellValue {
  const s = raw.trim()
  if (s === '') return null
  if (s.startsWith('=')) return { formula: s.slice(1) } as CellValue
  const low = s.toLowerCase()
  if (low === 'true' || low === 'vero') return true
  if (low === 'false' || low === 'falso') return false
  if (/^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(s) || /^-?\d+([.,]\d+)?$/.test(s)) {
    const n = Number(s.replace(/\./g, '').replace(',', '.'))
    if (!Number.isNaN(n)) return n
  }
  return s
}

// Valore "grezzo" da mostrare nell'input quando si edita una cella.
function rawOf(cell: Cell): string {
  const v = cell.value
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return String(v).replace('.', ',')
  if (typeof v === 'boolean') return v ? 'VERO' : 'FALSO'
  if (v instanceof Date) return v.toLocaleDateString('it-IT')
  if (typeof v === 'object') {
    if ('formula' in v) return `=${(v as { formula: string }).formula}`
    if ('richText' in v) return v.richText.map((r) => r.text).join('')
    if ('text' in v) return String((v as { text: unknown }).text)
  }
  return String(v)
}

// Viewer Excel/CSV (Fase 1 del piano Office, sola lettura): griglia virtualizzata
// nostra (solo le righe visibili), tab dei fogli, celle unite, larghezze colonne,
// stili base (grassetto/corsivo/colori/sfondo), date e numeri formattati, formule
// mostrate col VALORE calcolato salvato nel file (niente ricalcolo, per scelta).
// Editing = Fase 2. ExcelJS è caricata pigra (chunk del viewer).

const ROW_H = 24
const ROW_HDR_W = 46
const MAX_ROWS = 10000 // oltre: troncato con avviso (v1)
const MAX_COLS = 256

interface CellData {
  t: string // testo già formattato
  num?: boolean // numerico → allinea a destra
  b?: boolean
  i?: boolean
  fs?: number // dimensione font in px (solo se diversa dal default)
  color?: string
  bg?: string
  align?: string
  cs?: number // colSpan (celle unite in orizzontale)
  skip?: boolean // coperta da una cella unita
  wrap?: boolean // testo a capo (alignment.wrapText)
  chk?: boolean // cella booleana → checkbox cliccabile
  bt?: string // bordi espliciti della cella (css)
  br?: string
  bb?: string
  bl?: string
}

interface SheetData {
  name: string
  rows: CellData[][]
  widths: number[] // px per colonna
  heights: number[] // px per riga (altezze vere dal file)
  offsets: number[] // somme prefisse delle altezze (offsets[i] = inizio riga i)
  grid: boolean // gridlines del foglio (i template Google spesso le nascondono)
  truncated: boolean
}

const DEFAULT_ROW_PX = 21 // default di Sheets/Excel (~15.75pt)

function buildOffsets(heights: number[]): number[] {
  const out = new Array(heights.length + 1)
  out[0] = 0
  for (let i = 0; i < heights.length; i++) out[i + 1] = out[i] + heights[i]
  return out
}

// Indice della riga che contiene la coordinata y (ricerca binaria sui prefissi).
function rowAt(offsets: number[], y: number): number {
  let lo = 0
  let hi = Math.max(0, offsets.length - 2)
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (offsets[mid + 1] <= y) lo = mid + 1
    else hi = mid
  }
  return lo
}

// ---- Colori a tema (Google/Excel: fgColor {theme: n, tint}) ----

const THEME_ORDER = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6']

// Estrae la palette dal theme1.xml del workbook (srgbClr val / sysClr lastClr).
export function parseThemePalette(themeXml: string | undefined): string[] {
  if (!themeXml) return []
  return THEME_ORDER.map((name) => {
    const m = new RegExp(`<a:${name}>[\\s\\S]{0,200}?(?:val|lastClr)="([0-9A-Fa-f]{6})"`).exec(themeXml)
    return m ? `#${m[1].toLowerCase()}` : ''
  })
}

function applyTint(hex: string, tint: number): string {
  const n = parseInt(hex.slice(1), 16)
  const ch = (c: number) => {
    const v = tint < 0 ? c * (1 + tint) : c * (1 - tint) + 255 * tint
    return Math.max(0, Math.min(255, Math.round(v)))
  }
  const r = ch((n >> 16) & 255)
  const g = ch((n >> 8) & 255)
  const b = ch(n & 255)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

// Colore ExcelJS → CSS: argb esplicito oppure indice di tema + tint.
function resolveColor(c: { argb?: string; theme?: number } | undefined, palette: string[]): string | undefined {
  if (!c) return undefined
  const direct = argbToCss(c.argb)
  if (direct) return direct
  if (c.theme !== undefined && palette[c.theme]) {
    const tint = (c as { tint?: number }).tint
    return tint ? applyTint(palette[c.theme], tint) : palette[c.theme]
  }
  return undefined
}

const btn = 'px-2 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-zinc-300 disabled:opacity-40'

// Misura testo col font reale: se la parola più lunga di una cella (a capo,
// font grande) non sta nella colonna, il font si riduce quanto basta — i file
// nascono con font che noi non abbiamo (es. "Hind") e i fallback sono più larghi.
let measureCtxCache: CanvasRenderingContext2D | null | undefined
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (measureCtxCache === undefined) {
    measureCtxCache = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null
  }
  return measureCtxCache
}

function fitFontSize(cell: CellData, colW: number): number | undefined {
  const measureCtx = getMeasureCtx()
  if (!cell.fs || !cell.wrap || !measureCtx) return cell.fs
  const avail = colW - 14 // padding orizzontale
  if (avail <= 0) return cell.fs
  measureCtx.font = `${cell.b ? 700 : 400} ${cell.fs}px "Segoe UI", system-ui, sans-serif`
  let maxW = 0
  for (const word of cell.t.split(/\s+/)) {
    const w = measureCtx.measureText(word).width
    if (w > maxW) maxW = w
  }
  if (maxW <= avail) return cell.fs
  return Math.max(Math.floor((cell.fs * avail) / maxW), Math.floor(cell.fs * 0.55))
}

// "A", "B", … "AA" della colonna 1-based.
function colLetter(n: number): string {
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

// "AB" → indice 1-based.
function colIndex(letters: string): number {
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}

function argbToCss(argb?: string): string | undefined {
  if (!argb || argb.length !== 8) return undefined
  if (argb.startsWith('00')) return undefined // trasparente
  return `#${argb.slice(2)}`
}

function fmtNum(n: number, fmt?: string): string {
  if (fmt && fmt.includes('%')) {
    return (n * 100).toLocaleString('it-IT', { maximumFractionDigits: 2 }) + '%'
  }
  const m = fmt ? /0\.(0+)/.exec(fmt) : null
  const dec = m ? m[1].length : undefined
  const base = n.toLocaleString('it-IT', {
    minimumFractionDigits: dec ?? 0,
    maximumFractionDigits: dec ?? 6,
  })
  if (fmt && fmt.includes('€')) return `${base} €`
  if (fmt && fmt.includes('$')) return `$ ${base}`
  return base
}

function fmtDate(d: Date, fmt?: string): string {
  const hasTime = fmt ? /h/i.test(fmt) : false
  const hasDate = fmt ? /[dmy]/i.test(fmt.replace(/\[.*?\]/g, '')) : true
  // Celle SOLO orario (es. 8:00): Excel le salva come date del 1899 → mostra l'ora.
  if (hasTime && (!hasDate || d.getFullYear() <= 1900)) {
    return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  }
  return hasTime ? d.toLocaleString('it-IT') : d.toLocaleDateString('it-IT')
}

// ---- Mini-motore formule (subset, Fase 16 in embrione): aritmetica con
// riferimenti (D6+D5*2), SUM/SOMMA, AVERAGE/MEDIA, COUNT/CONTA, MIN, MAX su
// range. Niente eval/new Function (bloccati dalla CSP): parser nostro.

function numOf(v: CellValue): number | undefined {
  if (typeof v === 'number') return v
  if (v && typeof v === 'object' && 'result' in v && typeof (v as { result?: unknown }).result === 'number') {
    return (v as { result: number }).result
  }
  if (v === null || v === undefined || v === '') return 0 // vuoto = 0, come Excel
  return undefined
}

function rangeNums(ws: Worksheet, a: string, b: string): number[] | undefined {
  const m1 = /^([A-Z]+)(\d+)$/.exec(a)
  const m2 = /^([A-Z]+)(\d+)$/.exec(b)
  if (!m1 || !m2) return undefined
  const c1 = colIndex(m1[1])
  const r1 = Number(m1[2])
  const c2 = colIndex(m2[1])
  const r2 = Number(m2[2])
  if ((r2 - r1 + 1) * (c2 - c1 + 1) > 10_000) return undefined
  const out: number[] = []
  for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++)
    for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
      const v = ws.getRow(r).getCell(c).value
      if (typeof v === 'number') out.push(v)
      else {
        const n = numOf(v)
        if (n !== undefined && v !== null && v !== undefined && v !== '') out.push(n)
      }
    }
  return out
}

// Espressione aritmetica (discesa ricorsiva): + - * / ( ) e numeri col punto.
function evalArith(s: string): number | undefined {
  let i = 0
  const peek = () => s[i]
  function expr(): number {
    let v = term()
    while (peek() === '+' || peek() === '-') {
      const op = s[i++]
      const t = term()
      v = op === '+' ? v + t : v - t
    }
    return v
  }
  function term(): number {
    let v = factor()
    while (peek() === '*' || peek() === '/') {
      const op = s[i++]
      const f = factor()
      v = op === '*' ? v * f : v / f
    }
    return v
  }
  function factor(): number {
    if (peek() === '-') {
      i++
      return -factor()
    }
    if (peek() === '(') {
      i++
      const v = expr()
      if (peek() !== ')') throw new Error('parentesi')
      i++
      return v
    }
    const m = /^\d+(\.\d+)?/.exec(s.slice(i))
    if (!m) throw new Error('numero atteso')
    i += m[0].length
    return Number(m[0])
  }
  try {
    const v = expr()
    return i === s.length && Number.isFinite(v) ? v : undefined
  } catch {
    return undefined
  }
}

export function evalFormula(ws: Worksheet, formula: string): number | undefined {
  let s = formula.toUpperCase().replace(/\s+/g, '').replace(/;/g, ',')
  // Funzioni su range → numero.
  s = s.replace(/(SUM|SOMMA|AVERAGE|MEDIA|COUNT|CONTA(?:\.NUMERI)?|MIN|MAX)\(([A-Z]+\d+):([A-Z]+\d+)\)/g, (_m, name, a, b) => {
    const vals = rangeNums(ws, a, b)
    if (!vals) return 'ERR'
    if (name === 'SUM' || name === 'SOMMA') return String(vals.reduce((x, y) => x + y, 0))
    if (name === 'AVERAGE' || name === 'MEDIA') return vals.length ? String(vals.reduce((x, y) => x + y, 0) / vals.length) : 'ERR'
    if (name.startsWith('COUNT') || name.startsWith('CONTA')) return String(vals.length)
    if (name === 'MIN') return vals.length ? String(Math.min(...vals)) : 'ERR'
    return vals.length ? String(Math.max(...vals)) : 'ERR'
  })
  if (s.includes('ERR')) return undefined
  // Riferimenti singoli → valore numerico.
  let bad = false
  s = s.replace(/[A-Z]+\d+/g, (ref) => {
    const m = /^([A-Z]+)(\d+)$/.exec(ref)!
    const n = numOf(ws.getRow(Number(m[2])).getCell(colIndex(m[1])).value)
    if (n === undefined) {
      bad = true
      return '0'
    }
    return String(n)
  })
  if (bad || /[A-Z]/.test(s)) return undefined // funzioni/riferimenti non supportati
  return evalArith(s)
}

// Valore cella → testo mostrato (formule = risultato salvato nel file).
function cellText(v: CellValue, numFmt?: string): { text: string; num: boolean } {
  if (v === null || v === undefined) return { text: '', num: false }
  if (v instanceof Date) return { text: fmtDate(v, numFmt), num: true }
  if (typeof v === 'number') return { text: fmtNum(v, numFmt), num: true }
  if (typeof v === 'boolean') return { text: v ? '☑' : '☐', num: false } // checkbox come Excel/Sheets
  if (typeof v === 'string') return { text: v, num: false }
  if (typeof v === 'object') {
    if ('richText' in v) return { text: v.richText.map((r) => r.text).join(''), num: false }
    if ('error' in v) return { text: String(v.error), num: false }
    if ('formula' in v || 'sharedFormula' in v) {
      const res = (v as { result?: CellValue }).result
      // Senza risultato cached mostriamo la formula stessa (niente motore di
      // ricalcolo per ora: Excel/Sheets la calcoleranno alla prossima apertura).
      if (res === undefined) {
        const f = (v as { formula?: string }).formula
        return { text: f ? `=${f}` : '', num: false }
      }
      return cellText(res, numFmt)
    }
    if ('text' in v) return { text: String((v as { text: unknown }).text), num: false } // hyperlink
  }
  return { text: String(v), num: false }
}

function toCellData(cell: Cell, palette: string[]): CellData {
  const { text, num } = cellText(cell.value, cell.numFmt)
  const out: CellData = { t: text, num }
  if (typeof cell.value === 'boolean') out.chk = true
  const f = cell.font
  if (f?.bold) out.b = true
  if (f?.italic) out.i = true
  if (f?.size && f.size !== 10 && f.size !== 11) out.fs = Math.round(f.size * (4 / 3)) // pt → px
  const fc = resolveColor(f?.color, palette)
  if (fc) out.color = fc
  const fill = cell.fill
  if (fill && fill.type === 'pattern' && fill.pattern !== 'none') {
    const bg = resolveColor(fill.fgColor, palette)
    if (bg) out.bg = bg
  }
  if (cell.alignment?.horizontal) out.align = cell.alignment.horizontal
  else if (out.t === '☑' || out.t === '☐') out.align = 'center'
  if (cell.alignment?.wrapText) out.wrap = true
  // Bordi espliciti della cella (lo "stile card" dei template).
  const bd = cell.border
  if (bd) {
    const css = (side?: { style?: string; color?: { argb?: string; theme?: number } }) => {
      if (!side?.style) return undefined
      const w = side.style === 'medium' ? 2 : side.style === 'thick' || side.style === 'double' ? 3 : 1
      return `${w}px solid ${resolveColor(side.color, palette) ?? '#374151'}`
    }
    out.bt = css(bd.top)
    out.br = css(bd.right)
    out.bb = css(bd.bottom)
    out.bl = css(bd.left)
  }
  return out
}

// Foglio ExcelJS → modello piatto per il render (accesso celle una volta sola).
// (esportata per i test headless: gira anche fuori dal componente)
export function buildSheet(ws: Worksheet, palette: string[]): SheetData {
  const rowCount = Math.min(ws.rowCount || 0, MAX_ROWS)
  let colCount = Math.min(ws.columnCount || 1, MAX_COLS)
  // Tetto sul totale di celle visitate (fogli patologici).
  if (rowCount * colCount > 600_000) colCount = Math.max(26, Math.floor(600_000 / rowCount))

  // Celle unite: derivate cella per cella da `cell.master` (affidabile anche
  // sugli export di Google Sheets, dove `model.merges` può essere vuoto).
  // Le coperte diventano `skip`; il master accumula l'estensione del range.
  const merged = new Map<string, { r1: number; c1: number; r2: number; c2: number }>()
  const aggMerge = (masterAddr: string, r: number, c: number) => {
    const m = /^([A-Z]+)(\d+)$/.exec(masterAddr)
    if (!m) return
    const mc = colIndex(m[1])
    const mr = Number(m[2])
    const cur = merged.get(masterAddr) ?? { r1: mr, c1: mc, r2: mr, c2: mc }
    cur.c2 = Math.max(cur.c2, c)
    cur.r2 = Math.max(cur.r2, r)
    merged.set(masterAddr, cur)
  }

  const rows: CellData[][] = []
  const heights: number[] = []
  for (let r = 1; r <= rowCount; r++) {
    const row = ws.getRow(r)
    // Altezze VERE dal file (pt → px): i template usano righe spaziatrici da
    // 6pt e banner da 50pt — con altezza fissa il layout uscirebbe sfalsato.
    heights.push(row.height ? Math.max(6, Math.round(row.height * (4 / 3))) : DEFAULT_ROW_PX)
    const cells: CellData[] = Array.from({ length: colCount }, () => ({ t: '' }))
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      if (c > colCount) return
      const cd = toCellData(cell, palette)
      cells[c - 1] = cd
      if (cell.isMerged) {
        const masterAddr = cell.master.address
        if (masterAddr !== cell.address) {
          cd.t = '' // il valore lo mostra solo il master
          // skip (= nessun <td>) SOLO se il master è nella stessa riga: lo copre
          // il suo colSpan. Le coperte da una riga sopra (unione verticale)
          // restano <td> vuoti, altrimenti la riga slitterebbe a sinistra.
          const mm = /^[A-Z]+(\d+)$/.exec(masterAddr)
          if (mm && Number(mm[1]) === r) cd.skip = true
        }
        aggMerge(masterAddr, r, c)
      }
    })
    rows.push(cells)
  }

  // Applica i colSpan ai master e propaga lo SFONDO del master alle celle
  // coperte (l'unione verticale non può essere un vero rowSpan con la
  // virtualizzazione, ma almeno niente "buchi" bianchi dentro l'area unita).
  for (const { r1, c1, r2, c2 } of merged.values()) {
    if (r1 > rowCount || c1 > colCount) continue
    const master = rows[r1 - 1][c1 - 1]
    if (c2 > c1) {
      master.skip = false
      master.cs = Math.min(c2 - c1 + 1, colCount - c1 + 1)
    }
    if (master.bg) {
      for (let r = r1; r <= Math.min(r2, rowCount); r++)
        for (let c = c1; c <= Math.min(c2, colCount); c++) {
          const cd = rows[r - 1][c - 1]
          if (cd !== master && !cd.bg) cd.bg = master.bg
        }
    }
  }

  const widths: number[] = []
  for (let c = 1; c <= colCount; c++) {
    const w = ws.getColumn(c).width
    widths.push(w ? Math.round(w * 7 + 5) : 64)
  }

  // Gridlines: rispettiamo l'impostazione del foglio (View → Gridlines).
  const grid = (ws.views?.[0] as { showGridLines?: boolean } | undefined)?.showGridLines !== false

  return { name: ws.name, rows, widths, heights, offsets: buildOffsets(heights), grid, truncated: (ws.rowCount || 0) > MAX_ROWS }
}

function csvSheet(text: string): SheetData {
  const parsed = parseCsv(text)
  const truncated = parsed.length > MAX_ROWS
  const data = parsed.slice(0, MAX_ROWS)
  const colCount = Math.min(Math.max(...data.map((r) => r.length), 1), MAX_COLS)
  const rows = data.map((r) =>
    Array.from({ length: colCount }, (_, c) => {
      const raw = r[c] ?? ''
      const asNum = raw !== '' && !Number.isNaN(Number(raw.replace(',', '.')))
      return { t: raw, num: asNum } as CellData
    }),
  )
  const heights = Array(rows.length).fill(DEFAULT_ROW_PX)
  return { name: 'CSV', rows, widths: Array(colCount).fill(110), heights, offsets: buildOffsets(heights), grid: true, truncated }
}

export function XlsxViewer({ filePath }: { filePath: string }) {
  const [wb, setWb] = useState<Workbook | null>(null)
  const [sheetNames, setSheetNames] = useState<string[]>([])
  const [active, setActive] = useState(0)
  const [sheet, setSheet] = useState<SheetData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewH, setViewH] = useState(600)
  // Editing (Fase 2): cella in modifica + stato "non salvato".
  const [editing, setEditing] = useState<{ r: number; c: number } | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const setBuffer = useAppStore((s) => s.setBuffer)
  const clearBuffer = useAppStore((s) => s.clearBuffer)
  const cacheRef = useRef(new Map<number, SheetData>())
  const paletteRef = useRef<string[]>([]) // colori del tema del workbook
  const scrollRef = useRef<HTMLDivElement>(null)
  const isCsv = filePath.toLowerCase().endsWith('.csv')

  // Carica il file (ExcelJS pigra) e costruisce il primo foglio.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    setWb(null)
    setSheet(null)
    setActive(0)
    setScrollTop(0)
    cacheRef.current.clear()
    ;(async () => {
      if (isCsv) {
        const text = await readTextFile(filePath)
        if (cancelled) return
        setSheetNames([])
        setSheet(csvSheet(text))
        setLoading(false)
        return
      }
      const bytes = await readFile(filePath)
      const ExcelJS = (await import('exceljs')).default
      const book = new ExcelJS.Workbook()
      await book.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      if (cancelled) return
      // Riapplica al workbook le modifiche non ancora salvate di questo file.
      const edits = xlsxEditBuffers.get(filePath)
      if (edits) {
        for (const [key, val] of edits) {
          const [si, r, c] = key.split(':').map(Number)
          const ws = book.worksheets[si]
          if (ws) ws.getRow(r + 1).getCell(c + 1).value = val
        }
        setDirty(true)
      } else {
        setDirty(false)
      }
      setEditing(null)
      setWb(book)
      setSheetNames(book.worksheets.map((w) => w.name))
      // Palette del tema (per i fill/font con {theme: n} degli export Google).
      const themes = (book.model as unknown as { themes?: Record<string, string> }).themes
      paletteRef.current = parseThemePalette(themes?.theme1)
      const first = book.worksheets[0]
      if (first) {
        const built = buildSheet(first, paletteRef.current)
        cacheRef.current.set(0, built)
        setSheet(built)
      } else {
        setSheet({ name: '', rows: [], widths: [], heights: [], offsets: [0], grid: true, truncated: false })
      }
      setLoading(false)
    })().catch((e) => {
      console.error('Apertura foglio di calcolo:', e)
      if (!cancelled) {
        setError(true)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [filePath, isCsv])

  // Cambio foglio: costruzione pigra + cache.
  function selectSheet(i: number) {
    setEditing(null) // niente input orfano sul foglio nuovo
    setActive(i)
    setScrollTop(0)
    scrollRef.current?.scrollTo({ top: 0 })
    const cached = cacheRef.current.get(i)
    if (cached) {
      setSheet(cached)
      return
    }
    const ws = wb?.worksheets[i]
    if (!ws) return
    const built = buildSheet(ws, paletteRef.current)
    cacheRef.current.set(i, built)
    setSheet(built)
  }

  // Altezza visibile per la finestra di righe virtualizzata.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const obs = new ResizeObserver(() => setViewH(el.clientHeight))
    obs.observe(el)
    return () => obs.disconnect()
  }, [loading])

  // ---- Editing (Fase 2): la modifica va SUBITO nel workbook in memoria; il
  // salvataggio è un writeBuffer che preserva stili/formati (spike verificato).

  function commitEdit(r: number, c: number, raw: string) {
    setEditing(null)
    const ws = wb?.worksheets[active]
    if (!ws || !sheet) return
    const cellRef = ws.getRow(r + 1).getCell(c + 1)
    const before = rawOf(cellRef)
    if (raw === before) return // nessun cambiamento
    let value = parseInput(raw)
    // Formula: prova a calcolarla col mini-motore (aritmetica + SUM/MEDIA/…):
    // il risultato va anche nel file come cached, così ogni app lo mostra.
    if (value && typeof value === 'object' && 'formula' in value) {
      const result = evalFormula(ws, (value as { formula: string }).formula)
      if (result !== undefined) value = { formula: (value as { formula: string }).formula, result } as CellValue
    }
    cellRef.value = value
    // Aggiorna il modello di render della sola cella (stili invariati).
    const rebuilt = cellText(cellRef.value, cellRef.numFmt)
    const cd = sheet.rows[r][c]
    cd.t = rebuilt.text
    cd.num = rebuilt.num
    cd.chk = typeof cellRef.value === 'boolean'
    setSheet({ ...sheet })
    // Buffer per-file (sopravvive al cambio file) + pallino non salvato.
    const key = `${active}:${r}:${c}`
    const m = xlsxEditBuffers.get(filePath) ?? new Map<string, CellValue>()
    m.set(key, cellRef.value)
    xlsxEditBuffers.set(filePath, m)
    setDirty(true)
    setBuffer(filePath, '⟨foglio con modifiche non salvate⟩')
  }

  // Backup nascosto dell'originale prima della PRIMA scrittura (come PDF/DOCX).
  async function ensureBak() {
    const bak = `${filePath}.bak`
    if (!(await exists(bak))) {
      const orig = await readFile(filePath)
      await writeFileBinaryAtomic(bak, orig)
      invoke('set_hidden', { path: bak }).catch(() => {})
    }
  }

  async function save() {
    if (!wb || saving || !dirty) return
    setSaving(true)
    try {
      const out = new Uint8Array(await wb.xlsx.writeBuffer())
      await ensureBak()
      await writeFileBinaryAtomic(filePath, out)
      xlsxEditBuffers.delete(filePath)
      setDirty(false)
      clearBuffer(filePath)
    } catch (e) {
      console.error('Salvataggio xlsx:', e)
    } finally {
      setSaving(false)
    }
  }

  // Ctrl+S salva (solo xlsx: il CSV per ora è in sola lettura).
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    if (isCsv) return
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isCsv])

  const raw = filePath.split('\\').pop() ?? ''
  let fileName = raw
  try {
    fileName = decodeURIComponent(raw)
  } catch {
    /* tieni il grezzo */
  }

  const rows = sheet?.rows ?? []
  const widths = sheet?.widths ?? []
  const heights = sheet?.heights ?? []
  const offsets = sheet?.offsets ?? [0]
  const totalW = ROW_HDR_W + widths.reduce((a, b) => a + b, 0)
  const totalH = offsets[rows.length] ?? 0
  // Finestra visibile con altezze variabili: ricerca binaria sui prefissi.
  const start = Math.max(0, rowAt(offsets, scrollTop) - 5)
  const end = Math.min(rows.length, rowAt(offsets, scrollTop + viewH) + 6)
  const hdrBg = '#f4f4f5'
  const gridLine = '1px solid #d4d4d8'

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Barra superiore */}
      <div className="px-4 py-2 border-b border-zinc-800 flex items-center justify-between gap-3 shrink-0">
        <span className="text-sm text-zinc-300 truncate flex items-center gap-2 min-w-0">
          <span className="truncate">{fileName}</span>
          {dirty && <span className="text-xs text-amber-400 shrink-0">• non salvato</span>}
          {sheet && (
            <span className="text-xs text-zinc-500 shrink-0">
              · {rows.length}×{widths.length}
              {sheet.truncated && <span className="text-amber-400"> (troncato a {MAX_ROWS} righe)</span>}
            </span>
          )}
        </span>
        <div className="flex items-center gap-1 text-xs text-zinc-300">
          {!isCsv && (
            <button
              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-medium disabled:opacity-40"
              onClick={save}
              disabled={saving || !dirty || loading}
              title="Salva (Ctrl+S) — riscrive il file preservando stili e formule"
            >
              {saving ? 'Salvataggio…' : '💾 Salva'}
            </button>
          )}
          <ConvertButton filePath={filePath} className={btn} />
          <button className={btn} title="Apri in Explorer" onClick={() => revealInExplorer(filePath).catch((e) => console.error(e))}>
            Explorer
          </button>
        </div>
      </div>

      {/* Griglia */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto bg-white"
        // overflow-anchor: la virtualizzazione cambia gli spacer durante lo
        // scroll e l'ancoraggio di Chrome "compensa" → scroll che corre da solo.
        style={{ overflowAnchor: 'none' }}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        {error && <p className="text-zinc-500 text-sm text-center py-10">Impossibile aprire il file.</p>}
        {loading && !error && (
          <div className="mx-auto mt-16 h-7 w-7 rounded-full border-2 border-zinc-300 border-t-zinc-500 animate-spin" />
        )}
        {!loading && !error && sheet && rows.length === 0 && (
          <p className="text-zinc-400 text-sm text-center py-10">Foglio vuoto.</p>
        )}
        {!loading && !error && rows.length > 0 && (
          <div style={{ width: totalW }}>
            {/* Intestazioni colonna (A, B, C…): sticky in alto */}
            <div className="sticky top-0 z-20 flex" style={{ height: ROW_H, background: hdrBg }}>
              <div
                className="sticky left-0 z-10 shrink-0"
                style={{ width: ROW_HDR_W, background: hdrBg, borderRight: gridLine, borderBottom: gridLine }}
              />
              {widths.map((w, c) => (
                <div
                  key={c}
                  className="shrink-0 text-center text-[11px] leading-6 text-zinc-500 font-medium select-none"
                  style={{ width: w, borderRight: gridLine, borderBottom: gridLine }}
                >
                  {colLetter(c + 1)}
                </div>
              ))}
            </div>

            <div style={{ height: offsets[start] ?? 0 }} />
            <table style={{ tableLayout: 'fixed', borderCollapse: 'collapse', width: totalW }}>
              <colgroup>
                <col style={{ width: ROW_HDR_W }} />
                {widths.map((w, c) => (
                  <col key={c} style={{ width: w }} />
                ))}
              </colgroup>
              <tbody>
                {rows.slice(start, end).map((row, i) => {
                  const r = start + i
                  return (
                    <tr key={r} style={{ height: heights[r] ?? DEFAULT_ROW_PX }}>
                      <td
                        className="sticky left-0 z-10 text-center text-[11px] text-zinc-500 select-none"
                        style={{ background: hdrBg, borderRight: gridLine, borderBottom: gridLine }}
                      >
                        {r + 1}
                      </td>
                      {row.map((cell, c) => {
                        if (cell.skip) return null
                        // Gridline di default SOLO se il foglio le mostra e la
                        // cella non ha un fill (in Excel il fill copre la
                        // gridline); i bordi espliciti della cella vincono.
                        const grid = sheet?.grid && !cell.bg ? gridLine : undefined
                        // Larghezza reale della cella (somma le colonne unite).
                        let colW = widths[c] ?? 64
                        if (cell.cs) for (let k = 1; k < cell.cs; k++) colW += widths[c + k] ?? 0
                        const fs = fitFontSize(cell, colW)
                        return (
                          <td
                            key={c}
                            colSpan={cell.cs}
                            className={`px-1.5 overflow-hidden text-[13px] ${
                              cell.wrap ? 'whitespace-normal align-top' : 'whitespace-nowrap text-ellipsis'
                            }`}
                            style={{
                              borderTop: cell.bt,
                              borderLeft: cell.bl,
                              borderRight: cell.br ?? grid,
                              borderBottom: cell.bb ?? grid,
                              background: cell.bg,
                              color: cell.color ?? '#1f2937',
                              fontWeight: cell.b ? 700 : 400,
                              fontStyle: cell.i ? 'italic' : undefined,
                              fontSize: fs, // dimensione dal file, ridotta se la parola non ci sta
                              lineHeight: fs ? 1.15 : undefined,
                              textAlign: (cell.align as 'left' | 'center' | 'right') ?? (cell.num ? 'right' : 'left'),
                            }}
                            title={!cell.wrap && cell.t.length > 40 ? cell.t : undefined}
                            onClick={() => {
                              // click singolo = modifica (le booleane hanno la checkbox)
                              if (!isCsv && wb && !cell.chk) setEditing({ r, c })
                            }}
                          >
                            {cell.chk ? (
                              <input
                                type="checkbox"
                                checked={cell.t === '☑'}
                                disabled={isCsv}
                                className="align-middle cursor-pointer"
                                style={{ accentColor: '#2563eb' }}
                                onClick={(e) => e.stopPropagation()}
                                onChange={() => commitEdit(r, c, cell.t === '☑' ? 'FALSO' : 'VERO')}
                              />
                            ) : editing && editing.r === r && editing.c === c && wb ? (
                              <input
                                autoFocus
                                defaultValue={rawOf(wb.worksheets[active].getRow(r + 1).getCell(c + 1))}
                                className="block w-full h-full outline-none bg-white px-1.5 -mx-1.5"
                                style={{
                                  boxShadow: 'inset 0 0 0 2px #3b82f6',
                                  color: '#1f2937',
                                  fontSize: fs ?? 13,
                                  minHeight: (heights[r] ?? DEFAULT_ROW_PX) - 1,
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') commitEdit(r, c, e.currentTarget.value)
                                  else if (e.key === 'Escape') setEditing(null)
                                  e.stopPropagation()
                                }}
                                onBlur={(e) => commitEdit(r, c, e.currentTarget.value)}
                              />
                            ) : (
                              cell.t
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div style={{ height: Math.max(0, totalH - (offsets[end] ?? totalH)) }} />
          </div>
        )}
      </div>

      {/* Tab dei fogli (stile Excel, in basso) */}
      {sheetNames.length > 0 && (
        <div className="px-2 py-1 border-t border-zinc-800 bg-zinc-900 flex items-center gap-1 overflow-x-auto shrink-0">
          {sheetNames.map((name, i) => (
            <button
              key={i}
              onClick={() => selectSheet(i)}
              className={`px-3 py-1 rounded text-xs whitespace-nowrap ${
                i === active ? 'bg-zinc-100 text-zinc-900 font-medium' : 'text-zinc-400 hover:bg-zinc-800'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
