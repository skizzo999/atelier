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

function isRemote(src: string): boolean {
  return /^(https?:|data:)/i.test(src)
}

function isAbsoluteWin(src: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(src)
}

// Risolve un percorso relativo (rispetto alla cartella del file) in assoluto,
// gestendo ./ e ../
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

// Carica un'immagine (locale o remota) e ritorna un URL utilizzabile in <img src>.
// Per le immagini locali legge i byte e crea un object URL.
export async function loadImage(src: string, fileDir: string): Promise<string | null> {
  try {
    if (isRemote(src)) return src
    const abs = isAbsoluteWin(src) ? src.replace(/\//g, '\\') : resolvePath(fileDir, decodeURI(src))
    const bytes = await readFile(abs)
    const ext = abs.split('.').pop()?.toLowerCase() ?? ''
    return URL.createObjectURL(new Blob([bytes], { type: MIME[ext] ?? 'application/octet-stream' }))
  } catch (err) {
    console.error('Errore caricamento immagine:', err)
    return null
  }
}
