import { useState } from 'react'
import { useAppStore } from '../../store/appStore'
import { renameEntry } from '../../lib/fileOps'
import { formatSize } from '../../lib/imageMeta'
import { revealInExplorer } from '../../lib/imageActions'

interface Props {
  filePath: string
  dims: { w: number; h: number }
  sizeBytes: number
  dpi: number | null
  onClose: () => void
}

// Pannello laterale "Informazioni" (stile Foto di Windows): metadati, percorso,
// rinomina, copia percorso, apri in Explorer.
export function ImageInfoPanel({ filePath, dims, sizeBytes, dpi, onClose }: Props) {
  const setSelectedFile = useAppStore((s) => s.setSelectedFile)
  const fullName = filePath.split('\\').pop() ?? ''
  const dot = fullName.lastIndexOf('.')
  const ext = dot >= 0 ? fullName.slice(dot) : ''
  const [name, setName] = useState(dot >= 0 ? fullName.slice(0, dot) : fullName)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function doRename() {
    const trimmed = name.trim()
    if (!trimmed || trimmed + ext === fullName) return
    try {
      const np = await renameEntry(filePath, trimmed + ext)
      setSelectedFile(np)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Errore nel rinominare')
    }
  }

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(filePath)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch (e) {
      console.error('Copia percorso fallita:', e)
    }
  }

  const ext3 = ext.replace('.', '').toUpperCase()

  return (
    <aside className="w-72 shrink-0 border-l border-zinc-800 bg-zinc-900/40 overflow-y-auto flex flex-col">
      <div className="px-4 py-3 flex items-center justify-between border-b border-zinc-800">
        <span className="text-sm font-medium text-zinc-200">Informazioni</span>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 text-lg leading-none" title="Chiudi">
          ×
        </button>
      </div>

      <div className="p-4 flex flex-col gap-4 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500">Nome</span>
          <div className="flex items-center gap-1">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') setName(dot >= 0 ? fullName.slice(0, dot) : fullName)
              }}
              onBlur={doRename}
              className="flex-1 min-w-0 px-2 py-1 bg-zinc-950 border border-zinc-700 rounded text-zinc-100 focus:outline-none focus:border-zinc-500"
            />
            {ext && <span className="text-zinc-500 text-xs shrink-0">{ext}</span>}
          </div>
          {err && <span className="text-xs text-red-400">{err}</span>}
        </label>

        <Row label="Dimensioni">
          {dims.w} × {dims.h} px
        </Row>
        <Row label="Peso">{formatSize(sizeBytes)}</Row>
        <Row label="DPI">{dpi != null ? dpi : '—'}</Row>
        <Row label="Tipo">{ext3 || '—'}</Row>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500">Percorso</span>
          <p className="text-xs text-zinc-400 break-all font-mono leading-snug">{filePath}</p>
        </div>

        <div className="flex flex-col gap-2 pt-1">
          <button
            onClick={copyPath}
            className="tbtn justify-center border border-zinc-700/60"
          >
            {copied ? 'Percorso copiato ✓' : 'Copia percorso'}
          </button>
          <button
            onClick={() => revealInExplorer(filePath).catch((e) => console.error(e))}
            className="tbtn justify-center border border-zinc-700/60"
          >
            Apri in Explorer
          </button>
        </div>
      </div>
    </aside>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className="text-zinc-200">{children}</span>
    </div>
  )
}
