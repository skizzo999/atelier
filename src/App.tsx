import { useEffect, useState } from 'react'
import './App.css'
import { exists } from '@tauri-apps/plugin-fs'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useAppStore } from './store/appStore'
import { grantVaultAccess, initVaultMeta } from './lib/vault'
import { walkFiles } from './lib/search'
import { setVaultImageIndex } from './lib/images'
import { setNoteIndex } from './lib/notes'

const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif'])
import { FileTree } from './components/FileTree/FileTree'
import { FileView } from './components/FileView/FileView'
import { Welcome } from './components/Welcome/Welcome'
import { SearchPalette } from './components/SearchPalette/SearchPalette'
import { ConfirmDialog } from './components/ConfirmDialog'
import { TitleBar } from './components/TitleBar'
import { TabBar } from './components/TabBar'

function App() {
  const vaultPath = useAppStore((s) => s.vaultPath)
  const clearVault = useAppStore((s) => s.clearVault)
  const sidebarWidth = useAppStore((s) => s.sidebarWidth)
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const setSidebarWidth = useAppStore((s) => s.setSidebarWidth)
  const [booting, setBooting] = useState(true)
  // Un'altra istanza di Atelier è già aperta → mostra il picker dei vault
  // (stile Obsidian) invece di auto-aprire l'ultimo, senza toccare il persist.
  const [forcePicker, setForcePicker] = useState(false)
  const [palette, setPalette] = useState<'files' | 'content' | null>(null)
  // Guardia chiusura: n° di file sporchi quando l'utente prova a chiudere
  // (mostra la modale in-app al posto del confirm nativo di sistema).
  const [closeAsk, setCloseAsk] = useState<number | null>(null)

  // Boot: lo scope concesso a runtime non sopravvive al riavvio, quindi va
  // ri-concesso al vault salvato; se la cartella non esiste più, lo dimentichiamo.
  useEffect(() => {
    let cancelled = false
    async function boot() {
      // Heartbeat di un'altra istanza (localStorage è condiviso): se è fresco,
      // c'è già un Atelier aperto → questa finestra parte dal picker.
      const hb = Number(localStorage.getItem('atelier-heartbeat') || 0)
      const otherAlive = Date.now() - hb < 8000
      if (otherAlive) setForcePicker(true)
      const saved = useAppStore.getState().vaultPath
      if (saved && !otherAlive) {
        try {
          await grantVaultAccess(saved)
          const ok = await exists(saved)
          if (!ok && !cancelled) clearVault()
          else if (ok && !cancelled) {
            await initVaultMeta(saved) // vault "vero": .atelier\vault.json
            useAppStore.getState().registerVault(saved)
          }
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

  // Heartbeat di QUESTA istanza (parte dopo la lettura del boot, gli effetti
  // corrono in ordine di dichiarazione): le altre finestre lo vedono fresco.
  // Alla chiusura va RIMOSSO, altrimenti riaprendo l'app entro 8s si vede il
  // proprio heartbeat stantio e compare il picker invece dell'ultimo vault.
  useEffect(() => {
    const write = () => localStorage.setItem('atelier-heartbeat', String(Date.now()))
    const clear = () => localStorage.removeItem('atelier-heartbeat')
    const t = setInterval(write, 3000)
    write()
    window.addEventListener('beforeunload', clear)
    return () => {
      clearInterval(t)
      window.removeEventListener('beforeunload', clear)
      clear()
    }
  }, [])

  // Indice immagini del vault (nome -> path), per risolvere ![[img]] ovunque.
  // Aspetta la fine del boot (lo scope fs deve essere già concesso) e il
  // picker chiuso, altrimenti la scansione parte senza permessi e resta vuota.
  // Si ricalcola quando il watcher segnala cambi su disco (fsRevision).
  const fsRevision = useAppStore((s) => s.fsRevision)
  useEffect(() => {
    if (booting || forcePicker) return
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
  }, [vaultPath, booting, forcePicker, fsRevision])

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
        if (n === 0) {
          localStorage.removeItem('atelier-heartbeat') // beforeunload può non scattare con destroy()
          return // niente di sporco: chiudi pure
        }
        // Modale in-app (niente confirm nativo): blocca la chiusura e chiedi.
        // Se l'utente conferma, la modale chiude la finestra con destroy().
        event.preventDefault()
        setCloseAsk(n)
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

  // Barra del titolo custom sempre presente (decorations: false): la finestra
  // resta trascinabile/chiudibile in ogni stato (boot, picker, app).
  if (booting) {
    return (
      <div className="flex flex-col h-screen w-screen bg-zinc-900 overflow-hidden">
        <TitleBar />
        <div className="flex-1 flex items-center justify-center text-zinc-500">Caricamento...</div>
      </div>
    )
  }

  if (!vaultPath || forcePicker) {
    return (
      <div className="flex flex-col h-screen w-screen bg-zinc-900 overflow-hidden">
        <TitleBar />
        <Welcome onOpened={() => setForcePicker(false)} />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen w-screen bg-zinc-900 text-zinc-100 overflow-hidden">
      <TitleBar />
      <div className="flex flex-1 min-h-0">
      {/* Explorer dinamico: larghezza trascinabile, nascondibile dalla titlebar */}
      {sidebarOpen && (
        <>
          <aside style={{ width: sidebarWidth }} className="shrink-0 bg-zinc-950 flex flex-col">
            <div className="px-4 pt-3 pb-2">
              <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-widest">Explorer</h3>
            </div>
            <FileTree />
          </aside>
          <div
            className="w-1 shrink-0 cursor-col-resize bg-zinc-800/60 hover:bg-blue-500/50 transition-colors"
            title="Trascina per ridimensionare"
            onMouseDown={(e) => {
              e.preventDefault()
              const startX = e.clientX
              const orig = sidebarWidth
              const move = (ev: MouseEvent) => setSidebarWidth(orig + ev.clientX - startX)
              const up = () => {
                document.removeEventListener('mousemove', move)
                document.removeEventListener('mouseup', up)
              }
              document.addEventListener('mousemove', move)
              document.addEventListener('mouseup', up)
            }}
          />
        </>
      )}

      <main className="flex-1 flex flex-col overflow-hidden">
        <TabBar />
        <FileView />
      </main>

      {palette && <SearchPalette initialMode={palette} onClose={() => setPalette(null)} />}

      {/* Guardia chiusura: modale in-app al posto del confirm nativo. */}
      <ConfirmDialog
        open={closeAsk !== null}
        title="Modifiche non salvate"
        message={
          closeAsk === 1
            ? "C'è 1 file con modifiche non salvate: uscendo le perdi."
            : `Ci sono ${closeAsk} file con modifiche non salvate: uscendo le perdi.`
        }
        confirmLabel="Esci senza salvare"
        danger
        onCancel={() => setCloseAsk(null)}
        onConfirm={() => {
          localStorage.removeItem('atelier-heartbeat')
          void getCurrentWindow().destroy()
        }}
      />
      </div>
    </div>
  )
}

export default App
