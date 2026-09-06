import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '../../store/appStore'
import { runCommand } from '../../lib/shell'

// Pannello Git della modalità Developer: stato del repository del vault,
// diff del file selezionato, e il giro aggiungi → commit → push.
// Tutto passa da `git` via lo scope shell (nessuna libreria git in bundle).

interface Entry {
  code: string // due lettere di stato porcelain (es. " M", "??")
  path: string
}

// Etichetta leggibile per lo stato porcelain di un file.
function label(code: string): { text: string; cls: string } {
  const [x, y] = [code[0], code[1]]
  if (code === '??') return { text: 'nuovo', cls: 'text-emerald-400' }
  if (x === 'A' || y === 'A') return { text: 'aggiunto', cls: 'text-emerald-400' }
  if (x === 'D' || y === 'D') return { text: 'eliminato', cls: 'text-red-400' }
  if (x === 'R') return { text: 'rinominato', cls: 'text-blue-400' }
  if (x === 'M' || y === 'M') return { text: 'modificato', cls: 'text-amber-400' }
  return { text: code.trim() || 'cambiato', cls: 'text-zinc-400' }
}

export function GitPanel() {
  const vaultPath = useAppStore((s) => s.vaultPath)
  const [branch, setBranch] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [diff, setDiff] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [isRepo, setIsRepo] = useState<boolean | null>(null)

  const refresh = useCallback(async () => {
    if (!vaultPath) return
    setBusy(true)
    setNotice('')
    try {
      const res = await runCommand('git status --porcelain=v1 -b', vaultPath)
      if (res.code !== 0) {
        // Fuori da un repository git: non è un errore da mostrare come tale.
        setIsRepo(!/not a git repository/i.test(res.stderr))
        setEntries([])
        setBranch('')
        if (!/not a git repository/i.test(res.stderr) && res.stderr.trim()) setNotice(res.stderr.trim())
        return
      }
      setIsRepo(true)
      const lines = res.stdout.split(/\r?\n/).filter(Boolean)
      const head = lines.find((l) => l.startsWith('##'))
      setBranch(head ? head.slice(2).trim().split('...')[0] : '')
      setEntries(
        lines
          .filter((l) => !l.startsWith('##'))
          .map((l) => ({ code: l.slice(0, 2), path: l.slice(3).trim().replace(/^"|"$/g, '') })),
      )
    } catch (e) {
      setNotice(String(e))
    } finally {
      setBusy(false)
    }
  }, [vaultPath])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Diff del file selezionato (anche se già in staging).
  useEffect(() => {
    if (!selected || !vaultPath) {
      setDiff('')
      return
    }
    let cancelled = false
    ;(async () => {
      const q = `"${selected.replace(/"/g, '')}"`
      let res = await runCommand(`git diff -- ${q}`, vaultPath)
      if (!res.stdout.trim()) res = await runCommand(`git diff --cached -- ${q}`, vaultPath)
      if (!res.stdout.trim()) res = await runCommand(`git diff --no-index -- /dev/null ${q}`, vaultPath)
      if (!cancelled) setDiff(res.stdout || '(nessuna differenza testuale da mostrare)')
    })().catch((e) => !cancelled && setDiff(String(e)))
    return () => {
      cancelled = true
    }
  }, [selected, vaultPath])

  async function run(cmd: string, ok: string) {
    if (!vaultPath || busy) return
    setBusy(true)
    setNotice('')
    try {
      const res = await runCommand(cmd, vaultPath)
      setNotice(res.code === 0 ? ok : (res.stderr || res.stdout || 'Comando fallito').trim())
      if (res.code === 0) await refresh()
    } catch (e) {
      setNotice(String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!vaultPath) return <Empty text="Nessun vault aperto." />
  if (isRepo === false)
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-sm text-zinc-500">
        <p>Questa cartella non è un repository Git.</p>
        <button className="tbtn" disabled={busy} onClick={() => void run('git init', 'Repository creato.')}>
          Inizializza repository
        </button>
        {notice && <p className="text-xs text-zinc-600 max-w-md text-center">{notice}</p>}
      </div>
    )

  return (
    <div className="flex-1 flex min-h-0">
      {/* Elenco dei file cambiati */}
      <div className="w-72 shrink-0 border-r border-zinc-800 flex flex-col min-h-0">
        <div className="px-3 py-2 flex items-center justify-between gap-2 border-b border-zinc-800">
          <span className="text-xs text-zinc-400 truncate" title={branch}>
            {branch ? `Ramo: ${branch}` : 'Repository'}
          </span>
          <button className="tbtn" disabled={busy} onClick={() => void refresh()} title="Aggiorna">
            Aggiorna
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {entries.length === 0 && <p className="px-3 py-2 text-xs text-zinc-600">Nessuna modifica in sospeso.</p>}
          {entries.map((e) => {
            const l = label(e.code)
            return (
              <button
                key={e.path}
                onClick={() => setSelected(e.path)}
                className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-zinc-800 ${
                  selected === e.path ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300'
                }`}
                title={e.path}
              >
                <span className={`${l.cls} shrink-0 w-[68px]`}>{l.text}</span>
                <span className="truncate">{e.path}</span>
              </button>
            )
          })}
        </div>
        <div className="border-t border-zinc-800 p-2 flex flex-col gap-2">
          <input
            value={message}
            onChange={(ev) => setMessage(ev.target.value)}
            placeholder="Messaggio del commit"
            className="w-full bg-white border border-zinc-700 rounded-md px-2 py-1.5 text-xs text-zinc-200 focus:border-blue-500 focus:outline-none"
          />
          <div className="flex items-center gap-1.5">
            <button
              className="tbtn"
              disabled={busy || entries.length === 0}
              onClick={() => void run('git add -A', 'Modifiche aggiunte.')}
            >
              Aggiungi tutto
            </button>
            <button
              className="btn-accent rounded-md h-7 px-3 text-xs font-medium disabled:opacity-40"
              disabled={busy || !message.trim()}
              onClick={() =>
                void run(`git commit -m "${message.replace(/"/g, "'")}"`, 'Commit creato.').then(() => setMessage(''))
              }
            >
              Commit
            </button>
            <button className="tbtn" disabled={busy} onClick={() => void run('git push', 'Push completato.')}>
              Push
            </button>
          </div>
          {notice && <p className="text-[11px] text-zinc-500 break-words max-h-16 overflow-y-auto">{notice}</p>}
        </div>
      </div>

      {/* Diff del file selezionato */}
      <div className="flex-1 overflow-auto min-w-0">
        {!selected ? (
          <Empty text="Seleziona un file per vedere le differenze." />
        ) : (
          <pre className="p-3 font-mono text-[12px] leading-[1.5] whitespace-pre">
            {diff.split('\n').map((l, i) => (
              <div
                key={i}
                className={
                  l.startsWith('+') && !l.startsWith('+++')
                    ? 'text-emerald-400'
                    : l.startsWith('-') && !l.startsWith('---')
                      ? 'text-red-400'
                      : l.startsWith('@@')
                        ? 'text-blue-400'
                        : 'text-zinc-400'
                }
              >
                {l || ' '}
              </div>
            ))}
          </pre>
        )}
      </div>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="flex-1 flex items-center justify-center text-sm text-zinc-600">{text}</div>
}
