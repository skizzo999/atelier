import { useEffect, useState } from 'react'
import './App.css'
import { exists } from '@tauri-apps/plugin-fs'
import { useAppStore } from './store/appStore'
import { grantVaultAccess } from './lib/vault'
import { FileTree } from './components/FileTree/FileTree'
import { Editor } from './components/Editor/Editor'
import { Welcome } from './components/Welcome/Welcome'

function App() {
  const vaultPath = useAppStore((s) => s.vaultPath)
  const clearVault = useAppStore((s) => s.clearVault)
  const mode = useAppStore((s) => s.mode)
  const toggleMode = useAppStore((s) => s.toggleMode)
  const [booting, setBooting] = useState(true)

  // Boot: lo scope concesso a runtime non sopravvive al riavvio, quindi va
  // ri-concesso al vault salvato; se la cartella non esiste più, lo dimentichiamo.
  useEffect(() => {
    let cancelled = false
    async function boot() {
      const saved = useAppStore.getState().vaultPath
      if (saved) {
        try {
          await grantVaultAccess(saved)
          const ok = await exists(saved)
          if (!ok && !cancelled) clearVault()
        } catch (err) {
          console.error('Errore apertura vault salvato:', err)
          if (!cancelled) clearVault()
        }
      }
      if (!cancelled) setBooting(false)
    }
    boot()
    return () => {
      cancelled = true
    }
  }, [clearVault])

  // Rete di sicurezza: quando la finestra torna in primo piano, verifica che il
  // vault esista ancora (nel caso il watcher non avesse intercettato la rimozione).
  useEffect(() => {
    function onFocus() {
      const saved = useAppStore.getState().vaultPath
      if (!saved) return
      exists(saved)
        .then((ok) => {
          if (!ok) clearVault()
        })
        .catch(() => {})
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [clearVault])

  if (booting) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-zinc-900 text-zinc-500">
        Caricamento...
      </div>
    )
  }

  if (!vaultPath) {
    return <Welcome />
  }

  return (
    <div className="flex h-screen w-screen bg-zinc-900 text-zinc-100">
      <aside className="w-64 bg-zinc-950 border-r border-zinc-800 flex flex-col">
        <div className="p-4 border-b border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Explorer</h3>
        </div>
        <FileTree />
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-12 flex items-center justify-between px-4 border-b border-zinc-800">
          <span className="text-xs text-zinc-500 truncate" title={vaultPath}>
            {vaultPath}
          </span>
          <button
            onClick={toggleMode}
            className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-xs text-zinc-300 transition-colors shrink-0"
            title="Cambia modalità"
          >
            {mode === 'developer' ? '🛠 Developer' : '📝 Standard'}
          </button>
        </header>

        <Editor />
      </main>
    </div>
  )
}

export default App
