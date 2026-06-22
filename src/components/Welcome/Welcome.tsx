import { useState } from 'react'
import { useAppStore } from '../../store/appStore'
import { openVaultDialog, createVaultDialog } from '../../lib/vault'

export function Welcome() {
  const setVaultPath = useAppStore((s) => s.setVaultPath)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleOpen() {
    setBusy(true)
    try {
      const path = await openVaultDialog()
      if (path) setVaultPath(path)
    } catch (err) {
      console.error('Errore apertura vault:', err)
    } finally {
      setBusy(false)
    }
  }

  async function handleCreate() {
    setBusy(true)
    try {
      const path = await createVaultDialog(name)
      if (path) setVaultPath(path)
    } catch (err) {
      console.error('Errore creazione vault:', err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-zinc-900 text-zinc-100">
      <div className="w-96 flex flex-col gap-6">
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight">Atelier</h1>
          <p className="mt-2 text-sm text-zinc-500">
            Apri un vault esistente o creane uno nuovo per iniziare.
          </p>
        </div>

        {!creating ? (
          <div className="flex flex-col gap-3">
            <button
              onClick={handleOpen}
              disabled={busy}
              className="w-full px-4 py-2.5 bg-zinc-100 text-zinc-900 rounded font-medium text-sm hover:bg-white disabled:opacity-50 transition-colors"
            >
              Apri vault
            </button>
            <button
              onClick={() => setCreating(true)}
              disabled={busy}
              className="w-full px-4 py-2.5 bg-zinc-800 text-zinc-200 border border-zinc-700 rounded text-sm hover:bg-zinc-700 disabled:opacity-50 transition-colors"
            >
              Nuovo vault
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
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
      </div>
    </div>
  )
}
