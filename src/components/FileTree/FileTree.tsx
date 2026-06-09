import { useState, useCallback } from 'react'
import { Tree, NodeApi, NodeRendererProps } from 'react-arborist'
import { open } from '@tauri-apps/plugin-dialog'
import { readDir } from '@tauri-apps/plugin-fs'

interface FileNode {
  id: string
  name: string
  path: string
  isFolder: boolean
  children?: FileNode[]
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
        children: entry.isDirectory ? undefined : []
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

function FileNodeComponent({ node, style, dragHandle }: NodeRendererProps<FileNode>) {
  const { data } = node
  
  return (
    <div
      ref={dragHandle}
      style={style}
      className={`flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-zinc-800 rounded ${
        node.isSelected ? 'bg-zinc-700' : ''
      }`}
      onClick={() => {
        if (data.isFolder) {
          node.toggle()
        } else {
          node.tree.select(node.id)
          console.log('File selezionato:', data.path)
        }
      }}
    >
      <span className="text-xs select-none">
        {data.isFolder ? (node.isOpen ? '' : '📁') : ''}
      </span>
      <span className="text-sm text-zinc-200 truncate flex-1">
        {data.name}
      </span>
    </div>
  )
}

export function FileTree() {
  const [rootPath, setRootPath] = useState<string | null>(null)
  const [treeData, setTreeData] = useState<FileNode[]>([])
  const [loading, setLoading] = useState(false)

  const handleOpenFolder = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Seleziona una cartella'
    })
    
    if (selected) {
      setRootPath(selected)
      setLoading(true)
      const nodes = await loadDirectory(selected)
      setTreeData(nodes)
      setLoading(false)
    }
  }, [])

  const onLoadChildren = useCallback(async (parentNode: NodeApi<FileNode>) => {
    console.log('Caricamento figli per:', parentNode.data.path)
    const children = await loadDirectory(parentNode.data.path)
    
    // Mutazione in-place: aggiorniamo i children del nodo esistente
    parentNode.data.children = children
    
    // Shallow copy per triggerare re-render di React
    setTreeData(prevData => [...prevData])
    
    console.log('Figli caricati:', children.length)
  }, [])

  if (!rootPath) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <button
          onClick={handleOpenFolder}
          className="w-full px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 rounded text-sm transition-colors"
        >
          Apri cartella
        </button>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-zinc-800">
        <button
          onClick={handleOpenFolder}
          className="w-full px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 rounded text-xs transition-colors"
        >
          Cambia cartella
        </button>
        <div className="mt-2 text-xs text-zinc-500 truncate" title={rootPath}>
          {rootPath}
        </div>
      </div>
      
      <div className="flex-1 overflow-auto p-2">
        {loading ? (
          <div className="text-sm text-zinc-500 p-2">Caricamento...</div>
        ) : (
          <Tree
            data={treeData}
            openByDefault={false}
            width={240}
            height={600}
            indent={16}
            rowHeight={28}
            overscanCount={10}
            paddingTop={4}
            paddingBottom={4}
            padding={4}
            onLoad={onLoadChildren}
          >
            {FileNodeComponent}
          </Tree>
        )}
      </div>
    </div>
  )
}