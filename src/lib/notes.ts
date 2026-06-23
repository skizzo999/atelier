import { exists, writeTextFile } from '@tauri-apps/plugin-fs'

// Indice note del vault: nome senza estensione (minuscolo) -> path .md completo.
let noteIndex = new Map<string, string>()
export function setNoteIndex(index: Map<string, string>) {
  noteIndex = index
}

// Risolve un wikilink [[nome]] in un path .md: se la nota esiste la ritorna,
// altrimenti la crea (nella cartella `dir`) e ritorna il nuovo path.
export async function resolveOrCreateNote(name: string, dir: string): Promise<string | null> {
  const base = name.replace(/\.md$/i, '').trim()
  if (!base) return null

  const found = noteIndex.get(base.toLowerCase())
  if (found) return found

  const path = `${dir}\\${base}.md`
  try {
    if (!(await exists(path))) await writeTextFile(path, `# ${base}\n`)
    return path
  } catch (err) {
    console.error('Errore apertura wikilink:', err)
    return null
  }
}
