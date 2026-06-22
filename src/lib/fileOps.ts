import { writeTextFile, writeFile, mkdir, rename, remove, exists } from '@tauri-apps/plugin-fs'

function joinPath(dir: string, name: string): string {
  return `${dir}\\${name}`
}

function parentDir(path: string): string {
  const i = path.lastIndexOf('\\')
  return i >= 0 ? path.slice(0, i) : path
}

// Crea un file vuoto in `dir`. Errore se esiste già (per non sovrascriverlo).
export async function createFile(dir: string, name: string): Promise<string> {
  const path = joinPath(dir, name)
  if (await exists(path)) throw new Error('Esiste già un elemento con questo nome')
  await writeTextFile(path, '')
  return path
}

export async function createFolder(dir: string, name: string): Promise<string> {
  const path = joinPath(dir, name)
  if (await exists(path)) throw new Error('Esiste già un elemento con questo nome')
  await mkdir(path)
  return path
}

// Rinomina un file/cartella nello stesso parent. Ritorna il nuovo path.
export async function renameEntry(oldPath: string, newName: string): Promise<string> {
  const newPath = joinPath(parentDir(oldPath), newName)
  if (newPath === oldPath) return oldPath
  if (await exists(newPath)) throw new Error('Esiste già un elemento con questo nome')
  await rename(oldPath, newPath)
  return newPath
}

export async function deleteEntry(path: string, isFolder: boolean): Promise<void> {
  await remove(path, { recursive: isFolder })
}

// Salvataggio atomico: scrive su file temporaneo e poi rinomina sul file finale.
// `std::fs::rename` su Windows sostituisce il file esistente, quindi la sostituzione
// è atomica: in caso di crash a metà scrittura, l'originale resta intatto.
export async function writeFileAtomic(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp`
  await writeTextFile(tmp, content)
  await rename(tmp, path)
}

// Variante binaria del salvataggio atomico (es. immagini ri-encodate da canvas).
export async function writeFileBinaryAtomic(path: string, data: Uint8Array): Promise<void> {
  const tmp = `${path}.tmp`
  await writeFile(tmp, data)
  await rename(tmp, path)
}
