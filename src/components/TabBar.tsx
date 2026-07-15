import { useRef, useState } from 'react'
import { useAppStore } from '../store/appStore'

// Tab dei file aperti (stile Obsidian/browser): click attiva, ✕ o click
// centrale chiude, pallino ambra = modifiche non salvate, TRASCINA per
// riordinare. A destra il PERCORSO della cartella del file attivo (la
// vecchia riga dedicata è stata eliminata per guadagnare spazio).
export function TabBar() {
  const openTabs = useAppStore((s) => s.openTabs)
  const selectedFile = useAppStore((s) => s.selectedFile)
  const setSelectedFile = useAppStore((s) => s.setSelectedFile)
  const closeTab = useAppStore((s) => s.closeTab)
  const moveTab = useAppStore((s) => s.moveTab)
  const dirtyBuffers = useAppStore((s) => s.dirtyBuffers)
  const imageBuffers = useAppStore((s) => s.imageBuffers)
  // Riordino col drag: tab trascinata + indicatore di inserimento
  // (path della tab bersaglio + lato; path null = in fondo alla fila).
  const dragPath = useRef<string | null>(null)
  const [dropHint, setDropHint] = useState<{ path: string | null; before: boolean } | null>(null)

  if (openTabs.length === 0) return null

  // Cartella del file attivo, mostrata accanto alle tab (tooltip = percorso pieno).
  const activeDir = selectedFile ? selectedFile.slice(0, selectedFile.lastIndexOf('\\')) : null

  function dropAt(target: string | null, before: boolean) {
    const dragged = dragPath.current
    dragPath.current = null
    setDropHint(null)
    if (!dragged) return
    if (target === null) {
      moveTab(dragged, null)
      return
    }
    // "dopo il bersaglio" = prima della tab successiva (o in fondo)
    const beforePath = before ? target : (openTabs[openTabs.indexOf(target) + 1] ?? null)
    moveTab(dragged, beforePath)
  }

  return (
    <div
      className="flex items-end h-9 shrink-0 bg-zinc-950/70 border-b border-zinc-800/60 overflow-x-auto"
      // zona vuota della barra = sposta in fondo
      onDragOver={(e) => {
        if (!dragPath.current || e.target !== e.currentTarget) return
        e.preventDefault()
        setDropHint({ path: null, before: false })
      }}
      onDrop={(e) => {
        if (e.target !== e.currentTarget) return
        e.preventDefault()
        dropAt(null, false)
      }}
    >
      {openTabs.map((path) => {
        const name = path.split('\\').pop() ?? path
        const active = path === selectedFile
        const dirty = dirtyBuffers[path] !== undefined || imageBuffers[path] !== undefined
        const hint = dropHint?.path === path ? dropHint : null
        return (
          <div
            key={path}
            title={path}
            draggable
            onDragStart={(e) => {
              dragPath.current = path
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', path)
            }}
            onDragEnd={() => {
              dragPath.current = null
              setDropHint(null)
            }}
            onDragOver={(e) => {
              if (!dragPath.current || dragPath.current === path) return
              e.preventDefault()
              const r = e.currentTarget.getBoundingClientRect()
              setDropHint({ path, before: e.clientX < r.left + r.width / 2 })
            }}
            onDrop={(e) => {
              e.preventDefault()
              const r = e.currentTarget.getBoundingClientRect()
              dropAt(path, e.clientX < r.left + r.width / 2)
            }}
            onClick={() => setSelectedFile(path)}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault()
                closeTab(path)
              }
            }}
            className={`group flex items-center gap-1.5 h-8 max-w-52 px-3 rounded-t-lg text-[12.5px] cursor-pointer select-none shrink-0 border-x border-t ${
              active
                ? 'bg-zinc-900 text-zinc-100 border-zinc-800/60'
                : 'text-zinc-500 border-transparent hover:text-zinc-300 hover:bg-zinc-900/50'
            }`}
            style={
              hint
                ? { boxShadow: hint.before ? 'inset 2px 0 0 #3b82f6' : 'inset -2px 0 0 #3b82f6' }
                : undefined
            }
          >
            <span className="truncate">{name}</span>
            {dirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title="Modifiche non salvate" />}
            <button
              className={`shrink-0 rounded p-0.5 hover:bg-zinc-700/70 hover:text-zinc-100 ${
                active ? 'text-zinc-500' : 'text-transparent group-hover:text-zinc-500'
              }`}
              title="Chiudi"
              onClick={(e) => {
                e.stopPropagation()
                closeTab(path)
              }}
            >
              <svg viewBox="0 0 12 12" className="w-2.5 h-2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                <line x1="2.5" y1="2.5" x2="9.5" y2="9.5" />
                <line x1="9.5" y1="2.5" x2="2.5" y2="9.5" />
              </svg>
            </button>
          </div>
        )
      })}
      {activeDir && (
        <span
          className="ml-auto self-center px-3 text-[11px] text-zinc-500 truncate shrink min-w-0 select-none"
          title={selectedFile ?? undefined}
        >
          {activeDir}
        </span>
      )}
    </div>
  )
}
