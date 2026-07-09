import { useEffect, useMemo, useRef, useState } from 'react'
import { readFile, readTextFile, exists } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import type { Workbook, Worksheet, Cell, CellValue } from 'exceljs'
import { revealInExplorer } from '../../lib/imageActions'
import { writeFileBinaryAtomic } from '../../lib/fileOps'
import { useAppStore } from '../../store/appStore'
import { ConvertButton } from '../Convert/ConvertButton'
import { parseCsv } from '../../lib/csv'
// Solo funzioni pure: il parser vero (fast-formula-parser) è caricato pigro
// dentro recalcSheet, al primo ricalcolo.
import { normalizeFormula, shiftRefsAbs, FORMULA_NAMES, materializeSharedFormulas, adjustSheetFormulas } from '../../lib/formulaEngine'
import type { AdjustKind } from '../../lib/formulaEngine'

// Cronologia annulla/ripeti per file (valori e stili: le operazioni
// strutturali su righe/colonne la azzerano perché gli indici slittano).
interface HistOp {
  sheet: number
  cells: { r: number; c: number; before: CellValue; after: CellValue }[]
  // Modifiche di FORMATO (grassetto/colori/allineamento/formato numero):
  // snapshot JSON prima/dopo di font+fill+alignment+numFmt della cella.
  styles?: { r: number; c: number; before: string; after: string }[]
}
const xlsxHistory = new Map<string, { undo: HistOp[]; redo: HistOp[] }>()

type Range = { r1: number; c1: number; r2: number; c2: number }

// Filtri attivi (testi ESCLUSI per colonna), per file+foglio: vive a livello
// modulo come i buffer. Le righe nascoste vanno anche nel workbook
// (row.hidden + autoFilter) così il filtro sopravvive al salvataggio e
// Excel/Sheets riaprono il file già filtrato.
const xlsxFilters = new Map<string, Map<number, Set<string>>>()

// Chiave di ordinamento stile Excel: numeri (e date) prima del testo,
// celle vuote SEMPRE in fondo, testo senza distinzione di maiuscole.
export function sortKeyOf(v: CellValue): number | string | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'object') {
    if ('result' in v) return sortKeyOf((v as { result?: CellValue }).result ?? null)
    if ('richText' in v) return v.richText.map((x) => x.text).join('').toLowerCase()
    if ('text' in v) return String((v as { text: unknown }).text).toLowerCase()
    return null
  }
  // Testo che È un numero (es. "1.234,56" incollato come testo) → ordina
  // come numero, non alfabeticamente.
  const s = String(v).trim()
  if (/^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(s) || /^-?\d+([.,]\d+)?$/.test(s)) {
    const n = Number(s.replace(/\./g, '').replace(',', '.'))
    if (!Number.isNaN(n)) return n
  }
  return s.toLowerCase()
}

// Colori dei riferimenti in modalità formula (ciclici, come Excel/Sheets).
export const REF_COLORS = ['#4285f4', '#ea4335', '#9334e6', '#34a853', '#e37400', '#00838f']

// Divide una formula (senza '=') in token marcando i riferimenti (A1, $B$2,
// A1:B3): stesso riferimento → stesso colore; le stringhe restano testo.
// La concatenazione dei token DEVE ridare la formula esatta (specchio 1:1).
export function parseFormulaRefs(formula: string): { tokens: { t: string; ref?: string }[]; refs: Map<string, number> } {
  const tokens: { t: string; ref?: string }[] = []
  const refs = new Map<string, number>()
  const parts = formula.split('"')
  const re = /(?<![\w$.])\$?[A-Za-z]{1,3}\$?\d{1,7}(?::\$?[A-Za-z]{1,3}\$?\d{1,7})?(?![\w(])/g
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      // parte tra virgolette: testo puro (l'ultima può essere non chiusa:
      // se la virgoletta di chiusura esistesse ci sarebbe una parte dopo)
      const closed = i < parts.length - 1
      tokens.push({ t: `"${part}${closed ? '"' : ''}` })
      return
    }
    let last = 0
    for (const m of part.matchAll(re)) {
      const at = m.index ?? 0
      if (at > last) tokens.push({ t: part.slice(last, at) })
      const key = m[0].replace(/\$/g, '').toUpperCase()
      if (!refs.has(key)) refs.set(key, refs.size)
      tokens.push({ t: m[0], ref: key })
      last = at + m[0].length
    }
    if (last < part.length) tokens.push({ t: part.slice(last) })
  })
  return { tokens, refs }
}

export function compareCells(a: CellValue, b: CellValue, asc: boolean): number {
  const ka = sortKeyOf(a)
  const kb = sortKeyOf(b)
  if (ka === null && kb === null) return 0
  if (ka === null) return 1 // vuote in fondo, in entrambe le direzioni
  if (kb === null) return -1
  const dir = asc ? 1 : -1
  if (typeof ka === 'number' && typeof kb === 'number') return (ka - kb) * dir
  if (typeof ka === 'number') return -dir // numeri prima del testo (come Excel)
  if (typeof kb === 'number') return dir
  return ka.localeCompare(kb, 'it') * dir
}

// Continua una sequenza (fill handle): numeri con passo, date con passo in
// giorni, testo+numero ("Voce 1" → "Voce 2"); altrimenti copia ciclica.
export function seriesValue(vals: CellValue[], k: number): CellValue {
  const n = vals.length
  if (!n) return null
  const nums = vals.map((v) => (typeof v === 'number' ? v : undefined))
  if (nums.every((v) => v !== undefined)) {
    const step = n > 1 ? (nums[n - 1]! - nums[0]!) / (n - 1) : 1
    return nums[n - 1]! + step * k
  }
  if (vals.every((v) => v instanceof Date)) {
    const d = vals as Date[]
    const step = n > 1 ? (d[n - 1].getTime() - d[0].getTime()) / (n - 1) : 86_400_000
    return new Date(d[n - 1].getTime() + step * k)
  }
  const tn = vals.map((v) => (typeof v === 'string' ? /^(.*?)(\d+)$/.exec(v) : null))
  if (tn.every((m) => m) && new Set(tn.map((m) => m![1])).size === 1) {
    const last = Number(tn[n - 1]![2])
    const step = n > 1 ? Number(tn[n - 1]![2]) - Number(tn[n - 2]![2]) : 1
    return `${tn[0]![1]}${last + step * k}`
  }
  return vals[(((k - 1) % n) + n) % n] // copia ciclica
}

// Workbook con modifiche non salvate, per file: vive a livello modulo così
// sopravvive al cambio file (come gli altri buffer). Bufferizzare l'INTERO
// workbook regge anche le operazioni strutturali (righe/colonne/fogli), dove
// un buffer per-cella si romperebbe (gli indici slittano).
const xlsxWbBuffers = new Map<string, Workbook>()

// Interpreta l'input dell'utente: numero (virgola italiana), booleano,
// formula (=...; senza motore di ricalcolo il risultato arriverà da Excel),
// vuoto → null, altrimenti testo.
export function parseInput(raw: string): CellValue {
  const s = raw.trim()
  if (s === '') return null
  // Formula: normalizzata subito (SOMMA→SUM, ; → ,) così nel FILE va il nome
  // canonico inglese, l'unico che Excel/Sheets accettano nel formato xlsx.
  if (s.startsWith('=')) return { formula: normalizeFormula(s.slice(1)) } as CellValue
  const low = s.toLowerCase()
  if (low === 'true' || low === 'vero') return true
  if (low === 'false' || low === 'falso') return false
  // Date digitate (5/7, 05/07/2026, 5-7-26) → data vera, come Excel.
  // In UTC: è la convenzione dei seriali ExcelJS (round-trip pulito).
  const dm = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/.exec(s)
  if (dm) {
    const d = Number(dm[1])
    const mo = Number(dm[2])
    let y = dm[3] ? Number(dm[3]) : new Date().getFullYear()
    if (y < 100) y += 2000
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
      const date = new Date(Date.UTC(y, mo - 1, d))
      if (date.getUTCMonth() === mo - 1 && date.getUTCDate() === d) return date
    }
  }
  // Orari digitati (8:30, 8:30:15) → data-orario del 1899, come Excel.
  const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s)
  if (tm) {
    const h = Number(tm[1])
    const mi = Number(tm[2])
    if (h < 24 && mi < 60) return new Date(Date.UTC(1899, 11, 30, h, mi, Number(tm[3] ?? 0)))
  }
  // Percentuali digitate (5%, 12,5%) → numero + formato % (dal commit).
  const pm = /^(-?\d+(?:[.,]\d+)?)\s*%$/.exec(s)
  if (pm) {
    const n = Number(pm[1].replace(',', '.'))
    if (!Number.isNaN(n)) return n / 100
  }
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
  if (v instanceof Date) return v.toLocaleDateString('it-IT', { timeZone: 'UTC' })
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
  u?: boolean // sottolineato
  st?: boolean // barrato
  fs?: number // dimensione font in px (solo se diversa dal default)
  color?: string
  bg?: string
  align?: string
  cs?: number // colSpan (celle unite in orizzontale)
  rs?: number // rowSpan (celle unite in verticale)
  skip?: boolean // coperta da una cella unita nella STESSA riga (colSpan del master)
  covR?: number // coperta da un master in un'altra riga (indice 0-based del master)
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
  // Filtro attivo (autoFilter del foglio): riga di intestazione + estensione.
  filter?: { r: number; c1: number; c2: number; r2: number } | null
  // Riquadri bloccati (freeze panes) dal file: prime N righe / M colonne.
  frozen?: { rows: number; cols: number } | null
}

// Appunti interni RICCHI (valori/formule + stili): usati quando il testo di
// sistema coincide ancora con l'ultima copia fatta da noi — così l'incolla
// interno porta FORMULE traslate e formati, quello esterno resta TSV.
let xlsxClipboard: {
  text: string
  cut: boolean
  srcPath: string
  sheet: number
  r: number
  c: number
  cells: { v: CellValue; style: string }[][]
} | null = null

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

// Stili tabella predefiniti ("Formatta come tabella" di Excel, in piccolo):
// intestazione piena + righe alternate + bordi sottili coordinati.
const TABLE_STYLES = [
  { name: 'Blu', head: 'FF4472C4', band: 'FFD9E2F3', border: 'FF8EAADB' },
  { name: 'Azzurro', head: 'FF2E75B6', band: 'FFDDEBF7', border: 'FF9DC3E6' },
  { name: 'Verde', head: 'FF548235', band: 'FFE2EFDA', border: 'FFA9D08E' },
  { name: 'Arancio', head: 'FFED7D31', band: 'FFFCE4D6', border: 'FFF4B084' },
  { name: 'Grigio', head: 'FF7B7B7B', band: 'FFEDEDED', border: 'FFBFBFBF' },
  { name: 'Scuro', head: 'FF262626', band: 'FFD9D9D9', border: 'FF808080' },
] as const

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

// Larghezza del testo col font di render (fallback stimato nei test headless).
function textWidth(text: string, fs: number, bold?: boolean): number {
  const ctx = getMeasureCtx()
  if (!ctx) return text.length * fs * 0.55
  ctx.font = `${bold ? 700 : 400} ${fs}px "Segoe UI", system-ui, sans-serif`
  return ctx.measureText(text).width
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
  return `#${argb.slice(2).toLowerCase()}`
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
  // Sempre in UTC: i seriali Excel sono "senza fuso" e ExcelJS li converte in
  // Date UTC — il fuso locale sposterebbe orari (e a ovest anche i giorni).
  if (hasTime && (!hasDate || d.getUTCFullYear() <= 1900)) {
    return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
  }
  return hasTime ? d.toLocaleString('it-IT', { timeZone: 'UTC' }) : d.toLocaleDateString('it-IT', { timeZone: 'UTC' })
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

// Memo attiva durante l'applicazione della formattazione condizionale: le
// parti assolute (es. MAX(F28:F1000)) sono identiche per centinaia di celle.
let cfMemo: Map<string, number | undefined> | null = null

export function evalFormula(ws: Worksheet, formula: string): number | undefined {
  let s = formula.toUpperCase().replace(/\s+/g, '').replace(/;/g, ',')
  if (cfMemo?.has(s)) return cfMemo.get(s)
  const memoKey = s
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
  const done = (v: number | undefined) => {
    cfMemo?.set(memoKey, v)
    return v
  }
  if (s.includes('ERR')) return done(undefined)
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
  if (bad || /[A-Z]/.test(s)) return done(undefined) // fuori dal subset
  return done(evalArith(s))
}

// ---- Condizioni (per la formattazione condizionale): confronti, AND/OR ----

// Divide al livello zero di parentesi (per gli argomenti di AND/OR).
function splitTop(s: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === sep && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

export function evalCond(ws: Worksheet, expr: string): boolean | undefined {
  const s = expr.toUpperCase().replace(/\s+/g, '').replace(/;/g, ',')
  const inner = (name: string) => s.slice(name.length + 1, -1)
  if (s.startsWith('AND(') && s.endsWith(')')) {
    const parts = splitTop(inner('AND'), ',').map((p) => evalCond(ws, p))
    if (parts.some((p) => p === undefined)) return undefined
    return parts.every(Boolean)
  }
  if (s.startsWith('OR(') && s.endsWith(')')) {
    const parts = splitTop(inner('OR'), ',').map((p) => evalCond(ws, p))
    if (parts.some((p) => p === undefined)) return undefined
    return parts.some(Boolean)
  }
  // Confronto al livello zero: <>, >=, <=, poi =, >, <.
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (depth === 0 && (ch === '<' || ch === '>' || ch === '=')) {
      const two = s.slice(i, i + 2)
      const op = two === '<>' || two === '>=' || two === '<=' ? two : ch
      const L = evalFormula(ws, s.slice(0, i))
      const R = evalFormula(ws, s.slice(i + op.length))
      if (L === undefined || R === undefined) return undefined
      switch (op) {
        case '<>':
          return L !== R
        case '>=':
          return L >= R
        case '<=':
          return L <= R
        case '=':
          return L === R
        case '>':
          return L > R
        default:
          return L < R
      }
    }
  }
  const n = evalFormula(ws, s)
  return n === undefined ? undefined : n !== 0
}

// Trasla i riferimenti RELATIVI di (dr, dc) — semantica Excel: la formula di
// una regola è scritta per la prima cella del range; '$' = assoluto (e viene
// tolto nell'output: il motore lavora su riferimenti semplici).
export function shiftRefs(formula: string, dr: number, dc: number): string {
  return formula.toUpperCase().replace(/(\$?)([A-Z]+)(\$?)(\d+)/g, (_m, dCol, col, dRow, row) => {
    const c = dCol ? col : colLetter(Math.max(1, colIndex(col) + dc))
    const r = dRow ? row : String(Math.max(1, Number(row) + dr))
    return c + r
  })
}

// Applica la formattazione condizionale al modello (cellIs + espressioni nel
// subset del motore). Priorità 1 = più forte → applicata per ultima.
function applyConditional(ws: Worksheet, rows: CellData[][], rowCount: number, colCount: number) {
  interface CfRule {
    type?: string
    operator?: string
    formulae?: (string | number)[]
    priority?: number
    stopIfTrue?: boolean
    style?: {
      font?: { color?: { argb?: string } }
      fill?: { bgColor?: { argb?: string }; fgColor?: { argb?: string } }
    }
  }
  const cfs = (ws as unknown as { conditionalFormattings?: { ref: string; rules: CfRule[] }[] }).conditionalFormattings
  if (!cfs?.length) return
  cfMemo = new Map()
  try {
    // Raccogli (regola, range) e ordina per priorità DECRESCENTE: l'ultima
    // applicata (priorità 1) vince.
    const jobs: { rule: CfRule; r1: number; c1: number; r2: number; c2: number }[] = []
    for (const cf of cfs) {
      for (const token of String(cf.ref).split(/\s+/)) {
        const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(token)
        if (!m) continue
        const c1 = colIndex(m[1])
        const r1 = Number(m[2])
        const c2 = m[3] ? colIndex(m[3]) : c1
        const r2 = m[4] ? Number(m[4]) : r1
        for (const rule of cf.rules) jobs.push({ rule, r1, c1, r2, c2 })
      }
    }
    // Semantica Excel: priorità CRESCENTE, per ogni cella la PRIMA regola che
    // imposta una proprietà vince; stopIfTrue blocca le regole successive.
    jobs.sort((a, b) => (a.rule.priority ?? 99) - (b.rule.priority ?? 99))
    const bgTaken = new Set<string>()
    const colorTaken = new Set<string>()
    const stopped = new Set<string>()

    for (const { rule, r1, c1, r2, c2 } of jobs) {
      if (rule.type !== 'cellIs' && rule.type !== 'expression') continue
      const bg = argbToCss(rule.style?.fill?.bgColor?.argb ?? rule.style?.fill?.fgColor?.argb)
      const color = argbToCss(rule.style?.font?.color?.argb)
      if (!bg && !color) continue
      const f0 = rule.formulae?.[0] !== undefined ? String(rule.formulae[0]) : undefined
      const f1 = rule.formulae?.[1] !== undefined ? String(rule.formulae[1]) : undefined
      for (let r = r1; r <= Math.min(r2, rowCount); r++) {
        for (let c = c1; c <= Math.min(c2, colCount); c++) {
          const key = `${r}:${c}`
          if (stopped.has(key)) continue
          let match: boolean | undefined
          if (rule.type === 'cellIs') {
            const v = numOf(ws.getRow(r).getCell(c).value)
            const cellRaw = ws.getRow(r).getCell(c).value
            if (cellRaw === null || cellRaw === undefined || v === undefined || f0 === undefined) continue
            const a = evalFormula(ws, shiftRefs(f0, r - r1, c - c1))
            if (a === undefined) continue
            switch (rule.operator) {
              case 'greaterThan':
                match = v > a
                break
              case 'lessThan':
                match = v < a
                break
              case 'greaterThanOrEqual':
                match = v >= a
                break
              case 'lessThanOrEqual':
                match = v <= a
                break
              case 'equal':
                match = v === a
                break
              case 'notEqual':
                match = v !== a
                break
              case 'between': {
                const b = f1 !== undefined ? evalFormula(ws, shiftRefs(f1, r - r1, c - c1)) : undefined
                match = b !== undefined && v >= Math.min(a, b) && v <= Math.max(a, b)
                break
              }
            }
          } else if (f0 !== undefined) {
            match = evalCond(ws, shiftRefs(f0, r - r1, c - c1))
          }
          if (match) {
            const cd = rows[r - 1]?.[c - 1]
            if (!cd) continue
            if (bg && !bgTaken.has(key)) {
              cd.bg = bg
              bgTaken.add(key)
            }
            if (color && !colorTaken.has(key)) {
              cd.color = color
              colorTaken.add(key)
            }
            if (rule.stopIfTrue) stopped.add(key)
          }
        }
      }
    }
  } catch (e) {
    console.warn('Formattazione condizionale non applicata:', e)
  } finally {
    cfMemo = null
  }
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
  if (f?.underline && f.underline !== 'none') out.u = true
  if (f?.strike) out.st = true
  if (f?.size && f.size !== 10 && f.size !== 11) out.fs = Math.round(f.size * (4 / 3)) // pt → px
  const fc = resolveColor(f?.color, palette)
  if (fc) out.color = fc
  const fill = cell.fill
  if (fill && fill.type === 'pattern' && fill.pattern !== 'none') {
    const bg = resolveColor(fill.fgColor, palette)
    if (bg) out.bg = bg
  } else if (fill && fill.type === 'gradient') {
    // Gradiente → CSS linear-gradient (angolo Excel 0 = orizzontale).
    const g = fill as { degree?: number; stops?: { position: number; color: { argb?: string; theme?: number } }[] }
    const stops = (g.stops ?? []).map((s) => resolveColor(s.color, palette)).filter((x): x is string => !!x)
    if (stops.length >= 2) out.bg = `linear-gradient(${(g.degree ?? 0) + 90}deg, ${stops.join(', ')})`
  }
  if (cell.alignment?.horizontal) out.align = cell.alignment.horizontal
  else if (out.t === '☑' || out.t === '☐') out.align = 'center'
  if (cell.alignment?.wrapText) out.wrap = true
  // Bordi espliciti della cella (lo "stile card" dei template).
  const bd = cell.border
  if (bd) {
    const css = (side?: { style?: string; color?: { argb?: string; theme?: number } }) => {
      if (!side?.style) return undefined
      const s = side.style
      const w = s === 'medium' || s === 'mediumDashed' ? 2 : s === 'thick' || s === 'double' ? 3 : 1
      const line = s.includes('dash') ? 'dashed' : s === 'dotted' || s === 'hair' ? 'dotted' : s === 'double' ? 'double' : 'solid'
      return `${w}px ${line} ${resolveColor(side.color, palette) ?? '#374151'}`
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
  // Griglia SEMPRE più grande dell'usato (come Excel): un foglio nuovo mostra
  // 60×26 celle vuote pronte da compilare, uno pieno ha margine per crescere.
  const usedRows = ws.rowCount || 0
  const rowCount = Math.min(Math.max(usedRows + 30, 60), MAX_ROWS)
  let colCount = Math.min(Math.max(ws.columnCount || 1, 26), MAX_COLS)
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

  const widths: number[] = []
  for (let c = 1; c <= colCount; c++) {
    const w = ws.getColumn(c).width
    widths.push(w ? Math.round(w * 7 + 5) : 64)
  }

  const rows: CellData[][] = []
  const rawH: (number | undefined)[] = [] // altezza dal file (px), se presente
  const hiddenRows: boolean[] = []
  for (let r = 1; r <= rowCount; r++) {
    const row = ws.getRow(r)
    const cells: CellData[] = Array.from({ length: colCount }, () => ({ t: '' }))
    rawH.push(row.height ? Math.max(6, Math.round(row.height * (4 / 3))) : undefined)
    hiddenRows.push(!!row.hidden)
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

  // Applica colSpan/rowSpan ai master. Le coperte in un'altra riga portano
  // `covR` (riga del master): al render si saltano SOLO se il master è nella
  // finestra virtualizzata, altrimenti restano <td> vuoti (niente slittamenti).
  // Lo sfondo del master si propaga alle coperte per quel caso di fallback.
  for (const { r1, c1, r2, c2 } of merged.values()) {
    if (r1 > rowCount || c1 > colCount) continue
    const master = rows[r1 - 1][c1 - 1]
    if (c2 > c1) {
      master.skip = false
      master.cs = Math.min(c2 - c1 + 1, colCount - c1 + 1)
    }
    if (r2 > r1) master.rs = Math.min(r2, rowCount) - r1 + 1
    for (let r = r1; r <= Math.min(r2, rowCount); r++)
      for (let c = c1; c <= Math.min(c2, colCount); c++) {
        const cd = rows[r - 1][c - 1]
        if (cd === master) continue
        if (r > r1) cd.covR = r1 - 1
        if (master.bg && !cd.bg) cd.bg = master.bg
      }
  }

  // Altezze righe: AUTO-FIT al contenuto, come mostra Google Sheets (gli
  // export dei template scrivono altezze "stantie": banner da 21-42pt in
  // righe da 6pt che Google a schermo rialza da sé). Regole:
  //  - riga nascosta → 0; riga VUOTA → altezza del file (spaziatori intatti)
  //  - riga con contenuto → almeno quanto serve al font più alto (e alle
  //    righe stimate, per il testo a capo); mai meno dell'altezza del file
  //  - i master con rowSpan non contano (il loro blocco ha già lo spazio)
  const heights: number[] = []
  for (let r = 0; r < rowCount; r++) {
    let contentH = 0
    const cells = rows[r]
    for (let c = 0; c < cells.length; c++) {
      const cd = cells[c]
      if (!cd.t || cd.covR !== undefined || (cd.rs ?? 1) > 1) continue
      const fs = cd.fs ?? 13
      let need = Math.ceil(fs * 1.3)
      if (cd.wrap) {
        let avail = -12
        for (let k = 0; k < (cd.cs ?? 1); k++) avail += widths[c + k] ?? 0
        const w = textWidth(cd.t, fs, cd.b)
        const lines = Math.max(1, Math.min(20, Math.ceil((w * 1.1) / Math.max(avail, 20))))
        if (lines > 1) need = Math.ceil(lines * fs * 1.25) + 4
      }
      if (need > contentH) contentH = need
    }
    const fileH = rawH[r]
    heights.push(hiddenRows[r] ? 0 : fileH !== undefined ? Math.max(fileH, contentH) : Math.max(DEFAULT_ROW_PX, contentH ? contentH + 4 : 0))
  }

  // Formattazione condizionale (Fase 14): colori applicati al modello.
  applyConditional(ws, rows, rowCount, colCount)

  // Gridlines: rispettiamo l'impostazione del foglio (View → Gridlines).
  const view0 = ws.views?.[0] as { showGridLines?: boolean; state?: string; xSplit?: number; ySplit?: number } | undefined
  const grid = view0?.showGridLines !== false

  // Riquadri bloccati (freeze panes): prime N righe / M colonne sticky.
  const frozen =
    view0?.state === 'frozen' && ((view0.ySplit ?? 0) > 0 || (view0.xSplit ?? 0) > 0)
      ? { rows: Math.min(view0.ySplit ?? 0, 30), cols: Math.min(view0.xSplit ?? 0, 10) }
      : null

  // Filtro (autoFilter): può essere stringa "A1:D30" o oggetto {from, to}.
  let filter: SheetData['filter'] = null
  const afRaw = (ws as unknown as { autoFilter?: unknown }).autoFilter
  const afRef = (() => {
    if (typeof afRaw === 'string') return afRaw
    if (afRaw && typeof afRaw === 'object') {
      const part = (p: unknown): string | undefined => {
        if (typeof p === 'string') return p
        if (p && typeof p === 'object' && 'row' in p && 'column' in p) {
          const q = p as { row: number; column: number | string }
          return `${typeof q.column === 'number' ? colLetter(q.column) : q.column}${q.row}`
        }
        return undefined
      }
      const o = afRaw as { from?: unknown; to?: unknown }
      const a = part(o.from)
      const b = part(o.to)
      if (a) return b ? `${a}:${b}` : a
    }
    return undefined
  })()
  if (afRef) {
    const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(afRef.toUpperCase().replace(/\$/g, ''))
    if (m) {
      filter = {
        r: Number(m[2]) - 1,
        c1: colIndex(m[1]) - 1,
        c2: (m[3] ? colIndex(m[3]) : colIndex(m[1])) - 1,
        r2: (m[4] ? Number(m[4]) : Number(m[2])) - 1,
      }
    }
  }

  return { name: ws.name, rows, widths, heights, offsets: buildOffsets(heights), grid, truncated: usedRows > MAX_ROWS, filter, frozen }
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
  // Selezione multi-cella stile Excel (drag) + menu tasto destro.
  const [selRange, setSelRange] = useState<{ r1: number; c1: number; r2: number; c2: number } | null>(null)
  const selAnchor = useRef<{ r: number; c: number } | null>(null)
  const draggingSel = useRef(false)
  const dragMoved = useRef(false)
  const [menu, setMenu] = useState<{ x: number; y: number; r: number; c: number } | null>(null)
  const [submenu, setSubmenu] = useState<string | null>(null) // sottomenu aperto (Riga/Colonna/Ordina)
  const [filterMenu, setFilterMenu] = useState<{ c: number; x: number; y: number } | null>(null) // dropdown filtro
  const [renamingSheet, setRenamingSheet] = useState<number | null>(null)
  // Barra della formula (casella nome + fx) e finestre di formattazione.
  const [fxDraft, setFxDraft] = useState<string | null>(null)
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const [fmtDialog, setFmtDialog] = useState(false) // "Formato celle" (bordi/riempimento)
  const [tableMenu, setTableMenu] = useState<{ x: number; y: number } | null>(null) // galleria stili tabella
  const [delMenu, setDelMenu] = useState<{ x: number; y: number } | null>(null) // mini-menu del tasto Canc
  const [bStyle, setBStyle] = useState('thin') // stile bordo scelto nel dialog
  const [bColor, setBColor] = useState('#000000')
  const [gradA, setGradA] = useState('#ffffff')
  const [gradB, setGradB] = useState('#4472c4')
  const [gradDir, setGradDir] = useState('0') // gradi Excel: 0 orizz, 90 vert, 45 diag
  // Fill handle: trascinamento del quadratino per continuare le sequenze.
  const [fillPreview, setFillPreview] = useState<{ r1: number; c1: number; r2: number; c2: number } | null>(null)
  const fillRef = useRef<{ base: { r1: number; c1: number; r2: number; c2: number } } | null>(null)
  const fillPreviewRef = useRef<typeof fillPreview>(null)
  fillPreviewRef.current = fillPreview
  // Spostamento della selezione trascinandone il bordo (stile Excel).
  const [movePreview, setMovePreview] = useState<{ r1: number; c1: number; r2: number; c2: number } | null>(null)
  const moveRef = useRef<{ base: { r1: number; c1: number; r2: number; c2: number }; startR: number; startC: number } | null>(null)
  const movePreviewRef = useRef<typeof movePreview>(null)
  movePreviewRef.current = movePreview
  const setBuffer = useAppStore((s) => s.setBuffer)
  const clearBuffer = useAppStore((s) => s.clearBuffer)
  const cacheRef = useRef(new Map<number, SheetData>())
  const paletteRef = useRef<string[]>([]) // colori del tema del workbook
  const scrollRef = useRef<HTMLDivElement>(null)
  // Modalità formula: input attivi (cella o barra fx) e ultimo riferimento
  // inserito col click (i click consecutivi lo sostituiscono, come Excel).
  const editInputRef = useRef<HTMLInputElement | null>(null)
  const fxInputRef = useRef<HTMLInputElement | null>(null)
  const formulaPick = useRef<{ input: HTMLInputElement; start: number; end: number } | null>(null)
  const pickSwallow = useRef(false)
  const pickDrag = useRef<{ r: number; c: number } | null>(null) // drag → riferimento di RANGE
  // Navigazione con tastiera: cella "fuoco" (si muove con le frecce),
  // seme dell'editing (scrivi-per-sostituire) e modalità (enter vs edit).
  const navFocus = useRef<{ r: number; c: number } | null>(null)
  const headerDrag = useRef<{ kind: 'row' | 'col'; from: number } | null>(null) // drag sulle intestazioni
  const editSeed = useRef<string | null>(null)
  const editMode = useRef<'enter' | 'edit'>('edit') // enter = frecce committano e si muovono
  // Testo live della formula in scrittura (cella o barra fx): pilota i colori
  // dei riferimenti (riquadri sulle celle + specchio colorato negli input).
  const [fxLive, setFxLive] = useState<string | null>(null)
  // Autocompletamento funzioni (=SO → SOMMA…) e ricerca nel foglio (Ctrl+F).
  const [fxSuggest, setFxSuggest] = useState<{
    x: number
    y: number
    list: string[]
    idx: number
    start: number
    end: number
    src: 'cell' | 'fx'
  } | null>(null)
  const [findQ, setFindQ] = useState<string | null>(null) // null = barra chiusa
  const [findIdx, setFindIdx] = useState(0)
  const findInputRef = useRef<HTMLInputElement | null>(null)
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
      // Workbook con modifiche non salvate? Riprendi quello, non il disco.
      let book = xlsxWbBuffers.get(filePath)
      if (book) {
        setDirty(true)
      } else {
        const bytes = await readFile(filePath)
        const ExcelJS = (await import('exceljs')).default
        book = new ExcelJS.Workbook()
        await book.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
        setDirty(false)
      }
      if (cancelled) return
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

  // Fine del drag di selezione (o del drag di range in modalità formula),
  // ovunque finisca il mouse.
  useEffect(() => {
    const up = () => {
      draggingSel.current = false
      pickDrag.current = null
      headerDrag.current = null
    }
    document.addEventListener('mouseup', up)
    return () => document.removeEventListener('mouseup', up)
  }, [])

  // ---- Editing (Fase 2): la modifica va SUBITO nel workbook in memoria; il
  // salvataggio è un writeBuffer che preserva stili/formati (spike verificato).

  function commitEdit(r: number, c: number, raw: string) {
    setEditing(null)
    setFxLive(null)
    setFxSuggest(null)
    const ws = wb?.worksheets[active]
    if (!ws || !sheet) return
    const cellRef = ws.getRow(r + 1).getCell(c + 1)
    const before = rawOf(cellRef)
    if (raw === before) return // nessun cambiamento
    const beforeValue = cellRef.value
    let value = parseInput(raw)
    // Formato implicito come Excel: date/orari/percentuali digitati prendono
    // anche il formato numero (senza, Excel mostrerebbe il seriale grezzo).
    if (!cellRef.numFmt) {
      if (value instanceof Date) cellRef.numFmt = /:\d/.test(raw) ? 'hh:mm' : 'dd/mm/yyyy'
      else if (typeof value === 'number' && raw.trim().endsWith('%'))
        cellRef.numFmt = Number.isInteger(value * 100) ? '0%' : '0.00%'
    }
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
    markDirty()
    // Cronologia (annulla/ripeti).
    const h = xlsxHistory.get(filePath) ?? { undo: [], redo: [] }
    h.undo.push({ sheet: active, cells: [{ r, c, before: beforeValue, after: cellRef.value }] })
    if (h.undo.length > 100) h.undo.shift()
    h.redo = []
    xlsxHistory.set(filePath, h)
    void recalcAndRefresh() // le formule che dipendono da questa cella si aggiornano
  }

  // Ricalcolo live delle formule (fast-formula-parser, caricato pigro): dopo
  // ogni modifica ai valori ricalcola il foglio attivo e aggiorna a schermo
  // le celle il cui risultato è cambiato (i result vanno anche nel file).
  async function recalcAndRefresh() {
    const ws = wb?.worksheets[active]
    if (!ws || isCsv) return
    try {
      const { recalcSheet } = await import('../../lib/formulaEngine')
      const changed = await recalcSheet(wb!, ws)
      if (!changed.length) return
      markDirty()
      cacheRef.current.delete(active)
      setSheet((s) => {
        if (!s) return s
        for (const { r, c } of changed) {
          const cd = s.rows[r]?.[c]
          if (!cd) continue
          const cell = ws.getRow(r + 1).getCell(c + 1)
          const t = cellText(cell.value, cell.numFmt)
          cd.t = t.text
          cd.num = t.num
        }
        return { ...s }
      })
    } catch (e) {
      console.warn('Ricalcolo formule:', e)
    }
  }

  // Segna il file come non salvato: workbook nel buffer + pallino nel tree.
  function markDirty() {
    if (wb) xlsxWbBuffers.set(filePath, wb)
    setDirty(true)
    setBuffer(filePath, '⟨foglio con modifiche non salvate⟩')
  }

  // Ricostruisce il modello del foglio attivo dopo un'operazione strutturale.
  function rebuildActive() {
    const ws = wb?.worksheets[active]
    if (!ws) return
    const built = buildSheet(ws, paletteRef.current)
    cacheRef.current.set(active, built)
    setSheet(built)
  }

  // Operazione strutturale sul foglio attivo (righe/colonne): muta + rebuild.
  // Azzera la cronologia annulla/ripeti: gli indici delle celle slittano.
  // Con `adjust` le FORMULE del foglio vengono riscritte come fa Excel
  // (riferimenti traslati, range allargati/accorciati, #REF! sui cancellati);
  // prima si materializzano le formule condivise (indirizzi stantii).
  function structural(mutate: (ws: Worksheet) => void, adjust?: { kind: AdjustKind; pos: number }) {
    const ws = wb?.worksheets[active]
    if (!ws) return
    setEditing(null)
    setSelRange(null)
    try {
      if (adjust) materializeSharedFormulas(ws)
      mutate(ws)
      if (adjust) adjustSheetFormulas(ws, adjust.kind, adjust.pos)
    } catch (e) {
      console.error('Operazione non riuscita:', e)
    }
    xlsxHistory.delete(filePath)
    rebuildActive()
    markDirty()
    void recalcAndRefresh()
  }

  // Scrive un gruppo di celle registrando l'operazione nella cronologia
  // (annulla/ripeti). Usato da fill handle, undo/redo — e come base comune.
  function writeCells(cells: { r: number; c: number; v: CellValue }[], record = true) {
    const ws = wb?.worksheets[active]
    if (!ws || !cells.length) return
    const op: HistOp = { sheet: active, cells: [] }
    for (const { r, c, v } of cells) {
      const cell = ws.getRow(r + 1).getCell(c + 1)
      op.cells.push({ r, c, before: cell.value, after: v })
      cell.value = v
    }
    rebuildActive()
    markDirty()
    if (record) {
      const h = xlsxHistory.get(filePath) ?? { undo: [], redo: [] }
      h.undo.push(op)
      if (h.undo.length > 100) h.undo.shift()
      h.redo = []
      xlsxHistory.set(filePath, h)
    }
    void recalcAndRefresh()
  }

  function undoRedo(redo: boolean) {
    const h = xlsxHistory.get(filePath)
    const op = (redo ? h?.redo : h?.undo)?.pop()
    if (!h || !op) return
    if (op.sheet !== active) selectSheet(op.sheet) // torna sul foglio giusto
    const ws = wb?.worksheets[op.sheet]
    if (!ws) return
    // Annullando si applica in ordine INVERSO: se un'operazione tocca due
    // volte la stessa cella (es. taglia+incolla sovrapposti) il "before"
    // giusto è quello della prima scrittura.
    const cellsList = redo ? op.cells : [...op.cells].reverse()
    const stylesList = redo ? (op.styles ?? []) : [...(op.styles ?? [])].reverse()
    for (const e of cellsList) {
      ws.getRow(e.r + 1).getCell(e.c + 1).value = redo ? e.after : e.before
    }
    for (const e of stylesList) {
      const s = JSON.parse(redo ? e.after : e.before) as {
        numFmt?: string
        font?: object
        alignment?: object
        fill?: object
        border?: object
      }
      const cell = ws.getRow(e.r + 1).getCell(e.c + 1) as unknown as {
        numFmt?: string
        font?: object
        alignment?: object
        fill?: object
        border?: object
      }
      cell.numFmt = s.numFmt
      cell.font = s.font
      cell.alignment = s.alignment
      cell.fill = s.fill
      cell.border = s.border
    }
    ;(redo ? h.undo : h.redo).push(op)
    cacheRef.current.delete(op.sheet)
    rebuildActive()
    markDirty()
    void recalcAndRefresh()
  }

  // Applica il fill: per ogni colonna (o riga) della base, continua la serie.
  function applyFill(base: { r1: number; c1: number; r2: number; c2: number }, target: { r1: number; c1: number; r2: number; c2: number }) {
    const ws = wb?.worksheets[active]
    if (!ws) return
    const cells: { r: number; c: number; v: CellValue }[] = []
    const vertical = target.c1 === base.c1 && target.c2 === base.c2
    // Le FORMULE si trascinano come su Excel: riferimenti relativi traslati,
    // '$' assoluti bloccati; il risultato arriva dal ricalcolo dopo la scrittura.
    const fillVal = (vals: CellValue[], k: number, baseStart: number, targetPos: number): CellValue => {
      const n = vals.length
      const idx = (((k - 1) % n) + n) % n
      const src = vals[idx]
      if (src && typeof src === 'object' && !(src instanceof Date) && 'formula' in src) {
        const delta = targetPos - (baseStart + idx)
        const f = (src as { formula: string }).formula
        return { formula: vertical ? shiftRefsAbs(f, delta, 0) : shiftRefsAbs(f, 0, delta) } as CellValue
      }
      return seriesValue(vals, k)
    }
    if (vertical) {
      for (let c = base.c1; c <= base.c2; c++) {
        const vals: CellValue[] = []
        for (let r = base.r1; r <= base.r2; r++) vals.push(ws.getRow(r + 1).getCell(c + 1).value)
        for (let r = target.r1; r <= target.r2; r++) {
          const k = r > base.r2 ? r - base.r2 : r - base.r1 // sotto: k>0; sopra: k<0
          cells.push({ r, c, v: fillVal(vals, k, base.r1, r) })
        }
      }
    } else {
      for (let r = base.r1; r <= base.r2; r++) {
        const vals: CellValue[] = []
        for (let c = base.c1; c <= base.c2; c++) vals.push(ws.getRow(r + 1).getCell(c + 1).value)
        for (let c = target.c1; c <= target.c2; c++) {
          const k = c > base.c2 ? c - base.c2 : c - base.c1
          cells.push({ r, c, v: fillVal(vals, k, base.c1, c) })
        }
      }
    }
    writeCells(cells)
    setSelRange({ r1: Math.min(base.r1, target.r1), c1: Math.min(base.c1, target.c1), r2: Math.max(base.r2, target.r2), c2: Math.max(base.c2, target.c2) })
  }

  // Sposta il CONTENUTO della selezione nel punto di rilascio (valori; una
  // sola operazione in cronologia → annullabile con Ctrl+Z).
  function applyMove(base: { r1: number; c1: number; r2: number; c2: number }, target: { r1: number; c1: number; r2: number; c2: number }) {
    const ws = wb?.worksheets[active]
    if (!ws) return
    const values: CellValue[][] = []
    for (let r = base.r1; r <= base.r2; r++) {
      const row: CellValue[] = []
      for (let c = base.c1; c <= base.c2; c++) row.push(ws.getRow(r + 1).getCell(c + 1).value)
      values.push(row)
    }
    const cells: { r: number; c: number; v: CellValue }[] = []
    for (let r = base.r1; r <= base.r2; r++)
      for (let c = base.c1; c <= base.c2; c++) cells.push({ r, c, v: null })
    values.forEach((row, i) =>
      row.forEach((v, j) => cells.push({ r: target.r1 + i, c: target.c1 + j, v })),
    )
    writeCells(cells)
    setSelRange(target)
  }

  // Inizio drag dal bordo della selezione: ricava la cella di partenza dalle
  // coordinate (serve per calcolare lo spostamento relativo).
  function startMoveDrag(e: React.MouseEvent) {
    if (!selRange || !sheet) return
    e.preventDefault()
    e.stopPropagation()
    // se stai ancora scrivendo nella cella, il drag committa prima (come Excel)
    if (editing && editInputRef.current) commitEdit(editing.r, editing.c, editInputRef.current.value)
    const cont = scrollRef.current
    if (!cont) return
    const rect = cont.getBoundingClientRect()
    const x = e.clientX - rect.left + cont.scrollLeft - ROW_HDR_W
    const y = e.clientY - rect.top + cont.scrollTop - ROW_H // header colonne
    let acc = 0
    let startC = 0
    for (let i = 0; i < sheet.widths.length; i++) {
      acc += sheet.widths[i]
      if (x < acc) {
        startC = i
        break
      }
      startC = i
    }
    moveRef.current = { base: selRange, startR: rowAt(sheet.offsets, Math.max(0, y)), startC }
    const up = () => {
      document.removeEventListener('mouseup', up)
      const mv = moveRef.current
      const preview = movePreviewRef.current
      moveRef.current = null
      setMovePreview(null)
      if (mv && preview && (preview.r1 !== mv.base.r1 || preview.c1 !== mv.base.c1)) applyMove(mv.base, preview)
    }
    document.addEventListener('mouseup', up)
  }

  function startFillDrag(e: React.MouseEvent) {
    if (!selRange) return
    e.preventDefault()
    e.stopPropagation()
    // se stai ancora scrivendo nella cella, il drag committa prima (come Excel)
    if (editing && editInputRef.current) commitEdit(editing.r, editing.c, editInputRef.current.value)
    fillRef.current = { base: selRange }
    const up = () => {
      document.removeEventListener('mouseup', up)
      const f = fillRef.current
      const preview = fillPreviewRef.current
      fillRef.current = null
      setFillPreview(null)
      if (f && preview) applyFill(f.base, preview)
    }
    document.addEventListener('mouseup', up)
  }

  // Ridimensiona una colonna trascinando il bordo destro dell'intestazione.
  // Live sul modello; al rilascio il valore va anche nel workbook (px → chars).
  function startColResize(c: number, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const orig = sheet?.widths[c] ?? 64
    const move = (ev: MouseEvent) => {
      const w = Math.max(24, orig + ev.clientX - startX)
      setSheet((s) => (s ? { ...s, widths: s.widths.map((x, i) => (i === c ? w : x)) } : s))
    }
    const up = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      const w = Math.max(24, orig + ev.clientX - startX)
      const ws = wb?.worksheets[active]
      if (ws && !isCsv) {
        ws.getColumn(c + 1).width = Math.max(1, (w - 5) / 7)
        markDirty()
      }
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  // Ridimensiona una riga trascinando il bordo inferiore del numero di riga.
  function startRowResize(r: number, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const startY = e.clientY
    const orig = sheet?.heights[r] ?? DEFAULT_ROW_PX
    const move = (ev: MouseEvent) => {
      const h = Math.max(10, orig + ev.clientY - startY)
      setSheet((s) => {
        if (!s) return s
        const heights = s.heights.map((x, i) => (i === r ? h : x))
        return { ...s, heights, offsets: buildOffsets(heights) }
      })
    }
    const up = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      const h = Math.max(10, orig + ev.clientY - startY)
      const ws = wb?.worksheets[active]
      if (ws && !isCsv) {
        ws.getRow(r + 1).height = h * 0.75 // px → pt
        markDirty()
      }
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  // Incolla una matrice (TSV dagli appunti: righe \n, celle \t) a partire
  // dalla cella data — comportamento Excel, non tutto in una cella sola.
  function pasteMatrix(startR: number, startC: number, text: string) {
    const lines = text.replace(/\r/g, '').split('\n')
    while (lines.length && lines[lines.length - 1] === '') lines.pop()
    if (!lines.length) return
    setEditing(null)
    const cells: { r: number; c: number; v: CellValue }[] = []
    lines.forEach((line, i) => {
      line.split('\t').forEach((val, j) => {
        cells.push({ r: startR + i, c: startC + j, v: parseInput(val) })
      })
    })
    writeCells(cells) // registra anche nella cronologia (Ctrl+Z)
  }

  // ---- Navigazione con tastiera (stile Excel) ----

  // Porta la cella nel viewport (tenendo conto di header e riquadri bloccati).
  function ensureVisible(r: number, c: number) {
    const cont = scrollRef.current
    if (!cont || !sheet) return
    const frozR = sheet.frozen?.rows ?? 0
    const frozC = sheet.frozen?.cols ?? 0
    const frozH = offsets[Math.min(frozR, rows.length)] ?? 0
    let frozW = 0
    for (let i = 0; i < frozC && i < widths.length; i++) frozW += widths[i]
    const yTop = offsets[r] ?? 0
    const yBot = offsets[r + 1] ?? yTop + DEFAULT_ROW_PX
    if (r >= frozR && yTop < cont.scrollTop + frozH) cont.scrollTop = Math.max(0, yTop - frozH)
    else if (yBot > cont.scrollTop + cont.clientHeight - ROW_H) cont.scrollTop = yBot - cont.clientHeight + ROW_H
    const xL = colX(c)
    const xR = colX(c + 1)
    if (c >= frozC && xL < cont.scrollLeft + ROW_HDR_W + frozW) cont.scrollLeft = Math.max(0, xL - ROW_HDR_W - frozW)
    else if (xR > cont.scrollLeft + cont.clientWidth) cont.scrollLeft = xR - cont.clientWidth
  }

  // Inizia l'editing di una cella: seed = testo che SOSTITUISCE il contenuto
  // (scrivi-per-sostituire), null = modifica il contenuto esistente (F2/doppio
  // click). In modalità "enter" le frecce committano e si spostano.
  function startEdit(r: number, c: number, seed: string | null) {
    if (isCsv || !wb) return
    editSeed.current = seed
    editMode.current = seed === null ? 'edit' : 'enter'
    setEditing({ r, c })
    selAnchor.current = { r, c }
    navFocus.current = { r, c }
    setSelRange({ r1: r, r2: r, c1: c, c2: c })
    const raw0 = seed ?? rawOf(wb.worksheets[active].getRow(r + 1).getCell(c + 1))
    setFxLive(raw0.startsWith('=') ? raw0 : null)
    ensureVisible(r, c)
  }

  // Bersaglio del salto Ctrl+freccia: semantica Excel (al bordo del blocco
  // di dati contiguo, o alla prossima cella piena, o al bordo della griglia).
  function jumpTarget(r: number, c: number, dr: number, dc: number) {
    const R = rows.length - 1
    const C = widths.length - 1
    const filled = (rr: number, cc: number) => rr >= 0 && rr <= R && cc >= 0 && cc <= C && !!sheet?.rows[rr]?.[cc]?.t
    const edge = { r: dr > 0 ? R : dr < 0 ? 0 : r, c: dc > 0 ? C : dc < 0 ? 0 : c }
    let nr = r + dr
    let nc = c + dc
    if (nr < 0 || nr > R || nc < 0 || nc > C) return edge
    if (filled(r, c) && filled(nr, nc)) {
      while (filled(nr + dr, nc + dc)) {
        nr += dr
        nc += dc
      }
      return { r: nr, c: nc }
    }
    while (nr >= 0 && nr <= R && nc >= 0 && nc <= C && !filled(nr, nc)) {
      nr += dr
      nc += dc
    }
    if (nr < 0 || nr > R || nc < 0 || nc > C) return edge
    return { r: nr, c: nc }
  }

  // Seleziona la cella (1×1) e la rende visibile.
  function goTo(r: number, c: number) {
    navFocus.current = { r, c }
    selAnchor.current = { r, c }
    setEditing(null)
    setSelRange({ r1: r, r2: r, c1: c, c2: c })
    ensureVisible(r, c)
  }

  // Muove il fuoco (frecce/Invio/Tab): extend = Shift, jump = Ctrl.
  function moveSel(dr: number, dc: number, extend = false, jump = false) {
    if (!sheet) return
    const base = navFocus.current ?? (selRef.current ? { r: selRef.current.r1, c: selRef.current.c1 } : null)
    if (!base) return
    let r = base.r
    let c = base.c
    if (jump) {
      const t = jumpTarget(r, c, dr, dc)
      r = t.r
      c = t.c
    } else {
      r = Math.max(0, Math.min(rows.length - 1, r + dr))
      c = Math.max(0, Math.min(widths.length - 1, c + dc))
      // salta le righe nascoste dal filtro
      while (dr !== 0 && r > 0 && r < rows.length - 1 && (heights[r] ?? DEFAULT_ROW_PX) === 0) r += dr > 0 ? 1 : -1
    }
    navFocus.current = { r, c }
    if (extend) {
      const a = selAnchor.current ?? base
      setSelRange({ r1: Math.min(a.r, r), r2: Math.max(a.r, r), c1: Math.min(a.c, c), c2: Math.max(a.c, c) })
    } else {
      selAnchor.current = { r, c }
      setSelRange({ r1: r, r2: r, c1: c, c2: c })
    }
    ensureVisible(r, c)
  }

  // Ctrl+D / Ctrl+R: riempi in giù/a destra dalla prima riga/colonna della
  // selezione (o dalla cella sopra/a sinistra se la selezione è singola);
  // le formule si traslano come col fill handle.
  function fillBlock(dir: 'down' | 'right') {
    const sel = selRange
    const ws = wb?.worksheets[active]
    if (!sel || !ws || isCsv) return
    const down = dir === 'down'
    const single = down ? sel.r1 === sel.r2 : sel.c1 === sel.c2
    const src = down ? (single ? sel.r1 - 1 : sel.r1) : single ? sel.c1 - 1 : sel.c1
    if (src < 0) return
    const cells: { r: number; c: number; v: CellValue }[] = []
    const fillOne = (srcR: number, srcC: number, r: number, c: number) => {
      const v = ws.getRow(srcR + 1).getCell(srcC + 1).value
      if (v && typeof v === 'object' && !(v instanceof Date) && 'formula' in v) {
        return { formula: shiftRefsAbs((v as { formula: string }).formula, r - srcR, c - srcC) } as CellValue
      }
      return structuredClone(v)
    }
    if (down) {
      for (let c = sel.c1; c <= sel.c2; c++)
        for (let r = single ? sel.r1 : sel.r1 + 1; r <= sel.r2; r++) cells.push({ r, c, v: fillOne(src, c, r, c) })
    } else {
      for (let r = sel.r1; r <= sel.r2; r++)
        for (let c = single ? sel.c1 : sel.c1 + 1; c <= sel.c2; c++) cells.push({ r, c, v: fillOne(r, src, r, c) })
    }
    writeCells(cells)
  }

  // Doppio click sul fill handle: riempie in giù fin dove arrivano i dati
  // della colonna adiacente (sinistra o destra), come Excel.
  function fillHandleDouble() {
    const sel = selRange
    if (!sel || !sheet || isCsv) return
    const probe = sel.c1 > 0 ? sel.c1 - 1 : sel.c2 + 1
    if (probe >= widths.length) return
    let last = sel.r2
    while (last + 1 < rows.length && sheet.rows[last + 1]?.[probe]?.t) last++
    if (last > sel.r2) applyFill(sel, { r1: sel.r2 + 1, r2: last, c1: sel.c1, c2: sel.c2 })
  }

  // Suggerimenti di funzione mentre scrivi una formula (=SO → SOMMA…).
  function computeSuggest(inp: HTMLInputElement, src: 'cell' | 'fx') {
    const v = inp.value
    if (!v.startsWith('=')) {
      setFxSuggest(null)
      return
    }
    const pos = inp.selectionStart ?? v.length
    const m = /[=(,;+\-*/\s]([A-Za-zÀ-ù][A-Za-zÀ-ù.]*)$/.exec(v.slice(0, pos))
    if (!m) {
      setFxSuggest(null)
      return
    }
    const tok = m[1].toUpperCase()
    const list = FORMULA_NAMES.filter((n) => n.startsWith(tok) && n !== tok).slice(0, 8)
    if (!list.length) {
      setFxSuggest(null)
      return
    }
    const rect = inp.getBoundingClientRect()
    setFxSuggest({
      x: Math.min(rect.left, window.innerWidth - 200),
      y: Math.min(rect.bottom + 2, window.innerHeight - 220),
      list,
      idx: 0,
      start: pos - tok.length,
      end: pos,
      src,
    })
  }

  function applySuggest(inp: HTMLInputElement) {
    if (!fxSuggest) return
    const name = fxSuggest.list[fxSuggest.idx]
    inp.setRangeText(`${name}(`, fxSuggest.start, fxSuggest.end, 'end')
    setFxLive(inp.value)
    if (inp === fxInputRef.current) setFxDraft(inp.value)
    setFxSuggest(null)
    inp.focus()
  }

  // Tasti del dropdown suggerimenti: true = gestito (non proseguire).
  function suggestKeys(e: React.KeyboardEvent<HTMLInputElement>): boolean {
    if (!fxSuggest) return false
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      const d = e.key === 'ArrowDown' ? 1 : fxSuggest.list.length - 1
      setFxSuggest({ ...fxSuggest, idx: (fxSuggest.idx + d) % fxSuggest.list.length })
      return true
    }
    if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      applySuggest(e.currentTarget)
      return true
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setFxSuggest(null)
      return true
    }
    return false
  }

  // F4 mentre scrivi una formula: cicla i $ del riferimento al caret
  // (A1 → $A$1 → A$1 → $A1 → A1), come Excel.
  function cycleRef(inp: HTMLInputElement) {
    const v = inp.value
    if (!v.startsWith('=')) return
    const pos = inp.selectionStart ?? v.length
    const re = /(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})/g
    let best: { s: number; e: number; dc: string; col: string; dr: string; row: string } | null = null
    let m: RegExpExecArray | null
    while ((m = re.exec(v))) {
      const s = m.index
      const e = s + m[0].length
      if (pos >= s && pos <= e) {
        best = { s, e, dc: m[1], col: m[2], dr: m[3], row: m[4] }
        break
      }
      if (e <= pos) best = { s, e, dc: m[1], col: m[2], dr: m[3], row: m[4] }
    }
    if (!best) return
    const { col, row } = best
    const states = [`${col}${row}`, `$${col}$${row}`, `${col}$${row}`, `$${col}${row}`]
    const idx = best.dc && best.dr ? 1 : !best.dc && best.dr ? 2 : best.dc && !best.dr ? 3 : 0
    const next = states[(idx + 1) % 4]
    inp.setRangeText(next, best.s, best.e, 'end')
    setFxLive(inp.value)
    if (inp === fxInputRef.current) setFxDraft(inp.value)
  }

  // ---- Funzioni "pro" della griglia: appunti, ordina, formato, filtro ----

  // Snapshot di stile per appunti/cronologia.
  const styleSnap = (cell: Cell) =>
    JSON.stringify({ numFmt: cell.numFmt, font: cell.font, alignment: cell.alignment, fill: cell.fill, border: cell.border })
  const applyStyleSnap = (cell: Cell, s: string) => {
    const p = JSON.parse(s) as { numFmt?: string; font?: object; alignment?: object; fill?: object; border?: object }
    const t = cell as unknown as { numFmt?: string; font?: object; alignment?: object; fill?: object; border?: object }
    t.numFmt = p.numFmt
    t.font = p.font
    t.alignment = p.alignment
    t.fill = p.fill
    t.border = p.border
  }

  // Copia il range: TSV negli appunti di sistema (per Excel/Sheets e le altre
  // app) + copia RICCA interna (valori/formule/stili). cut = Taglia di Excel:
  // marca soltanto, l'origine si svuota quando incolli.
  function copyRange(sel: Range, cut = false) {
    if (!sheet) return
    const ws = wb?.worksheets[active]
    const lines: string[] = []
    const cells: { v: CellValue; style: string }[][] = []
    for (let r = sel.r1; r <= sel.r2; r++) {
      const line: string[] = []
      const rowCells: { v: CellValue; style: string }[] = []
      for (let c = sel.c1; c <= sel.c2; c++) {
        line.push(sheet.rows[r]?.[c]?.t ?? '')
        if (ws && !isCsv) {
          const cell = ws.getRow(r + 1).getCell(c + 1)
          rowCells.push({ v: structuredClone(cell.value), style: styleSnap(cell) })
        }
      }
      lines.push(line.join('\t'))
      cells.push(rowCells)
    }
    const text = lines.join('\n')
    xlsxClipboard = ws && !isCsv ? { text, cut, srcPath: filePath, sheet: active, r: sel.r1, c: sel.c1, cells } : null
    navigator.clipboard.writeText(text).catch(() => {})
  }

  // Cancella il contenuto del range (annullabile con Ctrl+Z).
  function clearRange(sel: Range) {
    const cells: { r: number; c: number; v: CellValue }[] = []
    for (let r = sel.r1; r <= sel.r2; r++)
      for (let c = sel.c1; c <= sel.c2; c++) cells.push({ r, c, v: null })
    writeCells(cells)
  }

  function cutRange(sel: Range) {
    copyRange(sel, true)
  }

  // Incolla: se il testo di sistema è ancora la NOSTRA ultima copia → incolla
  // ricco (formule traslate + stili); altrimenti TSV esterno.
  function pasteFromClipboard(sel: Range) {
    navigator.clipboard
      .readText()
      .then((text) => {
        if (!text) return
        const norm = text.replace(/\r/g, '').replace(/\n$/, '')
        const clip = xlsxClipboard
        if (clip && clip.text === norm && !isCsv) pasteRich(sel, clip)
        else pasteMatrix(sel.r1, sel.c1, text)
      })
      .catch((err) => console.error('Incolla:', err))
  }

  // Incolla ricco: formule con riferimenti traslati ($ rispettati), stili,
  // e — se era un Taglia dallo stesso foglio — svuota l'origine, tutto in
  // UNA operazione di cronologia.
  function pasteRich(target: Range, clip: NonNullable<typeof xlsxClipboard>) {
    const ws = wb?.worksheets[active]
    if (!ws) return
    setEditing(null)
    const dr = target.r1 - clip.r
    const dc = target.c1 - clip.c
    const op: HistOp = { sheet: active, cells: [], styles: [] }
    const emptyStyle = JSON.stringify({})
    if (clip.cut && clip.srcPath === filePath && clip.sheet === active) {
      clip.cells.forEach((rowCells, i) =>
        rowCells.forEach((_src, j) => {
          const cell = ws.getRow(clip.r + i + 1).getCell(clip.c + j + 1)
          op.cells.push({ r: clip.r + i, c: clip.c + j, before: cell.value, after: null })
          op.styles!.push({ r: clip.r + i, c: clip.c + j, before: styleSnap(cell), after: emptyStyle })
          cell.value = null
          applyStyleSnap(cell, emptyStyle)
        }),
      )
    }
    clip.cells.forEach((rowCells, i) =>
      rowCells.forEach((src, j) => {
        const r = target.r1 + i
        const c = target.c1 + j
        if (r >= MAX_ROWS || c >= MAX_COLS) return
        const cell = ws.getRow(r + 1).getCell(c + 1)
        op.cells.push({ r, c, before: cell.value, after: null })
        op.styles!.push({ r, c, before: styleSnap(cell), after: src.style })
        let v = structuredClone(src.v)
        if (v && typeof v === 'object' && !(v instanceof Date) && 'formula' in v) {
          v = { formula: shiftRefsAbs((v as { formula: string }).formula, dr, dc) } as CellValue // result dal ricalcolo
        }
        cell.value = v
        op.cells[op.cells.length - 1].after = v
        applyStyleSnap(cell, src.style)
      }),
    )
    if (clip.cut) xlsxClipboard = null // il Taglia si incolla UNA volta, come Excel
    rebuildActive()
    markDirty()
    const h = xlsxHistory.get(filePath) ?? { undo: [], redo: [] }
    h.undo.push(op)
    if (h.undo.length > 100) h.undo.shift()
    h.redo = []
    xlsxHistory.set(filePath, h)
    void recalcAndRefresh()
    setSelRange({
      r1: target.r1,
      c1: target.c1,
      r2: Math.min(target.r1 + clip.cells.length - 1, MAX_ROWS - 1),
      c2: Math.min(target.c1 + (clip.cells[0]?.length ?? 1) - 1, MAX_COLS - 1),
    })
  }

  // Ordina le righe del range per la colonna cliccata (i VALORI si spostano
  // insieme per riga; gli stili restano al loro posto, come "Ordina intervallo"
  // di Sheets). Una sola operazione in cronologia → annullabile.
  function sortRange(sel: Range, byC: number, asc: boolean) {
    const ws = wb?.worksheets[active]
    if (!ws || sel.r2 <= sel.r1) return
    const col = byC >= sel.c1 && byC <= sel.c2 ? byC : sel.c1
    const matrix: CellValue[][] = []
    for (let r = sel.r1; r <= sel.r2; r++) {
      const rv: CellValue[] = []
      for (let c = sel.c1; c <= sel.c2; c++) rv.push(ws.getRow(r + 1).getCell(c + 1).value)
      matrix.push(rv)
    }
    const order = matrix.map((_, i) => i)
    order.sort((a, b) => compareCells(matrix[a][col - sel.c1], matrix[b][col - sel.c1], asc) || a - b)
    const cells: { r: number; c: number; v: CellValue }[] = []
    order.forEach((src, i) => {
      matrix[src].forEach((v, j) => cells.push({ r: sel.r1 + i, c: sel.c1 + j, v }))
    })
    writeCells(cells)
  }

  // Applica una modifica di FORMATO alle celle selezionate registrandola in
  // cronologia (snapshot font/fill/alignment/numFmt/border prima e dopo).
  // Con alsoClearValues azzera anche i VALORI nella stessa operazione
  // (il "Cancella tutto" del tasto Canc: un solo Ctrl+Z ripristina tutto).
  function styleCells(mutate: (cell: Cell, r: number, c: number) => void, alsoClearValues = false) {
    const ws = wb?.worksheets[active]
    const sel = selRange ?? (editing ? { r1: editing.r, c1: editing.c, r2: editing.r, c2: editing.c } : null)
    if (!ws || !sel || isCsv) return
    const snap = (cell: Cell) =>
      JSON.stringify({ numFmt: cell.numFmt, font: cell.font, alignment: cell.alignment, fill: cell.fill, border: cell.border })
    const record = (sel.r2 - sel.r1 + 1) * (sel.c2 - sel.c1 + 1) <= 20_000 // selezioni enormi: senza cronologia
    const op: HistOp = { sheet: active, cells: [], styles: [] }
    for (let r = sel.r1; r <= sel.r2; r++)
      for (let c = sel.c1; c <= sel.c2; c++) {
        const cell = ws.getRow(r + 1).getCell(c + 1)
        const before = record ? snap(cell) : ''
        if (alsoClearValues) {
          if (record) op.cells.push({ r, c, before: cell.value, after: null })
          cell.value = null
        }
        mutate(cell, r, c)
        if (record) op.styles!.push({ r, c, before, after: snap(cell) })
      }
    rebuildActive()
    markDirty()
    if (record) {
      const h = xlsxHistory.get(filePath) ?? { undo: [], redo: [] }
      h.undo.push(op)
      if (h.undo.length > 100) h.undo.shift()
      h.redo = []
      xlsxHistory.set(filePath, h)
    } else {
      xlsxHistory.delete(filePath)
    }
    if (alsoClearValues) void recalcAndRefresh() // le formule dipendenti si aggiornano
  }

  // Azzera il solo FORMATO (font/riempimento/bordi/allineamento/formato numero).
  const wipeFormat = (cell: Cell) => {
    const c = cell as unknown as { font?: object; fill?: object; alignment?: object; border?: object; numFmt?: string }
    c.font = undefined
    c.fill = undefined
    c.alignment = undefined
    c.border = undefined
    c.numFmt = undefined
  }

  // Applica bordi alla selezione: 'all' su ogni cella, 'outline' solo sul
  // perimetro, singoli lati, o 'none' per toglierli. Stile+colore dal dialog.
  function applyBorders(preset: 'all' | 'outline' | 'top' | 'bottom' | 'left' | 'right' | 'none') {
    const sel = selRange ?? (editing ? { r1: editing.r, c1: editing.c, r2: editing.r, c2: editing.c } : null)
    if (!sel) return
    const side = { style: bStyle, color: { argb: `FF${bColor.slice(1).toUpperCase()}` } } as NonNullable<Cell['border']>['top']
    styleCells((cell, r, c) => {
      if (preset === 'none') {
        cell.border = {}
        return
      }
      const b = { ...cell.border }
      if (preset === 'all' || preset === 'top' || (preset === 'outline' && r === sel.r1)) b.top = side
      if (preset === 'all' || preset === 'bottom' || (preset === 'outline' && r === sel.r2)) b.bottom = side
      if (preset === 'all' || preset === 'left' || (preset === 'outline' && c === sel.c1)) b.left = side
      if (preset === 'all' || preset === 'right' || (preset === 'outline' && c === sel.c2)) b.right = side
      cell.border = b
    })
  }

  // "Formatta come tabella": intestazione piena, righe alternate, bordi.
  function applyTableStyle(p: (typeof TABLE_STYLES)[number]) {
    const sel = selRange
    if (!sel || sel.r2 <= sel.r1) return
    styleCells((cell, r) => {
      const side = { style: 'thin', color: { argb: p.border } } as NonNullable<Cell['border']>['top']
      cell.border = { top: side, bottom: side, left: side, right: side }
      if (r === sel.r1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: p.head } }
        cell.font = { ...cell.font, bold: true, color: { argb: 'FFFFFFFF' } }
      } else if ((r - sel.r1) % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: p.band } }
      } else {
        cell.fill = { type: 'pattern', pattern: 'none' }
      }
    })
  }

  // Imposta/rimuove i riquadri bloccati (scritti nel file: ws.views frozen,
  // quindi round-trip in Excel/Sheets).
  function setFrozen(nRows: number, nCols: number) {
    const ws = wb?.worksheets[active]
    if (!ws) return
    const prev = { ...((ws.views?.[0] ?? {}) as Record<string, unknown>) }
    if (nRows > 0 || nCols > 0) {
      ws.views = [{ ...prev, state: 'frozen', xSplit: nCols || 0, ySplit: nRows || 0 }] as typeof ws.views
    } else {
      delete prev.xSplit
      delete prev.ySplit
      ws.views = [{ ...prev, state: 'normal' }] as typeof ws.views
    }
    rebuildActive()
    markDirty()
  }

  // Doppio click sul bordo dell'intestazione colonna: larghezza auto-adattata
  // al contenuto (misura del testo col font reale, come Excel).
  function autoFitCol(c: number) {
    const ws = wb?.worksheets[active]
    if (!sheet || !ws || isCsv) return
    let w = 40
    let seen = 0
    for (let r = 0; r < sheet.rows.length && seen < 3000; r++) {
      const cd = sheet.rows[r]?.[c]
      if (!cd?.t || cd.cs) continue // le celle unite non contano
      seen++
      w = Math.max(w, Math.ceil(textWidth(cd.t, cd.fs ?? 13, cd.b)) + 16)
    }
    w = Math.min(w, 500)
    ws.getColumn(c + 1).width = Math.max(1, (w - 5) / 7)
    rebuildActive()
    markDirty()
  }

  // Crea il filtro: intestazione = riga cliccata (o prima riga della selezione),
  // esteso alle colonne piene e fino all'ultima riga di dati. Scritto come
  // autoFilter nel workbook → round-trip in Excel/Sheets.
  function createFilter(sel: Range, clickedR: number) {
    const ws = wb?.worksheets[active]
    if (!ws) return
    let r = clickedR
    let c1 = 0
    let c2 = 0
    let rEnd = 0
    if (sel.r2 > sel.r1) {
      r = sel.r1
      c1 = sel.c1
      c2 = sel.c2
      rEnd = sel.r2
    } else {
      // deriva l'estensione dalle celle piene della riga cliccata
      let first = -1
      let last = -1
      ws.getRow(r + 1).eachCell({ includeEmpty: false }, (cell, c) => {
        if (cell.value !== null && cell.value !== undefined && cell.value !== '') {
          if (first < 0) first = c - 1
          last = c - 1
        }
      })
      if (first < 0) {
        first = 0
        last = Math.max(0, (ws.columnCount || 1) - 1)
      }
      c1 = first
      c2 = last
      rEnd = Math.min(Math.max(ws.rowCount || r + 1, r + 2) - 1, MAX_ROWS - 1)
    }
    ws.autoFilter = `${colLetter(c1 + 1)}${r + 1}:${colLetter(c2 + 1)}${rEnd + 1}`
    rebuildActive()
    markDirty()
  }

  function removeFilter() {
    const ws = wb?.worksheets[active]
    const f = sheet?.filter
    if (!ws || !f) return
    for (let r = f.r + 1; r <= Math.min(f.r2, MAX_ROWS - 1); r++) ws.getRow(r + 1).hidden = false
    ws.autoFilter = undefined
    xlsxFilters.delete(`${filePath}#${active}`)
    setFilterMenu(null)
    rebuildActive()
    markDirty()
  }

  // Ricalcola le righe nascoste dai criteri correnti (testi esclusi per colonna).
  function applyFilterRows() {
    const ws = wb?.worksheets[active]
    const f = sheet?.filter
    if (!ws || !f) return
    const map = xlsxFilters.get(`${filePath}#${active}`)
    const rEnd = Math.min(f.r2, MAX_ROWS - 1)
    for (let r = f.r + 1; r <= rEnd; r++) {
      let hide = false
      if (map) {
        for (const [c, set] of map) {
          if (!set.size || c < f.c1 || c > f.c2) continue
          const cell = ws.getRow(r + 1).getCell(c + 1)
          if (set.has(cellText(cell.value, cell.numFmt).text)) {
            hide = true
            break
          }
        }
      }
      ws.getRow(r + 1).hidden = hide
    }
    rebuildActive()
    markDirty()
  }

  // ---- Gestione fogli ----

  function addSheet() {
    if (!wb) return
    try {
      wb.addWorksheet(`Foglio ${wb.worksheets.length + 1}`)
    } catch (e) {
      console.error('Nuovo foglio:', e)
      return
    }
    setSheetNames(wb.worksheets.map((w) => w.name))
    markDirty()
    selectSheet(wb.worksheets.length - 1)
  }

  function renameSheet(i: number, name: string) {
    setRenamingSheet(null)
    const ws = wb?.worksheets[i]
    const clean = name.trim()
    if (!ws || !clean || clean === ws.name) return
    try {
      ws.name = clean.slice(0, 31) // limite Excel
      setSheetNames(wb!.worksheets.map((w) => w.name))
      markDirty()
    } catch (e) {
      console.error('Rinomina foglio:', e)
    }
  }

  async function removeSheet(i: number) {
    if (!wb || wb.worksheets.length <= 1) return
    const { confirm } = await import('@tauri-apps/plugin-dialog')
    const ok = await confirm(`Eliminare il foglio "${wb.worksheets[i].name}"?`, { title: 'Atelier', kind: 'warning' })
    if (!ok) return
    wb.removeWorksheet(wb.worksheets[i].id)
    cacheRef.current.clear() // gli indici dei fogli slittano
    setSheetNames(wb.worksheets.map((w) => w.name))
    markDirty()
    selectSheet(Math.min(i, wb.worksheets.length - 1))
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
      xlsxWbBuffers.delete(filePath)
      setDirty(false)
      clearBuffer(filePath)
    } catch (e) {
      console.error('Salvataggio xlsx:', e)
    } finally {
      setSaving(false)
    }
  }

  // Ctrl+S salva; Ctrl+Z / Ctrl+Y (o Ctrl+Shift+Z) annulla/ripeti.
  const saveRef = useRef(save)
  saveRef.current = save
  const undoRedoRef = useRef(undoRedo)
  undoRedoRef.current = undoRedo
  useEffect(() => {
    if (isCsv) return
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 's') {
        e.preventDefault()
        saveRef.current()
      } else if (k === 'z' && !e.shiftKey) {
        if ((e.target as HTMLElement)?.tagName === 'INPUT') return // undo dell'input
        e.preventDefault()
        undoRedoRef.current(false)
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        if ((e.target as HTMLElement)?.tagName === 'INPUT') return
        e.preventDefault()
        undoRedoRef.current(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isCsv])

  // Selezione multi-cella: Ctrl+C copia come TSV (incollabile in Excel),
  // Canc svuota le celle, Esc deseleziona.
  const selRef = useRef(selRange)
  selRef.current = selRange
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Tasti digitati in un input/select (barra formula, dialog, filtri):
      // mai interpretarli come comandi della griglia.
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      const sel = selRef.current
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !isCsv) {
        // Ctrl+F = trova nel foglio (funziona anche senza selezione)
        e.preventDefault()
        setFindQ((q) => q ?? '')
        setTimeout(() => findInputRef.current?.focus(), 0)
        return
      }
      if (e.key === 'Escape') {
        // chiudi prima i pannelli aperti, poi la selezione
        if (fmtDialog) setFmtDialog(false)
        else if (tableMenu) setTableMenu(null)
        else if (delMenu) setDelMenu(null)
        else if (findQ !== null) setFindQ(null)
        else setSelRange(null)
        return
      }
      if (!sel || editing) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        if (!sheet) return
        e.preventDefault()
        copyRange(sel)
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
        if (isCsv || !sheet) return
        e.preventDefault()
        cutRange(sel)
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        if (isCsv) return
        e.preventDefault()
        pasteFromClipboard(sel)
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        if (isCsv) return
        e.preventDefault()
        fillBlock('down') // riempi in giù, come Excel
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
        if (isCsv) return
        e.preventDefault()
        fillBlock('right')
      } else if (e.key === 'Backspace') {
        // Backspace = cancella SOLO il contenuto, diretto (annullabile)
        if (isCsv) return
        e.preventDefault()
        clearRange(sel)
      } else if (e.key === 'Delete') {
        // Canc = mini-menu: cosa cancellare? (contenuto/formato/tutto)
        if (isCsv) return
        e.preventDefault()
        const rect = scrollRef.current?.getBoundingClientRect()
        const x = rect ? rect.left + colX(sel.c1) - (scrollRef.current?.scrollLeft ?? 0) : window.innerWidth / 2
        const y = rect ? rect.top + ROW_H + (offsets[sel.r2 + 1] ?? 0) - (scrollRef.current?.scrollTop ?? 0) + 4 : window.innerHeight / 2
        setDelMenu({
          x: Math.max(8, Math.min(x, window.innerWidth - 210)),
          y: Math.max(8, Math.min(y, window.innerHeight - 160)),
        })
      } else if (e.key.startsWith('Arrow')) {
        // Frecce: muovono il fuoco; Shift estende, Ctrl salta ai bordi dei dati
        e.preventDefault()
        const dr = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
        const dc = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
        moveSel(dr, dc, e.shiftKey, e.ctrlKey || e.metaKey)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        moveSel(e.shiftKey ? -1 : 1, 0)
      } else if (e.key === 'Tab') {
        e.preventDefault()
        moveSel(0, e.shiftKey ? -1 : 1)
      } else if (e.key === 'PageDown' || e.key === 'PageUp') {
        e.preventDefault()
        const n = Math.max(3, Math.floor((scrollRef.current?.clientHeight ?? 480) / 24) - 2)
        moveSel(e.key === 'PageDown' ? n : -n, 0, e.shiftKey)
      } else if (e.key === 'Home') {
        e.preventDefault()
        const f = navFocus.current ?? { r: sel.r1, c: sel.c1 }
        goTo(e.ctrlKey || e.metaKey ? 0 : f.r, 0)
      } else if (e.key === 'F2') {
        if (isCsv) return
        e.preventDefault()
        const f = navFocus.current ?? { r: sel.r1, c: sel.c1 }
        startEdit(f.r, f.c, null)
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        // Ctrl+A = seleziona tutta la griglia
        e.preventDefault()
        selAnchor.current = { r: 0, c: 0 }
        navFocus.current = { r: rows.length - 1, c: widths.length - 1 }
        setSelRange({ r1: 0, c1: 0, r2: rows.length - 1, c2: widths.length - 1 })
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // scrivi-per-sostituire: digitare su una cella selezionata inizia
        // l'editing col carattere digitato (come Excel)
        if (isCsv) return
        e.preventDefault()
        const f = navFocus.current ?? { r: sel.r1, c: sel.c1 }
        startEdit(f.r, f.c, e.key)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, wb, active, sheet, isCsv, fmtDialog, tableMenu, delMenu, findQ])

  // Cambiando cella/foglio/file, le bozze della barra formula si azzerano.
  useEffect(() => {
    setFxDraft(null)
    setNameDraft(null)
  }, [selRange?.r1, selRange?.c1, editing?.r, editing?.c, active, filePath])

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
  // Ascissa (px) dell'inizio della colonna c, header righe incluso.
  const colX = (cc: number) => {
    let x = ROW_HDR_W
    for (let i = 0; i < cc && i < widths.length; i++) x += widths[i]
    return x
  }
  // Bersaglio della toolbar formato: selezione, o la cella in modifica.
  const fmtTarget = selRange ?? (editing ? { r1: editing.r, c1: editing.c, r2: editing.r, c2: editing.c } : null)
  // Cella "ancora" (prima del range): dà lo stato corrente ai controlli.
  const anchorCell = fmtTarget && wb && !isCsv ? wb.worksheets[active]?.getRow(fmtTarget.r1 + 1).getCell(fmtTarget.c1 + 1) : null
  const aFont = anchorCell?.font
  const aFmt = anchorCell?.numFmt
  const fmtKind = !aFmt ? 'auto' : aFmt.includes('%') ? 'perc' : aFmt.includes('€') ? 'eur' : /0\.00/.test(aFmt) ? 'num' : 'auto'
  // Statistiche della selezione per la barra di stato (Somma/Media/Conteggio),
  // il riflesso condizionato di chi usa Excel.
  const selStats = useMemo(() => {
    if (!selRange || !wb || isCsv) return null
    const ws = wb.worksheets[active]
    if (!ws) return null
    const n = (selRange.r2 - selRange.r1 + 1) * (selRange.c2 - selRange.c1 + 1)
    if (n < 2 || n > 200_000) return null
    let sum = 0
    let nums = 0
    let cnt = 0
    for (let r = selRange.r1; r <= selRange.r2; r++)
      for (let c = selRange.c1; c <= selRange.c2; c++) {
        const v = ws.getRow(r + 1).getCell(c + 1).value
        if (v === null || v === undefined || v === '') continue
        cnt++
        if (v instanceof Date) continue
        const x =
          typeof v === 'number'
            ? v
            : typeof v === 'object' && 'result' in v && typeof (v as { result?: unknown }).result === 'number'
              ? (v as { result: number }).result
              : undefined
        if (typeof x === 'number') {
          sum += x
          nums++
        }
      }
    return cnt ? { sum, nums, cnt } : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selRange, wb, active, isCsv, sheet])

  // Risultati della ricerca nel foglio (Ctrl+F), max 500.
  const findMatches = useMemo(() => {
    if (!findQ || !sheet) return []
    const q = findQ.toLowerCase()
    const out: { r: number; c: number }[] = []
    for (let r = 0; r < sheet.rows.length && out.length < 500; r++) {
      const row = sheet.rows[r]
      for (let c = 0; c < row.length; c++) {
        if (row[c].t && row[c].t.toLowerCase().includes(q)) {
          out.push({ r, c })
          if (out.length >= 500) break
        }
      }
    }
    return out
  }, [findQ, sheet])
  const findQlc = findQ ? findQ.toLowerCase() : ''

  function findNext(dir: 1 | -1) {
    if (!findMatches.length) return
    const i = (findIdx + dir + findMatches.length) % findMatches.length
    setFindIdx(i)
    goTo(findMatches[i].r, findMatches[i].c)
  }

  // Modalità formula attiva: token colorati + riquadri sui riferimenti.
  const fxColors = fxLive && fxLive.startsWith('=') ? parseFormulaRefs(fxLive.slice(1)) : null
  const refColorOf = (key: string) => REF_COLORS[(fxColors?.refs.get(key) ?? 0) % REF_COLORS.length]
  const fxMirror = (cls: string, style: React.CSSProperties) =>
    fxColors && (
      <div aria-hidden className={cls} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', whiteSpace: 'pre', ...style }}>
        <span>=</span>
        {fxColors.tokens.map((tk, i) =>
          tk.ref !== undefined ? (
            <span key={i} style={{ color: refColorOf(tk.ref) }}>
              {tk.t}
            </span>
          ) : (
            <span key={i}>{tk.t}</span>
          ),
        )}
      </div>
    )
  // Finestra visibile con altezze variabili: ricerca binaria sui prefissi.
  const start = Math.max(0, rowAt(offsets, scrollTop) - 5)
  const end = Math.min(rows.length, rowAt(offsets, scrollTop + viewH) + 6)
  // Riquadri bloccati: le prime N righe/M colonne restano sticky; le righe
  // bloccate si renderizzano SEMPRE (fuori dalla finestra virtualizzata).
  const frozenR = !isCsv ? Math.min(sheet?.frozen?.rows ?? 0, rows.length) : 0
  const frozenC = !isCsv ? Math.min(sheet?.frozen?.cols ?? 0, widths.length) : 0
  const frozenH = offsets[frozenR] ?? 0
  const windowStart = Math.max(start, frozenR)
  const hdrBg = '#f4f4f5'
  const gridLine = '1px solid #d4d4d8'

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
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

      {/* Toolbar formato celle (funzioni pro): agisce sulla selezione */}
      {!isCsv && !loading && !error && sheet && (
        <div
          className="px-2 py-1 border-b border-zinc-800 bg-zinc-900/60 flex items-center gap-1 shrink-0 text-xs text-zinc-300 overflow-x-auto"
          // niente perdita di focus/selezione cliccando i bottoni (i select e i
          // color picker invece hanno bisogno del mousedown nativo)
          onMouseDown={(e) => {
            const tag = (e.target as HTMLElement).tagName
            if (tag !== 'SELECT' && tag !== 'INPUT') e.preventDefault()
          }}
        >
          {(
            [
              ['G', 'Grassetto', <b key="g">G</b>, !!aFont?.bold, () => styleCells((cell) => (cell.font = { ...cell.font, bold: !aFont?.bold }))],
              ['C', 'Corsivo', <i key="c">C</i>, !!aFont?.italic, () => styleCells((cell) => (cell.font = { ...cell.font, italic: !aFont?.italic }))],
              [
                'S',
                'Sottolineato',
                <u key="s">S</u>,
                !!aFont?.underline && aFont.underline !== 'none',
                () => styleCells((cell) => (cell.font = { ...cell.font, underline: !(aFont?.underline && aFont.underline !== 'none') })),
              ],
              ['B', 'Barrato', <s key="b">B</s>, !!aFont?.strike, () => styleCells((cell) => (cell.font = { ...cell.font, strike: !aFont?.strike }))],
            ] as [string, string, React.ReactNode, boolean, () => void][]
          ).map(([key, title, label, on, fn]) => (
            <button
              key={key}
              title={title}
              disabled={!fmtTarget}
              className={`px-2 py-0.5 rounded min-w-7 ${on ? 'bg-zinc-600 text-white' : 'hover:bg-zinc-700'} disabled:opacity-40 disabled:hover:bg-transparent`}
              onClick={fn}
            >
              {label}
            </button>
          ))}
          <div className="w-px h-4 bg-zinc-700 mx-1 shrink-0" />
          <select
            title="Dimensione carattere"
            disabled={!fmtTarget}
            className="bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5 disabled:opacity-40"
            value={aFont?.size ?? 10}
            onChange={(e) => {
              const size = Number(e.target.value)
              styleCells((cell) => (cell.font = { ...cell.font, size }))
            }}
          >
            {[...new Set([6, 8, 9, 10, 11, 12, 14, 16, 18, 24, 36, aFont?.size ?? 10])]
              .sort((a, b) => a - b)
              .map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
          </select>
          <div className="w-px h-4 bg-zinc-700 mx-1 shrink-0" />
          <label className="flex items-center gap-1 cursor-pointer" title="Colore testo">
            <span className={fmtTarget ? '' : 'opacity-40'}>A</span>
            <input
              type="color"
              disabled={!fmtTarget}
              className="w-6 h-5 p-0 border-0 bg-transparent cursor-pointer disabled:opacity-40"
              defaultValue="#1f2937"
              onChange={(e) => {
                const argb = `FF${e.target.value.slice(1).toUpperCase()}`
                styleCells((cell) => (cell.font = { ...cell.font, color: { argb } }))
              }}
            />
          </label>
          <label className="flex items-center gap-1 cursor-pointer" title="Colore riempimento">
            <span className={fmtTarget ? '' : 'opacity-40'}>🪣</span>
            <input
              type="color"
              disabled={!fmtTarget}
              className="w-6 h-5 p-0 border-0 bg-transparent cursor-pointer disabled:opacity-40"
              defaultValue="#fff2cc"
              onChange={(e) => {
                const argb = `FF${e.target.value.slice(1).toUpperCase()}`
                styleCells((cell) => (cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }))
              }}
            />
          </label>
          <button
            title="Nessun riempimento"
            disabled={!fmtTarget}
            className="px-1.5 py-0.5 rounded hover:bg-zinc-700 disabled:opacity-40 disabled:hover:bg-transparent"
            onClick={() => styleCells((cell) => (cell.fill = { type: 'pattern', pattern: 'none' }))}
          >
            ⌀
          </button>
          <div className="w-px h-4 bg-zinc-700 mx-1 shrink-0" />
          <select
            title="Allineamento orizzontale"
            disabled={!fmtTarget}
            className="bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5 disabled:opacity-40"
            value={anchorCell?.alignment?.horizontal ?? ''}
            onChange={(e) => {
              const h = e.target.value as '' | 'left' | 'center' | 'right'
              styleCells((cell) => (cell.alignment = { ...cell.alignment, horizontal: h === '' ? undefined : h }))
            }}
          >
            <option value="">Allinea: auto</option>
            <option value="left">Sinistra</option>
            <option value="center">Centro</option>
            <option value="right">Destra</option>
          </select>
          <select
            title="Formato numero"
            disabled={!fmtTarget}
            className="bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5 disabled:opacity-40"
            value={fmtKind}
            onChange={(e) => {
              const fmt =
                e.target.value === 'num' ? '#,##0.00' : e.target.value === 'perc' ? '0.00%' : e.target.value === 'eur' ? '#,##0.00 "€"' : undefined
              styleCells((cell) => ((cell as unknown as { numFmt?: string }).numFmt = fmt))
            }}
          >
            <option value="auto">Formato: automatico</option>
            <option value="num">Numero (0,00)</option>
            <option value="perc">Percentuale</option>
            <option value="eur">Valuta (€)</option>
          </select>
          <div className="w-px h-4 bg-zinc-700 mx-1 shrink-0" />
          <button
            title="Bordi, riempimento e gradiente"
            disabled={!fmtTarget}
            className="px-2 py-0.5 rounded hover:bg-zinc-700 disabled:opacity-40 disabled:hover:bg-transparent whitespace-nowrap"
            onClick={() => setFmtDialog(true)}
          >
            ⊞ Formato celle
          </button>
          <button
            title="Formatta la selezione come tabella (intestazione + righe alternate)"
            disabled={!selRange || selRange.r2 <= selRange.r1}
            className="px-2 py-0.5 rounded hover:bg-zinc-700 disabled:opacity-40 disabled:hover:bg-transparent whitespace-nowrap"
            onClick={(e) => setTableMenu({ x: e.clientX, y: e.clientY })}
          >
            🗔 Tabella
          </button>
        </div>
      )}

      {/* Barra della formula (casella nome + fx), come Excel */}
      {!isCsv && !loading && !error && sheet && (
        <div className="px-2 py-1 border-b border-zinc-800 flex items-center gap-2 shrink-0 text-xs">
          <input
            title="Cella attiva — scrivi un riferimento (es. B12) e premi Invio per saltarci"
            className="w-16 bg-zinc-800 border border-zinc-700 rounded px-1 py-1 text-zinc-200 text-center outline-none focus:border-zinc-500"
            value={nameDraft ?? (fmtTarget ? `${colLetter(fmtTarget.c1 + 1)}${fmtTarget.r1 + 1}` : '')}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const m = /^([A-Za-z]{1,3})(\d{1,7})$/.exec((nameDraft ?? '').trim())
                if (m) {
                  const c0 = Math.min(colIndex(m[1].toUpperCase()), widths.length) - 1
                  const r0 = Math.min(Number(m[2]), rows.length) - 1
                  if (r0 >= 0 && c0 >= 0) {
                    setEditing(null)
                    setSelRange({ r1: r0, r2: r0, c1: c0, c2: c0 })
                    scrollRef.current?.scrollTo({ top: Math.max(0, (offsets[r0] ?? 0) - 100), left: Math.max(0, colX(c0) - ROW_HDR_W - 100) })
                  }
                }
                setNameDraft(null)
                e.currentTarget.blur()
              } else if (e.key === 'Escape') {
                setNameDraft(null)
                e.currentTarget.blur()
              }
            }}
            onBlur={() => setNameDraft(null)}
          />
          <span className="text-zinc-500 italic font-serif shrink-0">fx</span>
          <div className="flex-1 relative">
            <input
              ref={fxInputRef}
              title="Contenuto della cella — Invio applica, Esc annulla"
              disabled={!fmtTarget || !!editing}
              placeholder={editing ? 'Stai scrivendo nella cella…' : fmtTarget ? '' : 'Seleziona una cella'}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 font-mono outline-none focus:border-zinc-500 disabled:opacity-50"
              style={{ color: fxColors && !editing ? 'transparent' : '#e4e4e7', caretColor: '#e4e4e7' }}
              value={editing ? '' : (fxDraft ?? (anchorCell ? rawOf(anchorCell) : ''))}
              onChange={(e) => {
                setFxDraft(e.target.value)
                setFxLive(e.target.value.startsWith('=') ? e.target.value : null)
                computeSuggest(e.currentTarget, 'fx')
              }}
              onKeyDown={(e) => {
                if (suggestKeys(e)) return
                if (e.key === 'F4') {
                  e.preventDefault()
                  cycleRef(e.currentTarget)
                  return
                }
                if (e.key === 'Enter' && fmtTarget && fxDraft !== null) {
                  commitEdit(fmtTarget.r1, fmtTarget.c1, fxDraft)
                  setFxDraft(null)
                  e.currentTarget.blur()
                } else if (e.key === 'Escape') {
                  setFxDraft(null)
                  setFxLive(null)
                  e.currentTarget.blur()
                }
              }}
              onBlur={() => {
                setFxDraft(null)
                setFxLive(null)
                setFxSuggest(null)
              }}
            />
            {!editing &&
              fxMirror('px-2 py-1 font-mono text-xs border border-transparent rounded', { color: '#e4e4e7', lineHeight: '16px' })}
          </div>
        </div>
      )}

      {/* Barra di ricerca nel foglio (Ctrl+F) */}
      {findQ !== null && !isCsv && (
        <div className="absolute right-4 top-24 z-30 flex items-center gap-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl px-2 py-1 text-xs">
          <input
            ref={findInputRef}
            autoFocus
            placeholder="Trova nel foglio…"
            className="w-40 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-200 outline-none focus:border-zinc-500"
            value={findQ}
            onChange={(e) => {
              setFindQ(e.target.value)
              setFindIdx(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') findNext(e.shiftKey ? -1 : 1)
              else if (e.key === 'Escape') setFindQ(null)
            }}
          />
          <span className="text-zinc-400 whitespace-nowrap min-w-12 text-center">
            {findQ ? (findMatches.length ? `${findIdx + 1} di ${findMatches.length}${findMatches.length >= 500 ? '+' : ''}` : '0') : ''}
          </span>
          <button className="px-1.5 py-0.5 rounded hover:bg-zinc-700 text-zinc-300" title="Precedente (Shift+Invio)" onClick={() => findNext(-1)}>
            ↑
          </button>
          <button className="px-1.5 py-0.5 rounded hover:bg-zinc-700 text-zinc-300" title="Successivo (Invio)" onClick={() => findNext(1)}>
            ↓
          </button>
          <button className="px-1.5 py-0.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-200" title="Chiudi (Esc)" onClick={() => setFindQ(null)}>
            ✕
          </button>
        </div>
      )}

      {/* Dropdown autocompletamento funzioni */}
      {fxSuggest && (
        <div
          className="fixed z-50 w-48 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1 text-xs"
          style={{ left: fxSuggest.x, top: fxSuggest.y }}
          onMouseDown={(e) => e.preventDefault() /* niente blur dell'input */}
        >
          {fxSuggest.list.map((n, i) => (
            <button
              key={n}
              className={`w-full text-left px-3 py-1 font-mono ${i === fxSuggest.idx ? 'bg-zinc-600 text-white' : 'text-zinc-200 hover:bg-zinc-700'}`}
              onMouseEnter={() => setFxSuggest({ ...fxSuggest, idx: i })}
              onClick={() => {
                const inp = fxSuggest.src === 'cell' ? editInputRef.current : fxInputRef.current
                if (inp) applySuggest(inp)
              }}
            >
              {n}(
            </button>
          ))}
        </div>
      )}

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
          <div style={{ width: totalW, position: 'relative' }}>
            {/* Intestazioni colonna (A, B, C…): sticky in alto */}
            <div className="sticky top-0 z-20 flex" style={{ height: ROW_H, background: hdrBg }}>
              <div
                className="sticky left-0 z-10 shrink-0"
                style={{ width: ROW_HDR_W, background: hdrBg, borderRight: gridLine, borderBottom: gridLine }}
              />
              {widths.map((w, c) => (
                <div
                  key={c}
                  className="relative shrink-0 text-center text-[11px] leading-6 text-zinc-500 font-medium select-none cursor-pointer hover:bg-zinc-200/60"
                  style={{
                    width: w,
                    borderRight: c === frozenC - 1 ? '2px solid #9ca3af' : gridLine,
                    borderBottom: gridLine,
                    // lettere delle colonne bloccate: sticky in orizzontale
                    ...(c < frozenC ? { position: 'sticky' as const, left: colX(c), zIndex: 5, background: hdrBg } : {}),
                  }}
                  title="Seleziona la colonna (trascina per più colonne)"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    // click sulla lettera = seleziona TUTTA la colonna; trascinando
                    // sulle lettere si selezionano più colonne (stile Excel)
                    headerDrag.current = { kind: 'col', from: c }
                    setEditing(null)
                    navFocus.current = { r: 0, c }
                    setSelRange({ r1: 0, r2: rows.length - 1, c1: c, c2: c })
                  }}
                  onMouseEnter={() => {
                    const hd = headerDrag.current
                    if (hd?.kind !== 'col') return
                    setSelRange({ r1: 0, r2: rows.length - 1, c1: Math.min(hd.from, c), c2: Math.max(hd.from, c) })
                  }}
                >
                  {colLetter(c + 1)}
                  {/* maniglia di ridimensionamento colonna (doppio click = auto-adatta) */}
                  <div
                    className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-blue-400/60"
                    onMouseDown={(e) => startColResize(c, e)}
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      autoFitCol(c)
                    }}
                  />
                </div>
              ))}
            </div>

            <div style={{ height: Math.max(0, (offsets[windowStart] ?? 0) - frozenH) }} />
            <table style={{ tableLayout: 'fixed', borderCollapse: 'collapse', width: totalW }}>
              <colgroup>
                <col style={{ width: ROW_HDR_W }} />
                {widths.map((w, c) => (
                  <col key={c} style={{ width: w }} />
                ))}
              </colgroup>
              <tbody>
                {[
                  ...rows.slice(0, frozenR).map((row, i) => [row, i] as const),
                  ...rows.slice(windowStart, end).map((row, i) => [row, windowStart + i] as const),
                ].map(([row, r]) => {
                  if ((heights[r] ?? DEFAULT_ROW_PX) === 0) return null // riga nascosta dal filtro
                  const rowFrozen = r < frozenR
                  return (
                    <tr key={r} style={{ height: heights[r] ?? DEFAULT_ROW_PX }}>
                      <td
                        className="sticky left-0 z-10 py-0 text-center text-[11px] text-zinc-500 select-none cursor-pointer hover:bg-zinc-200/60"
                        style={{
                          background: hdrBg,
                          borderRight: gridLine,
                          borderBottom: rowFrozen && r === frozenR - 1 ? '2px solid #9ca3af' : gridLine,
                          position: 'sticky',
                          ...(rowFrozen ? { top: ROW_H + (offsets[r] ?? 0), zIndex: 15 } : {}),
                        }}
                        title="Seleziona la riga (trascina per più righe)"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          // click sul numero = seleziona TUTTA la riga; trascinando
                          // sui numeri si selezionano più righe (stile Excel)
                          headerDrag.current = { kind: 'row', from: r }
                          setEditing(null)
                          navFocus.current = { r, c: 0 }
                          setSelRange({ r1: r, r2: r, c1: 0, c2: widths.length - 1 })
                        }}
                        onMouseEnter={() => {
                          const hd = headerDrag.current
                          if (hd?.kind !== 'row') return
                          setSelRange({ r1: Math.min(hd.from, r), r2: Math.max(hd.from, r), c1: 0, c2: widths.length - 1 })
                        }}
                      >
                        {/* altezza fissa anche qui: il numero non deve gonfiare
                            le righe basse (spaziatori da 6-10px dei template) */}
                        <div
                          className="relative w-full flex items-center justify-center overflow-hidden"
                          style={{ height: Math.max(0, (heights[r] ?? DEFAULT_ROW_PX) - 1) }}
                        >
                          {r + 1}
                          {/* maniglia di ridimensionamento riga */}
                          <div
                            className="absolute left-0 bottom-0 w-full h-1 cursor-row-resize hover:bg-blue-400/60"
                            onMouseDown={(e) => startRowResize(r, e)}
                          />
                        </div>
                      </td>
                      {row.map((cell, c) => {
                        if (cell.skip) return null
                        // Coperta da un rowSpan: sparisce solo se il master è
                        // dentro la finestra virtualizzata e non nascosto dal
                        // filtro; altrimenti resta un td vuoto (niente slittamenti).
                        if (cell.covR !== undefined && cell.covR >= start && (heights[cell.covR] ?? DEFAULT_ROW_PX) > 0) return null
                        // Gridline di default SOLO se il foglio le mostra e la
                        // cella non ha un fill (in Excel il fill copre la
                        // gridline); i bordi espliciti della cella vincono.
                        const grid = sheet?.grid && !cell.bg ? gridLine : undefined
                        const inSel =
                          !!selRange && r >= selRange.r1 && r <= selRange.r2 && c >= selRange.c1 && c <= selRange.c2
                        const inFill =
                          !!fillPreview && r >= fillPreview.r1 && r <= fillPreview.r2 && c >= fillPreview.c1 && c <= fillPreview.c2
                        const isEditing = !!editing && editing.r === r && editing.c === c
                        const isFind = !!findQlc && !!cell.t && cell.t.toLowerCase().includes(findQlc)
                        // Larghezza reale della cella (somma le colonne unite).
                        let colW = widths[c] ?? 64
                        if (cell.cs) for (let k = 1; k < cell.cs; k++) colW += widths[c + k] ?? 0
                        const fs = fitFontSize(cell, colW)
                        // Contenuto in un div ad ALTEZZA FISSA: l'altezza resa
                        // coincide sempre col modello (un font più alto della
                        // riga non la gonfia più → overlay sempre in registro).
                        // Con rowSpan l'altezza è quella dell'intero blocco unito.
                        const span = cell.rs ?? 1
                        const innerH = Math.max(0, (offsets[Math.min(r + span, rows.length)] ?? 0) - (offsets[r] ?? 0) - 1)
                        // Font più alto della riga (banner dei template Google):
                        // il testo DEBORDA visibilmente sulle righe sotto, come
                        // su Sheets — clippare taglierebbe il titolo a metà.
                        const tall = (fs ?? 13) * 1.25 > innerH + 2
                        return (
                          <td
                            key={c}
                            colSpan={cell.cs}
                            rowSpan={cell.rs}
                            // py-0: azzera il padding verticale UA dei td (1px sopra
                            // e sotto) che gonfierebbe le righe oltre il modello.
                            // (il clipping lo fa il div interno, non il td: i banner
                            // "tall" devono poter debordare)
                            className="px-1.5 py-0 text-[13px]"
                            style={{
                              borderTop: cell.bt,
                              borderLeft: cell.bl,
                              borderRight: cell.br ?? grid,
                              borderBottom: cell.bb ?? grid,
                              background: cell.bg,
                              // cella attiva (editing) = bordo Excel; selezione = tinta
                              boxShadow: isEditing
                                ? 'inset 0 0 0 2px #1a73e8'
                                : inSel
                                  ? 'inset 0 0 0 999px rgba(59,130,246,0.14)'
                                  : isFind
                                    ? 'inset 0 0 0 999px rgba(250,204,21,0.35)' // risultato Ctrl+F
                                    : inFill
                                      ? 'inset 0 0 0 999px rgba(59,130,246,0.08)'
                                      : undefined,
                              color: cell.color ?? '#1f2937',
                              fontWeight: cell.b ? 700 : 400,
                              fontStyle: cell.i ? 'italic' : undefined,
                              textDecoration: cell.u || cell.st ? `${cell.u ? 'underline' : ''} ${cell.st ? 'line-through' : ''}`.trim() : undefined,
                              fontSize: fs, // dimensione dal file, ridotta se la parola non ci sta
                              textAlign: (cell.align as 'left' | 'center' | 'right') ?? (cell.num ? 'right' : 'left'),
                              // celle nei riquadri BLOCCATI: sticky + sfondo opaco;
                              // linea di demarcazione sul bordo del blocco
                              ...(rowFrozen || c < frozenC
                                ? {
                                    position: 'sticky' as const,
                                    ...(rowFrozen ? { top: ROW_H + (offsets[r] ?? 0) } : {}),
                                    ...(c < frozenC ? { left: colX(c) } : {}),
                                    zIndex: rowFrozen && c < frozenC ? 9 : rowFrozen ? 8 : 7,
                                    background: cell.bg ?? '#ffffff',
                                    ...(rowFrozen && r === frozenR - 1 ? { borderBottom: '2px solid #9ca3af' } : {}),
                                    ...(c < frozenC && c === frozenC - 1 ? { borderRight: '2px solid #9ca3af' } : {}),
                                  }
                                : {}),
                            }}
                            title={!cell.wrap && cell.t.length > 40 ? cell.t : undefined}
                            onMouseDown={(e) => {
                              if (e.button !== 0) return
                              // MODALITÀ FORMULA: se stai scrivendo una formula
                              // (=...), il click su un'altra cella ne INSERISCE il
                              // riferimento nella formula invece di chiudere l'edit;
                              // click consecutivi sostituiscono l'ultimo riferimento.
                              const inp = document.activeElement
                              if (
                                (inp === editInputRef.current || inp === fxInputRef.current) &&
                                inp instanceof HTMLInputElement &&
                                inp.value.startsWith('=') &&
                                !(editing && editing.r === r && editing.c === c)
                              ) {
                                e.preventDefault() // l'input NON deve perdere il focus
                                pickSwallow.current = true
                                pickDrag.current = { r, c } // trascinando diventa un range
                                const refTxt = `${colLetter(c + 1)}${r + 1}`
                                let start = inp.selectionStart ?? inp.value.length
                                const end = inp.selectionEnd ?? start
                                const prev = formulaPick.current
                                if (prev && prev.input === inp && start === end && start === prev.end) start = prev.start
                                inp.setRangeText(refTxt, start, end, 'end')
                                formulaPick.current = { input: inp, start, end: start + refTxt.length }
                                if (inp === fxInputRef.current) setFxDraft(inp.value)
                                setFxLive(inp.value)
                                return
                              }
                              // Shift+click: estende la selezione dall'ancora (Excel)
                              if (e.shiftKey && selAnchor.current && !editing) {
                                e.preventDefault()
                                const a = selAnchor.current
                                navFocus.current = { r, c }
                                dragMoved.current = true // il click che segue non deve ridurre a 1×1
                                setSelRange({
                                  r1: Math.min(a.r, r),
                                  r2: Math.max(a.r, r),
                                  c1: Math.min(a.c, c),
                                  c2: Math.max(a.c, c),
                                })
                                return
                              }
                              // Niente selezione TESTO nativa mentre si selezionano
                              // celle (confonde). Ma se una cella è in modifica, il
                              // default serve: il blur dell'input committa l'edit.
                              if (!editing && !(e.target as HTMLElement).closest('input')) e.preventDefault()
                              selAnchor.current = { r, c }
                              draggingSel.current = true
                              dragMoved.current = false
                              setSelRange(null)
                            }}
                            onMouseEnter={() => {
                              // modalità formula: trascinando si costruisce un RANGE
                              const pd = pickDrag.current
                              const fp = formulaPick.current
                              if (pd && fp) {
                                const a = `${colLetter(Math.min(pd.c, c) + 1)}${Math.min(pd.r, r) + 1}`
                                const b = `${colLetter(Math.max(pd.c, c) + 1)}${Math.max(pd.r, r) + 1}`
                                const txt = a === b ? a : `${a}:${b}`
                                fp.input.setRangeText(txt, fp.start, fp.end, 'end')
                                fp.end = fp.start + txt.length
                                if (fp.input === fxInputRef.current) setFxDraft(fp.input.value)
                                setFxLive(fp.input.value)
                                return
                              }
                              // trascinamento del bordo selezione → anteprima spostamento
                              const mv = moveRef.current
                              if (mv) {
                                const b = mv.base
                                let dr = r - mv.startR
                                let dc = c - mv.startC
                                dr = Math.max(-b.r1, Math.min(dr, rows.length - 1 - b.r2))
                                dc = Math.max(-b.c1, Math.min(dc, widths.length - 1 - b.c2))
                                setMovePreview({ r1: b.r1 + dr, r2: b.r2 + dr, c1: b.c1 + dc, c2: b.c2 + dc })
                                return
                              }
                              // trascinamento del fill handle → anteprima estensione
                              const f = fillRef.current
                              if (f) {
                                const b = f.base
                                let p: typeof fillPreview = null
                                if (r > b.r2) p = { r1: b.r2 + 1, r2: r, c1: b.c1, c2: b.c2 }
                                else if (r < b.r1) p = { r1: r, r2: b.r1 - 1, c1: b.c1, c2: b.c2 }
                                else if (c > b.c2) p = { r1: b.r1, r2: b.r2, c1: b.c2 + 1, c2: c }
                                else if (c < b.c1) p = { r1: b.r1, r2: b.r2, c1: c, c2: b.c1 - 1 }
                                setFillPreview(p)
                                return
                              }
                              // trascinando su un'altra cella → selezione stile Excel
                              const a = selAnchor.current
                              if (!draggingSel.current || !a) return
                              if (a.r !== r || a.c !== c) dragMoved.current = true
                              window.getSelection()?.removeAllRanges() // niente testo misto
                              navFocus.current = { r, c }
                              setSelRange({
                                r1: Math.min(a.r, r),
                                r2: Math.max(a.r, r),
                                c1: Math.min(a.c, c),
                                c2: Math.max(a.c, c),
                              })
                            }}
                            onClick={() => {
                              // il click era un inserimento di riferimento in formula
                              if (pickSwallow.current) {
                                pickSwallow.current = false
                                return
                              }
                              // click singolo = SELEZIONA (come Excel): l'editing parte
                              // scrivendo (sostituisce), con F2 o col doppio click.
                              if (!dragMoved.current && !isCsv && wb && !cell.chk) {
                                selAnchor.current = { r, c }
                                navFocus.current = { r, c }
                                setSelRange({ r1: r, r2: r, c1: c, c2: c })
                              }
                            }}
                            onDoubleClick={() => {
                              if (!isCsv && wb && !cell.chk) startEdit(r, c, null)
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              // tasto destro FUORI dalla selezione → la selezione si
                              // sposta sulla cella cliccata (come Excel)
                              if (!selRange || r < selRange.r1 || r > selRange.r2 || c < selRange.c1 || c > selRange.c2) {
                                setSelRange({ r1: r, r2: r, c1: c, c2: c })
                              }
                              setSubmenu(null)
                              setMenu({ x: e.clientX, y: e.clientY, r, c })
                            }}
                          >
                            {/* altezza FISSA = modello; una riga non può più crescere col testo */}
                            <div
                              style={{
                                position: 'relative',
                                height: innerH,
                                overflow: tall ? 'visible' : 'hidden',
                                whiteSpace: cell.wrap ? 'normal' : 'nowrap',
                                textOverflow: 'ellipsis',
                                lineHeight: cell.wrap || tall ? 1.25 : `${innerH}px`,
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
                              ) : isEditing && wb ? (
                                // Editing "in place" come Excel: nessuna casella visibile,
                                // solo il caret; il bordo lo dà la cella (boxShadow sopra).
                                // In modalità formula il testo dell'input è trasparente e
                                // sotto c'è lo SPECCHIO con i riferimenti colorati.
                                <>
                                  {fxMirror('', {
                                    textAlign: 'left',
                                    color: '#1f2937',
                                    fontSize: fs ?? 13,
                                    fontWeight: 400,
                                    fontStyle: 'normal',
                                  })}
                                  <input
                                    autoFocus
                                    ref={editInputRef}
                                    defaultValue={editSeed.current ?? rawOf(wb.worksheets[active].getRow(r + 1).getCell(c + 1))}
                                    onFocus={(e) => {
                                      const n = e.currentTarget.value.length
                                      e.currentTarget.setSelectionRange(n, n) // caret in fondo
                                    }}
                                    className="block w-full outline-none bg-transparent"
                                    style={{
                                      height: '100%',
                                      color: fxColors ? 'transparent' : (cell.color ?? '#1f2937'),
                                      caretColor: '#1f2937',
                                      fontSize: fs ?? 13,
                                      fontWeight: fxColors ? 400 : cell.b ? 700 : 400,
                                      fontStyle: fxColors ? 'normal' : cell.i ? 'italic' : undefined,
                                      textAlign: fxColors
                                        ? 'left' // le formule si scrivono a sinistra, come Excel
                                        : ((cell.align as 'left' | 'center' | 'right') ?? (cell.num ? 'right' : 'left')),
                                    }}
                                    onInput={(e) => {
                                      const v = e.currentTarget.value
                                      setFxLive(v.startsWith('=') ? v : null)
                                      computeSuggest(e.currentTarget, 'cell')
                                    }}
                                    onKeyDown={(e) => {
                                      if (suggestKeys(e)) return // il dropdown ha la precedenza
                                      if (e.key === 'F4') {
                                        e.preventDefault()
                                        e.stopPropagation()
                                        cycleRef(e.currentTarget)
                                        return
                                      }
                                      const val = e.currentTarget.value
                                      if (e.key === 'Enter') {
                                        commitEdit(r, c, val)
                                        moveSel(e.shiftKey ? -1 : 1, 0) // Invio scende, come Excel
                                      } else if (e.key === 'Tab') {
                                        e.preventDefault()
                                        commitEdit(r, c, val)
                                        moveSel(0, e.shiftKey ? -1 : 1)
                                      } else if (e.key === 'Escape') {
                                        setEditing(null)
                                        setFxLive(null)
                                      } else if (
                                        e.key.startsWith('Arrow') &&
                                        editMode.current === 'enter' &&
                                        !val.startsWith('=')
                                      ) {
                                        // scrivi-per-sostituire: le frecce committano e
                                        // si spostano (in F2/doppio click muovono il caret)
                                        e.preventDefault()
                                        commitEdit(r, c, val)
                                        moveSel(
                                          e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0,
                                          e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0,
                                        )
                                      }
                                      e.stopPropagation()
                                    }}
                                  onPaste={(e) => {
                                    // Incolla multi-cella: distribuisci dalla cella corrente.
                                    const text = e.clipboardData.getData('text/plain')
                                    if (text.includes('\t') || text.includes('\n')) {
                                      e.preventDefault()
                                      setEditing(null)
                                      pasteMatrix(r, c, text)
                                    }
                                  }}
                                    onBlur={(e) => commitEdit(r, c, e.currentTarget.value)}
                                  />
                                </>
                              ) : (
                                cell.t
                              )}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div style={{ height: Math.max(0, totalH - (offsets[end] ?? totalH)) }} />

            {/* Bordo spesso della selezione (stile Excel): il bordo si può
                trascinare per SPOSTARE le celle; il quadratino è il fill handle
                (visibile anche mentre scrivi: trascinarlo committa e riempie). */}
            {selRange &&
              (() => {
                const x = colX(selRange.c1)
                const wSel = colX(selRange.c2 + 1) - x
                const y = ROW_H + (offsets[selRange.r1] ?? 0)
                const hSel = (offsets[selRange.r2 + 1] ?? totalH) - (offsets[selRange.r1] ?? 0)
                const strip = (side: 'top' | 'bottom' | 'left' | 'right'): React.CSSProperties => ({
                  position: 'absolute',
                  pointerEvents: 'auto',
                  cursor: 'move',
                  ...(side === 'top'
                    ? { top: -4, left: 0, right: 0, height: 7 }
                    : side === 'bottom'
                      ? { bottom: -4, left: 0, right: 0, height: 7 }
                      : side === 'left'
                        ? { left: -4, top: 0, bottom: 0, width: 7 }
                        : { right: -4, top: 0, bottom: 0, width: 7 }),
                })
                return (
                  <div
                    style={{
                      position: 'absolute',
                      left: x,
                      top: y,
                      width: wSel,
                      height: hSel,
                      border: '2px solid #1a73e8',
                      pointerEvents: 'none',
                      zIndex: 5,
                    }}
                  >
                    {(['top', 'bottom', 'left', 'right'] as const).map((s) => (
                      <div key={s} style={strip(s)} onMouseDown={startMoveDrag} title="Trascina per spostare" />
                    ))}
                    {!isCsv && (
                      <div
                        style={{
                          position: 'absolute',
                          right: -5,
                          bottom: -5,
                          width: 9,
                          height: 9,
                          background: '#1a73e8',
                          border: '1px solid #ffffff',
                          pointerEvents: 'auto',
                          cursor: 'crosshair',
                        }}
                        onMouseDown={startFillDrag}
                        onDoubleClick={(e) => {
                          e.stopPropagation()
                          fillHandleDouble() // riempi fino alla fine dei dati adiacenti
                        }}
                        title="Trascina per continuare la serie (doppio click: riempi fino in fondo)"
                      />
                    )}
                  </div>
                )
              })()}

            {/* Anteprima dello spostamento (tratteggiata) */}
            {movePreview &&
              (() => {
                const x = colX(movePreview.c1)
                return (
                  <div
                    style={{
                      position: 'absolute',
                      left: x,
                      top: ROW_H + (offsets[movePreview.r1] ?? 0),
                      width: colX(movePreview.c2 + 1) - x,
                      height: (offsets[movePreview.r2 + 1] ?? totalH) - (offsets[movePreview.r1] ?? 0),
                      border: '2px dashed #1a73e8',
                      pointerEvents: 'none',
                      zIndex: 5,
                    }}
                  />
                )
              })()}

            {/* Pulsanti del filtro (▼) sulla riga di intestazione */}
            {sheet?.filter &&
              !isCsv &&
              (() => {
                const f = sheet.filter!
                const map = xlsxFilters.get(`${filePath}#${active}`)
                const out: React.ReactNode[] = []
                for (let c = Math.max(f.c1, 0); c <= Math.min(f.c2, widths.length - 1); c++) {
                  const activeF = !!map?.get(c)?.size
                  out.push(
                    <button
                      key={c}
                      title="Filtra questa colonna"
                      style={{
                        position: 'absolute',
                        left: colX(c + 1) - 17,
                        top: ROW_H + (offsets[f.r] ?? 0) + 2,
                        width: 15,
                        height: 15,
                        zIndex: 4,
                        fontSize: 8,
                        lineHeight: '13px',
                        borderRadius: 3,
                        border: '1px solid #9ca3af',
                        background: activeF ? '#1a73e8' : 'rgba(255,255,255,0.92)',
                        color: activeF ? '#ffffff' : '#4b5563',
                        cursor: 'pointer',
                      }}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        setFilterMenu({ c, x: e.clientX, y: e.clientY })
                      }}
                    >
                      ▼
                    </button>,
                  )
                }
                return out
              })()}

            {/* Riquadri colorati sui riferimenti della formula in scrittura */}
            {fxColors &&
              !isCsv &&
              [...fxColors.refs.entries()].map(([key, idx]) => {
                const m = /^([A-Z]{1,3})(\d+)(?::([A-Z]{1,3})(\d+))?$/.exec(key)
                if (!m) return null
                let r1 = Number(m[2]) - 1
                let c1 = colIndex(m[1]) - 1
                let r2 = m[4] ? Number(m[4]) - 1 : r1
                let c2 = m[3] ? colIndex(m[3]) - 1 : c1
                ;[r1, r2] = [Math.min(r1, r2), Math.max(r1, r2)]
                ;[c1, c2] = [Math.min(c1, c2), Math.max(c1, c2)]
                if (r1 >= rows.length || c1 >= widths.length) return null
                r2 = Math.min(r2, rows.length - 1)
                c2 = Math.min(c2, widths.length - 1)
                const color = REF_COLORS[idx % REF_COLORS.length]
                const x = colX(c1)
                return (
                  <div
                    key={key}
                    style={{
                      position: 'absolute',
                      left: x,
                      top: ROW_H + (offsets[r1] ?? 0),
                      width: colX(c2 + 1) - x,
                      height: (offsets[r2 + 1] ?? totalH) - (offsets[r1] ?? 0),
                      border: `2px dashed ${color}`,
                      background: `${color}14`,
                      pointerEvents: 'none',
                      zIndex: 6,
                    }}
                  />
                )
              })}
          </div>
        )}
      </div>

      {/* Menu tasto destro sulla griglia: appunti, righe/colonne, ordina, filtro */}
      {menu && !isCsv && (
        <>
          <div
            className="fixed inset-0 z-40"
            onMouseDown={() => {
              setMenu(null)
              setSubmenu(null)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu(null)
              setSubmenu(null)
            }}
          />
          {(() => {
            const mr: Range = selRange ?? { r1: menu.r, r2: menu.r, c1: menu.c, c2: menu.c }
            const canSort = mr.r2 > mr.r1
            const panelX = Math.min(menu.x, window.innerWidth - 240)
            const panelY = Math.min(menu.y, window.innerHeight - 340)
            const subFlip = panelX + 224 + 180 > window.innerWidth // sottomenu a sinistra se non ci sta
            const close = () => {
              setMenu(null)
              setSubmenu(null)
            }
            const item = (label: string, fn: () => void) => (
              <button
                key={label}
                className="w-full text-left px-3 py-1.5 text-zinc-200 hover:bg-zinc-700"
                onMouseEnter={() => setSubmenu(null)}
                onClick={() => {
                  close()
                  fn()
                }}
              >
                {label}
              </button>
            )
            const sub = (id: string, label: string, entries: [string, () => void][], disabled = false) => (
              <div key={id} className="relative" onMouseEnter={() => setSubmenu(disabled ? null : id)}>
                <button
                  disabled={disabled}
                  className="w-full text-left px-3 py-1.5 text-zinc-200 hover:bg-zinc-700 disabled:opacity-40 disabled:hover:bg-transparent flex items-center justify-between"
                >
                  <span>{label}</span>
                  <span className="text-zinc-500">▸</span>
                </button>
                {submenu === id && (
                  <div
                    className="absolute top-0 w-48 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1"
                    style={subFlip ? { right: '100%' } : { left: '100%' }}
                  >
                    {entries.map(([l, fn]) => (
                      <button
                        key={l}
                        className="w-full text-left px-3 py-1.5 text-zinc-200 hover:bg-zinc-700"
                        onClick={() => {
                          close()
                          fn()
                        }}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
            return (
              <div
                className="fixed z-50 w-56 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1 text-sm"
                style={{ left: panelX, top: panelY }}
              >
                {item('Taglia', () => cutRange(mr))}
                {item('Copia', () => copyRange(mr))}
                {item('Incolla', () => pasteFromClipboard(mr))}
                <div className="h-px bg-zinc-700 my-1" />
                {sub('riga', 'Riga', [
                  ['Aggiungi sopra', () => structural((ws) => ws.insertRow(menu.r + 1, [], 'i'), { kind: 'insRow', pos: menu.r + 1 })],
                  ['Aggiungi sotto', () => structural((ws) => ws.insertRow(menu.r + 2, [], 'i'), { kind: 'insRow', pos: menu.r + 2 })],
                  ['Duplica', () => structural((ws) => ws.duplicateRow(menu.r + 1, 1, true), { kind: 'insRow', pos: menu.r + 2 })],
                  ['Elimina', () => structural((ws) => ws.spliceRows(menu.r + 1, 1), { kind: 'delRow', pos: menu.r + 1 })],
                ])}
                {sub('colonna', 'Colonna', [
                  ['Aggiungi a sinistra', () => structural((ws) => ws.spliceColumns(menu.c + 1, 0, []), { kind: 'insCol', pos: menu.c + 1 })],
                  ['Aggiungi a destra', () => structural((ws) => ws.spliceColumns(menu.c + 2, 0, []), { kind: 'insCol', pos: menu.c + 2 })],
                  ['Elimina', () => structural((ws) => ws.spliceColumns(menu.c + 1, 1), { kind: 'delCol', pos: menu.c + 1 })],
                ])}
                <div className="h-px bg-zinc-700 my-1" />
                {sub(
                  'ordina',
                  'Ordina intervallo',
                  [
                    ['Crescente (1 → 9, A → Z)', () => sortRange(mr, menu.c, true)],
                    ['Decrescente (9 → 1, Z → A)', () => sortRange(mr, menu.c, false)],
                  ],
                  !canSort,
                )}
                {sheet?.filter ? item('Rimuovi filtro', removeFilter) : item('Crea un filtro', () => createFilter(mr, menu.r))}
                {sub('blocca', 'Blocca riquadri', [
                  [`Righe fino alla ${menu.r + 1}`, () => setFrozen(menu.r + 1, sheet?.frozen?.cols ?? 0)],
                  [`Colonne fino alla ${colLetter(menu.c + 1)}`, () => setFrozen(sheet?.frozen?.rows ?? 0, menu.c + 1)],
                  ['Riga e colonna qui', () => setFrozen(menu.r + 1, menu.c + 1)],
                  ['Sblocca tutto', () => setFrozen(0, 0)],
                ])}
                <div className="h-px bg-zinc-700 my-1" />
                {item('Formato celle…', () => setFmtDialog(true))}
                {item('Cancella contenuto', () => clearRange(mr))}
                {item('Cancella formattazione', () => styleCells(wipeFormat))}
              </div>
            )
          })()}
        </>
      )}

      {/* Dropdown del filtro: spunte sui valori della colonna */}
      {filterMenu &&
        sheet?.filter &&
        !isCsv &&
        (() => {
          const f = sheet.filter!
          const ws = wb?.worksheets[active]
          if (!ws) return null
          const key = `${filePath}#${active}`
          const excl = xlsxFilters.get(key)?.get(filterMenu.c) ?? new Set<string>()
          const counts = new Map<string, number>()
          const rEnd = Math.min(f.r2, MAX_ROWS - 1)
          for (let r = f.r + 1; r <= rEnd; r++) {
            const cell = ws.getRow(r + 1).getCell(filterMenu.c + 1)
            const t = cellText(cell.value, cell.numFmt).text
            counts.set(t, (counts.get(t) ?? 0) + 1)
          }
          const values = [...counts.keys()].sort((a, b) => a.localeCompare(b, 'it')).slice(0, 500)
          const setExcluded = (next: Set<string>) => {
            const map = xlsxFilters.get(key) ?? new Map<number, Set<string>>()
            map.set(filterMenu.c, next)
            xlsxFilters.set(key, map)
            applyFilterRows()
          }
          return (
            <>
              <div className="fixed inset-0 z-40" onMouseDown={() => setFilterMenu(null)} />
              <div
                className="fixed z-50 w-60 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1 text-sm"
                style={{ left: Math.min(filterMenu.x, window.innerWidth - 260), top: Math.min(filterMenu.y, window.innerHeight - 360) }}
              >
                <div className="px-3 py-1 text-xs text-zinc-400">
                  Filtra colonna {colLetter(filterMenu.c + 1)} · {values.length} valori
                </div>
                <div className="flex gap-1 px-3 py-1">
                  <button className="flex-1 px-2 py-0.5 text-xs bg-zinc-700 hover:bg-zinc-600 rounded text-zinc-200" onClick={() => setExcluded(new Set())}>
                    Tutti
                  </button>
                  <button
                    className="flex-1 px-2 py-0.5 text-xs bg-zinc-700 hover:bg-zinc-600 rounded text-zinc-200"
                    onClick={() => setExcluded(new Set(values))}
                  >
                    Nessuno
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto px-1 py-1">
                  {values.map((v) => (
                    <label key={v} className="flex items-center gap-2 px-2 py-0.5 rounded hover:bg-zinc-700 cursor-pointer text-zinc-200">
                      <input
                        type="checkbox"
                        checked={!excl.has(v)}
                        style={{ accentColor: '#2563eb' }}
                        onChange={(e) => {
                          const next = new Set(excl)
                          if (e.target.checked) next.delete(v)
                          else next.add(v)
                          setExcluded(next)
                        }}
                      />
                      <span className="truncate">
                        {v === '' ? '(Vuote)' : v} <span className="text-zinc-500">· {counts.get(v)}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )
        })()}

      {/* Dialog "Formato celle": bordi (lato/stile/colore) e gradiente */}
      {fmtDialog && !isCsv && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onMouseDown={() => setFmtDialog(false)} />
          <div
            className="fixed z-50 w-80 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl p-4 text-sm text-zinc-200"
            style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="font-medium">Formato celle</span>
              <button className="text-zinc-500 hover:text-zinc-200 px-1" onClick={() => setFmtDialog(false)}>
                ✕
              </button>
            </div>

            <div className="text-xs text-zinc-400 mb-1">Bordi — scegli stile e colore, poi dove applicarli</div>
            <div className="flex items-center gap-2 mb-2">
              <select
                className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-1 py-1"
                value={bStyle}
                onChange={(e) => setBStyle(e.target.value)}
              >
                <option value="thin">Sottile</option>
                <option value="medium">Medio</option>
                <option value="thick">Spesso</option>
                <option value="double">Doppio</option>
                <option value="dashed">Tratteggiato</option>
                <option value="dotted">Punteggiato</option>
              </select>
              <input type="color" className="w-8 h-7 p-0 border-0 bg-transparent cursor-pointer" value={bColor} onChange={(e) => setBColor(e.target.value)} />
            </div>
            <div className="grid grid-cols-4 gap-1 mb-4">
              {(
                [
                  ['Tutti', 'all'],
                  ['Esterni', 'outline'],
                  ['Sopra', 'top'],
                  ['Sotto', 'bottom'],
                  ['Sinistra', 'left'],
                  ['Destra', 'right'],
                  ['Nessuno', 'none'],
                ] as const
              ).map(([label, preset]) => (
                <button
                  key={preset}
                  className="px-1.5 py-1 bg-zinc-700 hover:bg-zinc-600 rounded text-xs disabled:opacity-40"
                  disabled={!fmtTarget}
                  onClick={() => applyBorders(preset)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="text-xs text-zinc-400 mb-1">Riempimento a gradiente</div>
            <div className="flex items-center gap-2 mb-2">
              <input type="color" className="w-8 h-7 p-0 border-0 bg-transparent cursor-pointer" value={gradA} onChange={(e) => setGradA(e.target.value)} />
              <span className="text-zinc-500">→</span>
              <input type="color" className="w-8 h-7 p-0 border-0 bg-transparent cursor-pointer" value={gradB} onChange={(e) => setGradB(e.target.value)} />
              <select
                className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-1 py-1"
                value={gradDir}
                onChange={(e) => setGradDir(e.target.value)}
              >
                <option value="0">Orizzontale</option>
                <option value="90">Verticale</option>
                <option value="45">Diagonale</option>
              </select>
            </div>
            <div
              className="h-5 rounded mb-2 border border-zinc-700"
              style={{ background: `linear-gradient(${Number(gradDir) + 90}deg, ${gradA}, ${gradB})` }}
            />
            <div className="flex gap-2">
              <button
                className="flex-1 px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded text-white text-xs disabled:opacity-40"
                disabled={!fmtTarget}
                onClick={() =>
                  styleCells(
                    (cell) =>
                      (cell.fill = {
                        type: 'gradient',
                        gradient: 'angle',
                        degree: Number(gradDir),
                        stops: [
                          { position: 0, color: { argb: `FF${gradA.slice(1).toUpperCase()}` } },
                          { position: 1, color: { argb: `FF${gradB.slice(1).toUpperCase()}` } },
                        ],
                      }),
                  )
                }
              >
                Applica gradiente
              </button>
              <button
                className="flex-1 px-2 py-1 bg-zinc-700 hover:bg-zinc-600 rounded text-xs disabled:opacity-40"
                disabled={!fmtTarget}
                onClick={() => styleCells((cell) => (cell.fill = { type: 'pattern', pattern: 'none' }))}
              >
                Nessun riempimento
              </button>
            </div>
            <p className="text-[11px] text-zinc-500 mt-3">
              Le modifiche si applicano subito alla selezione e si annullano con Ctrl+Z.
            </p>
          </div>
        </>
      )}

      {/* Galleria "Formatta come tabella" */}
      {tableMenu && !isCsv && (
        <>
          <div className="fixed inset-0 z-40" onMouseDown={() => setTableMenu(null)} />
          <div
            className="fixed z-50 w-56 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1 text-sm"
            style={{ left: Math.min(tableMenu.x, window.innerWidth - 240), top: Math.min(tableMenu.y + 8, window.innerHeight - 280) }}
          >
            <div className="px-3 py-1 text-xs text-zinc-400">Stile tabella — 1ª riga della selezione = intestazione</div>
            {TABLE_STYLES.map((p) => (
              <button
                key={p.name}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-700 text-zinc-200"
                onClick={() => {
                  setTableMenu(null)
                  applyTableStyle(p)
                }}
              >
                <span className="w-4 h-4 rounded-sm border border-zinc-600" style={{ background: `#${p.head.slice(2)}` }} />
                <span className="w-4 h-4 rounded-sm border border-zinc-600" style={{ background: `#${p.band.slice(2)}` }} />
                {p.name}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Mini-menu del tasto Canc: cosa cancellare dalla selezione */}
      {delMenu && !isCsv && selRange && (
        <>
          <div className="fixed inset-0 z-40" onMouseDown={() => setDelMenu(null)} />
          <div
            className="fixed z-50 w-52 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1 text-sm"
            style={{ left: delMenu.x, top: delMenu.y }}
          >
            <div className="px-3 py-1 text-xs text-zinc-400">Cancella dalla selezione…</div>
            {(
              [
                ['Solo contenuto', 'Backspace', () => clearRange(selRange)],
                ['Solo formattazione', '', () => styleCells(wipeFormat)],
                ['Tutto (contenuto + formato)', '', () => styleCells(wipeFormat, true)],
              ] as [string, string, () => void][]
            ).map(([label, hint, fn]) => (
              <button
                key={label}
                className="w-full text-left px-3 py-1.5 text-zinc-200 hover:bg-zinc-700 flex items-center justify-between gap-2"
                onClick={() => {
                  setDelMenu(null)
                  fn()
                }}
              >
                <span>{label}</span>
                {hint && <span className="text-[10px] text-zinc-500 shrink-0">{hint}</span>}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Tab dei fogli (stile Excel, in basso): doppio click = rinomina, ＋ = nuovo */}
      {sheetNames.length > 0 && (
        <div className="px-2 py-1 border-t border-zinc-800 bg-zinc-900 flex items-center gap-1 overflow-x-auto shrink-0">
          {sheetNames.map((name, i) =>
            renamingSheet === i ? (
              <input
                key={i}
                autoFocus
                defaultValue={name}
                className="px-2 py-0.5 w-32 bg-zinc-950 border border-zinc-600 rounded text-xs text-zinc-100 outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') renameSheet(i, e.currentTarget.value)
                  if (e.key === 'Escape') setRenamingSheet(null)
                }}
                onBlur={(e) => renameSheet(i, e.currentTarget.value)}
              />
            ) : (
              <span key={i} className="group flex items-center shrink-0">
                <button
                  onClick={() => selectSheet(i)}
                  onDoubleClick={() => !isCsv && setRenamingSheet(i)}
                  title={isCsv ? undefined : 'Doppio click per rinominare'}
                  className={`px-3 py-1 rounded text-xs whitespace-nowrap ${
                    i === active ? 'bg-zinc-100 text-zinc-900 font-medium' : 'text-zinc-400 hover:bg-zinc-800'
                  }`}
                >
                  {name}
                </button>
                {!isCsv && i === active && sheetNames.length > 1 && (
                  <button
                    className="ml-0.5 px-1 text-zinc-500 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100"
                    title="Elimina foglio"
                    onClick={() => removeSheet(i)}
                  >
                    ✕
                  </button>
                )}
              </span>
            ),
          )}
          {!isCsv && wb && (
            <button
              onClick={addSheet}
              className="px-2 py-1 rounded text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 shrink-0"
              title="Nuovo foglio"
            >
              ＋
            </button>
          )}
          {/* barra di stato: Somma/Media/Conteggio della selezione, come Excel */}
          {selStats && (
            <div className="ml-auto flex items-center gap-3 pr-2 text-[11px] text-zinc-400 whitespace-nowrap shrink-0">
              {selStats.nums > 0 && (
                <>
                  <span>
                    Somma: <span className="text-zinc-200 font-medium">{selStats.sum.toLocaleString('it-IT', { maximumFractionDigits: 2 })}</span>
                  </span>
                  <span>
                    Media:{' '}
                    <span className="text-zinc-200 font-medium">
                      {(selStats.sum / selStats.nums).toLocaleString('it-IT', { maximumFractionDigits: 2 })}
                    </span>
                  </span>
                </>
              )}
              <span>
                Conteggio: <span className="text-zinc-200 font-medium">{selStats.cnt}</span>
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
