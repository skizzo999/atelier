// Metadati immagine letti dai byte del file (DPI da PNG pHYs / JPEG JFIF).

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// DPI dell'immagine (densità). Ritorna null se non determinabile.
export function parseDpi(bytes: Uint8Array, ext: string): number | null {
  const e = ext.toLowerCase()
  try {
    if (e === 'png') {
      // Segnatura PNG (8 byte) + chunk [len(4) type(4) data...]. Cerco pHYs.
      let i = 8
      while (i + 12 <= bytes.length) {
        const len = bytes[i] * 0x1000000 + (bytes[i + 1] << 16) + (bytes[i + 2] << 8) + bytes[i + 3]
        const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7])
        if (type === 'pHYs') {
          const ppuX = bytes[i + 8] * 0x1000000 + (bytes[i + 9] << 16) + (bytes[i + 10] << 8) + bytes[i + 11]
          const unit = bytes[i + 16] // 1 = metro
          return unit === 1 ? Math.round(ppuX * 0.0254) : null
        }
        if (type === 'IDAT' || type === 'IEND') break
        i += 12 + len
      }
      return 96 // default Windows quando manca pHYs
    }
    if (e === 'jpg' || e === 'jpeg') {
      // FFD8, poi segmenti FFEx [len(2) data...]. Cerco APP0 'JFIF'.
      let i = 2
      while (i + 4 < bytes.length && bytes[i] === 0xff) {
        const marker = bytes[i + 1]
        const len = (bytes[i + 2] << 8) + bytes[i + 3]
        if (marker === 0xe0 && bytes[i + 4] === 0x4a && bytes[i + 5] === 0x46 && bytes[i + 6] === 0x49 && bytes[i + 7] === 0x46) {
          const unit = bytes[i + 11] // 1=dpi, 2=dpcm
          const xd = (bytes[i + 12] << 8) + bytes[i + 13]
          if (unit === 1) return xd
          if (unit === 2) return Math.round(xd * 2.54)
          return null
        }
        if (marker === 0xda) break // start of scan
        i += 2 + len
      }
      return 96
    }
  } catch {
    return null
  }
  return null
}
