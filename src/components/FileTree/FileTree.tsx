import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'
import { Tree, NodeRendererProps } from 'react-arborist'
import { readDir } from '@tauri-apps/plugin-fs'
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

// Il renderer riceve solo NodeRendererProps: usiamo un context per fargli
// chiedere il lazy-load passando direttamente l'oggetto dati del nodo cliccato.
const RequestLoadContext = createContext<(node: FileNode) => void>(() => {})

function FileNodeComponent({ node, style }: NodeRendererProps<FileNode>) {
  const { data } = node
  const requestLoad = useContext(RequestLoadContext)
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
          console.log('File selezionato:', data.path)
        }
      }}
    >
      <span className="text-xs select-none">{icon}</span>
      <span className="text-sm text-zinc-200 truncate flex-1">{data.name}</span>
    </div>
  )
}

export function FileTree() {
  const vaultPath = useAppStore((s) => s.vaultPath)
  const setVaultPath = useAppStore((s) => s.setVaultPath)
  const [treeData, setTreeData] = useState<FileNode[]>([])
  const [loading, setLoading] = useState(false)

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
          <RequestLoadContext.Provider value={requestLoad}>
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
          </RequestLoadContext.Provider>
        )}
      </div>
    </div>
  )
}
