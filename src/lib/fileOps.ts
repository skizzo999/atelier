import { writeTextFile, writeFile, mkdir, rename, remove, exists } from '@tauri-apps/plugin-fs'
import { htmlToDocxBlob } from './htmlToDocx'

function joinPath(dir: string, name: string): string {
  return `${dir}\\${name}`
}

function parentDir(path: string): string {
  const i = path.lastIndexOf('\\')
  return i >= 0 ? path.slice(0, i) : path
}

// Crea un file vuoto in `dir`. Errore se esiste già (per non sovrascriverlo).
// I .docx vengono creati come DOCX veri (documento vuoto): un file da 0 byte
// non sarebbe apribile (il formato è uno ZIP con dentro gli XML di Word).
export async function createFile(dir: string, name: string): Promise<string> {
  const path = joinPath(dir, name)
  if (await exists(path)) throw new Error('Esiste già un elemento con questo nome')
  if (name.toLowerCase().endsWith('.docx')) {
    const blob = await htmlToDocxBlob(document.createElement('div'))
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()))
  } else {
    await writeTextFile(path, '')
  }
  return path
}

// Importa nel vault un file esterno (contenuto già letto dal drop HTML5),
// senza mai sovrascrivere: se il nome è occupato aggiunge un suffisso.
export async function importFile(dir: string, name: string, bytes: Uint8Array): Promise<string> {
  let dest = joinPath(dir, name)
  if (await exists(dest)) dest = await uniquePathWithSuffix(dest, 'importato')
  await writeFile(dest, bytes)
  return dest
}

// Sposta un file/cartella dentro `newDir` mantenendo il nome (drag-and-drop).
// Errore se nella destinazione esiste già un elemento con lo stesso nome.
export async function moveEntry(oldPath: string, newDir: string): Promise<string> {
  const name = oldPath.slice(oldPath.lastIndexOf('\\') + 1)
  const dest = joinPath(newDir, name)
  if (dest === oldPath) return oldPath
  if (await exists(dest)) throw new Error(`Nella cartella c'è già "${name}"`)
  await rename(oldPath, dest)
  return dest
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

// Genera un path libero accanto all'originale, aggiungendo un suffisso (e un
// contatore se necessario). Es: foto.png -> foto-ritaglio.png / foto-ritaglio-1.png
export async function uniquePathWithSuffix(originalPath: string, suffix: string): Promise<string> {
  const dir = parentDir(originalPath)
  const file = originalPath.slice(dir.length + 1)
  const dot = file.lastIndexOf('.')
  const base = dot >= 0 ? file.slice(0, dot) : file
  const ext = dot >= 0 ? file.slice(dot) : '' // include il punto

  let candidate = joinPath(dir, `${base}-${suffix}${ext}`)
  let n = 1
  while (await exists(candidate)) {
    candidate = joinPath(dir, `${base}-${suffix}-${n}${ext}`)
    n++
  }
  return candidate
}
