import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AppMode = 'standard' | 'developer'

interface AppState {
  // Cartella radice del vault attualmente aperto (null = nessun vault).
  vaultPath: string | null
  // Modalità dell'app: 'standard' (utente) o 'developer' (funzioni avanzate).
  mode: AppMode

  setVaultPath: (path: string) => void
  clearVault: () => void
  setMode: (mode: AppMode) => void
  toggleMode: () => void
}

// Stato globale persistito in localStorage: vaultPath e mode sopravvivono
// al riavvio dell'app, così al boot possiamo riaprire l'ultimo vault.
export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      vaultPath: null,
      mode: 'standard',
      setVaultPath: (path) => set({ vaultPath: path }),
      clearVault: () => set({ vaultPath: null }),
      setMode: (mode) => set({ mode }),
      toggleMode: () =>
        set((state) => ({ mode: state.mode === 'standard' ? 'developer' : 'standard' })),
    }),
    { name: 'atelier-app' },
  ),
)
