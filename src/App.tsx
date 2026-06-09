import './App.css'
import { FileTree } from './components/FileTree/FileTree'

function App() {
  return (
    <div className="flex h-screen w-screen bg-zinc-900 text-zinc-100">
      <aside className="w-64 bg-zinc-950 border-r border-zinc-800 flex flex-col">
        <div className="p-4 border-b border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Explorer</h3>
        </div>
        <FileTree />
      </aside>
      
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 p-8 overflow-y-auto">
          <h1 className="text-3xl font-bold mb-4">Editor Area</h1>
          <p className="text-zinc-500">Seleziona un file dalla sidebar per iniziare.</p>
          <div className="mt-8 p-4 bg-zinc-800 rounded-lg border border-zinc-700">
            <p className="text-sm text-zinc-400">✅ Se vedi questo stile, Tailwind è configurato correttamente.</p>
          </div>
        </div>
      </main>
    </div>
  )
}

export default App