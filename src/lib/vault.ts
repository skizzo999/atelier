import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { mkdir, exists, writeTextFile } from '@tauri-apps/plugin-fs'

// Concede a runtime l'accesso in lettura alla cartella e a tutto il sottoalbero.
// Va richiamata ogni volta che si apre un vault (anche al boot per quello salvato):
// lo scope concesso a runtime NON sopravvive al riavvio dell'app.
export async function grantVaultAccess(path: string): Promise<void> {
  await invoke('allow_path', { path })
}

// Rende la cartella un VERO vault Atelier (come .obsidian per Obsidian):
// crea `<vault>\.atelier\vault.json` con nome e data. Le cartelle che iniziano
// col punto sono già nascoste da tree e ricerca. Best-effort: una cartella in
// sola lettura non deve impedire l'apertura.
export async function initVaultMeta(path: string): Promise<void> {
  try {
    const dir = `${path}\\.atelier`
    if (!(await exists(dir))) await mkdir(dir)
    const meta = `${dir}\\vault.json`
    if (!(await exists(meta))) {
      const name = path.split('\\').pop() || path
      await writeTextFile(meta, JSON.stringify({ name, createdAt: new Date().toISOString(), app: 'atelier' }, null, 2))
    }
  } catch (e) {
    console.warn('Metadati vault non scrivibili:', e)
  }
}

// Apre un dialog per scegliere una cartella esistente da usare come vault.
// Ritorna il path scelto (già autorizzato) oppure null se l'utente annulla.
export async function openVaultDialog(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: 'Apri vault',
  })
  if (typeof selected !== 'string') return null
  await grantVaultAccess(selected)
  return selected
}

// Crea una nuova cartella-vault con il nome dato, dentro una posizione scelta
// dall'utente. Ritorna il path del nuovo vault o null se annullato/nome vuoto.
export async function createVaultDialog(name: string): Promise<string | null> {
  const trimmed = name.trim()
  if (!trimmed) return null

  const parent = await open({
    directory: true,
    multiple: false,
    title: 'Scegli dove creare il vault',
  })
  if (typeof parent !== 'string') return null

  // Scope SOLO sul vault, non sul genitore: mkdir controlla il path di
  // destinazione (già autorizzato), quindi il permesso sul parent non serve
  // e concederlo allargherebbe la superficie per tutta la sessione.
  const vaultPath = `${parent}\\${trimmed}`
  await grantVaultAccess(vaultPath)
  await mkdir(vaultPath, { recursive: true })
  return vaultPath
}
