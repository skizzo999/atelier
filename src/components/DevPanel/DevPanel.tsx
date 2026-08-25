import { useAppStore, type DevTab } from '../../store/appStore'
import { Terminal } from './Terminal'
import { GitPanel } from './GitPanel'
import { ToolBox } from './ToolBox'

// Pannello inferiore della modalità Developer: terminale, Git e strumenti.
// Altezza trascinabile e persistita; il contenuto delle schede resta montato
// (il terminale non perde storico e comandi in corso passando a Git).

const TABS: { id: DevTab; label: string }[] = [
  { id: 'terminal', label: 'Terminale' },
  { id: 'git', label: 'Git' },
  { id: 'tools', label: 'Strumenti' },
]

export function DevPanel() {
  const height = useAppStore((s) => s.devPanelHeight)
  const open = useAppStore((s) => s.devPanelOpen)
  const tab = useAppStore((s) => s.devTab)
  const setHeight = useAppStore((s) => s.setDevPanelHeight)
  const setTab = useAppStore((s) => s.setDevTab)
  const toggle = useAppStore((s) => s.toggleDevPanel)

  return (
    <div className="shrink-0 flex flex-col border-t border-zinc-800 bg-zinc-950" style={{ height: open ? height : 33 }}>
      {/* Maniglia di ridimensionamento (solo a pannello aperto) */}
      {open && (
        <div
          // Zona di presa GENEROSA (9px a cavallo del bordo): prenderla non
          // deve essere una questione di pixel. La linea blu appare al
          // passaggio ed è sottile, ma l'area cliccabile è tutta questa.
          className="group relative h-[9px] -mt-[5px] -mb-[4px] z-10 cursor-row-resize"
          title="Trascina per ridimensionare"
          onMouseDown={(e) => {
            e.preventDefault()
            const startY = e.clientY
            const orig = height
            const move = (ev: MouseEvent) => setHeight(orig + startY - ev.clientY)
            const up = () => {
              document.removeEventListener('mousemove', move)
              document.removeEventListener('mouseup', up)
            }
            document.addEventListener('mousemove', move)
            document.addEventListener('mouseup', up)
          }}
        >
          {/* linea blu sottile, centrata nella zona di presa */}
          <div className="absolute left-0 right-0 top-[4px] h-[2px] bg-transparent group-hover:bg-blue-500/70 transition-colors" />
        </div>
      )}

      <div className="h-8 shrink-0 flex items-center gap-1 px-2 border-b border-zinc-800">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => (open && tab === t.id ? toggle() : setTab(t.id))}
            className={`px-2.5 h-6 rounded text-xs transition-colors ${
              open && tab === t.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {t.label}
          </button>
        ))}
        <div className="flex-1" />
        <button className="tbtn" onClick={toggle} title={open ? 'Riduci il pannello' : 'Apri il pannello'}>
          {open ? '▾' : '▴'}
        </button>
      </div>

      {open && (
        <div className="flex-1 min-h-0 flex">
          <div className={tab === 'terminal' ? 'flex-1 flex min-h-0' : 'hidden'}>
            <Terminal />
          </div>
          <div className={tab === 'git' ? 'flex-1 flex min-h-0' : 'hidden'}>
            <GitPanel />
          </div>
          <div className={tab === 'tools' ? 'flex-1 flex min-h-0' : 'hidden'}>
            <ToolBox />
          </div>
        </div>
      )}
    </div>
  )
}
