import { useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { readDir, readTextFile } from '@tauri-apps/plugin-fs'

interface FileNode {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
}

export function FileTree() {
  const [rootPath, setRootPath] = useState<string | null>(null)
  const [tree, setTree] = useState<FileNode[]>([])
  const [loading, setLoading] = useState(false)

  async function handleOpenFolder() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Seleziona una cartella'
    })
    if (selected) {
      setRootPath(selected)
      setLoading(true)
      try {
        const entries = await readDir(selected)
        const nodes: FileNode[] = entries.map(e => ({
          name: e.name,
          path: e.path,
          isDir: e.isDirectory
        }))
        setTree(nodes)
      } catch (err) {
        console.error('Errore lettura directory:', err)
      } finally {
        setLoading(false)
      }
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '10px', borderBottom: '1px solid #333' }}>
        <button
          onClick={handleOpenFolder}
          style={{
            width: '100%',
            padding: '6px 12px',
            background: '#2a2a2a',
            color: '#f6f6f6',
            border: '1px solid #444',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px'
          }}
        >
          {rootPath ? 'Cambia cartella' : 'Apri cartella'}
        </button>
        {rootPath && (
          <div style={{ fontSize: '10px', color: '#666', marginTop: '6px', wordBreak: 'break-all' }}>
            {rootPath}
          </div>
        )}
      </div>
      
      <div style={{ flex: 1, overflow: 'auto', padding: '8px' }}>
        {loading && <div style={{ color: '#888', fontSize: '12px' }}>Caricamento...</div>}
        {!loading && tree.length === 0 && (
          <div style={{ color: '#555', fontSize: '12px' }}>Nessuna cartella aperta</div>
        )}
        {tree.map(node => (
          <div
            key={node.path}
            style={{
              padding: '4px 8px',
              fontSize: '13px',
              color: node.isDir ? '#e6c07b' : '#ccc',
              cursor: 'pointer',
              borderRadius: '3px'
            }}
          >
            {node.isDir ? '📁' : ''} {node.name}
          </div>
        ))}
      </div>
    </div>
  )
}
