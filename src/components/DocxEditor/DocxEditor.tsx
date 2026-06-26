import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import Image from '@tiptap/extension-image'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import { readFile, writeTextFile, exists } from '@tauri-apps/plugin-fs'
import DOMPurify from 'dompurify'
import * as mammoth from 'mammoth'
import { revealInExplorer } from '../../lib/imageActions'
import { writeFileBinaryAtomic } from '../../lib/fileOps'
import { htmlToDocxBlob } from '../../lib/htmlToDocx'
import { useAppStore } from '../../store/appStore'

const extensions = [
  StarterKit,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Image,
  Table.configure({ resizable: true }),
  TableRow,
  TableHeader,
  TableCell,
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

// Editor DOCX (TipTap): apri il .docx ed è subito editabile, con barra strumenti
// in stile Word ma con l'identità di Atelier. Salva = sovrascrive il .docx.
export function DocxEditor({ filePath }: { filePath: string }) {
  const setSelectedFile = useAppStore((s) => s.setSelectedFile)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [, setTick] = useState(0)
  const loadingRef = useRef(true)

  const editor = useEditor({
    extensions,
    content: '',
    immediatelyRender: false, // evita problemi col doppio mount di StrictMode
    editorProps: {
      attributes: { class: 'prose prose-invert max-w-3xl mx-auto focus:outline-none pb-24' },
    },
    onUpdate: () => {
      if (!loadingRef.current) setDirty(true)
    },
    onTransaction: () => setTick((t) => (t + 1) % 1_000_000), // barra riflette lo stato
  })

  // Importa il .docx (Mammoth → HTML) nell'editor.
  useEffect(() => {
    if (!editor) return
    let cancelled = false
    loadingRef.current = true
    setLoading(true)
    setError(false)
    setDirty(false)
    ;(async () => {
      const bytes = await readFile(filePath)
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      const result = await mammoth.convertToHtml({ arrayBuffer })
      if (cancelled) return
      editor.commands.setContent(DOMPurify.sanitize(result.value))
      setLoading(false)
      // lascia assestare il setContent, poi riattiva il tracking delle modifiche
      requestAnimationFrame(() => {
        loadingRef.current = false
      })
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
      const blob = await htmlToDocxBlob(editor.view.dom as HTMLElement)
      const buf = new Uint8Array(await blob.arrayBuffer())
      await writeFileBinaryAtomic(filePath, buf)
      setDirty(false)
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

  const headingValue = editor?.isActive('heading', { level: 1 })
    ? '1'
    : editor?.isActive('heading', { level: 2 })
      ? '2'
      : editor?.isActive('heading', { level: 3 })
        ? '3'
        : 'p'

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
          <button className={btn} title="Esporta in Markdown" disabled={exporting || loading} onClick={exportMarkdown}>
            {exporting ? 'Esporto…' : '↧ .md'}
          </button>
          <button className={btn} title="Apri in Explorer" onClick={() => revealInExplorer(filePath).catch((e) => console.error(e))}>
            Explorer
          </button>
        </div>
      </div>

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
              else editor.chain().focus().toggleHeading({ level: Number(v) as 1 | 2 | 3 }).run()
            }}
            className="h-7 bg-zinc-800 border border-zinc-700 rounded text-zinc-200 text-sm px-1"
          >
            <option value="p">Paragrafo</option>
            <option value="1">Titolo 1</option>
            <option value="2">Titolo 2</option>
            <option value="3">Titolo 3</option>
          </select>
          <Sep />
          <TBtn title="Grassetto (Ctrl+B)" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
            <span className="font-bold">B</span>
          </TBtn>
          <TBtn title="Corsivo (Ctrl+I)" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
            <span className="italic">I</span>
          </TBtn>
          <TBtn title="Sottolineato (Ctrl+U)" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>
            <span className="underline">U</span>
          </TBtn>
          <TBtn title="Barrato" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}>
            <span className="line-through">S</span>
          </TBtn>
          <TBtn title="Codice" active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}>
            {'</>'}
          </TBtn>
          <Sep />
          <TBtn title="Elenco puntato" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
            •☰
          </TBtn>
          <TBtn title="Elenco numerato" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
            1.
          </TBtn>
          <TBtn title="Citazione" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
            ❝
          </TBtn>
          <Sep />
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
          <Sep />
          <TBtn title="Riga orizzontale" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
            ―
          </TBtn>
        </div>
      )}

      <div className="flex-1 overflow-y-auto bg-zinc-900 py-8 px-6">
        {error && <p className="text-zinc-500 text-sm text-center">Impossibile aprire il documento.</p>}
        {loading && !error && (
          <div className="mx-auto h-7 w-7 rounded-full border-2 border-zinc-700 border-t-zinc-400 animate-spin" />
        )}
        <EditorContent editor={editor} className={loading || error ? 'hidden' : ''} />
      </div>
    </div>
  )
}
