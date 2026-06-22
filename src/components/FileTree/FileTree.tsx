import { createContext, useContext, useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { Tree, NodeRendererProps } from 'react-arborist'
import { readDir, exists, watch, type UnwatchFn } from '@tauri-apps/plugin-fs'
import { useAppStore } from '../../store/appStore'
import { openVaultDialog } from '../../lib/vault'

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

// Rilegge dal filesystem i figli di `path`, preservando lo stato (childrenLoaded
// + sottoalberi) delle cartelle ancora aperte. Usata dal watcher per il refresh:
// gli elementi nuovi compaiono, quelli eliminati spariscono, le cartelle aperte
// restano aperte e aggiornate.
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

// Il renderer riceve solo NodeRendererProps: usiamo un context per passargli le
// azioni (lazy-load delle cartelle e selezione del file) con l'oggetto dati del nodo.
interface TreeActions {
  requestLoad: (node: FileNode) => void
  selectFile: (path: string) => void
}
const TreeActionsContext = createContext<TreeActions>({
  requestLoad: () => {},
  selectFile: () => {},
})

function FileNodeComponent({ node, style }: NodeRendererProps<FileNode>) {
  const { data } = node
  const { requestLoad, selectFile } = useContext(TreeActionsContext)
  const icon = data.isFolder ? (node.isOpen ? '📂' : '📁') : '📄'

  return (
    <div
      style={style}
      className={`flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-zinc-800 rounded ${
        node.isSelected ? 'bg-zinc-700' : ''
      }`}
      onClick={() => {
        if (data.isFolder) {
          node.toggle()
          if (!data.childrenLoaded) requestLoad(data)
        } else {
          node.select()
          selectFile(data.path)
        }
      }}
    >
      <span className="text-xs select-none">{icon}</span>
      <span className="text-sm text-zinc-200 truncate flex-1">{data.name}</span>
    </div>
  )
}

export function FileTree({ onSelectFile }: { onSelectFile: (path: string) => void }) {
  const vaultPath = useAppStore((s) => s.vaultPath)
  const setVaultPath = useAppStore((s) => s.setVaultPath)
  const clearVault = useAppStore((s) => s.clearVault)
  const [treeData, setTreeData] = useState<FileNode[]>([])
  const [loading, setLoading] = useState(false)

  // Specchio sincrono di treeData, per leggerlo dentro il callback del watcher.
  const treeDataRef = useRef<FileNode[]>([])
  useEffect(() => {
    treeDataRef.current = treeData
  }, [treeData])

  // Misura il contenitore per far riempire l'albero allo spazio disponibile
  // (react-arborist vuole width/height numerici espliciti).
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

  // Watcher filesystem: tiene l'albero allineato ai cambiamenti esterni.
  // Se la root del vault sparisce torna alla Welcome; altrimenti aggiorna l'albero.
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

  const treeActions = useMemo<TreeActions>(
    () => ({ requestLoad, selectFile: onSelectFile }),
    [requestLoad, onSelectFile],
  )

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-zinc-800">
        <button
          onClick={handleChangeVault}
          className="w-full px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 rounded text-xs transition-colors"
        >
          Cambia vault
        </button>
      </div>

      <div ref={containerRef} className="flex-1 overflow-hidden">
        {loading ? (
          <div className="text-sm text-zinc-500 p-2">Caricamento...</div>
        ) : (
          <TreeActionsContext.Provider value={treeActions}>
            <Tree
              data={treeData}
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
    </div>
  )
}
