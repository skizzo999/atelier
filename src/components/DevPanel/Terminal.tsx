import { useEffect, useRef, useState } from 'react'
import { exists } from '@tauri-apps/plugin-fs'
import { useAppStore } from '../../store/appStore'
import { spawnCommand, resolveCd, type RunningCommand } from '../../lib/shell'

// Terminale della modalità Developer. Ogni comando è un processo nuovo
// (powershell/sh secondo la piattaforma): la cartella corrente la teniamo
// noi, così `cd` "ricorda" dove sei come in un terminale vero.

interface Line {
  text: string
  kind: 'cmd' | 'out' | 'err' | 'info'
}

const MAX_LINES = 2000 // oltre: le più vecchie si buttano (memoria)

export function Terminal() {
  const vaultPath = useAppStore((s) => s.vaultPath)
  const [cwd, setCwd] = useState(vaultPath ?? '')
  const [lines, setLines] = useState<Line[]>([
    { text: 'Terminale di Atelier — scrivi un comando e premi Invio. `clear` pulisce.', kind: 'info' },
  ])
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const historyRef = useRef<string[]>([])
  const histPos = useRef(-1)
  const childRef = useRef<RunningCommand | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Il vault è la casa del terminale: se cambia, si riparte da lì.
  useEffect(() => {
    setCwd(vaultPath ?? '')
  }, [vaultPath])

  // Comando arrivato dal tasto "Esegui" dell'editor: lo eseguiamo qui.
  const pendingCommand = useAppStore((s) => s.pendingCommand)
  const clearPendingCommand = useAppStore((s) => s.clearPendingCommand)
  useEffect(() => {
    if (!pendingCommand || running) return
    clearPendingCommand()
    void submit(pendingCommand)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCommand, running])

  // Ogni riga nuova scorre in fondo.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  const push = (text: string, kind: Line['kind']) =>
    setLines((prev) => {
      const next = [...prev, { text, kind }]
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next
    })

  async function submit(forced?: string) {
    const line = (forced ?? input).trim()
    if (!line || running) return
    if (!forced) setInput('')
    historyRef.current = [line, ...historyRef.current.filter((h) => h !== line)].slice(0, 100)
    histPos.current = -1
    push(`${shortCwd(cwd)}> ${line}`, 'cmd')

    // Comandi gestiti da noi (il processo figlio non potrebbe cambiare la
    // nostra cartella, e `clear` non ha senso passarlo alla shell).
    if (line === 'clear' || line === 'cls') {
      setLines([])
      return
    }
    const cd = /^cd\s+(.+)$/i.exec(line) ?? (/^cd$/i.test(line) ? ['', vaultPath ?? ''] : null)
    if (cd) {
      const target = resolveCd(cwd, cd[1] ?? '')
      try {
        if (await exists(target)) setCwd(target)
        else push(`Cartella inesistente: ${target}`, 'err')
      } catch {
        // Fuori dallo scope fs concesso: lo diciamo invece di fallire in silenzio.
        push(`Cartella non accessibile: ${target}`, 'err')
      }
      return
    }

    setRunning(true)
    try {
      childRef.current = await spawnCommand(
        line,
        cwd || undefined,
        (text, stream) => {
          // Ogni evento porta gia' UNA riga: togliamo il solo a-capo finale,
          // altrimenti lo split produce una riga vuota di troppo e il
          // terminale risulta spaziato doppio (le righe vuote vere restano).
          const clean = text.replace(/\r\n?/g, '\n').replace(/\n$/, '')
          for (const t of clean.split('\n')) push(t, stream === 'err' ? 'err' : 'out')
        },
        (code) => {
          childRef.current = null
          setRunning(false)
          if (code !== 0) push(`[uscita ${code ?? '?'}]`, 'info')
          inputRef.current?.focus()
        },
      )
    } catch (e) {
      push(String(e), 'err')
      setRunning(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      void submit()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const h = historyRef.current
      if (!h.length) return
      histPos.current = Math.min(histPos.current + 1, h.length - 1)
      setInput(h[histPos.current])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const h = historyRef.current
      histPos.current = Math.max(histPos.current - 1, -1)
      setInput(histPos.current < 0 ? '' : h[histPos.current])
    } else if (e.key === 'c' && e.ctrlKey && running) {
      e.preventDefault()
      void stop()
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault()
      setLines([])
    }
  }

  async function stop() {
    try {
      await childRef.current?.kill()
      push('[interrotto]', 'info')
    } catch (e) {
      push(String(e), 'err')
    }
    childRef.current = null
    setRunning(false)
  }

  return (
    <div className="flex-1 flex flex-col min-h-0" onClick={() => inputRef.current?.focus()}>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[12.5px] leading-[1.55]">
        {lines.map((l, i) => (
          <div
            key={i}
            className={
              l.kind === 'err'
                ? 'text-red-400 whitespace-pre-wrap break-all'
                : l.kind === 'cmd'
                  ? 'text-blue-400 whitespace-pre-wrap break-all'
                  : l.kind === 'info'
                    ? 'text-zinc-500 whitespace-pre-wrap break-all'
                    : 'text-zinc-300 whitespace-pre-wrap break-all'
            }
          >
            {l.text || ' '}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 px-3 py-2 border-t border-zinc-800 font-mono text-[12.5px]">
        <span className="text-blue-400 shrink-0">{shortCwd(cwd)}&gt;</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={running}
          spellCheck={false}
          placeholder={running ? 'in esecuzione…' : ''}
          className="flex-1 bg-transparent outline-none text-zinc-100 placeholder:text-zinc-600 disabled:opacity-60"
        />
        {running && (
          <button className="tbtn shrink-0" onClick={() => void stop()} title="Interrompi (Ctrl+C)">
            Interrompi
          </button>
        )}
      </div>
    </div>
  )
}

// Percorso accorciato nel prompt: solo le ultime due parti.
function shortCwd(p: string): string {
  if (!p) return '~'
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts.length <= 2 ? p : '…' + parts.slice(-2).join('\\')
}
