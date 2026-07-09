// Motore di ricalcolo formule (Fase 16 del piano Office).
// Reuse-first: fast-formula-parser (MIT, ~280 funzioni Excel: SE, CERCA.VERT,
// statistiche, testo, date…) sopra il workbook ExcelJS — il FILE resta nostro
// (round-trip intatto), la libreria calcola tramite gli hook onCell/onRange.
// La libreria è caricata pigra (import dinamico) al primo ricalcolo.
import type { Workbook, Worksheet, Cell, CellValue } from 'exceljs'

// ---- Helper riferimenti (locali: evitano l'import circolare col viewer) ----

function colLetter(n: number): string {
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function colIndex(letters: string): number {
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}

// Trasla i riferimenti RELATIVI di (dr, dc) CONSERVANDO i '$' assoluti e le
// stringhe tra virgolette (per formule da scrivere nelle celle, es. il fill
// handle che trascina =SOMMA(B2:B4) in giù). I '$' bloccano riga/colonna.
export function shiftRefsAbs(formula: string, dr: number, dc: number): string {
  const parts = formula.split('"')
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = parts[i].replace(/(?<![\w$.])(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![\w(])/g, (_m, dCol, col, dRow, row) => {
      const cU = (col as string).toUpperCase()
      const c = dCol ? cU : colLetter(Math.max(1, colIndex(cU) + dc))
      const r = dRow ? row : String(Math.max(1, Number(row) + dr))
      return `${dCol}${c}${dRow}${r}`
    })
  }
  return parts.join('"')
}

// ---- Nomi funzione italiani → canonici inglesi ----
// Il file xlsx salva SEMPRE i nomi inglesi (Excel li traduce solo a schermo):
// quando l'utente scrive =SOMMA(...) la salviamo come SUM(...) così il file
// resta apribile ovunque.
const IT_EN: Record<string, string> = {
  SOMMA: 'SUM',
  'SOMMA.SE': 'SUMIF',
  'SOMMA.PIÙ.SE': 'SUMIFS',
  MEDIA: 'AVERAGE',
  'MEDIA.SE': 'AVERAGEIF',
  MEDIANA: 'MEDIAN',
  'CONTA.NUMERI': 'COUNT',
  CONTA: 'COUNT',
  'CONTA.VALORI': 'COUNTA',
  'CONTA.SE': 'COUNTIF',
  'CONTA.PIÙ.SE': 'COUNTIFS',
  'CONTA.VUOTE': 'COUNTBLANK',
  SE: 'IF',
  'PIÙ.SE': 'IFS',
  'SE.ERRORE': 'IFERROR',
  'SE.NON.DISP': 'IFNA',
  E: 'AND',
  O: 'OR',
  NON: 'NOT',
  'CERCA.VERT': 'VLOOKUP',
  'CERCA.ORIZZ': 'HLOOKUP',
  CERCA: 'LOOKUP',
  CONFRONTA: 'MATCH',
  INDICE: 'INDEX',
  SCARTO: 'OFFSET',
  ARROTONDA: 'ROUND',
  'ARROTONDA.PER.DIF': 'ROUNDDOWN',
  'ARROTONDA.PER.ECC': 'ROUNDUP',
  TRONCA: 'TRUNC',
  ASS: 'ABS',
  RADQ: 'SQRT',
  POTENZA: 'POWER',
  RESTO: 'MOD',
  'QUOZIENTE': 'QUOTIENT',
  PICCOLO: 'SMALL',
  GRANDE: 'LARGE',
  RANGO: 'RANK',
  'DEV.ST': 'STDEV',
  MODA: 'MODE',
  CASUALE: 'RAND',
  'CASUALE.TRA': 'RANDBETWEEN',
  'PI.GRECO': 'PI',
  OGGI: 'TODAY',
  ADESSO: 'NOW',
  GIORNO: 'DAY',
  MESE: 'MONTH',
  ANNO: 'YEAR',
  GIORNI: 'DAYS',
  DATA: 'DATE',
  ORA: 'HOUR',
  MINUTO: 'MINUTE',
  SECONDO: 'SECOND',
  'GIORNO.SETTIMANA': 'WEEKDAY',
  'FINE.MESE': 'EOMONTH',
  TESTO: 'TEXT',
  CONCATENA: 'CONCATENATE',
  MAIUSC: 'UPPER',
  MINUSC: 'LOWER',
  'ANNULLA.SPAZI': 'TRIM',
  LUNGHEZZA: 'LEN',
  SINISTRA: 'LEFT',
  DESTRA: 'RIGHT',
  'STRINGA.ESTRAI': 'MID',
  RIMPIAZZA: 'REPLACE',
  SOSTITUISCI: 'SUBSTITUTE',
  TROVA: 'FIND',
  RICERCA: 'SEARCH',
  RIPETI: 'REPT',
  VALORE: 'VALUE',
  'VAL.VUOTO': 'ISBLANK',
  'VAL.NUMERO': 'ISNUMBER',
  'VAL.TESTO': 'ISTEXT',
  'VAL.ERRORE': 'ISERROR',
}

// Nomi per l'autocompletamento (italiani + canonici, senza doppioni).
export const FORMULA_NAMES = [...new Set([...Object.keys(IT_EN), ...Object.values(IT_EN)])].sort()

// Normalizza una formula scritta dall'utente: nomi italiani → inglesi e,
// se usa lo stile italiano (';' tra argomenti), virgole decimali → punti e
// ';' → ','. Le stringhe tra virgolette non vengono toccate.
export function normalizeFormula(raw: string): string {
  const italianSeps = raw.includes(';')
  const parts = raw.split('"')
  for (let i = 0; i < parts.length; i += 2) {
    let s = parts[i]
    if (italianSeps) s = s.replace(/(\d),(\d)/g, '$1.$2').replace(/;/g, ',')
    s = s.replace(/([A-Za-zÀ-ù][A-Za-zÀ-ù.]*)\s*\(/g, (m, name: string) => {
      const en = IT_EN[name.toUpperCase()]
      return en ? `${en}(` : m
    })
    parts[i] = s
  }
  return parts.join('"')
}

// ---- Date: seriale Excel ⇄ Date JS (epoca 1899-12-30, convenzione std) ----
const EPOCH = Date.UTC(1899, 11, 30)
const DAY = 86_400_000
const toSerial = (d: Date) => (d.getTime() - EPOCH) / DAY
const fromSerial = (n: number) => new Date(EPOCH + Math.round(n * DAY))

// ---- Caricamento pigro del parser ----
interface ParserInstance {
  parse(formula: string, position: { sheet: string; row: number; col: number }): unknown
}
interface ParserCtor {
  new (config: {
    onCell: (ref: { sheet: string; row: number; col: number }) => unknown
    onRange: (ref: { sheet: string; from: { row: number; col: number }; to: { row: number; col: number } }) => unknown[][]
  }): ParserInstance
}
let ctorCache: ParserCtor | null = null
async function loadParser(): Promise<ParserCtor> {
  if (!ctorCache) {
    const m = (await import('fast-formula-parser')) as unknown as { default: ParserCtor }
    ctorCache = m.default
  }
  return ctorCache
}

// Risultato del parser → CellValue accettabile come result (o undefined se
// errore/#N/A/fuori supporto: in quel caso NON tocchiamo il cached del file,
// così GOOGLEFINANCE e simili restano com'erano).
function sanitize(out: unknown): CellValue | undefined {
  if (Array.isArray(out)) out = Array.isArray(out[0]) ? out[0][0] : out[0]
  if (out === null || out === undefined) return undefined
  if (typeof out === 'number') return Number.isFinite(out) ? out : undefined
  if (typeof out === 'string' || typeof out === 'boolean') return out
  return undefined // FormulaError e oggetti vari
}

const same = (a: unknown, b: unknown) =>
  a instanceof Date && b instanceof Date
    ? a.getTime() === b.getTime()
    : typeof a === 'number' && typeof b === 'number'
      ? Math.abs(a - b) < 1e-9
      : a === b

const isFormulaValue = (v: CellValue): v is CellValue & object =>
  !!v && typeof v === 'object' && !(v instanceof Date) && ('formula' in v || 'sharedFormula' in v)

// Formula effettiva di una cella: diretta, oppure condivisa (master traslato).
export function effectiveFormula(ws: Worksheet, cell: Cell): string | undefined {
  const v = cell.value as { formula?: string; sharedFormula?: string } | null
  if (!v) return undefined
  if (v.formula) return v.formula
  if (v.sharedFormula) {
    try {
      const master = ws.getCell(v.sharedFormula)
      const mv = master.value as { formula?: string } | null
      if (mv?.formula) {
        const dr = Number(cell.row) - Number(master.row)
        const dc = Number(cell.col) - Number(master.col)
        return shiftRefsAbs(mv.formula, dr, dc)
      }
    } catch {
      /* master non risolvibile */
    }
  }
  return undefined
}

// ---- Traslazione delle formule su inserimento/eliminazione righe-colonne ----
// (Excel riscrive i riferimenti; senza, una =SOMMA(B2:B10) diventerebbe
// silenziosamente sbagliata dopo un "Aggiungi riga".)

export type AdjustKind = 'insRow' | 'delRow' | 'insCol' | 'delCol'

// Riscrive UNA formula per l'operazione strutturale (pos è 1-based).
// Semantica Excel: gli estremi dei range si adattano (i range che attraversano
// il punto di inserimento si allargano); i riferimenti alla riga/colonna
// eliminata diventano #REF!.
export function adjustFormula(formula: string, kind: AdjustKind, pos: number): string {
  const parts = formula.split('"')
  const re =
    /(?<![\w$.!])(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?:(:)(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7}))?(?![\w(])/g
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = parts[i].replace(re, (_all, d1c, c1s, d1r, r1s, colon, d2c, c2s, d2r, r2s) => {
      let c1 = colIndex((c1s as string).toUpperCase())
      let r1 = Number(r1s)
      if (!colon) {
        if (kind === 'insRow' && r1 >= pos) r1++
        else if (kind === 'delRow') {
          if (r1 === pos) return '#REF!'
          if (r1 > pos) r1--
        } else if (kind === 'insCol' && c1 >= pos) c1++
        else if (kind === 'delCol') {
          if (c1 === pos) return '#REF!'
          if (c1 > pos) c1--
        }
        return `${d1c}${colLetter(c1)}${d1r}${r1}`
      }
      let c2 = colIndex((c2s as string).toUpperCase())
      let r2 = Number(r2s)
      if (kind === 'insRow') {
        if (r1 >= pos) r1++
        if (r2 >= pos) r2++
      } else if (kind === 'delRow') {
        if (r1 === pos && r2 === pos) return '#REF!'
        if (r1 > pos) r1--
        if (r2 >= pos) r2 = Math.max(r1, r2 - 1)
      } else if (kind === 'insCol') {
        if (c1 >= pos) c1++
        if (c2 >= pos) c2++
      } else {
        if (c1 === pos && c2 === pos) return '#REF!'
        if (c1 > pos) c1--
        if (c2 >= pos) c2 = Math.max(c1, c2 - 1)
      }
      return `${d1c}${colLetter(c1)}${d1r}${r1}:${d2c}${colLetter(c2)}${d2r}${r2}`
    })
  }
  return parts.join('"')
}

// Le formule CONDIVISE (sharedFormula) puntano al master per indirizzo: dopo
// uno splice l'indirizzo salvato è stantio. Prima dell'operazione strutturale
// le materializziamo in formule piene (stesso risultato, niente ambiguità).
export function materializeSharedFormulas(ws: Worksheet) {
  const slaves: { cell: Cell; f: string; res: CellValue }[] = []
  ws.eachRow((row) => {
    row.eachCell((cell) => {
      const v = cell.value as { sharedFormula?: string; result?: CellValue } | null
      if (v && typeof v === 'object' && !(v instanceof Date) && 'sharedFormula' in v) {
        const f = effectiveFormula(ws, cell)
        if (f) slaves.push({ cell, f, res: v.result ?? null })
      }
    })
  })
  for (const { cell, f, res } of slaves) cell.value = { formula: f, result: res } as CellValue
}

// Riscrive TUTTE le formule del foglio per l'operazione strutturale.
export function adjustSheetFormulas(ws: Worksheet, kind: AdjustKind, pos: number) {
  const targets: { cell: Cell; f: string; res: CellValue }[] = []
  ws.eachRow((row) => {
    row.eachCell((cell) => {
      const v = cell.value as { formula?: string; result?: CellValue } | null
      if (v && typeof v === 'object' && !(v instanceof Date) && 'formula' in v && v.formula) {
        targets.push({ cell, f: v.formula, res: v.result ?? null })
      }
    })
  })
  if (targets.length > 5000) return // fogli patologici: meglio non toccare
  for (const { cell, f, res } of targets) {
    const nf = adjustFormula(f, kind, pos)
    if (nf !== f) cell.value = { formula: nf, result: res } as CellValue
  }
}

// Ricalcola TUTTE le formule del foglio attivo (dipendenze risolte in modo
// ricorsivo attraverso onCell, cicli protetti, anche tra fogli). Scrive i
// result nel workbook (così il file salvato ha i valori aggiornati per ogni
// app) e restituisce le coordinate 0-based delle celle cambiate.
export async function recalcSheet(wb: Workbook, ws: Worksheet): Promise<{ r: number; c: number }[]> {
  // Censimento formule del foglio (fogli patologici: niente ricalcolo live).
  const formulaCells: { cell: Cell; r: number; c: number }[] = []
  ws.eachRow((row, r) => {
    row.eachCell((cell, c) => {
      if (isFormulaValue(cell.value)) formulaCells.push({ cell, r, c })
    })
  })
  if (!formulaCells.length || formulaCells.length > 3000) return []

  const Parser = await loadParser()
  const cache = new Map<string, unknown>()
  const evaluating = new Set<string>()

  // Valore di una cella per il motore: numeri/testi/bool diretti, date come
  // seriali, formule valutate ricorsivamente (memo + guardia sui cicli).
  function valueOf(wsX: Worksheet, cell: Cell): unknown {
    const v = cell.value
    if (v === null || v === undefined) return null
    if (v instanceof Date) return toSerial(v)
    if (typeof v === 'object') {
      if (isFormulaValue(v)) {
        const key = `${wsX.name}!${cell.address}`
        if (cache.has(key)) return cache.get(key)
        const vv = v as { result?: CellValue }
        const cached = vv.result instanceof Date ? toSerial(vv.result) : vv.result
        if (evaluating.has(key)) return cached ?? 0 // ciclo → cached
        const f = effectiveFormula(wsX, cell)
        if (!f) return cached ?? null
        evaluating.add(key)
        let out: unknown
        try {
          out = sanitize(parseAt(f, { sheet: wsX.name, row: Number(cell.row), col: Number(cell.col) }))
        } catch {
          out = undefined
        }
        evaluating.delete(key)
        if (out === undefined) out = cached ?? null // fuori supporto → cached
        cache.set(key, out)
        return out
      }
      const obj = v as { richText?: { text: string }[]; text?: unknown }
      if (obj.richText) return obj.richText.map((t) => t.text).join('')
      if ('text' in obj) return obj.text
      return null // errori e altri oggetti
    }
    return v // number | string | boolean
  }

  // Il parser NON è rientrante (parse annidato sulla stessa istanza = stato
  // corrotto, verificato): pool di istanze per PROFONDITÀ di ricorsione — se
  // ne creano tante quanti sono i livelli di formule annidate, non una per
  // formula (new Parser costa ~2,5 ms).
  const pool: ParserInstance[] = []
  let depth = 0
  const makeParser = (): ParserInstance =>
    new Parser({
      onCell: ({ sheet, row, col }) => {
        const wsX = (sheet && wb.getWorksheet(sheet)) || ws
        return valueOf(wsX, wsX.getRow(row).getCell(col))
      },
      onRange: ({ sheet, from, to }) => {
        const wsX = (sheet && wb.getWorksheet(sheet)) || ws
        // Colonne/righe intere (A:A) → clamp all'area davvero usata.
        // rowCount/columnCount = ULTIMO indice usato (actual*Count è un
        // CONTEGGIO delle righe/colonne piene: sui fogli sparsi taglierebbe
        // via dati veri — verificato).
        const r2 = Math.min(to.row, Math.max(wsX.rowCount || 1, from.row))
        const c2 = Math.min(to.col, Math.max(wsX.columnCount || 1, from.col))
        if ((r2 - from.row + 1) * (c2 - from.col + 1) > 200_000) return [[null]]
        const out: unknown[][] = []
        for (let r = from.row; r <= r2; r++) {
          const line: unknown[] = []
          for (let c = from.col; c <= c2; c++) line.push(valueOf(wsX, wsX.getRow(r).getCell(c)))
          out.push(line)
        }
        return out
      },
    })
  function parseAt(f: string, pos: { sheet: string; row: number; col: number }): unknown {
    if (!pool[depth]) pool[depth] = makeParser()
    const p = pool[depth]
    depth++
    try {
      return p.parse(f, pos)
    } finally {
      depth--
    }
  }

  const changed: { r: number; c: number }[] = []
  for (const { cell, r, c } of formulaCells) {
    const out = valueOf(ws, cell)
    const sane = sanitize(out)
    if (sane === undefined) continue
    const vv = cell.value as { result?: CellValue }
    const prev = vv.result
    // Se prima c'era una data, un risultato numerico resta una data.
    const next: CellValue = prev instanceof Date && typeof sane === 'number' ? fromSerial(sane) : sane
    if (!same(prev, next)) {
      cell.value = { ...(cell.value as object), result: next } as CellValue
      changed.push({ r: r - 1, c: c - 1 })
    }
  }
  return changed
}
