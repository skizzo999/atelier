// Parser/serializzatore CSV minimale con supporto virgolette (RFC 4180-ish).
// Il separatore viene rilevato dalla prima riga (l'Excel italiano usa ';').

export function detectSep(text: string): string {
  // Analizza le prime righe (non solo la prima: può essere un titolo senza
  // separatori). Vince il separatore più frequente; parità/zero → ','.
  const sample = text.slice(0, 2000)
  const commas = (sample.match(/,/g) || []).length
  const semis = (sample.match(/;/g) || []).length
  const tabs = (sample.match(/\t/g) || []).length
  if (tabs > commas && tabs > semis) return '\t'
  return semis > commas ? ';' : ','
}

export function parseCsv(text: string, sep = detectSep(text)): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"'
          i++
        } else inQuotes = false
      } else cur += ch
      continue
    }
    if (ch === '"') inQuotes = true
    else if (ch === sep) {
      row.push(cur)
      cur = ''
    } else if (ch === '\n') {
      row.push(cur.replace(/\r$/, ''))
      rows.push(row)
      row = []
      cur = ''
    } else cur += ch
  }
  row.push(cur.replace(/\r$/, ''))
  if (row.length > 1 || row[0] !== '') rows.push(row)
  return rows
}

export function toCsv(rows: string[][], sep = ';'): string {
  const quote = (s: string) =>
    s.includes(sep) || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
  return rows.map((r) => r.map(quote).join(sep)).join('\r\n')
}
