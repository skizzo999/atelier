import { createContext, useContext, useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { Tree, NodeRendererProps } from 'react-arborist'
import { readDir, exists, watch, type UnwatchFn } from '@tauri-apps/plugin-fs'
import { useAppStore } from '../../store/appStore'
import { openVaultDialog } from '../../lib/vault'
import { createFolder, renameEntry, deleteEntry, moveEntry, importFile } from '../../lib/fileOps'
import { NewFileModal } from './NewFileModal'

interface FileNode {
  id: string
  name: string
  path: string
  isFolder: boolean
  children?: FileNode[]
  // Lazy loading: distingue "cartella non ancora caricata" da "cartella vuota".
  childrenLoaded?: boolean
}

async function loadDirectory(path: string): Promise<FileNode[]> {
  try {
    const entries = await readDir(path)
    const nodes: FileNode[] = []

    for (const entry of entries) {
      if (!entry.name) continue
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      if (entry.name.endsWith('.tmp')) continue // file temporanei del salvataggio atomico
      if (entry.name.endsWith('.bak')) continue // backup .docx: utili ma non li mostriamo
      if (entry.name.endsWith('.atelier')) continue // impostazioni documento affianco

      const fullPath = `${path}\\${entry.name}`
      nodes.push({
        id: fullPath,
        name: entry.name,
        path: fullPath,
        isFolder: entry.isDirectory,
        // children array (anche vuoto) = nodo interno/cartella; undefined = foglia/file.
        children: entry.isDirectory ? [] : undefined,
        childrenLoaded: entry.isDirectory ? false : undefined,
      })
    }

    return nodes.sort((a, b) => {
      if (a.isFolder && !b.isFolder) return -1
      if (!a.isFolder && b.isFolder) return 1
      return a.name.localeCompare(b.name)
    })
  } catch (err) {
    console.error('Errore caricamento directory:', err)
    return []
  }
}

// Inserisce i figli caricati nel nodo corrispondente, in modo immutabile
// (react-arborist ricostruisce l'albero da `data`: servono nuovi riferimenti).
function setNodeChildren(nodes: FileNode[], id: string, children: FileNode[]): FileNode[] {
  return nodes.map((node) => {
    if (node.id === id) {
      return { ...node, children, childrenLoaded: true }
    }
    if (node.children && node.children.length > 0) {
      return { ...node, children: setNodeChildren(node.children, id, children) }
    }
    return node
  })
}

// Rilegge dal filesystem i figli di `path`, preservando lo stato delle cartelle
// ancora aperte. Usata dal watcher per il refresh: i nuovi elementi compaiono,
// quelli eliminati spariscono, le cartelle aperte restano aperte e aggiornate.
async function reloadChildren(path: string, oldChildren: FileNode[]): Promise<FileNode[]> {
  const fresh = await loadDirectory(path)
  const oldById = new Map(oldChildren.map((c) => [c.id, c]))
  return Promise.all(
    fresh.map(async (child) => {
      const old = oldById.get(child.id)
      if (child.isFolder && old?.isFolder && old.childrenLoaded && old.children) {
        return {
          ...child,
          children: await reloadChildren(child.path, old.children),
          childrenLoaded: true,
        }
      }
      return child
    }),
  )
}

interface TreeActions {
  requestLoad: (node: FileNode) => void
  selectFile: (path: string) => void
  openMenu: (node: FileNode, x: number, y: number) => void
}
const TreeActionsContext = createContext<TreeActions>({
  requestLoad: () => {},
  selectFile: () => {},
  openMenu: () => {},
})

function FileNodeComponent({ node, style, dragHandle }: NodeRendererProps<FileNode>) {
  const { data } = node
  const { requestLoad, selectFile, openMenu } = useContext(TreeActionsContext)
  const isDirty = useAppStore(
    (s) =>
      !data.isFolder &&
      (s.dirtyBuffers[data.path] !== undefined || s.imageBuffers[data.path] !== undefined),
  )
  const icon = data.isFolder ? (node.isOpen ? '📂' : '📁') : '📄'

  return (
    <div
      ref={dragHandle}
      style={style}
      className={`flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-zinc-800 rounded ${
        node.isSelected ? 'bg-zinc-700' : ''
      } ${node.isDragging ? 'opacity-40' : ''} ${node.willReceiveDrop ? 'bg-zinc-700/70 ring-1 ring-zinc-500' : ''}`}
      onClick={() => {
        if (data.isFolder) {
          node.toggle()
          if (!data.childrenLoaded) requestLoad(data)
        } else {
          node.select()
          selectFile(data.path)
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        node.select()
        openMenu(data, e.clientX, e.clientY)
      }}
    >
      <span className="text-xs select-none">{icon}</span>
      <span className="text-sm text-zinc-200 truncate flex-1">{data.name}</span>
      {isDirty && (
        <span
          className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
          title="Modifiche non salvate"
        />
      )}
    </div>
  )
}

function MenuItem({
  onClick,
  danger,
  children,
}: {
  onClick: () => void
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 hover:bg-zinc-700 ${
        danger ? 'text-red-400' : 'text-zinc-200'
      }`}
    >
      {children}
    </button>
  )
}

function NameModal({
  title,
  initial,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  title: string
  initial: string
  busy: boolean
  error: string | null
  onConfirm: (name: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial)
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
    >
      <div
        className="w-80 bg-zinc-900 border border-zinc-700 rounded-lg p-4 flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-zinc-200">{title}</h3>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) onConfirm(name.trim())
            if (e.key === 'Escape') onCancel()
          }}
          className="px-3 py-2 bg-zinc-950 border border-zinc-700 rounded text-sm text-zinc-100 focus:outline-none focus:border-zinc-500"
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 rounded disabled:opacity-50"
          >
            Annulla
          </button>
          <button
            onClick={() => onConfirm(name.trim())}
            disabled={busy || !name.trim()}
            className="px-3 py-1.5 text-xs bg-zinc-100 text-zinc-900 rounded font-medium hover:bg-white disabled:opacity-50"
          >
            Conferma
          </button>
        </div>
      </div>
    </div>
  )
}

function ConfirmModal({
  message,
  busy,
  onConfirm,
  onCancel,
}: {
  message: string
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
    >
      <div
        className="w-80 bg-zinc-900 border border-zinc-700 rounded-lg p-4 flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm text-zinc-200">{message}</p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 rounded disabled:opacity-50"
          >
            Annulla
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="px-3 py-1.5 text-xs bg-red-600 text-white rounded font-medium hover:bg-red-500 disabled:opacity-50"
          >
            Elimina
          </button>
        </div>
      </div>
    </div>
  )
}

export function FileTree() {
  const vaultPath = useAppStore((s) => s.vaultPath)
  const setVaultPath = useAppStore((s) => s.setVaultPath)
  const clearVault = useAppStore((s) => s.clearVault)
  const setSelectedFile = useAppStore((s) => s.setSelectedFile)
  const [treeData, setTreeData] = useState<FileNode[]>([])
  const [loading, setLoading] = useState(false)

  // target null = area vuota dell'explorer → azioni sulla radice del vault.
  const [menu, setMenu] = useState<{ target: FileNode | null; x: number; y: number } | null>(null)
  const [nameModal, setNameModal] = useState<{
    title: string
    initial: string
    run: (name: string) => Promise<void>
  } | null>(null)
  const [modalBusy, setModalBusy] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<FileNode | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  // Cartella di destinazione della modale "Nuovo file" (null = chiusa).
  const [newFileDir, setNewFileDir] = useState<string | null>(null)
  // Un drag di file ESTERNI (da Explorer di Windows) è sopra l'albero.
  const [dropActive, setDropActive] = useState(false)

  // Specchio sincrono di treeData, per leggerlo dentro il callback del watcher.
  const treeDataRef = useRef<FileNode[]>([])
  useEffect(() => {
    treeDataRef.current = treeData
  }, [treeData])

  // Misura il contenitore per far riempire l'albero allo spazio disponibile.
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      setSize({ width: el.clientWidth, height: el.clientHeight })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [loading])

  // Carica (o ricarica) l'albero quando cambia il vault.
  useEffect(() => {
    if (!vaultPath) {
      setTreeData([])
      return
    }
    let cancelled = false
    setLoading(true)
    loadDirectory(vaultPath).then((nodes) => {
      if (cancelled) return
      setTreeData(nodes)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [vaultPath])

  // Watcher filesystem: tiene l'albero allineato ai cambiamenti (esterni e interni).
  useEffect(() => {
    if (!vaultPath) return
    let unwatch: UnwatchFn | undefined
    let disposed = false

    async function onChange() {
      try {
        const stillThere = await exists(vaultPath!)
        if (!stillThere) {
          clearVault()
          return
        }
        const refreshed = await reloadChildren(vaultPath!, treeDataRef.current)
        if (!disposed) setTreeData(refreshed)
      } catch (err) {
        console.error('Errore aggiornamento albero (watcher):', err)
      }
    }

    watch(vaultPath, () => onChange(), { recursive: true, delayMs: 300 })
      .then((fn) => {
        if (disposed) fn()
        else unwatch = fn
      })
      .catch((err) => console.error('Errore avvio watcher:', err))

    return () => {
      disposed = true
      unwatch?.()
    }
  }, [vaultPath, clearVault])

  // Lazy loading: carica i figli la prima volta che una cartella viene aperta.
  const requestLoad = useCallback(async (node: FileNode) => {
    if (node.childrenLoaded) return
    const children = await loadDirectory(node.path)
    setTreeData((prev) => setNodeChildren(prev, node.id, children))
  }, [])

  const handleChangeVault = useCallback(async () => {
    const path = await openVaultDialog()
    if (path) setVaultPath(path)
  }, [setVaultPath])

  // Drag-and-drop: sposta i nodi trascinati dentro la cartella di destinazione
  // (parentId null = radice del vault). Il refresh visivo lo fa il watcher.
  const handleMove = useCallback(
    async ({ dragIds, parentId }: { dragIds: string[]; parentId: string | null }) => {
      const st = useAppStore.getState()
      const targetDir = parentId ?? st.vaultPath
      if (!targetDir) return
      for (const path of dragIds) {
        // Niente spostamenti nello stesso posto o di una cartella dentro sé stessa.
        if (path.slice(0, path.lastIndexOf('\\')) === targetDir) continue
        if (targetDir === path || targetDir.startsWith(path + '\\')) continue
        try {
          const dest = await moveEntry(path, targetDir)
          const s = useAppStore.getState()
          s.movePathPrefix(path, dest) // buffer non salvati → nuovo percorso
          const sel = s.selectedFile
          if (sel === path) s.setSelectedFile(dest)
          else if (sel && sel.startsWith(path + '\\')) s.setSelectedFile(dest + sel.slice(path.length))
        } catch (err) {
          console.error('Spostamento non riuscito:', err)
        }
      }
    },
    [],
  )

  const treeActions = useMemo<TreeActions>(
    () => ({
      requestLoad,
      selectFile: setSelectedFile,
      openMenu: (node, x, y) => setMenu({ target: node, x, y }),
    }),
    [requestLoad, setSelectedFile],
  )

  // Import di file esterni trascinati da fuori (Explorer di Windows): il drop
  // HTML5 dà nome + contenuto (non il path) → li COPIAMO nel vault e apriamo
  // l'ultimo. Le cartelle non arrivano dal drop HTML5 e vengono saltate.
  async function importDropped(files: FileList) {
    const root = useAppStore.getState().vaultPath
    if (!root) return
    let lastPath: string | null = null
    for (const f of Array.from(files)) {
      if (!f.name) continue
      try {
        const bytes = new Uint8Array(await f.arrayBuffer())
        lastPath = await importFile(root, f.name, bytes)
      } catch (err) {
        console.error(`Import di "${f.name}" non riuscito (cartella?):`, err)
      }
    }
    if (lastPath) setSelectedFile(lastPath) // il watcher aggiorna l'albero
  }

  // --- Operazioni su file/cartelle (le modifiche al disco le riflette il watcher) ---

  function openNewFile(dir: string) {
    setMenu(null)
    setNewFileDir(dir) // modale con nome + tipo (md/docx/txt/…)
  }

  function openNewFolder(dir: string) {
    setMenu(null)
    setModalError(null)
    setNameModal({
      title: 'Nuova cartella',
      initial: 'nuova-cartella',
      run: async (name) => {
        await createFolder(dir, name)
      },
    })
  }

  function openRename(node: FileNode) {
    setMenu(null)
    setModalError(null)
    setNameModal({
      title: 'Rinomina',
      initial: node.name,
      run: async (name) => {
        const np = await renameEntry(node.path, name)
        // Rimappa i buffer non salvati sul nuovo path (anche il sottoalbero,
        // se è stata rinominata una cartella con file sporchi dentro).
        useAppStore.getState().movePathPrefix(node.path, np)
        // Aggiorna il file aperto se era questo (o se è dentro la cartella rinominata).
        const sel = useAppStore.getState().selectedFile
        if (sel === node.path) setSelectedFile(np)
        else if (sel && sel.startsWith(node.path + '\\')) {
          setSelectedFile(np + sel.slice(node.path.length))
        }
      },
    })
  }

  function openDelete(node: FileNode) {
    setMenu(null)
    setConfirmTarget(node)
  }

  async function handleNameConfirm(name: string) {
    if (!nameModal) return
    setModalBusy(true)
    setModalError(null)
    try {
      await nameModal.run(name)
      setNameModal(null)
    } catch (err) {
      setModalError(err instanceof Error ? err.message : String(err))
    } finally {
      setModalBusy(false)
    }
  }

  async function handleDeleteConfirm() {
    if (!confirmTarget) return
    setConfirmBusy(true)
    try {
      await deleteEntry(confirmTarget.path, confirmTarget.isFolder)
      // Scarta eventuali buffer non salvati del file/cartella eliminati.
      useAppStore.getState().clearBuffersUnder(confirmTarget.path)
      useAppStore.getState().clearImageBuffersUnder(confirmTarget.path)
      const sel = useAppStore.getState().selectedFile
      if (sel === confirmTarget.path || (sel && sel.startsWith(confirmTarget.path + '\\'))) {
        setSelectedFile(null)
      }
      setConfirmTarget(null)
    } catch (err) {
      console.error('Errore eliminazione:', err)
      setConfirmTarget(null)
    } finally {
      setConfirmBusy(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-zinc-800 flex gap-1.5">
        <button
          onClick={() => vaultPath && setNewFileDir(vaultPath)}
          className="flex-1 px-2 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 rounded text-xs transition-colors"
          title="Crea un nuovo file nel vault"
        >
          ＋ Nuovo file
        </button>
        <button
          onClick={handleChangeVault}
          className="flex-1 px-2 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 rounded text-xs transition-colors"
        >
          Cambia vault
        </button>
      </div>

      <div
        ref={containerRef}
        className={`flex-1 overflow-hidden relative ${dropActive ? 'ring-2 ring-inset ring-blue-500/70 bg-blue-500/5' : ''}`}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ target: null, x: e.clientX, y: e.clientY })
        }}
        // Drop di file ESTERNI (il drag interno di react-arborist non è di tipo 'Files').
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault()
            setDropActive(true)
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropActive(false)
        }}
        onDrop={(e) => {
          if (e.dataTransfer.files.length) {
            e.preventDefault()
            setDropActive(false)
            importDropped(e.dataTransfer.files)
          }
        }}
      >
        {dropActive && (
          <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center">
            <span className="px-3 py-1.5 bg-zinc-900/90 border border-blue-500/50 rounded text-xs text-blue-300">
              Rilascia per importare nel vault
            </span>
          </div>
        )}
        {loading ? (
          <div className="text-sm text-zinc-500 p-2">Caricamento...</div>
        ) : (
          <TreeActionsContext.Provider value={treeActions}>
            <Tree
              data={treeData}
              onMove={handleMove}
              openByDefault={false}
              width={size.width}
              height={size.height}
              indent={16}
              rowHeight={28}
              overscanCount={10}
              paddingTop={4}
              paddingBottom={4}
            >
              {FileNodeComponent}
            </Tree>
          </TreeActionsContext.Provider>
        )}
      </div>

      {menu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu(null)
            }}
          />
          <div
            className="fixed z-50 w-44 bg-zinc-800 border border-zinc-700 rounded shadow-lg py-1 text-sm"
            style={{ top: menu.y, left: menu.x }}
          >
            {menu.target === null ? (
              <>
                <MenuItem onClick={() => vaultPath && openNewFile(vaultPath)}>Nuovo file</MenuItem>
                <MenuItem onClick={() => vaultPath && openNewFolder(vaultPath)}>
                  Nuova cartella
                </MenuItem>
              </>
            ) : (
              <>
                {menu.target.isFolder && (
                  <>
                    <MenuItem onClick={() => openNewFile(menu.target!.path)}>Nuovo file</MenuItem>
                    <MenuItem onClick={() => openNewFolder(menu.target!.path)}>
                      Nuova cartella
                    </MenuItem>
                  </>
                )}
                <MenuItem onClick={() => openRename(menu.target!)}>Rinomina</MenuItem>
                <MenuItem danger onClick={() => openDelete(menu.target!)}>
                  Elimina
                </MenuItem>
              </>
            )}
          </div>
        </>
      )}

      {newFileDir && (
        <NewFileModal
          dir={newFileDir}
          onClose={() => setNewFileDir(null)}
          onCreated={(p) => {
            setNewFileDir(null)
            setSelectedFile(p)
          }}
        />
      )}

      {nameModal && (
        <NameModal
          title={nameModal.title}
          initial={nameModal.initial}
          busy={modalBusy}
          error={modalError}
          onConfirm={handleNameConfirm}
          onCancel={() => {
            setNameModal(null)
            setModalError(null)
          }}
        />
      )}

      {confirmTarget && (
        <ConfirmModal
          message={`Eliminare "${confirmTarget.name}"${
            confirmTarget.isFolder ? ' e tutto il suo contenuto' : ''
          }?`}
          busy={confirmBusy}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setConfirmTarget(null)}
        />
      )}
    </div>
  )
}
