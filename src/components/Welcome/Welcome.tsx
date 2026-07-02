import { useState } from 'react'
import { exists } from '@tauri-apps/plugin-fs'
import { useAppStore } from '../../store/appStore'
import { openVaultDialog, createVaultDialog, grantVaultAccess, initVaultMeta } from '../../lib/vault'

// Picker dei vault stile Obsidian: a sinistra i vault conosciuti (click per
// aprire), a destra crea/apri. Mostrato al primo avvio, quando il vault
// sparisce, o quando apri una seconda finestra di Atelier.
export function Welcome({ onOpened }: { onOpened?: () => void }) {
  const setVaultPath = useAppStore((s) => s.setVaultPath)
  const registerVault = useAppStore((s) => s.registerVault)
  const forgetVault = useAppStore((s) => s.forgetVault)
  const knownVaults = useAppStore((s) => s.knownVaults)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Apre un vault (nuovo o conosciuto): scope, metadati .atelier, registro.
  async function activate(path: string) {
    await grantVaultAccess(path)
    if (!(await exists(path))) throw new Error('La cartella non esiste più')
    await initVaultMeta(path)
    registerVault(path)
    setVaultPath(path)
    onOpened?.()
  }

  async function openKnown(path: string) {
    setBusy(true)
    setError(null)
    try {
      await activate(path)
    } catch (err) {
      console.error('Apertura vault:', err)
      setError(`"${path}" non è apribile (spostato o eliminato?). Puoi toglierlo dalla lista con ✕.`)
    } finally {
      setBusy(false)
    }
  }

  async function handleOpen() {
    setBusy(true)
    setError(null)
    try {
      const path = await openVaultDialog()
      if (path) await activate(path)
    } catch (err) {
      console.error('Errore apertura vault:', err)
    } finally {
      setBusy(false)
    }
  }

  async function handleCreate() {
    setBusy(true)
    setError(null)
    try {
      const path = await createVaultDialog(name)
      if (path) await activate(path)
    } catch (err) {
      console.error('Errore creazione vault:', err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-screen w-screen bg-zinc-900 text-zinc-100">
      {/* Sinistra: vault conosciuti */}
      <aside className="w-72 shrink-0 bg-zinc-950 border-r border-zinc-800 flex flex-col">
        <div className="px-4 py-3 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">I tuoi vault</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {knownVaults.length === 0 && (
            <p className="text-xs text-zinc-600 px-2 py-3">
              Nessun vault ancora: creane uno o apri una cartella →
            </p>
          )}
          {knownVaults.map((v) => (
            <div
              key={v.path}
              className="group flex items-center gap-2 px-2 py-2 rounded hover:bg-zinc-800 cursor-pointer"
              onClick={() => !busy && openKnown(v.path)}
              title={v.path}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-200 truncate">{v.name}</p>
                <p className="text-[11px] text-zinc-600 truncate">{v.path}</p>
              </div>
              <button
                className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-zinc-200 px-1"
                title="Togli dalla lista (non elimina la cartella)"
                onClick={(e) => {
                  e.stopPropagation()
                  forgetVault(v.path)
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* Destra: azioni */}
      <main className="flex-1 flex items-center justify-center p-8">
        <div className="w-[26rem] flex flex-col gap-6">
          <div className="text-center">
            <h1 className="text-4xl font-bold tracking-tight">Atelier</h1>
            <p className="mt-2 text-sm text-zinc-500">Il tuo spazio di lavoro locale.</p>
          </div>

          <div className="bg-zinc-800/40 border border-zinc-800 rounded-xl divide-y divide-zinc-800">
            <div className="flex items-center gap-4 p-4">
              <div className="flex-1">
                <p className="text-sm font-medium text-zinc-200">Crea nuovo vault</p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Crea una cartella Atelier con dentro tutto il necessario.
                </p>
              </div>
              <button
                onClick={() => setCreating(true)}
                disabled={busy}
                className="px-4 py-2 bg-zinc-100 text-zinc-900 rounded-lg font-medium text-sm hover:bg-white disabled:opacity-50 transition-colors shrink-0"
              >
                Crea
              </button>
            </div>
            <div className="flex items-center gap-4 p-4">
              <div className="flex-1">
                <p className="text-sm font-medium text-zinc-200">Apri cartella come vault</p>
                <p className="text-xs text-zinc-500 mt-0.5">Scegli una cartella già esistente.</p>
              </div>
              <button
                onClick={handleOpen}
                disabled={busy}
                className="px-4 py-2 bg-zinc-800 text-zinc-200 border border-zinc-700 rounded-lg text-sm hover:bg-zinc-700 disabled:opacity-50 transition-colors shrink-0"
              >
                Apri
              </button>
            </div>
          </div>

          {creating && (
            <div className="flex flex-col gap-3 bg-zinc-800/40 border border-zinc-800 rounded-xl p-4">
              <input
                autoFocus
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && name.trim()) handleCreate()
                  if (e.key === 'Escape') setCreating(false)
                }}
                placeholder="Nome del vault"
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
              />
              <div className="flex gap-3">
                <button
                  onClick={() => setCreating(false)}
                  disabled={busy}
                  className="flex-1 px-4 py-2 bg-zinc-800 text-zinc-300 border border-zinc-700 rounded text-sm hover:bg-zinc-700 disabled:opacity-50 transition-colors"
                >
                  Annulla
                </button>
                <button
                  onClick={handleCreate}
                  disabled={busy || !name.trim()}
                  className="flex-1 px-4 py-2 bg-zinc-100 text-zinc-900 rounded font-medium text-sm hover:bg-white disabled:opacity-50 transition-colors"
                >
                  Scegli posizione e crea
                </button>
              </div>
            </div>
          )}

          {error && <p className="text-xs text-red-400 text-center">{error}</p>}
        </div>
      </main>
    </div>
  )
}
