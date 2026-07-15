import { getCurrentWindow } from '@tauri-apps/api/window'
import { useAppStore } from '../store/appStore'

// Barra del titolo custom (decorations: false): in tinta con l'app, area di
// trascinamento nativa (data-tauri-drag-region gestisce anche il doppio
// click = massimizza). La ✕ chiama close() → passa dalla guardia di
// chiusura (modale modifiche non salvate), NON destroy().
export function TitleBar() {
  const win = getCurrentWindow()
  const vaultPath = useAppStore((s) => s.vaultPath)
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const mode = useAppStore((s) => s.mode)
  const toggleMode = useAppStore((s) => s.toggleMode)

  const btn =
    'h-full w-11 flex items-center justify-center text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800/80 transition-colors'

  return (
    <div
      data-tauri-drag-region
      className="h-9 shrink-0 flex items-center bg-zinc-950 border-b border-zinc-800/60 select-none"
    >
      {/* toggle Explorer (solo con un vault aperto) */}
      {vaultPath && (
        <button
          className="h-full w-10 flex items-center justify-center text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800/80 transition-colors"
          title={sidebarOpen ? "Nascondi l'Explorer" : "Mostra l'Explorer"}
          onClick={toggleSidebar}
        >
          <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
            <rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.5" />
            <line x1="6" y1="2.8" x2="6" y2="13.2" />
            {sidebarOpen && <rect x="1.8" y="2.8" width="4.2" height="10.4" rx="1.5" fill="currentColor" stroke="none" opacity="0.35" />}
          </svg>
        </button>
      )}
      <div data-tauri-drag-region className="flex items-center gap-2 px-3 pointer-events-none">
        <span className="w-5 h-5 rounded-md bg-zinc-800 border border-zinc-700 flex items-center justify-center font-display text-[13px] text-blue-500 leading-none">
          A
        </span>
        <span className="font-display text-sm text-zinc-300 tracking-tight">Atelier</span>
      </div>
      <div data-tauri-drag-region className="flex-1 h-full" />
      {/* modalità (era nella riga del percorso, ora eliminata) */}
      {vaultPath && (
        <button
          onClick={toggleMode}
          className="px-2.5 mr-1 h-6 self-center text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800/70 rounded-md text-[11px] transition-colors shrink-0"
          title="Cambia modalità"
        >
          {mode === 'developer' ? 'Developer' : 'Standard'}
        </button>
      )}
      <div className="flex h-full">
        <button className={btn} title="Riduci a icona" onClick={() => void win.minimize()}>
          <svg viewBox="0 0 12 12" className="w-3 h-3" stroke="currentColor" strokeWidth="1.2">
            <line x1="1.5" y1="6" x2="10.5" y2="6" />
          </svg>
        </button>
        <button className={btn} title="Ingrandisci/Ripristina" onClick={() => void win.toggleMaximize()}>
          <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="1.2">
            <rect x="2" y="2" width="8" height="8" rx="1" />
          </svg>
        </button>
        <button
          className="h-full w-11 flex items-center justify-center text-zinc-500 hover:text-white hover:bg-red-600 transition-colors"
          title="Chiudi"
          onClick={() => void win.close()}
        >
          <svg viewBox="0 0 12 12" className="w-3 h-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
            <line x1="2.5" y1="2.5" x2="9.5" y2="9.5" />
            <line x1="9.5" y1="2.5" x2="2.5" y2="9.5" />
          </svg>
        </button>
      </div>
    </div>
  )
}
