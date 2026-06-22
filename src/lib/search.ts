import { readDir, readTextFile } from '@tauri-apps/plugin-fs'

export interface VaultFile {
  path: string
  name: string
  rel: string // percorso relativo alla radice del vault
}

export interface ContentMatch {
  path: string
  name: string
  rel: string
  line: number
  preview: string
}

function skip(name: string): boolean {
  return name.startsWith('.') || name === 'node_modules' || name.endsWith('.tmp')
}

// Elenca ricorsivamente TUTTI i file del vault (qualsiasi tipo): serve al quick-open.
export async function walkFiles(root: string): Promise<VaultFile[]> {
  const out: VaultFile[] = []

  async function walk(dir: string) {
    let entries
    try {
      entries = await readDir(dir)
    } catch {
      return
    }
    for (const e of entries) {
      if (!e.name || skip(e.name)) continue
      const full = `${dir}\\${e.name}`
      if (e.isDirectory) {
        await walk(full)
      } else {
        out.push({ path: full, name: e.name, rel: full.slice(root.length + 1) })
      }
    }
  }

  await walk(root)
  return out
}

// Estensioni testuali su cui ha senso la ricerca nel contenuto. I formati binari
// (docx, pdf, immagini) verranno gestiti quando avranno i loro viewer/estrattori.
const TEXT_EXT = new Set([
  'md', 'markdown', 'txt', 'json', 'js', 'ts', 'jsx', 'tsx', 'css', 'html', 'htm',
  'xml', 'yml', 'yaml', 'csv', 'log', 'sh', 'rs', 'py', 'toml', 'ini', 'conf',
])

function isTextFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase()
  return ext ? TEXT_EXT.has(ext) : false
}

// Cerca `query` nel contenuto dei file testuali. Una riga per file (la prima),
// per restare leggera; limite ai risultati totali.
export async function searchContent(
  files: VaultFile[],
  query: string,
  limit = 50,
): Promise<ContentMatch[]> {
  const q = query.toLowerCase()
  const results: ContentMatch[] = []

  for (const f of files) {
    if (!isTextFile(f.name)) continue
    let text: string
    try {
      text = await readTextFile(f.path)
    } catch {
      continue
    }
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(q)) {
        results.push({
          path: f.path,
          name: f.name,
          rel: f.rel,
          line: i + 1,
          preview: lines[i].trim().slice(0, 120),
        })
        break
      }
    }
    if (results.length >= limit) break
  }

  return results
}

// Ordina i match per nome file: prima chi inizia con la query, poi chi la contiene.
export function rankByName(f: VaultFile, q: string): number {
  const name = f.name.toLowerCase()
  if (name.startsWith(q)) return 0
  if (name.includes(q)) return 1
  return 2
}
