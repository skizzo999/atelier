import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { EditorState, StateField, type Extension, type Range } from '@codemirror/state'

// Tabelle stile Obsidian nella vista Ibrida: la tabella markdown è sostituita
// da un widget a blocco (StateField: i ViewPlugin non possono fare decorazioni
// a blocco) con celle contentEditable. Scrivi nel testo, la STRUTTURA resta:
// ogni modifica ri-serializza il markdown e lo riscrive nel documento.
// L'eco della nostra stessa modifica non ricostruisce il DOM (updateDOM
// confronta dataset.md) → il cursore resta dov'è mentre digiti.

type Align = 'left' | 'center' | 'right' | null
interface TableModel {
  header: string[]
  aligns: Align[]
  rows: string[][]
}

// ---------- parse / serializza ----------

// Divide una riga di tabella sulle | non escapate ('\|' resta nel testo cella).
function splitRow(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '\\' && line[i + 1] === '|') {
      cur += '\\|'
      i++
      continue
    }
    if (ch === '|') {
      cells.push(cur)
      cur = ''
    } else cur += ch
  }
  cells.push(cur)
  // "| a | b |" produce un frammento vuoto prima della prima e dopo l'ultima |.
  if (cells.length && cells[0].trim() === '') cells.shift()
  if (cells.length && cells[cells.length - 1].trim() === '') cells.pop()
  return cells.map((c) => c.trim())
}

function isDelimiterRow(line: string): boolean {
  return /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line) && line.includes('-') && line.includes('|')
}

function parseTable(md: string): TableModel {
  const lines = md.split('\n')
  const header = splitRow(lines[0] ?? '')
  const aligns: Align[] = splitRow(lines[1] ?? '').map((c) => {
    const l = c.startsWith(':')
    const r = c.endsWith(':')
    return l && r ? 'center' : r ? 'right' : l ? 'left' : null
  })
  const rows = lines.slice(2).map(splitRow)
  // Normalizza il numero di colonne (tolleranza sui md scritti a mano).
  const cols = Math.max(header.length, aligns.length, ...rows.map((r) => r.length), 1)
  const pad = (a: string[]) => a.concat(Array(Math.max(0, cols - a.length)).fill(''))
  return {
    header: pad(header),
    aligns: aligns.concat(Array(Math.max(0, cols - aligns.length)).fill(null)).slice(0, cols),
    rows: rows.map(pad),
  }
}

function serializeTable(m: TableModel): string {
  const row = (cells: string[]) => '| ' + cells.map((c) => c || ' ').join(' | ') + ' |'
  const delim = m.aligns
    .map((a) => (a === 'center' ? ':---:' : a === 'right' ? '---:' : a === 'left' ? ':---' : '---'))
    .join(' | ')
  return [row(m.header), `| ${delim} |`, ...m.rows.map(row)].join('\n')
}

// ---------- ricerca delle tabelle nel documento (scansione righe, no parser) ----------

interface TableRange {
  from: number
  to: number
  md: string
}

function findTables(state: EditorState): TableRange[] {
  const doc = state.doc
  const out: TableRange[] = []
  let inFence = false
  let n = 1
  while (n <= doc.lines) {
    const text = doc.line(n).text
    if (/^\s*(```|~~~)/.test(text)) {
      inFence = !inFence
      n++
      continue
    }
    if (!inFence && text.includes('|') && text.trim() !== '' && n < doc.lines && isDelimiterRow(doc.line(n + 1).text)) {
      let end = n + 1
      while (end + 1 <= doc.lines) {
        const nt = doc.line(end + 1).text
        if (!nt.includes('|') || nt.trim() === '' || /^\s*(```|~~~)/.test(nt)) break
        end++
      }
      const from = doc.line(n).from
      const to = doc.line(end).to
      out.push({ from, to, md: doc.sliceString(from, to) })
      n = end + 1
      continue
    }
    n++
  }
  return out
}

// ---------- helper celle ----------

const unescapeCell = (s: string) => s.replace(/\\\|/g, '|')
const escapeCell = (s: string) => s.replace(/\r?\n/g, ' ').replace(/\\\|/g, '|').replace(/\|/g, '\\|')

// Riga della cella nel modello: -1 = intestazione, 0.. = corpo.
function cellPos(el: Element): { r: number; c: number } {
  return { r: Number((el as HTMLElement).dataset.r), c: Number((el as HTMLElement).dataset.c) }
}

function caretToEnd(el: HTMLElement) {
  el.focus()
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

// ---------- menu contestuale (DOM puro: viviamo dentro CodeMirror) ----------

interface MenuItem {
  label: string
  disabled?: boolean
  action?: () => void
  children?: MenuItem[]
  separator?: boolean
}

function openMenu(x: number, y: number, items: MenuItem[]) {
  closeMenu()
  const root = buildMenuList(items)
  root.classList.add('cm-tablemenu-root')
  root.style.left = `${x}px`
  root.style.top = `${y}px`
  document.body.appendChild(root)
  // Se sborda in basso/destra, rientra.
  const r = root.getBoundingClientRect()
  if (r.bottom > window.innerHeight) root.style.top = `${Math.max(4, window.innerHeight - r.height - 8)}px`
  if (r.right > window.innerWidth) root.style.left = `${Math.max(4, window.innerWidth - r.width - 8)}px`
  const close = (e: MouseEvent) => {
    if (!root.contains(e.target as Node)) closeMenu()
  }
  const esc = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeMenu()
  }
  document.addEventListener('mousedown', close, true)
  document.addEventListener('keydown', esc, true)
  menuCleanup = () => {
    document.removeEventListener('mousedown', close, true)
    document.removeEventListener('keydown', esc, true)
    root.remove()
  }
}

let menuCleanup: (() => void) | null = null
function closeMenu() {
  menuCleanup?.()
  menuCleanup = null
}

function buildMenuList(items: MenuItem[]): HTMLDivElement {
  const list = document.createElement('div')
  list.className = 'cm-tablemenu'
  for (const it of items) {
    if (it.separator) {
      const sep = document.createElement('div')
      sep.className = 'cm-tablemenu-sep'
      list.appendChild(sep)
      continue
    }
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'cm-tablemenu-item'
    row.textContent = it.label
    if (it.disabled) row.disabled = true
    if (it.children) {
      row.classList.add('has-sub')
      const sub = buildMenuList(it.children)
      sub.classList.add('cm-tablemenu-sub')
      row.appendChild(sub)
      // Se il sottomenu sborda dal bordo destro/basso della finestra, ribaltalo.
      row.addEventListener('mouseenter', () => {
        requestAnimationFrame(() => {
          const r = sub.getBoundingClientRect()
          if (r.width === 0) return // non visibile
          sub.classList.toggle('cm-tablemenu-flip', r.right > window.innerWidth - 4)
          if (r.bottom > window.innerHeight - 4) {
            sub.style.top = `${-5 - (r.bottom - window.innerHeight + 8)}px`
          }
        })
      })
    } else if (it.action) {
      row.addEventListener('click', () => {
        closeMenu()
        it.action!()
      })
    }
    list.appendChild(row)
  }
  return list
}

// ---------- widget ----------

class TableWidget extends WidgetType {
  constructor(readonly md: string) {
    super()
  }
  eq(other: TableWidget) {
    return other.md === this.md
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement('div')
    wrap.className = 'cm-mdtable-wrap'
    wrap.dataset.md = this.md
    renderTable(wrap, this.md, view)
    return wrap
  }
  updateDOM(dom: HTMLElement, view: EditorView) {
    // Eco di una modifica partita dal widget stesso: DOM già aggiornato.
    if (dom.dataset.md === this.md) return true
    // Modifica esterna (undo, altro): ricostruisci in place.
    dom.dataset.md = this.md
    renderTable(dom, this.md, view)
    return true
  }
  ignoreEvent() {
    return true // gli eventi dentro il widget sono nostri, non di CodeMirror
  }
}

// Range attuale della tabella di questo widget (le posizioni si spostano col testo).
function rangeOfWrap(view: EditorView, wrap: HTMLElement): TableRange | null {
  const pos = view.posAtDOM(wrap)
  const tables = findTables(view.state)
  return tables.find((t) => t.from === pos) ?? tables.find((t) => pos >= t.from && pos <= t.to) ?? null
}

function renderTable(wrap: HTMLElement, md: string, view: EditorView) {
  const model = parseTable(md)
  wrap.replaceChildren()

  const table = document.createElement('table')
  table.className = 'cm-lp-mdtable'

  // Selezione multi-cella stile Excel (drag): stato locale a questo render.
  let selecting = false
  let selAnchor: { r: number; c: number } | null = null
  let selRange: { r1: number; c1: number; r2: number; c2: number } | null = null

  const allCells = () => Array.from(table.querySelectorAll<HTMLElement>('[data-r]'))

  function applySelClasses() {
    for (const el of allCells()) {
      const { r, c } = cellPos(el)
      const inSel = !!selRange && r >= selRange.r1 && r <= selRange.r2 && c >= selRange.c1 && c <= selRange.c2
      el.classList.toggle('cm-mdtable-selcell', inSel)
    }
  }
  function clearSel() {
    selRange = null
    applySelClasses()
  }

  // Riscrive il markdown della tabella nel documento. `echo` = modifica di solo
  // testo (il DOM è già giusto → sopprimi la ricostruzione impostando dataset).
  function writeBack(newMd: string, echo: boolean, focus?: { r: number; c: number }) {
    const range = rangeOfWrap(view, wrap)
    if (!range) return
    if (echo) wrap.dataset.md = newMd
    view.dispatch({ changes: { from: range.from, to: range.to, insert: newMd } })
    if (!echo && focus) {
      // Dopo la ricostruzione (sincrona nel dispatch) rimetti il focus sulla cella.
      requestAnimationFrame(() => {
        const cell = wrap.querySelector<HTMLElement>(`[data-r="${focus.r}"][data-c="${focus.c}"]`)
        if (cell) caretToEnd(cell)
      })
    }
  }

  // Modello con il TESTO ATTUALE delle celle letto dal DOM: le modifiche di
  // solo testo non ricostruiscono il widget (di proposito), quindi il modello
  // del render può essere stantio — il DOM è l'unica fonte di verità del testo.
  function modelFromDOM(): TableModel {
    const m: TableModel = { header: [...model.header], aligns: [...model.aligns], rows: model.rows.map((r) => [...r]) }
    for (const el of allCells()) {
      const { r, c } = cellPos(el)
      const text = escapeCell(el.textContent ?? '')
      if (r === -1) m.header[c] = text
      else if (m.rows[r]) m.rows[r][c] = text
    }
    return m
  }

  // Modifiche di testo: DOM → markdown (eco soppressa, il cursore resta).
  function commitText() {
    writeBack(serializeTable(modelFromDOM()), true)
  }

  // Operazione strutturale: parte dal testo attuale, muta e ricostruisce.
  function structural(mutate: (m: TableModel) => void, focus: { r: number; c: number }) {
    const m = modelFromDOM()
    mutate(m)
    const cols = m.header.length
    m.rows = m.rows.map((r) => r.concat(Array(Math.max(0, cols - r.length)).fill('')).slice(0, cols))
    writeBack(serializeTable(m), false, {
      r: Math.min(focus.r, m.rows.length - 1),
      c: Math.max(0, Math.min(focus.c, cols - 1)),
    })
  }

  const emptyRow = (cols: number) => Array(cols).fill('')

  function makeCell(tag: 'th' | 'td', r: number, c: number, text: string, align: Align): HTMLElement {
    const el = document.createElement(tag)
    el.dataset.r = String(r)
    el.dataset.c = String(c)
    el.contentEditable = 'true'
    el.spellcheck = false
    el.textContent = unescapeCell(text)
    if (align) el.style.textAlign = align
    return el
  }

  // Intestazione + corpo.
  const thead = document.createElement('thead')
  const hr = document.createElement('tr')
  model.header.forEach((cell, c) => hr.appendChild(makeCell('th', -1, c, cell, model.aligns[c])))
  thead.appendChild(hr)
  table.appendChild(thead)

  const tbody = document.createElement('tbody')
  model.rows.forEach((row, r) => {
    const tr = document.createElement('tr')
    row.forEach((cell, c) => tr.appendChild(makeCell('td', r, c, cell, model.aligns[c])))
    tbody.appendChild(tr)
  })
  table.appendChild(tbody)

  // ---- eventi (delegati sulla tabella, mai fatti risalire a CodeMirror) ----

  const cellOf = (e: Event) => (e.target as Element).closest?.('[data-r]') as HTMLElement | null

  table.addEventListener('input', (e) => {
    e.stopPropagation()
    if (cellOf(e)) commitText()
  })

  table.addEventListener('paste', (e) => {
    e.stopPropagation()
    const cell = cellOf(e)
    if (!cell) return
    e.preventDefault()
    const text = e.clipboardData?.getData('text/plain').replace(/\r?\n/g, ' ') ?? ''
    document.execCommand('insertText', false, text)
  })

  table.addEventListener('copy', (e) => {
    e.stopPropagation()
    if (!selRange) return
    // Copia la selezione multi-cella come TSV (testo attuale dal DOM).
    e.preventDefault()
    const m = modelFromDOM()
    const lines: string[] = []
    for (let r = selRange.r1; r <= selRange.r2; r++) {
      const cells: string[] = []
      for (let c = selRange.c1; c <= selRange.c2; c++) {
        cells.push(unescapeCell(r === -1 ? m.header[c] ?? '' : m.rows[r]?.[c] ?? ''))
      }
      lines.push(cells.join('\t'))
    }
    e.clipboardData?.setData('text/plain', lines.join('\n'))
  })

  table.addEventListener('keydown', (e) => {
    e.stopPropagation()
    const cell = cellOf(e)

    // Selezione multi-cella attiva: Canc/Backspace svuota le celle selezionate.
    if (selRange && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault()
      const sr = selRange
      structural(
        (m) => {
          for (let r = sr.r1; r <= sr.r2; r++)
            for (let c = sr.c1; c <= sr.c2; c++) {
              if (r === -1) m.header[c] = ''
              else if (m.rows[r]) m.rows[r][c] = ''
            }
        },
        { r: sr.r1, c: sr.c1 },
      )
      return
    }
    if (!cell) return
    const { r, c } = cellPos(cell)
    const cols = model.header.length
    const ordered = allCells()

    if (e.key === 'Tab') {
      e.preventDefault()
      const idx = ordered.indexOf(cell)
      if (!e.shiftKey && idx === ordered.length - 1) {
        // Tab sull'ultima cella = nuova riga (come Obsidian).
        structural((m) => m.rows.push(emptyRow(cols)), { r: model.rows.length, c: 0 })
        return
      }
      const next = ordered[idx + (e.shiftKey ? -1 : 1)]
      if (next) caretToEnd(next)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (r === model.rows.length - 1 || (r === -1 && model.rows.length === 0)) {
        structural((m) => m.rows.push(emptyRow(cols)), { r: model.rows.length, c })
      } else {
        const below = wrap.querySelector<HTMLElement>(`[data-r="${r + 1}"][data-c="${c}"]`)
        if (below) caretToEnd(below)
      }
      return
    }
    if (e.key === 'Escape') {
      const range = rangeOfWrap(view, wrap)
      if (range) {
        const anchor = Math.min(range.to + 1, view.state.doc.length)
        view.dispatch({ selection: { anchor } })
        view.focus()
      }
      return
    }
  })

  // Drag di selezione celle (stile Excel): parte quando trascini SU UN'ALTRA cella.
  table.addEventListener('mousedown', (e) => {
    e.stopPropagation()
    const cell = cellOf(e)
    clearSel()
    if (!cell || e.button !== 0) return
    selecting = true
    selAnchor = cellPos(cell)
    const up = () => {
      selecting = false
      document.removeEventListener('mouseup', up)
    }
    document.addEventListener('mouseup', up)
  })
  table.addEventListener('mouseover', (e) => {
    if (!selecting || !selAnchor) return
    const cell = cellOf(e)
    if (!cell) return
    const p = cellPos(cell)
    if (p.r === selAnchor.r && p.c === selAnchor.c && !selRange) return
    selRange = {
      r1: Math.min(selAnchor.r, p.r),
      r2: Math.max(selAnchor.r, p.r),
      c1: Math.min(selAnchor.c, p.c),
      c2: Math.max(selAnchor.c, p.c),
    }
    window.getSelection()?.removeAllRanges() // niente selezione di testo mista
    applySelClasses()
  })

  // Menu rapido col tasto destro (Riga / Colonna / Ordina).
  table.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    e.stopPropagation()
    const cell = cellOf(e)
    if (!cell) return
    const { r, c } = cellPos(cell)
    const cols = model.header.length
    const isHeader = r === -1
    openMenu(e.clientX, e.clientY, [
      {
        label: 'Riga',
        children: [
          { label: 'Aggiungi riga prima', disabled: isHeader, action: () => structural((m) => m.rows.splice(r, 0, emptyRow(cols)), { r, c }) },
          { label: 'Aggiungi riga dopo', action: () => structural((m) => m.rows.splice(isHeader ? 0 : r + 1, 0, emptyRow(cols)), { r: isHeader ? 0 : r + 1, c }) },
          { label: 'Sposta riga su', disabled: isHeader || r === 0, action: () => structural((m) => m.rows.splice(r - 1, 0, ...m.rows.splice(r, 1)), { r: r - 1, c }) },
          { label: 'Sposta riga giù', disabled: isHeader || r === model.rows.length - 1, action: () => structural((m) => m.rows.splice(r + 1, 0, ...m.rows.splice(r, 1)), { r: r + 1, c }) },
          { label: 'Duplica riga', disabled: isHeader, action: () => structural((m) => m.rows.splice(r + 1, 0, [...m.rows[r]]), { r: r + 1, c }) },
          { label: 'Elimina riga', disabled: isHeader || model.rows.length <= 1, action: () => structural((m) => m.rows.splice(r, 1), { r: Math.max(0, r - 1), c }) },
        ],
      },
      {
        label: 'Colonna',
        children: [
          {
            label: 'Aggiungi colonna prima',
            action: () =>
              structural(
                (m) => {
                  m.header.splice(c, 0, '')
                  m.aligns.splice(c, 0, null)
                  m.rows.forEach((row) => row.splice(c, 0, ''))
                },
                { r, c },
              ),
          },
          {
            label: 'Aggiungi colonna dopo',
            action: () =>
              structural(
                (m) => {
                  m.header.splice(c + 1, 0, '')
                  m.aligns.splice(c + 1, 0, null)
                  m.rows.forEach((row) => row.splice(c + 1, 0, ''))
                },
                { r, c: c + 1 },
              ),
          },
          {
            label: 'Sposta colonna a sinistra',
            disabled: c === 0,
            action: () =>
              structural(
                (m) => {
                  m.header.splice(c - 1, 0, ...m.header.splice(c, 1))
                  m.aligns.splice(c - 1, 0, ...m.aligns.splice(c, 1))
                  m.rows.forEach((row) => row.splice(c - 1, 0, ...row.splice(c, 1)))
                },
                { r, c: c - 1 },
              ),
          },
          {
            label: 'Sposta colonna a destra',
            disabled: c === cols - 1,
            action: () =>
              structural(
                (m) => {
                  m.header.splice(c + 1, 0, ...m.header.splice(c, 1))
                  m.aligns.splice(c + 1, 0, ...m.aligns.splice(c, 1))
                  m.rows.forEach((row) => row.splice(c + 1, 0, ...row.splice(c, 1)))
                },
                { r, c: c + 1 },
              ),
          },
          {
            label: 'Duplica colonna',
            action: () =>
              structural(
                (m) => {
                  m.header.splice(c + 1, 0, m.header[c])
                  m.aligns.splice(c + 1, 0, m.aligns[c])
                  m.rows.forEach((row) => row.splice(c + 1, 0, row[c]))
                },
                { r, c: c + 1 },
              ),
          },
          {
            label: 'Elimina colonna',
            disabled: cols <= 1,
            action: () =>
              structural(
                (m) => {
                  m.header.splice(c, 1)
                  m.aligns.splice(c, 1)
                  m.rows.forEach((row) => row.splice(c, 1))
                },
                { r, c: Math.max(0, c - 1) },
              ),
          },
        ],
      },
      { label: '', separator: true },
      {
        label: 'Ordina',
        children: [
          {
            label: 'Dalla A alla Z (crescente)',
            action: () => structural((m) => m.rows.sort((a, b) => unescapeCell(a[c] ?? '').localeCompare(unescapeCell(b[c] ?? ''))), { r: 0, c }),
          },
          {
            label: 'Dalla Z alla A (decrescente)',
            action: () => structural((m) => m.rows.sort((a, b) => unescapeCell(b[c] ?? '').localeCompare(unescapeCell(a[c] ?? ''))), { r: 0, c }),
          },
        ],
      },
    ])
  })

  wrap.appendChild(table)

  // "+" a fondo tabella = aggiungi riga dopo; "+" sul bordo destro = colonna.
  const addRow = document.createElement('button')
  addRow.type = 'button'
  addRow.className = 'cm-mdtable-addrow'
  addRow.textContent = '+'
  addRow.title = 'Aggiungi riga dopo'
  addRow.addEventListener('mousedown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    structural((m) => m.rows.push(emptyRow(model.header.length)), { r: model.rows.length, c: 0 })
  })
  wrap.appendChild(addRow)

  const addCol = document.createElement('button')
  addCol.type = 'button'
  addCol.className = 'cm-mdtable-addcol'
  addCol.textContent = '+'
  addCol.title = 'Aggiungi colonna dopo'
  addCol.addEventListener('mousedown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    structural(
      (m) => {
        m.header.push('')
        m.aligns.push(null)
        m.rows.forEach((row) => row.push(''))
      },
      { r: -1, c: model.header.length },
    )
  })
  wrap.appendChild(addCol)
}

// ---------- StateField ----------

function buildDecorations(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = []
  for (const t of findTables(state)) {
    ranges.push(Decoration.replace({ widget: new TableWidget(t.md), block: true }).range(t.from, t.to))
  }
  return Decoration.set(ranges)
}

const tableField = StateField.define<DecorationSet>({
  create: buildDecorations,
  update(deco, tr) {
    if (!tr.docChanged) return deco
    return buildDecorations(tr.state)
  },
  provide: (f) => EditorView.decorations.from(f),
})

const tableTheme = EditorView.theme({
  '.cm-mdtable-wrap': {
    position: 'relative',
    margin: '0.6em 0',
    paddingRight: '22px',
    paddingBottom: '4px',
  },
  '.cm-lp-mdtable': {
    borderCollapse: 'collapse',
    fontSize: '0.95em',
    width: '100%',
  },
  '.cm-lp-mdtable th, .cm-lp-mdtable td': {
    border: '1px solid #334155',
    padding: '0.35em 0.7em',
    textAlign: 'left',
    minWidth: '3em',
    outline: 'none',
    caretColor: '#f1f5f9',
  },
  '.cm-lp-mdtable th': { background: 'rgba(255,255,255,0.05)', fontWeight: '700', color: '#f1f5f9' },
  '.cm-lp-mdtable td:focus, .cm-lp-mdtable th:focus': {
    boxShadow: 'inset 0 0 0 2px rgba(96,165,250,0.6)',
  },
  '.cm-mdtable-selcell': {
    background: 'rgba(59,130,246,0.2) !important',
    boxShadow: 'inset 0 0 0 1px rgba(96,165,250,0.7)',
  },
  '.cm-mdtable-addrow': {
    display: 'block',
    width: 'calc(100% - 22px)',
    border: '1px dashed transparent',
    background: 'transparent',
    color: 'transparent',
    fontSize: '13px',
    lineHeight: '1',
    padding: '2px 0',
    cursor: 'pointer',
    borderRadius: '4px',
  },
  '.cm-mdtable-addcol': {
    position: 'absolute',
    top: '0',
    right: '0',
    bottom: '10px',
    width: '18px',
    border: '1px dashed transparent',
    background: 'transparent',
    color: 'transparent',
    fontSize: '13px',
    cursor: 'pointer',
    borderRadius: '4px',
  },
  '.cm-mdtable-wrap:hover .cm-mdtable-addrow, .cm-mdtable-wrap:hover .cm-mdtable-addcol': {
    color: '#94a3b8',
    borderColor: '#334155',
    background: 'rgba(255,255,255,0.03)',
  },
  '.cm-mdtable-addrow:hover, .cm-mdtable-addcol:hover': {
    background: 'rgba(96,165,250,0.15) !important',
    color: '#f1f5f9 !important',
  },
})

export function tableEditor(): Extension {
  return [tableField, tableTheme]
}
