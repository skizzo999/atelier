import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AppMode = 'standard' | 'developer'

interface AppState {
  // Cartella radice del vault attualmente aperto (null = nessun vault).
  vaultPath: string | null
  // Modalità dell'app: 'standard' (utente) o 'developer' (funzioni avanzate).
  mode: AppMode
  // File attualmente aperto nell'editor (null = nessuno). Non persistito.
  selectedFile: string | null
  // Modifiche non salvate per file (path -> contenuto). Non persistito.
  // Condiviso così l'explorer può mostrare l'indicatore "non salvato" sui file.
  dirtyBuffers: Record<string, string>

  setVaultPath: (path: string) => void
  clearVault: () => void
  setMode: (mode: AppMode) => void
  toggleMode: () => void
  setSelectedFile: (path: string | null) => void
  setBuffer: (path: string, content: string) => void
  clearBuffer: (path: string) => void
  clearBuffersUnder: (prefix: string) => void
  moveBuffer: (from: string, to: string) => void
}

// Stato globale. Solo vaultPath e mode vengono persistiti in localStorage
// (vedi `partialize`): selectedFile e dirtyBuffers sono transitori.
export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      vaultPath: null,
      mode: 'standard',
      selectedFile: null,
      dirtyBuffers: {},
      setVaultPath: (path) => set({ vaultPath: path }),
      clearVault: () => set({ vaultPath: null, selectedFile: null, dirtyBuffers: {} }),
      setMode: (mode) => set({ mode }),
      toggleMode: () =>
        set((state) => ({ mode: state.mode === 'standard' ? 'developer' : 'standard' })),
      setSelectedFile: (path) => set({ selectedFile: path }),
      setBuffer: (path, content) =>
        set((state) => ({ dirtyBuffers: { ...state.dirtyBuffers, [path]: content } })),
      clearBuffer: (path) =>
        set((state) => {
          const next = { ...state.dirtyBuffers }
          delete next[path]
          return { dirtyBuffers: next }
        }),
      clearBuffersUnder: (prefix) =>
        set((state) => {
          const next: Record<string, string> = {}
          for (const [k, v] of Object.entries(state.dirtyBuffers)) {
            if (k !== prefix && !k.startsWith(prefix + '\\')) next[k] = v
          }
          return { dirtyBuffers: next }
        }),
      moveBuffer: (from, to) =>
        set((state) => {
          if (state.dirtyBuffers[from] === undefined) return {}
          const next = { ...state.dirtyBuffers }
          next[to] = next[from]
          delete next[from]
          return { dirtyBuffers: next }
        }),
    }),
    {
      name: 'atelier-app',
      partialize: (state) => ({ vaultPath: state.vaultPath, mode: state.mode }),
    },
  ),
)
