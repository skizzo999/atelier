import './App.css'
import { FileTree } from './components/FileTree/FileTree'

function App() {
  return (
    <div style={{ display: 'flex', width: '100%', height: '100%' }}>
      <aside className="sidebar">
        <div style={{ padding: '15px', borderBottom: '1px solid #333' }}>
          <h3 style={{ margin: 0, fontSize: '14px', color: '#aaa' }}>EXPLORER</h3>
        </div>
        <FileTree />
      </aside>
      
      <main className="main-content">
        <div className="editor-container">
          <h1>Editor Area</h1>
          <p style={{ color: '#888' }}>Seleziona un file dalla sidebar per iniziare.</p>
        </div>
      </main>
    </div>
  )
}

export default App
