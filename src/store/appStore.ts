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

  setVaultPath: (path: string) => void
  clearVault: () => void
  setMode: (mode: AppMode) => void
  toggleMode: () => void
  setSelectedFile: (path: string | null) => void
}

// Stato globale. Solo vaultPath e mode vengono persistiti in localStorage
// (vedi `partialize`): selectedFile è transitorio e non deve sopravvivere al riavvio.
export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      vaultPath: null,
      mode: 'standard',
      selectedFile: null,
      setVaultPath: (path) => set({ vaultPath: path }),
      clearVault: () => set({ vaultPath: null, selectedFile: null }),
      setMode: (mode) => set({ mode }),
      toggleMode: () =>
        set((state) => ({ mode: state.mode === 'standard' ? 'developer' : 'standard' })),
      setSelectedFile: (path) => set({ selectedFile: path }),
    }),
    {
      name: 'atelier-app',
      partialize: (state) => ({ vaultPath: state.vaultPath, mode: state.mode }),
    },
  ),
)
