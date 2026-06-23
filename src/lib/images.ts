import { readFile } from '@tauri-apps/plugin-fs'

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  avif: 'image/avif',
}

// Indice immagini del vault: basename (minuscolo) -> path completo. Permette di
// trovare un'immagine per nome ovunque nel vault (come Obsidian).
let vaultImageIndex = new Map<string, string>()
export function setVaultImageIndex(index: Map<string, string>) {
  vaultImageIndex = index
}

function isRemote(src: string): boolean {
  return /^(https?:|data:)/i.test(src)
}

function isAbsoluteWin(src: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(src)
}

function resolvePath(fileDir: string, rel: string): string {
  const combined = `${fileDir}\\${rel.replace(/\//g, '\\')}`
  const out: string[] = []
  for (const part of combined.split('\\')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('\\')
}

async function readAsObjectUrl(abs: string): Promise<string> {
  const bytes = await readFile(abs)
  const ext = abs.split('.').pop()?.toLowerCase() ?? ''
  return URL.createObjectURL(new Blob([bytes], { type: MIME[ext] ?? 'application/octet-stream' }))
}

// Carica un'immagine provando piu strade: remota, assoluta, relativa al file,
// e per nome in tutto il vault. Ritorna un object URL o null se non trovata.
export async function loadImage(src: string, fileDir: string): Promise<string | null> {
  if (isRemote(src)) return src

  const clean = decodeURI(src.trim())
  const candidates: string[] = []
  if (isAbsoluteWin(clean)) {
    candidates.push(clean.replace(/\//g, '\\'))
  } else {
    candidates.push(resolvePath(fileDir, clean))
    const base = clean.split(/[\\/]/).pop()?.toLowerCase()
    if (base && vaultImageIndex.has(base)) candidates.push(vaultImageIndex.get(base)!)
  }

  for (const abs of candidates) {
    try {
      return await readAsObjectUrl(abs)
    } catch {
      // prova il prossimo candidato
    }
  }
  console.error('Immagine non trovata:', src, 'provati:', candidates)
  return null
}
