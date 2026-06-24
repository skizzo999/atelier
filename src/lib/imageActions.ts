// Azioni rapide sulle immagini: copia negli appunti, mostra in Explorer.
import { revealItemInDir } from '@tauri-apps/plugin-opener'

export async function revealInExplorer(path: string): Promise<void> {
  await revealItemInDir(path)
}

// Copia un canvas negli appunti come PNG. Ritorna true se riuscito.
export function copyCanvasToClipboard(canvas: HTMLCanvasElement): Promise<boolean> {
  return new Promise((resolve) => {
    canvas.toBlob(async (blob) => {
      if (!blob) return resolve(false)
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        resolve(true)
      } catch {
        resolve(false)
      }
    }, 'image/png')
  })
}

// Copia un <img> già caricato negli appunti (passa per un canvas).
export async function copyImageElementToClipboard(img: HTMLImageElement): Promise<boolean> {
  const c = document.createElement('canvas')
  c.width = img.naturalWidth || img.width
  c.height = img.naturalHeight || img.height
  const ctx = c.getContext('2d')
  if (!ctx) return false
  ctx.drawImage(img, 0, 0)
  return copyCanvasToClipboard(c)
}
