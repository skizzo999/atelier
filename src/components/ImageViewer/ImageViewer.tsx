import { useEffect, useState } from 'react'
import { readFile } from '@tauri-apps/plugin-fs'

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  avif: 'image/avif',
}

function mimeOf(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return MIME[ext] ?? 'application/octet-stream'
}

export function ImageViewer({ filePath }: { filePath: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [fit, setFit] = useState(true)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    setError(false)
    setUrl(null)
    setZoom(1)
    setFit(true)
    readFile(filePath)
      .then((bytes) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeOf(filePath) }))
        setUrl(objectUrl)
      })
      .catch((err) => {
        console.error('Errore lettura immagine:', err)
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [filePath])

  const fileName = filePath.split('\\').pop()

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-2 border-b border-zinc-800 flex items-center justify-between gap-3">
        <span className="text-sm text-zinc-400 truncate">{fileName}</span>
        <div className="flex items-center gap-1 text-xs text-zinc-300">
          <button
            onClick={() => {
              setFit(false)
              setZoom((z) => Math.max(0.1, +(z - 0.25).toFixed(2)))
            }}
            className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded"
          >
            −
          </button>
          <span className="w-12 text-center text-zinc-500">
            {fit ? 'Fit' : `${Math.round(zoom * 100)}%`}
          </span>
          <button
            onClick={() => {
              setFit(false)
              setZoom((z) => Math.min(8, +(z + 0.25).toFixed(2)))
            }}
            className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded"
          >
            +
          </button>
          <button
            onClick={() => setFit(true)}
            className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded"
          >
            Adatta
          </button>
          <button
            onClick={() => {
              setFit(false)
              setZoom(1)
            }}
            className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded"
          >
            100%
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto flex items-center justify-center bg-zinc-950 p-4">
        {error ? (
          <span className="text-zinc-500 text-sm">Impossibile caricare l'immagine.</span>
        ) : url ? (
          <img
            src={url}
            alt={fileName}
            className={fit ? 'max-w-full max-h-full object-contain' : ''}
            style={fit ? undefined : { width: `${zoom * 100}%` }}
          />
        ) : (
          <span className="text-zinc-500 text-sm">Caricamento…</span>
        )}
      </div>
    </div>
  )
}
