import { useState } from 'react'
import { createFile } from '../../lib/fileOps'

// Un tipo di file creabile dalla modale "Nuovo file".
interface FileType {
  ext: string
  label: string
  icon: string
  disabled?: boolean // placeholder per formati futuri (Excel, PowerPoint)
}

const MAIN_TYPES: FileType[] = [
  { ext: 'md', label: 'Markdown', icon: '📝' },
  { ext: 'docx', label: 'Word', icon: '📄' },
  { ext: 'txt', label: 'Testo', icon: '🗒️' },
]

// In arrivo: mostrati ma non selezionabili (promemoria di cosa manca).
const FUTURE_TYPES: FileType[] = [
  { ext: 'xlsx', label: 'Excel', icon: '📊', disabled: true },
  { ext: 'pptx', label: 'PowerPoint', icon: '📽️', disabled: true },
]

// Programmazione (lista a cascata): qualche esempio, si estende in futuro.
const CODE_TYPES: FileType[] = [
  { ext: 'html', label: 'HTML', icon: '🌐' },
  { ext: 'css', label: 'CSS', icon: '🎨' },
  { ext: 'js', label: 'JavaScript', icon: '🟨' },
  { ext: 'ts', label: 'TypeScript', icon: '🟦' },
  { ext: 'py', label: 'Python', icon: '🐍' },
  { ext: 'java', label: 'Java', icon: '☕' },
  { ext: 'php', label: 'PHP', icon: '🐘' },
  { ext: 'json', label: 'JSON', icon: '🧾' },
]

const ALL_EXTS = [...MAIN_TYPES, ...CODE_TYPES].map((t) => t.ext)

// Modale "Nuovo file": nome a sinistra, tipo a destra (md/docx/txt, futuri
// Excel/PowerPoint, cascata Programmazione). Si apre dal bottone in sidebar
// e dal tasto destro sull'explorer.
export function NewFileModal({
  dir,
  onClose,
  onCreated,
}: {
  dir: string
  onClose: () => void
  onCreated: (path: string) => void
}) {
  const [name, setName] = useState('nuovo')
  const [ext, setExt] = useState('md')
  const [codeOpen, setCodeOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Nome finale: aggiunge l'estensione del tipo scelto se non è già scritta.
  const trimmed = name.trim()
  const finalName = trimmed && !trimmed.toLowerCase().endsWith(`.${ext}`) ? `${trimmed}.${ext}` : trimmed

  // Se l'utente digita un'estensione nota nel nome, seleziona quel tipo.
  function onNameChange(v: string) {
    setName(v)
    const typed = v.trim().toLowerCase().split('.').pop()
    if (typed && typed !== v.trim().toLowerCase() && ALL_EXTS.includes(typed)) {
      setExt(typed)
      if (CODE_TYPES.some((t) => t.ext === typed)) setCodeOpen(true)
    }
  }

  async function create() {
    if (!finalName || busy) return
    setBusy(true)
    setError(null)
    try {
      const path = await createFile(dir, finalName)
      onCreated(path)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  function TypeRow({ t, indent }: { t: FileType; indent?: boolean }) {
    const selected = !t.disabled && ext === t.ext
    return (
      <button
        disabled={t.disabled}
        onClick={() => setExt(t.ext)}
        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm ${indent ? 'pl-6' : ''} ${
          selected ? 'bg-zinc-100 text-zinc-900 font-medium' : t.disabled ? 'text-zinc-600' : 'text-zinc-300 hover:bg-zinc-800'
        }`}
        title={t.disabled ? 'In arrivo' : `.${t.ext}`}
      >
        <span className="text-xs">{t.icon}</span>
        <span className="flex-1 truncate">{t.label}</span>
        {t.disabled ? (
          <span className="text-[10px] text-zinc-600 border border-zinc-700 rounded px-1">presto</span>
        ) : (
          <span className={`text-[10px] ${selected ? 'text-zinc-500' : 'text-zinc-600'}`}>.{t.ext}</span>
        )}
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onMouseDown={onClose}>
      <div
        className="w-[30rem] bg-zinc-900 border border-zinc-700 rounded-lg p-4 flex gap-4"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Sinistra: nome */}
        <div className="flex-1 flex flex-col gap-3 min-w-0">
          <h3 className="text-sm font-semibold text-zinc-200">Nuovo file</h3>
          <input
            autoFocus
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') create()
              if (e.key === 'Escape') onClose()
            }}
            placeholder="Nome del file"
            className="px-3 py-2 bg-zinc-950 border border-zinc-700 rounded text-sm text-zinc-100 focus:outline-none focus:border-zinc-500"
          />
          {finalName && (
            <p className="text-xs text-zinc-500 truncate" title={finalName}>
              Verrà creato: <span className="text-zinc-400">{finalName}</span>
            </p>
          )}
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex-1" />
          <div className="flex gap-2 justify-end">
            <button
              onClick={onClose}
              disabled={busy}
              className="px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 rounded disabled:opacity-50"
            >
              Annulla
            </button>
            <button
              onClick={create}
              disabled={busy || !finalName}
              className="px-3 py-1.5 text-xs bg-zinc-100 text-zinc-900 rounded font-medium hover:bg-white disabled:opacity-50"
            >
              {busy ? 'Creo…' : 'Crea'}
            </button>
          </div>
        </div>

        {/* Destra: tipo di file */}
        <div className="w-44 shrink-0 border-l border-zinc-800 pl-3 flex flex-col">
          <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1.5">Tipo</p>
          <div className="flex-1 overflow-y-auto max-h-72 flex flex-col gap-0.5 pr-1">
            {MAIN_TYPES.map((t) => (
              <TypeRow key={t.ext} t={t} />
            ))}
            <div className="h-px bg-zinc-800 my-1" />
            {FUTURE_TYPES.map((t) => (
              <TypeRow key={t.ext} t={t} />
            ))}
            <div className="h-px bg-zinc-800 my-1" />
            <button
              onClick={() => setCodeOpen((o) => !o)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm text-zinc-300 hover:bg-zinc-800"
            >
              <span className="text-xs">{codeOpen ? '▾' : '▸'}</span>
              <span className="flex-1">Programmazione</span>
            </button>
            {codeOpen && CODE_TYPES.map((t) => <TypeRow key={t.ext} t={t} indent />)}
          </div>
        </div>
      </div>
    </div>
  )
}
