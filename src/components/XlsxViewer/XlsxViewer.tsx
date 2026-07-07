import { useEffect, useRef, useState } from 'react'
import { readFile, readTextFile, exists } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import type { Workbook, Worksheet, Cell, CellValue } from 'exceljs'
import { revealInExplorer } from '../../lib/imageActions'
import { writeFileBinaryAtomic } from '../../lib/fileOps'
import { useAppStore } from '../../store/appStore'
import { ConvertButton } from '../Convert/ConvertButton'
import { parseCsv } from '../../lib/csv'

// Cronologia annulla/ripeti per file (solo modifiche ai VALORI: le operazioni
// strutturali su righe/colonne la azzerano perché gli indici slittano).
interface HistOp {
  sheet: number
  cells: { r: number; c: number; before: CellValue; after: CellValue }[]
}
const xlsxHistory = new Map<string, { undo: HistOp[]; redo: HistOp[] }>()

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

  // Formattazione condizionale (Fase 14): colori applicati al modello.
  applyConditional(ws, rows, rowCount, colCount)

  // Gridlines: rispettiamo l'impostazione del foglio (View → Gridlines).
  const grid = (ws.views?.[0] as { showGridLines?: boolean } | undefined)?.showGridLines !== false

  return { name: ws.name, rows, widths, heights, offsets: buildOffsets(heights), grid, truncated: usedRows > MAX_ROWS }
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
  const [renamingSheet, setRenamingSheet] = useState<number | null>(null)
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

  // Fine del drag di selezione, ovunque finisca il mouse.
  useEffect(() => {
    const up = () => {
      draggingSel.current = false
    }
    document.addEventListener('mouseup', up)
    return () => document.removeEventListener('mouseup', up)
  }, [])

  // ---- Editing (Fase 2): la modifica va SUBITO nel workbook in memoria; il
  // salvataggio è un writeBuffer che preserva stili/formati (spike verificato).

  function commitEdit(r: number, c: number, raw: string) {
    setEditing(null)
    const ws = wb?.worksheets[active]
    if (!ws || !sheet) return
    const cellRef = ws.getRow(r + 1).getCell(c + 1)
    const before = rawOf(cellRef)
    if (raw === before) return // nessun cambiamento
    const beforeValue = cellRef.value
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
    markDirty()
    // Cronologia (annulla/ripeti).
    const h = xlsxHistory.get(filePath) ?? { undo: [], redo: [] }
    h.undo.push({ sheet: active, cells: [{ r, c, before: beforeValue, after: cellRef.value }] })
    if (h.undo.length > 100) h.undo.shift()
    h.redo = []
    xlsxHistory.set(filePath, h)
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
  function structural(mutate: (ws: Worksheet) => void) {
    const ws = wb?.worksheets[active]
    if (!ws) return
    setEditing(null)
    setSelRange(null)
    try {
      mutate(ws)
    } catch (e) {
      console.error('Operazione non riuscita:', e)
    }
    xlsxHistory.delete(filePath)
    rebuildActive()
    markDirty()
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
  }

  function undoRedo(redo: boolean) {
    const h = xlsxHistory.get(filePath)
    const op = (redo ? h?.redo : h?.undo)?.pop()
    if (!h || !op) return
    if (op.sheet !== active) selectSheet(op.sheet) // torna sul foglio giusto
    const ws = wb?.worksheets[op.sheet]
    if (!ws) return
    for (const e of op.cells) {
      ws.getRow(e.r + 1).getCell(e.c + 1).value = redo ? e.after : e.before
    }
    ;(redo ? h.undo : h.redo).push(op)
    cacheRef.current.delete(op.sheet)
    rebuildActive()
    markDirty()
  }

  // Applica il fill: per ogni colonna (o riga) della base, continua la serie.
  function applyFill(base: { r1: number; c1: number; r2: number; c2: number }, target: { r1: number; c1: number; r2: number; c2: number }) {
    const ws = wb?.worksheets[active]
    if (!ws) return
    const cells: { r: number; c: number; v: CellValue }[] = []
    const vertical = target.c1 === base.c1 && target.c2 === base.c2
    if (vertical) {
      for (let c = base.c1; c <= base.c2; c++) {
        const vals: CellValue[] = []
        for (let r = base.r1; r <= base.r2; r++) vals.push(ws.getRow(r + 1).getCell(c + 1).value)
        for (let r = target.r1; r <= target.r2; r++) {
          const k = r > base.r2 ? r - base.r2 : r - base.r1 // sotto: k>0; sopra: k<0
          cells.push({ r, c, v: seriesValue(vals, k) })
        }
      }
    } else {
      for (let r = base.r1; r <= base.r2; r++) {
        const vals: CellValue[] = []
        for (let c = base.c1; c <= base.c2; c++) vals.push(ws.getRow(r + 1).getCell(c + 1).value)
        for (let c = target.c1; c <= target.c2; c++) {
          const k = c > base.c2 ? c - base.c2 : c - base.c1
          cells.push({ r, c, v: seriesValue(vals, k) })
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
      const sel = selRef.current
      if (!sel || editing) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        const ws = wb?.worksheets[active]
        if (!ws || !sheet) return
        e.preventDefault()
        const lines: string[] = []
        for (let r = sel.r1; r <= sel.r2; r++) {
          const cells: string[] = []
          for (let c = sel.c1; c <= sel.c2; c++) cells.push(sheet.rows[r]?.[c]?.t ?? '')
          lines.push(cells.join('\t'))
        }
        navigator.clipboard.writeText(lines.join('\n')).catch(() => {})
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        if (isCsv) return
        e.preventDefault()
        navigator.clipboard
          .readText()
          .then((text) => pasteMatrix(sel.r1, sel.c1, text))
          .catch((err) => console.error('Incolla:', err))
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (isCsv) return
        e.preventDefault()
        const cells: { r: number; c: number; v: CellValue }[] = []
        for (let r = sel.r1; r <= sel.r2; r++)
          for (let c = sel.c1; c <= sel.c2; c++) cells.push({ r, c, v: null })
        writeCells(cells) // annullabile con Ctrl+Z
      } else if (e.key === 'Escape') {
        setSelRange(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, wb, active, sheet, isCsv])

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
                  style={{ width: w, borderRight: gridLine, borderBottom: gridLine }}
                  title="Seleziona la colonna"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    // click sulla lettera = seleziona TUTTA la colonna (stile Excel)
                    setEditing(null)
                    setSelRange({ r1: 0, r2: rows.length - 1, c1: c, c2: c })
                  }}
                >
                  {colLetter(c + 1)}
                  {/* maniglia di ridimensionamento colonna */}
                  <div
                    className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-blue-400/60"
                    onMouseDown={(e) => startColResize(c, e)}
                  />
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
                        className="sticky left-0 z-10 text-center text-[11px] text-zinc-500 select-none cursor-pointer hover:bg-zinc-200/60"
                        style={{ background: hdrBg, borderRight: gridLine, borderBottom: gridLine, position: 'sticky' }}
                        title="Seleziona la riga"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          // click sul numero = seleziona TUTTA la riga (stile Excel)
                          setEditing(null)
                          setSelRange({ r1: r, r2: r, c1: 0, c2: widths.length - 1 })
                        }}
                      >
                        <div className="relative w-full h-full flex items-center justify-center">
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
                        // Gridline di default SOLO se il foglio le mostra e la
                        // cella non ha un fill (in Excel il fill copre la
                        // gridline); i bordi espliciti della cella vincono.
                        const grid = sheet?.grid && !cell.bg ? gridLine : undefined
                        const inSel =
                          !!selRange && r >= selRange.r1 && r <= selRange.r2 && c >= selRange.c1 && c <= selRange.c2
                        const inFill =
                          !!fillPreview && r >= fillPreview.r1 && r <= fillPreview.r2 && c >= fillPreview.c1 && c <= fillPreview.c2
                        const isEditing = !!editing && editing.r === r && editing.c === c
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
                              // cella attiva (editing) = bordo Excel; selezione = tinta
                              boxShadow: isEditing
                                ? 'inset 0 0 0 2px #1a73e8'
                                : inSel
                                  ? 'inset 0 0 0 999px rgba(59,130,246,0.14)'
                                  : inFill
                                    ? 'inset 0 0 0 999px rgba(59,130,246,0.08)'
                                    : undefined,
                              color: cell.color ?? '#1f2937',
                              fontWeight: cell.b ? 700 : 400,
                              fontStyle: cell.i ? 'italic' : undefined,
                              fontSize: fs, // dimensione dal file, ridotta se la parola non ci sta
                              lineHeight: fs ? 1.15 : undefined,
                              textAlign: (cell.align as 'left' | 'center' | 'right') ?? (cell.num ? 'right' : 'left'),
                            }}
                            title={!cell.wrap && cell.t.length > 40 ? cell.t : undefined}
                            onMouseDown={(e) => {
                              if (e.button !== 0) return
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
                              setSelRange({
                                r1: Math.min(a.r, r),
                                r2: Math.max(a.r, r),
                                c1: Math.min(a.c, c),
                                c2: Math.max(a.c, c),
                              })
                            }}
                            onClick={() => {
                              // click singolo = modifica (se non era un drag di selezione)
                              if (!dragMoved.current && !isCsv && wb && !cell.chk) setEditing({ r, c })
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              setMenu({ x: e.clientX, y: e.clientY, r, c })
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
                              <input
                                autoFocus
                                defaultValue={rawOf(wb.worksheets[active].getRow(r + 1).getCell(c + 1))}
                                className="block w-full outline-none bg-transparent"
                                style={{
                                  color: cell.color ?? '#1f2937',
                                  fontSize: fs ?? 13,
                                  fontWeight: cell.b ? 700 : 400,
                                  fontStyle: cell.i ? 'italic' : undefined,
                                  textAlign: (cell.align as 'left' | 'center' | 'right') ?? (cell.num ? 'right' : 'left'),
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') commitEdit(r, c, e.currentTarget.value)
                                  else if (e.key === 'Escape') setEditing(null)
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

            {/* Bordo spesso della selezione (stile Excel): il bordo si può
                trascinare per SPOSTARE le celle; il quadratino è il fill handle. */}
            {selRange &&
              (() => {
                const colX = (cc: number) => {
                  let x = ROW_HDR_W
                  for (let i = 0; i < cc && i < widths.length; i++) x += widths[i]
                  return x
                }
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
                        title="Trascina per continuare la serie"
                      />
                    )}
                  </div>
                )
              })()}

            {/* Anteprima dello spostamento (tratteggiata) */}
            {movePreview &&
              (() => {
                const colX = (cc: number) => {
                  let x = ROW_HDR_W
                  for (let i = 0; i < cc && i < widths.length; i++) x += widths[i]
                  return x
                }
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
          </div>
        )}
      </div>

      {/* Menu tasto destro sulla griglia: righe/colonne/selezione */}
      {menu && !isCsv && (
        <>
          <div
            className="fixed inset-0 z-40"
            onMouseDown={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu(null)
            }}
          />
          <div
            className="fixed z-50 w-56 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1 text-sm"
            style={{ left: Math.min(menu.x, window.innerWidth - 240), top: Math.min(menu.y, window.innerHeight - 330) }}
          >
            {(
              [
                ['Aggiungi riga sopra', (ws: Worksheet) => ws.insertRow(menu.r + 1, [], 'i')],
                ['Aggiungi riga sotto', (ws: Worksheet) => ws.insertRow(menu.r + 2, [], 'i')],
                ['Duplica riga', (ws: Worksheet) => ws.duplicateRow(menu.r + 1, 1, true)],
                ['Elimina riga', (ws: Worksheet) => ws.spliceRows(menu.r + 1, 1)],
                null,
                ['Aggiungi colonna a sinistra', (ws: Worksheet) => ws.spliceColumns(menu.c + 1, 0, [])],
                ['Aggiungi colonna a destra', (ws: Worksheet) => ws.spliceColumns(menu.c + 2, 0, [])],
                ['Elimina colonna', (ws: Worksheet) => ws.spliceColumns(menu.c + 1, 1)],
              ] as ([string, (ws: Worksheet) => void] | null)[]
            ).map((item, idx) =>
              item === null ? (
                <div key={idx} className="h-px bg-zinc-700 my-1" />
              ) : (
                <button
                  key={item[0]}
                  className="w-full text-left px-3 py-1.5 text-zinc-200 hover:bg-zinc-700"
                  onClick={() => {
                    setMenu(null)
                    structural(item[1])
                  }}
                >
                  {item[0]}
                </button>
              ),
            )}
            {selRange && (
              <>
                <div className="h-px bg-zinc-700 my-1" />
                <button
                  className="w-full text-left px-3 py-1.5 text-zinc-200 hover:bg-zinc-700"
                  onClick={() => {
                    setMenu(null)
                    const sel = selRange
                    structural((ws) => {
                      for (let r = sel.r1; r <= sel.r2; r++)
                        for (let c = sel.c1; c <= sel.c2; c++) ws.getRow(r + 1).getCell(c + 1).value = null
                    })
                  }}
                >
                  Svuota celle selezionate
                </button>
              </>
            )}
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
        </div>
      )}
    </div>
  )
}
