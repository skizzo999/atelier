import { readDir, readTextFile, readFile } from '@tauri-apps/plugin-fs'
import * as pdfjsLib from 'pdfjs-dist'
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import * as mammoth from 'mammoth'

pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorker

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

function isPdf(name: string): boolean {
  return name.toLowerCase().endsWith('.pdf')
}

// Testo per pagina di un PDF, in cache per sessione (i PDF cambiano di rado e
// ri-estrarre a ogni tasto premuto sarebbe lentissimo). Solo testo "vero": le
// scansioni senza testo non vengono trovate qui (vanno aperte e cercate con l'OCR).
const pdfTextCache = new Map<string, string[]>()

async function pdfPageTexts(path: string): Promise<string[]> {
  const cached = pdfTextCache.get(path)
  if (cached) return cached
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
  pdfTextCache.set(path, pages)
  return pages
}

function snippet(text: string, idx: number, len: number): string {
  const start = Math.max(0, idx - 40)
  return (start > 0 ? '…' : '') + text.slice(start, idx + len + 80).replace(/\s+/g, ' ').trim()
}

function isDocx(name: string): boolean {
  return name.toLowerCase().endsWith('.docx')
}

// Testo grezzo di un DOCX (Mammoth), in cache per sessione.
const docxTextCache = new Map<string, string>()

async function docxText(path: string): Promise<string> {
  const cached = docxTextCache.get(path)
  if (cached !== undefined) return cached
  const bytes = await readFile(path)
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const r = await mammoth.extractRawText({ arrayBuffer })
  docxTextCache.set(path, r.value)
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
