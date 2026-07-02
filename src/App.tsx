import { useEffect, useState } from 'react'
import './App.css'
import { exists } from '@tauri-apps/plugin-fs'
import { confirm } from '@tauri-apps/plugin-dialog'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useAppStore } from './store/appStore'
import { grantVaultAccess } from './lib/vault'
import { walkFiles } from './lib/search'
import { setVaultImageIndex } from './lib/images'
import { setNoteIndex } from './lib/notes'

const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif'])
import { FileTree } from './components/FileTree/FileTree'
import { FileView } from './components/FileView/FileView'
import { Welcome } from './components/Welcome/Welcome'
import { SearchPalette } from './components/SearchPalette/SearchPalette'

function App() {
  const vaultPath = useAppStore((s) => s.vaultPath)
  const clearVault = useAppStore((s) => s.clearVault)
  const mode = useAppStore((s) => s.mode)
  const toggleMode = useAppStore((s) => s.toggleMode)
  const [booting, setBooting] = useState(true)
  const [palette, setPalette] = useState<'files' | 'content' | null>(null)

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

  // Indice immagini del vault (nome -> path), per risolvere ![[img]] ovunque.
  useEffect(() => {
    if (!vaultPath) {
      setVaultImageIndex(new Map())
      return
    }
    let cancelled = false
    walkFiles(vaultPath).then((files) => {
      if (cancelled) return
      const imgMap = new Map<string, string>()
      const noteMap = new Map<string, string>()
      for (const f of files) {
        const lower = f.name.toLowerCase()
        const ext = lower.split('.').pop()
        if (ext && IMG_EXT.has(ext)) imgMap.set(lower, f.path)
        if (lower.endsWith('.md')) noteMap.set(lower.replace(/\.md$/, ''), f.path)
      }
      setVaultImageIndex(imgMap)
      setNoteIndex(noteMap)
    })
    return () => {
      cancelled = true
    }
  }, [vaultPath])

  // Scorciatoie globali per la ricerca (solo con un vault aperto):
  // Ctrl/Cmd+P = quick-open per nome, Ctrl/Cmd+Shift+F = ricerca nel contenuto.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!useAppStore.getState().vaultPath) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setPalette('files')
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setPalette('content')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Guardia chiusura: se ci sono modifiche non salvate (testo o immagini),
  // chiedi conferma prima di chiudere la finestra — altrimenti si perdono in
  // silenzio (i buffer vivono solo in memoria). Se il handler non chiama
  // preventDefault, l'API Tauri chiude da sola con destroy().
  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    getCurrentWindow()
      .onCloseRequested(async (event) => {
        const s = useAppStore.getState()
        const n = Object.keys(s.dirtyBuffers).length + Object.keys(s.imageBuffers).length
        if (n === 0) return // niente di sporco: chiudi pure
        const ok = await confirm(
          n === 1
            ? "C'è 1 file con modifiche non salvate: uscendo le perdi."
            : `Ci sono ${n} file con modifiche non salvate: uscendo le perdi.`,
          { title: 'Atelier', kind: 'warning', okLabel: 'Esci senza salvare', cancelLabel: 'Annulla' },
        )
        if (!ok) event.preventDefault()
      })
      .then((f) => {
        if (disposed) f()
        else unlisten = f
      })
      .catch((e) => console.error('Guardia chiusura non attiva:', e))
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

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

        <FileView />
      </main>

      {palette && <SearchPalette initialMode={palette} onClose={() => setPalette(null)} />}
    </div>
  )
}

export default App
