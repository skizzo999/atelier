import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AppMode = 'standard' | 'developer'
// Vista dell'editor markdown: Codice / Ibrida (live preview) / Lettura.
export type MarkdownView = 'source' | 'live' | 'reading'

// Preset di una penna delle annotazioni (configurabile e persistente).
export interface PenPreset {
  color: string
  width: number // spessore in pixel dell'immagine
  opacity: number // 0..1
}

interface AppState {
  // Cartella radice del vault attualmente aperto (null = nessun vault).
  vaultPath: string | null
  // Modalità dell'app: 'standard' (utente) o 'developer' (funzioni avanzate).
  mode: AppMode
  // Ultima vista markdown scelta (persistita, così l'app riapre come l'hai lasciata).
  mdView: MarkdownView
  // Due penne configurabili per le annotazioni (persistite).
  penPresets: [PenPreset, PenPreset]
  // Tre colori dell'evidenziatore PDF, personalizzabili e persistiti.
  pdfHlColors: [string, string, string]
  // File attualmente aperto nell'editor (null = nessuno). Non persistito.
  selectedFile: string | null
  // Modifiche non salvate per file (path -> contenuto). Non persistito.
  // Condiviso così l'explorer può mostrare l'indicatore "non salvato" sui file.
  dirtyBuffers: Record<string, string>
  // Termine da evidenziare nell'editor al prossimo caricamento file (one-shot,
  // impostato quando si apre un file da una ricerca nel contenuto). Non persistito.
  pendingHighlight: string | null
  // Immagini con modifiche non salvate (path -> blob PNG dell'immagine editata).
  // Non persistito. Permette di cambiare file senza perdere le modifiche immagine.
  imageBuffers: Record<string, Blob>

  setVaultPath: (path: string) => void
  clearVault: () => void
  setMode: (mode: AppMode) => void
  setMdView: (view: MarkdownView) => void
  setPenPreset: (index: 0 | 1, patch: Partial<PenPreset>) => void
  setPdfHlColor: (index: 0 | 1 | 2, color: string) => void
  toggleMode: () => void
  setSelectedFile: (path: string | null) => void
  setPendingHighlight: (term: string | null) => void
  setBuffer: (path: string, content: string) => void
  clearBuffer: (path: string) => void
  clearBuffersUnder: (prefix: string) => void
  moveBuffer: (from: string, to: string) => void
  setImageBuffer: (path: string, blob: Blob) => void
  clearImageBuffer: (path: string) => void
  clearImageBuffersUnder: (prefix: string) => void
  moveImageBuffer: (from: string, to: string) => void
}

// Stato globale. Solo vaultPath e mode vengono persistiti in localStorage
// (vedi `partialize`): selectedFile e dirtyBuffers sono transitori.
export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      vaultPath: null,
      mode: 'standard',
      mdView: 'source',
      // Penna 1: tratto pieno rosso; Penna 2: evidenziatore giallo semitrasparente.
      penPresets: [
        { color: '#ef4444', width: 6, opacity: 1 },
        { color: '#facc15', width: 22, opacity: 0.4 },
      ],
      pdfHlColors: ['#facc15', '#4ade80', '#60a5fa'],
      selectedFile: null,
      dirtyBuffers: {},
      pendingHighlight: null,
      imageBuffers: {},
      setVaultPath: (path) => set({ vaultPath: path }),
      clearVault: () =>
        set({ vaultPath: null, selectedFile: null, dirtyBuffers: {}, imageBuffers: {} }),
      setMode: (mode) => set({ mode }),
      setMdView: (view) => set({ mdView: view }),
      setPenPreset: (index, patch) =>
        set((state) => {
          const next: [PenPreset, PenPreset] = [{ ...state.penPresets[0] }, { ...state.penPresets[1] }]
          next[index] = { ...next[index], ...patch }
          return { penPresets: next }
        }),
      setPdfHlColor: (index, color) =>
        set((state) => {
          const next = [...state.pdfHlColors] as [string, string, string]
          next[index] = color
          return { pdfHlColors: next }
        }),
      toggleMode: () =>
        set((state) => ({ mode: state.mode === 'standard' ? 'developer' : 'standard' })),
      setSelectedFile: (path) => set({ selectedFile: path }),
      setPendingHighlight: (term) => set({ pendingHighlight: term }),
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
      setImageBuffer: (path, blob) =>
        set((state) => ({ imageBuffers: { ...state.imageBuffers, [path]: blob } })),
      clearImageBuffer: (path) =>
        set((state) => {
          const next = { ...state.imageBuffers }
          delete next[path]
          return { imageBuffers: next }
        }),
      clearImageBuffersUnder: (prefix) =>
        set((state) => {
          const next: Record<string, Blob> = {}
          for (const [k, v] of Object.entries(state.imageBuffers)) {
            if (k !== prefix && !k.startsWith(prefix + '\\')) next[k] = v
          }
          return { imageBuffers: next }
        }),
      moveImageBuffer: (from, to) =>
        set((state) => {
          if (state.imageBuffers[from] === undefined) return {}
          const next = { ...state.imageBuffers }
          next[to] = next[from]
          delete next[from]
          return { imageBuffers: next }
        }),
    }),
    {
      name: 'atelier-app',
      partialize: (state) => ({
        vaultPath: state.vaultPath,
        mode: state.mode,
        mdView: state.mdView,
        penPresets: state.penPresets,
        pdfHlColors: state.pdfHlColors,
      }),
    },
  ),
)
