// Metadati immagine letti dai byte del file (DPI da PNG pHYs / JPEG JFIF).

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// CRC32 (per i chunk PNG).
function crc32(data: Uint8Array): number {
  let crc = ~0
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return ~crc >>> 0
}

// Reinietta il DPI nei byte ri-encodati da canvas.toBlob (che li perde):
// PNG → chunk pHYs dopo l'IHDR; JPEG → densità nell'APP0 JFIF. Altri formati
// (webp: niente DPI standard) tornano invariati.
export function applyDpi(bytes: Uint8Array, ext: string, dpi: number): Uint8Array {
  const e = ext.toLowerCase()
  try {
    if (e === 'png') {
      // pHYs: ppm X (4) + ppm Y (4) + unità 1=metro (1). Inserito dopo IHDR
      // (firma 8 + chunk IHDR 25 = offset 33); canvas non emette mai pHYs.
      const ppm = Math.round(dpi / 0.0254)
      const data = new Uint8Array(13)
      data.set([0x70, 0x48, 0x59, 0x73]) // 'pHYs'
      const dv = new DataView(data.buffer)
      dv.setUint32(4, ppm)
      dv.setUint32(8, ppm)
      data[12] = 1
      const chunk = new Uint8Array(4 + 13 + 4)
      new DataView(chunk.buffer).setUint32(0, 9) // lunghezza dei soli dati
      chunk.set(data, 4)
      new DataView(chunk.buffer).setUint32(17, crc32(data))
      const out = new Uint8Array(bytes.length + chunk.length)
      out.set(bytes.subarray(0, 33))
      out.set(chunk, 33)
      out.set(bytes.subarray(33), 33 + chunk.length)
      return out
    }
    if (e === 'jpg' || e === 'jpeg') {
      // Trova l'APP0 JFIF e scrive unità=dpi + densità X/Y in place.
      const out = bytes.slice()
      let i = 2
      while (i + 4 < out.length && out[i] === 0xff) {
        const marker = out[i + 1]
        const len = (out[i + 2] << 8) + out[i + 3]
        if (marker === 0xe0 && out[i + 4] === 0x4a && out[i + 5] === 0x46 && out[i + 6] === 0x49 && out[i + 7] === 0x46) {
          out[i + 11] = 1 // unità: dpi
          out[i + 12] = (dpi >> 8) & 0xff
          out[i + 13] = dpi & 0xff
          out[i + 14] = (dpi >> 8) & 0xff
          out[i + 15] = dpi & 0xff
          return out
        }
        if (marker === 0xda) break
        i += 2 + len
      }
      return bytes
    }
  } catch {
    return bytes
  }
  return bytes
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
