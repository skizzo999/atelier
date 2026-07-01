import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import Image from '@tiptap/extension-image'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import { TextStyle, Color, FontFamily, FontSize } from '@tiptap/extension-text-style'
import { ParagraphLineHeight } from '../../lib/lineHeight'
import Highlight from '@tiptap/extension-highlight'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import Typography from '@tiptap/extension-typography'
import { readFile, readTextFile, writeTextFile, exists } from '@tauri-apps/plugin-fs'
import DOMPurify from 'dompurify'
import * as mammoth from 'mammoth'
import { revealInExplorer } from '../../lib/imageActions'
import { writeFileBinaryAtomic } from '../../lib/fileOps'
import { htmlToDocxBlob, type DocxLayout } from '../../lib/htmlToDocx'
import { PaginationPlus } from 'tiptap-pagination-plus'
import { DocSettings, type PageNumMode, type DocLayout, FORMATS, cmToPx } from './DocSettings'
import { useAppStore } from '../../store/appStore'

// Numero totale di pagine (l'estensione conosce solo {page}, non il totale).
function pageTotalOf(editor: Editor): number {
  const f = editor.view.dom.querySelectorAll('.rm-page-footer').length
  return f || editor.view.dom.querySelectorAll('.rm-page-break').length + 1
}
function footerTextFor(mode: PageNumMode, total: number): string {
  if (mode === 'page') return '{page}'
  if (mode === 'page-total') return `{page} / ${total}`
  if (mode === 'page-of-total') return `Pagina {page} di ${total}`
  return ''
}

// Tutte le impostazioni documento (salvate in un file affianco al .docx).
type FullSettings = DocLayout & { paper: string; footerLeft: string; pageNum: PageNumMode }
const DEFAULT_SETTINGS: FullSettings = {
  format: 'A4',
  landscape: false,
  margins: { top: 2.5, bottom: 2.5, left: 2, right: 2 },
  headerLeft: '',
  headerRight: '',
  paper: '#ffffff',
  footerLeft: '',
  pageNum: 'none',
}

// Sfondo dell'area documento = colore dei "gap" tra le pagine: così i fogli A4
// (bianchi) sembrano staccati l'uno dall'altro.
const PAGE_BG = '#4b4f55'

const extensions = [
  StarterKit,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Image,
  // Tabelle: estensione attiva per fedeltà sui .docx importati.
  Table.configure({ resizable: true }),
  TableRow,
  TableHeader,
  TableCell,
  // Stile testo: colore, font, dimensione, interlinea, evidenziatore (gratis/MIT).
  TextStyle,
  Color,
  FontFamily,
  FontSize,
  ParagraphLineHeight, // interlinea per paragrafo (la nostra, vedi lib/lineHeight)
  Highlight.configure({ multicolor: true }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Subscript,
  Superscript,
  Typography,
  // Paginazione vera A4 (open-source, v3): fogli distinti, margini, header/footer.
  PaginationPlus.configure({
    pageWidth: 794,
    pageHeight: 1123,
    marginTop: 95,
    marginBottom: 95,
    marginLeft: 76,
    marginRight: 76,
    pageGap: 30,
    pageGapBorderSize: 0,
    pageGapBorderColor: PAGE_BG, // eventuale bordo gap = invisibile (no "stanghetta")
    pageBreakBackground: PAGE_BG, // gap = sfondo → pagine staccate
  }),
]

// Bottone della barra strumenti (stile Atelier: attivo = accento blu).
function TBtn({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void
  active?: boolean
  disabled?: boolean
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()} // non perdere la selezione nell'editor
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`min-w-7 h-7 px-1.5 rounded text-sm leading-none flex items-center justify-center ${
        active ? 'bg-blue-600 text-white' : 'text-zinc-300 hover:bg-zinc-700'
      } disabled:opacity-40`}
    >
      {children}
    </button>
  )
}

const Sep = () => <span className="w-px h-5 bg-zinc-700 mx-1" />

const FONTS = ['Predefinito', 'Inter', 'Arial', 'Times New Roman', 'Georgia', 'Calibri', 'Verdana', 'Courier New', 'Garamond']
const SIZES = [10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 48]
const LINE_HEIGHTS = ['1', '1.15', '1.5', '2', '2.5']
const TEXT_COLORS = ['#111827', '#6b7280', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#0891b2']
const HL_COLORS = ['#fde047', '#fca5a5', '#fdba74', '#bef264', '#6ee7b7', '#a5f3fc', '#a5b4fc', '#d8b4fe', '#f9a8d4', '#e5e7eb']

const sel = 'h-7 bg-zinc-800 border border-zinc-700 rounded text-zinc-200 text-xs px-1'

// Un unico tasto colore+evidenziatore (come il Docx editor di TipTap).
function ColorPopover({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  const cur = editor.getAttributes('textStyle').color as string | undefined
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        title="Colore e evidenziatore"
        className="min-w-7 h-7 px-1 rounded text-sm flex items-center gap-0.5 text-zinc-300 hover:bg-zinc-700"
      >
        <span className="font-bold" style={{ color: cur || undefined }}>
          A
        </span>
        <span className="text-[8px]">▾</span>
      </button>
      {open && (
        <div className="absolute z-50 top-8 left-0 w-56 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-3">
          <div className="text-[11px] text-zinc-400 mb-1.5">Colore testo</div>
          <div className="grid grid-cols-5 gap-2 mb-3">
            {TEXT_COLORS.map((c) => (
              <button
                key={c}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor.chain().focus().setColor(c).run()}
                className="h-6 w-6 rounded-full border border-zinc-600"
                style={{ background: c }}
                title={c}
              />
            ))}
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.chain().focus().unsetColor().run()}
              className="h-6 w-6 rounded-full border border-zinc-600 bg-white text-zinc-900 text-[10px] flex items-center justify-center"
              title="Nessun colore"
            >
              ⌀
            </button>
          </div>
          <div className="text-[11px] text-zinc-400 mb-1.5">Evidenziatore</div>
          <div className="grid grid-cols-5 gap-2">
            {HL_COLORS.map((c) => (
              <button
                key={c}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor.chain().focus().setHighlight({ color: c }).run()}
                className="h-6 w-6 rounded border border-zinc-600"
                style={{ background: c }}
                title={c}
              />
            ))}
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.chain().focus().unsetHighlight().run()}
              className="h-6 w-6 rounded border border-zinc-600 bg-zinc-800 text-zinc-300 text-[10px] flex items-center justify-center"
              title="Togli evidenziatore"
            >
              ⌫
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// Editor DOCX (TipTap): apri il .docx ed è subito editabile, con barra strumenti
// in stile Word ma con l'identità di Atelier. Salva = sovrascrive il .docx.
export function DocxEditor({ filePath }: { filePath: string }) {
  const setSelectedFile = useAppStore((s) => s.setSelectedFile)
  const setBuffer = useAppStore((s) => s.setBuffer)
  const clearBuffer = useAppStore((s) => s.clearBuffer)
  // "Non salvato" = c'è un buffer per questo file (mostra anche il pallino nel tree).
  const dirty = useAppStore((s) => s.dirtyBuffers[filePath] !== undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [paperColor, setPaperColor] = useState('#ffffff')
  const paperColorRef = useRef('#ffffff')
  paperColorRef.current = paperColor
  const [pageNumMode, setPageNumMode] = useState<PageNumMode>('none')
  const pageNumModeRef = useRef<PageNumMode>('none')
  pageNumModeRef.current = pageNumMode
  const [footerLeft, setFooterLeft] = useState('') // testo libero in basso a sinistra
  const footerLeftRef = useRef('')
  footerLeftRef.current = footerLeft
  // Impostazioni di impaginazione (per scriverle nel .docx al salvataggio).
  const layoutRef = useRef<DocLayout>({
    format: 'A4',
    landscape: false,
    margins: { top: 2.5, bottom: 2.5, left: 2, right: 2 },
    headerLeft: '',
    headerRight: '',
  })
  const [, setTick] = useState(0)
  const importingRef = useRef(true) // true mentre carico: ignora gli update
  const scrollRef = useRef<HTMLDivElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  // Inserisce un'immagine dal file system (come data URI, così resta nel documento).
  function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !editor) return
    const reader = new FileReader()
    reader.onload = () => editor.chain().focus().setImage({ src: String(reader.result) }).run()
    reader.readAsDataURL(file)
  }

  const editor = useEditor({
    extensions,
    content: '',
    immediatelyRender: false, // evita problemi col doppio mount di StrictMode
    editorProps: {
      attributes: { class: 'prose max-w-none focus:outline-none' },
    },
    onUpdate: ({ editor }) => {
      if (importingRef.current) return
      setBuffer(filePath, editor.getHTML()) // modifica → buffer (persiste tra i file)
    },
    onTransaction: () => setTick((t) => (t + 1) % 1_000_000), // barra riflette lo stato
  })

  // Apre il .docx: se ci sono modifiche non salvate (buffer) le ripristina,
  // altrimenti importa dal file (Mammoth → HTML).
  useEffect(() => {
    if (!editor) return
    let cancelled = false
    importingRef.current = true
    setLoading(true)
    setError(false)
    ;(async () => {
      // Impostazioni documento dal file affianco (margini, orientamento, header/piè, colore).
      let settings = DEFAULT_SETTINGS
      try {
        if (await exists(`${filePath}.atelier`)) {
          settings = { ...DEFAULT_SETTINGS, ...JSON.parse(await readTextFile(`${filePath}.atelier`)) }
        }
      } catch {
        /* niente impostazioni salvate */
      }
      const buffered = useAppStore.getState().dirtyBuffers[filePath]
      if (buffered !== undefined) {
        editor.commands.setContent(buffered)
        applyAllSettings(settings) // subito, prima di mostrare: niente flash del bianco
        setLoading(false)
        setTimeout(() => (importingRef.current = false), 400)
        return
      }
      const bytes = await readFile(filePath)
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      const result = await mammoth.convertToHtml({ arrayBuffer })
      if (cancelled) return
      editor.commands.setContent(DOMPurify.sanitize(result.value))
      applyAllSettings(settings) // subito, prima di mostrare: niente flash del bianco
      setLoading(false)
      setTimeout(() => (importingRef.current = false), 400)
    })().catch((e) => {
      console.error('Errore apertura DOCX:', e)
      if (!cancelled) {
        setError(true)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [filePath, editor])

  // Salva SOVRASCRIVENDO il .docx (backup .bak pristino la prima volta).
  async function save() {
    if (!editor || saving) return
    setSaving(true)
    try {
      const bak = `${filePath}.bak`
      if (!(await exists(bak))) {
        const orig = await readFile(filePath)
        await writeFileBinaryAtomic(bak, orig)
      }
      // HTML pulito del documento (no chrome di paginazione: header/footer/gap).
      const container = document.createElement('div')
      container.innerHTML = editor.getHTML()
      // Impaginazione → sezione Word (formato/orientamento/margini/header/footer).
      const lay = layoutRef.current
      const f = FORMATS[lay.format] ?? FORMATS.A4
      const docxLayout: DocxLayout = {
        pageWidthPx: lay.landscape ? f.h : f.w,
        pageHeightPx: lay.landscape ? f.w : f.h,
        marginsPx: {
          top: cmToPx(lay.margins.top),
          bottom: cmToPx(lay.margins.bottom),
          left: cmToPx(lay.margins.left),
          right: cmToPx(lay.margins.right),
        },
        headerLeft: lay.headerLeft,
        headerRight: lay.headerRight,
        footerLeft: footerLeftRef.current,
        pageNum: pageNumModeRef.current,
        paper: paperColorRef.current,
      }
      const blob = await htmlToDocxBlob(container, docxLayout)
      const buf = new Uint8Array(await blob.arrayBuffer())
      await writeFileBinaryAtomic(filePath, buf)
      // Impostazioni documento nel file affianco, per ripristinarle alla riapertura.
      await writeTextFile(`${filePath}.atelier`, JSON.stringify(gatherSettings())).catch(() => {})
      clearBuffer(filePath) // salvato → niente più "non salvato"
    } catch (e) {
      console.error('Salvataggio DOCX:', e)
    } finally {
      setSaving(false)
    }
  }

  // Ctrl+S salva.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, saving, filePath])

  // Piè di pagina = testo libero a sinistra + numero di pagina a destra (col totale).
  function applyFooter(left: string, mode: PageNumMode) {
    if (editor) editor.commands.updateFooterContent(left, footerTextFor(mode, pageTotalOf(editor)))
  }
  function changePageNumMode(mode: PageNumMode) {
    setPageNumMode(mode)
    applyFooter(footerLeftRef.current, mode)
  }
  function changeFooterLeft(text: string) {
    setFooterLeft(text)
    applyFooter(text, pageNumModeRef.current)
  }

  // Applica tutte le impostazioni (es. all'apertura, dal file affianco).
  function applyAllSettings(s: FullSettings) {
    if (!editor) return
    layoutRef.current = {
      format: s.format,
      landscape: s.landscape,
      margins: s.margins,
      headerLeft: s.headerLeft,
      headerRight: s.headerRight,
    }
    footerLeftRef.current = s.footerLeft
    pageNumModeRef.current = s.pageNum
    setFooterLeft(s.footerLeft)
    setPageNumMode(s.pageNum)
    setPaperColor(s.paper)
    const f = FORMATS[s.format] ?? FORMATS.A4
    editor
      .chain()
      .updatePageWidth(s.landscape ? f.h : f.w)
      .updatePageHeight(s.landscape ? f.w : f.h)
      .updateMargins({
        top: cmToPx(s.margins.top),
        bottom: cmToPx(s.margins.bottom),
        left: cmToPx(s.margins.left),
        right: cmToPx(s.margins.right),
      })
      .updateHeaderContent(s.headerLeft, s.headerRight)
      .updateFooterContent(s.footerLeft, footerTextFor(s.pageNum, pageTotalOf(editor)))
      .run()
  }
  function gatherSettings(): FullSettings {
    return {
      ...layoutRef.current,
      paper: paperColorRef.current,
      footerLeft: footerLeftRef.current,
      pageNum: pageNumModeRef.current,
    }
  }

  // Aggiorna il totale nel piè quando cambia il numero di pagine.
  useEffect(() => {
    if (!editor) return
    let last = -1
    let raf = 0
    const onUpd = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        if (pageNumModeRef.current === 'none') return
        const total = pageTotalOf(editor)
        if (total === last) return
        last = total
        editor.commands.updateFooterContent(footerLeftRef.current, footerTextFor(pageNumModeRef.current, total))
      })
    }
    editor.on('update', onUpd)
    return () => {
      editor.off('update', onUpd)
      cancelAnimationFrame(raf)
    }
  }, [editor])

  // Zoom della pagina con Ctrl+rotella.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey) return
      e.preventDefault()
      setZoom((z) => +Math.min(2.5, Math.max(0.5, z + (e.deltaY < 0 ? 0.1 : -0.1))).toFixed(2))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  async function exportMarkdown() {
    if (exporting) return
    setExporting(true)
    try {
      const bytes = await readFile(filePath)
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      const toMd = (
        mammoth as unknown as {
          convertToMarkdown: (i: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>
        }
      ).convertToMarkdown
      const md = await toMd({ arrayBuffer })
      const dir = filePath.slice(0, filePath.lastIndexOf('\\'))
      const base = fileName.replace(/\.docx$/i, '')
      let dest = `${dir}\\${base}.md`
      let i = 2
      while (await exists(dest)) {
        dest = `${dir}\\${base} (${i}).md`
        i++
      }
      await writeTextFile(dest, md.value)
      setSelectedFile(dest)
    } catch (e) {
      console.error('Export DOCX→MD:', e)
    } finally {
      setExporting(false)
    }
  }

  const raw = filePath.split('\\').pop() ?? ''
  let fileName = raw
  try {
    fileName = decodeURIComponent(raw)
  } catch {
    /* nome con % non valido: tieni il grezzo */
  }

  const headingValue =
    ([1, 2, 3, 4, 5, 6].find((l) => editor?.isActive('heading', { level: l }))?.toString() as string) || 'p'

  const btn = 'px-2 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-zinc-300 disabled:opacity-40'

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Barra superiore: file + azioni */}
      <div className="px-4 py-2 border-b border-zinc-800 flex items-center justify-between gap-3 shrink-0">
        <span className="text-sm text-zinc-300 truncate flex items-center gap-2 min-w-0">
          <span className="truncate">{fileName}</span>
          {dirty && <span className="text-xs text-amber-400 shrink-0">• non salvato</span>}
        </span>
        <div className="flex items-center gap-1 text-xs text-zinc-300">
          <button
            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-medium disabled:opacity-40"
            onClick={save}
            disabled={saving || loading || !!error}
            title="Salva (Ctrl+S) — sovrascrive il .docx"
          >
            {saving ? 'Salvataggio…' : '💾 Salva'}
          </button>
          <button
            className={settingsOpen ? 'px-2 py-1 bg-zinc-100 text-zinc-900 border border-zinc-100 rounded' : btn}
            title="Impostazioni documento"
            disabled={loading || !!error}
            onClick={() => setSettingsOpen((o) => !o)}
          >
            ⚙️ Documento
          </button>
          <button className={btn} title="Esporta in Markdown" disabled={exporting || loading} onClick={exportMarkdown}>
            {exporting ? 'Esporto…' : '↧ .md'}
          </button>
          <button className={btn} title="Apri in Explorer" onClick={() => revealInExplorer(filePath).catch((e) => console.error(e))}>
            Explorer
          </button>
        </div>
      </div>

      {settingsOpen && editor && (
        <DocSettings
          editor={editor}
          onClose={() => setSettingsOpen(false)}
          paper={paperColor}
          setPaper={setPaperColor}
          pageNumMode={pageNumMode}
          setPageNumMode={changePageNumMode}
          footerLeft={footerLeft}
          setFooterLeft={changeFooterLeft}
          onLayout={(patch) => {
            layoutRef.current = { ...layoutRef.current, ...patch }
          }}
          initial={layoutRef.current}
        />
      )}

      {/* Barra strumenti di formattazione */}
      {editor && !loading && !error && (
        <div className="px-3 py-1.5 border-b border-zinc-800 bg-zinc-900/60 flex items-center gap-0.5 flex-wrap shrink-0">
          <TBtn title="Annulla" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>
            ↶
          </TBtn>
          <TBtn title="Ripeti" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>
            ↷
          </TBtn>
          <Sep />
          <select
            value={headingValue}
            onChange={(e) => {
              const v = e.target.value
              if (v === 'p') editor.chain().focus().setParagraph().run()
              else editor.chain().focus().toggleHeading({ level: Number(v) as 1 | 2 | 3 | 4 }).run()
            }}
            title="Tipo di testo"
            className={sel + ' text-sm'}
          >
            <option value="p">Paragrafo</option>
            <option value="1">Titolo 1</option>
            <option value="2">Titolo 2</option>
            <option value="3">Titolo 3</option>
            <option value="4">Titolo 4</option>
          </select>
          {/* Carattere */}
          <select
            value={editor.getAttributes('textStyle').fontFamily || 'Predefinito'}
            onChange={(e) => {
              const v = e.target.value
              if (v === 'Predefinito') editor.chain().focus().unsetFontFamily().run()
              else editor.chain().focus().setFontFamily(v).run()
            }}
            title="Carattere"
            className={sel + ' max-w-[7.5rem]'}
          >
            {FONTS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          {/* Dimensione */}
          <select
            value={String(editor.getAttributes('textStyle').fontSize || '').replace('px', '')}
            onChange={(e) => {
              const v = e.target.value
              if (!v) editor.chain().focus().unsetFontSize().run()
              else editor.chain().focus().setFontSize(`${v}px`).run()
            }}
            title="Dimensione"
            className={sel}
          >
            <option value="">—</option>
            {SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <Sep />
          {/* Liste */}
          <TBtn title="Elenco puntato" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
            •☰
          </TBtn>
          <TBtn title="Elenco numerato" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
            1.
          </TBtn>
          <TBtn title="Elenco di attività" active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()}>
            ☑
          </TBtn>
          <Sep />
          {/* Blocchi */}
          <TBtn title="Blocco di codice" active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
            {'{ }'}
          </TBtn>
          <TBtn title="Citazione" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
            ❝
          </TBtn>
          <Sep />
          {/* Marchi */}
          <TBtn title="Grassetto (Ctrl+B)" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
            <span className="font-bold">B</span>
          </TBtn>
          <TBtn title="Corsivo (Ctrl+I)" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
            <span className="italic">I</span>
          </TBtn>
          <TBtn title="Barrato" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}>
            <span className="line-through">S</span>
          </TBtn>
          <TBtn title="Codice in linea" active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}>
            {'</>'}
          </TBtn>
          <TBtn title="Sottolineato (Ctrl+U)" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>
            <span className="underline">U</span>
          </TBtn>
          <ColorPopover editor={editor} />
          <TBtn
            title="Inserisci/Modifica link"
            active={editor.isActive('link')}
            onClick={() => {
              const prev = editor.getAttributes('link').href as string | undefined
              const url = window.prompt('URL del link:', prev ?? 'https://')
              if (url === null) return
              if (url === '') editor.chain().focus().extendMarkRange('link').unsetLink().run()
              else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
            }}
          >
            🔗
          </TBtn>
          <Sep />
          {/* Apici/pedici */}
          <TBtn title="Apice" active={editor.isActive('superscript')} onClick={() => editor.chain().focus().toggleSuperscript().run()}>
            x²
          </TBtn>
          <TBtn title="Pedice" active={editor.isActive('subscript')} onClick={() => editor.chain().focus().toggleSubscript().run()}>
            x₂
          </TBtn>
          <Sep />
          {/* Allineamenti */}
          <TBtn title="Allinea a sinistra" active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()}>
            ⬅
          </TBtn>
          <TBtn title="Centra" active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()}>
            ↔
          </TBtn>
          <TBtn title="Allinea a destra" active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()}>
            ➡
          </TBtn>
          <TBtn title="Giustifica" active={editor.isActive({ textAlign: 'justify' })} onClick={() => editor.chain().focus().setTextAlign('justify').run()}>
            ☰
          </TBtn>
          {/* Interlinea */}
          <select
            value={(editor.getAttributes('paragraph').lineHeight as string) || (editor.getAttributes('heading').lineHeight as string) || ''}
            onChange={(e) => {
              const v = e.target.value
              if (!v) editor.chain().focus().unsetLineHeight().run()
              else editor.chain().focus().setLineHeight(v).run()
            }}
            title="Interlinea"
            className={sel}
          >
            <option value="">↕</option>
            {LINE_HEIGHTS.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
          <Sep />
          {/* Immagine + riga */}
          <TBtn title="Inserisci immagine" onClick={() => imageInputRef.current?.click()}>
            🖼
          </TBtn>
          <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={onPickImage} />
          <TBtn title="Riga orizzontale" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
            ―
          </TBtn>
          <div className="flex-1" />
          {/* Zoom della pagina */}
          <TBtn title="Riduci zoom" onClick={() => setZoom((z) => +Math.max(0.5, z - 0.1).toFixed(2))}>
            −
          </TBtn>
          <span className="w-11 text-center text-xs text-zinc-400 tabular-nums">{Math.round(zoom * 100)}%</span>
          <TBtn title="Aumenta zoom" onClick={() => setZoom((z) => +Math.min(2.5, z + 0.1).toFixed(2))}>
            +
          </TBtn>
          <TBtn title="Reimposta zoom" onClick={() => setZoom(1)}>
            ⟳
          </TBtn>
        </div>
      )}

      {/* Sfondo grigio; i fogli A4 (bianchi, con margini) e i salti pagina li
          gestisce il motore di paginazione. Zoom via CSS. */}
      <div ref={scrollRef} className="flex-1 overflow-auto py-8 px-4" style={{ background: PAGE_BG }}>
        {error && <p className="text-zinc-400 text-sm text-center">Impossibile aprire il documento.</p>}
        {loading && !error && (
          <div className="mx-auto h-7 w-7 rounded-full border-2 border-neutral-500 border-t-neutral-200 animate-spin" />
        )}
        <div
          className={`docx-prose ${loading || error ? 'hidden' : ''}`}
          style={{ zoom, ...({ '--docx-paper': paperColor } as React.CSSProperties) }}
        >
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  )
}
