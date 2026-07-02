import { readDir, readTextFile, readFile, stat } from '@tauri-apps/plugin-fs'

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
  page?: number // per i PDF: pagina del primo match
  preview: string
}

// Allineato al filtro del FileTree: file di servizio (tmp/backup) esclusi
// anche da quick-open e ricerca nel contenuto.
function skip(name: string): boolean {
  return (
    name.startsWith('.') ||
    name === 'node_modules' ||
    name.endsWith('.tmp') ||
    name.endsWith('.bak') ||
    name.endsWith('.atelier')
  )
}

// Elenca ricorsivamente TUTTI i file del vault (qualsiasi tipo): serve al quick-open.
// Le cartelle-symlink vengono saltate (un link a una cartella antenata creerebbe
// un ciclo infinito); il limite di profondità è la seconda rete di sicurezza.
const MAX_DEPTH = 64

export async function walkFiles(root: string): Promise<VaultFile[]> {
  const out: VaultFile[] = []

  async function walk(dir: string, depth: number) {
    if (depth > MAX_DEPTH) return
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
        if (!e.isSymlink) await walk(full, depth + 1)
      } else {
        out.push({ path: full, name: e.name, rel: full.slice(root.length + 1) })
      }
    }
  }

  await walk(root, 0)
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

function isPdf(name: string): boolean {
  return name.toLowerCase().endsWith('.pdf')
}

// Data di modifica del file: la cache vale finché il file non cambia.
async function mtimeOf(path: string): Promise<number> {
  try {
    return (await stat(path)).mtime?.getTime() ?? 0
  } catch {
    return 0
  }
}

// Testo per pagina di un PDF, in cache finché il file non cambia (ri-estrarre
// a ogni tasto premuto sarebbe lentissimo). Solo testo "vero": le scansioni
// senza testo non vengono trovate qui (vanno aperte e cercate con l'OCR).
const pdfTextCache = new Map<string, { mtime: number; pages: string[] }>()

async function pdfPageTexts(path: string): Promise<string[]> {
  const mtime = await mtimeOf(path)
  const cached = pdfTextCache.get(path)
  if (cached && cached.mtime === mtime) return cached.pages
  // pdf.js caricato solo alla prima ricerca in un PDF (code-split): questo
  // modulo è importato da App, non deve pesare sul bundle principale.
  const [pdfjsLib, { default: PdfWorker }] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorker
  const bytes = await readFile(path)
  const task = pdfjsLib.getDocument({ data: bytes })
  const pdf = await task.promise
  const pages: string[] = []
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n)
    const tc = await page.getTextContent()
    pages.push(tc.items.map((it) => ('str' in it ? it.str : '')).join(' '))
  }
  task.destroy()
  pdfTextCache.set(path, { mtime, pages })
  return pages
}

function snippet(text: string, idx: number, len: number): string {
  const start = Math.max(0, idx - 40)
  return (start > 0 ? '…' : '') + text.slice(start, idx + len + 80).replace(/\s+/g, ' ').trim()
}

function isDocx(name: string): boolean {
  return name.toLowerCase().endsWith('.docx')
}

// Testo grezzo di un DOCX (Mammoth), in cache finché il file non cambia.
const docxTextCache = new Map<string, { mtime: number; text: string }>()

async function docxText(path: string): Promise<string> {
  const mtime = await mtimeOf(path)
  const cached = docxTextCache.get(path)
  if (cached && cached.mtime === mtime) return cached.text
  const mammoth = await import('mammoth') // solo alla prima ricerca in un DOCX
  const bytes = await readFile(path)
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const r = await mammoth.extractRawText({ arrayBuffer })
  docxTextCache.set(path, { mtime, text: r.value })
  return r.value
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
    if (isPdf(f.name)) {
      let pages: string[]
      try {
        pages = await pdfPageTexts(f.path)
      } catch {
        continue
      }
      for (let p = 0; p < pages.length; p++) {
        const idx = pages[p].toLowerCase().indexOf(q)
        if (idx >= 0) {
          results.push({
            path: f.path,
            name: f.name,
            rel: f.rel,
            line: 0,
            page: p + 1,
            preview: snippet(pages[p], idx, q.length),
          })
          break // primo match per PDF
        }
      }
      if (results.length >= limit) break
      continue
    }
    if (isDocx(f.name)) {
      let text: string
      try {
        text = await docxText(f.path)
      } catch {
        continue
      }
      const idx = text.toLowerCase().indexOf(q)
      if (idx >= 0) {
        results.push({ path: f.path, name: f.name, rel: f.rel, line: 0, preview: snippet(text, idx, q.length) })
      }
      if (results.length >= limit) break
      continue
    }
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
