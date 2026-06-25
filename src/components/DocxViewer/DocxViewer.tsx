import { useEffect, useState } from 'react'
import { readFile } from '@tauri-apps/plugin-fs'
import DOMPurify from 'dompurify'
import * as mammoth from 'mammoth'
import { formatSize } from '../../lib/imageMeta'
import { revealInExplorer } from '../../lib/imageActions'

const btn =
  'px-2 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-zinc-300 disabled:opacity-40'

// Viewer DOCX (sola lettura): Mammoth converte il .docx in HTML semantico
// (titoli, grassetto/corsivo, liste, tabelle, immagini), reso come la vista Lettura.
export function DocxViewer({ filePath }: { filePath: string }) {
  const [html, setHtml] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [sizeBytes, setSizeBytes] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    setHtml('')
    ;(async () => {
      const bytes = await readFile(filePath)
      setSizeBytes(bytes.length)
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      const result = await mammoth.convertToHtml({ arrayBuffer })
      if (cancelled) return
      setHtml(DOMPurify.sanitize(result.value))
      setLoading(false)
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
  }, [filePath])

  const raw = filePath.split('\\').pop() ?? ''
  let fileName = raw
  try {
    fileName = decodeURIComponent(raw)
  } catch {
    /* nome con % non valido: tieni il grezzo */
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-2 border-b border-zinc-800 flex items-center justify-between gap-3 shrink-0">
        <span className="text-sm text-zinc-300 truncate flex items-center gap-2 min-w-0">
          <span className="truncate">{fileName}</span>
          {sizeBytes > 0 && <span className="text-xs text-zinc-500 shrink-0">· {formatSize(sizeBytes)}</span>}
        </span>
        <button className={btn} title="Apri in Explorer" onClick={() => revealInExplorer(filePath).catch((e) => console.error(e))}>
          Explorer
        </button>
      </div>

      <div className="flex-1 overflow-y-auto bg-zinc-900 py-8 px-6">
        {error && <p className="text-zinc-500 text-sm text-center">Impossibile aprire il documento.</p>}
        {loading && !error && (
          <div className="mx-auto h-7 w-7 rounded-full border-2 border-zinc-700 border-t-zinc-400 animate-spin" />
        )}
        {!loading && !error && (
          <div
            className="prose prose-invert max-w-3xl mx-auto"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </div>
  )
}
