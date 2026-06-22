import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { mkdir } from '@tauri-apps/plugin-fs'

// Concede a runtime l'accesso in lettura alla cartella e a tutto il sottoalbero.
// Va richiamata ogni volta che si apre un vault (anche al boot per quello salvato):
// lo scope concesso a runtime NON sopravvive al riavvio dell'app.
export async function grantVaultAccess(path: string): Promise<void> {
  await invoke('allow_path', { path })
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

  // Serve l'accesso al parent per poter creare la sottocartella al suo interno.
  await grantVaultAccess(parent)
  const vaultPath = `${parent}\\${trimmed}`
  await mkdir(vaultPath, { recursive: true })
  await grantVaultAccess(vaultPath)
  return vaultPath
}
