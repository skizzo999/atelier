import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'

// ExcelJS, salvando, BUTTA VIA le parti che non conosce: grafici, disegni,
// immagini ancorate. Su un file vero (verificato) 4 parti grafiche su 4
// sparivano, insieme al riferimento <drawing> dentro il foglio: il file
// restava valido ma senza grafici. Perdita di dati silenziosa.
//
// Qui rimettiamo quelle parti nel file appena scritto, prendendole
// dall'originale: le voci dello zip, il riferimento dentro il foglio, la
// relazione che lo collega e le dichiarazioni di tipo. Le celle e gli stili
// restano quelli nuovi di ExcelJS — si recupera solo ciò che ha perso.

/** Parti che ExcelJS non gestisce e che vanno riportate nel file salvato. */
const DA_SALVARE = /^xl\/(charts|drawings)\//

const localOf = (nome: string) => {
  const i = nome.indexOf(':')
  return i < 0 ? nome : nome.slice(i + 1)
}

// Nome del foglio → percorso del suo XML, dentro un pacchetto xlsx.
function mappaFogli(file: Record<string, Uint8Array>): Map<string, string> {
  const out = new Map<string, string>()
  const wbXml = file['xl/workbook.xml']
  const relsXml = file['xl/_rels/workbook.xml.rels']
  if (!wbXml || !relsXml) return out
  const rels = new Map<string, string>()
  for (const m of strFromU8(relsXml).matchAll(/<Relationship\b[^>]*>/g)) {
    const id = m[0].match(/\bId="([^"]+)"/)?.[1]
    const target = m[0].match(/\bTarget="([^"]+)"/)?.[1]
    if (id && target) rels.set(id, 'xl/' + target.replace(/^\/?xl\//, '').replace(/^\.\//, ''))
  }
  for (const m of strFromU8(wbXml).matchAll(/<sheet\b[^>]*>/g)) {
    const nome = m[0].match(/\bname="([^"]*)"/)?.[1]
    const rid = m[0].match(/r:id="([^"]+)"/)?.[1]
    const path = rid ? rels.get(rid) : undefined
    if (nome && path) out.set(nome, path)
  }
  return out
}

/** Percorso del file .rels che accompagna una parte. */
const relsDi = (parte: string) => parte.replace(/([^/]+)$/, '_rels/$1.rels')

/** Risolve un Target relativo (es. "../drawings/drawing1.xml"). */
function risolvi(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parti = base.split('/').slice(0, -1)
  for (const p of target.split('/')) {
    if (p === '.' || p === '') continue
    if (p === '..') parti.pop()
    else parti.push(p)
  }
  return parti.join('/')
}

/** Nuova posizione di un grafico spostato dall'utente. */
export interface Spostamento {
  /** Percorso del disegno, es. "xl/drawings/drawing1.xml". */
  drawing: string
  /** Quale ancoraggio dentro quel disegno (ordine di documento). */
  index: number
  from: { col: number; row: number }
  fromOff: { x: number; y: number } // px a 96 dpi
  to: { col: number; row: number }
  toOff: { x: number; y: number }
}

const EMU = 9525 // EMU per pixel a 96 dpi

// Un tag con prefisso di namespace qualsiasi (xdr:, a:, o nessuno).
const TAG = '(?:[A-Za-z0-9]+:)?'

/** Sostituisce col/colOff/row/rowOff dentro un blocco <from> o <to>. */
function riscriviAngolo(blocco: string, col: number, colOff: number, row: number, rowOff: number): string {
  const set = (xml: string, tag: string, valore: number) =>
    xml.replace(new RegExp('<' + TAG + tag + '>[^<]*</' + TAG + tag + '>'), (m) =>
      m.replace(/>[^<]*</, '>' + valore + '<'),
    )
  let out = set(blocco, 'colOff', Math.round(colOff * EMU))
  out = set(out, 'rowOff', Math.round(rowOff * EMU))
  out = set(out, 'col', col)
  out = set(out, 'row', row)
  return out
}

/**
 * Applica gli spostamenti all'XML di un disegno. Gli ancoraggi sono presi in
 * ordine di documento, lo stesso ordine con cui il lettore li numera.
 * Un oneCellAnchor non ha <to>: si sposta soltanto, mantiene la sua misura.
 */
function applicaSpostamenti(xml: string, mosse: Spostamento[]): string {
  if (!mosse.length) return xml
  const perIndice = new Map(mosse.map((m) => [m.index, m]))
  let i = 0
  const re = new RegExp(
    '<' + TAG + '(twoCellAnchor|oneCellAnchor)(?:\\s[^>]*)?>[\\s\\S]*?</' + TAG + '\\1>',
    'g',
  )
  return xml.replace(re, (blocco) => {
    const m = perIndice.get(i++)
    if (!m) return blocco
    let out = blocco.replace(new RegExp('<' + TAG + 'from>[\\s\\S]*?</' + TAG + 'from>'), (f) =>
      riscriviAngolo(f, m.from.col, m.fromOff.x, m.from.row, m.fromOff.y),
    )
    out = out.replace(new RegExp('<' + TAG + 'to>[\\s\\S]*?</' + TAG + 'to>'), (t) =>
      riscriviAngolo(t, m.to.col, m.toOff.x, m.to.row, m.toOff.y),
    )
    return out
  })
}

/**
 * Rimette nel file salvato i grafici e i disegni dell'originale.
 * Non lancia mai: se qualcosa non torna restituisce il salvato com'era,
 * perché un salvataggio senza grafici è comunque meglio di un file rotto.
 */
export function preserveCharts(
  originale: Uint8Array,
  salvato: Uint8Array,
  spostamenti: Spostamento[] = [],
): Uint8Array {
  try {
    const zo = unzipSync(originale)
    const parti = Object.keys(zo).filter((k) => DA_SALVARE.test(k))
    if (!parti.length) return salvato // niente da salvare

    const zs = unzipSync(salvato)
    for (const p of parti) zs[p] = zo[p]

    // Grafici spostati: si riscrive l'ancoraggio nel disegno appena rimesso.
    for (const disegno of new Set(spostamenti.map((m) => m.drawing))) {
      const raw = zs[disegno]
      if (!raw) continue
      const mosse = spostamenti.filter((m) => m.drawing === disegno)
      zs[disegno] = strToU8(applicaSpostamenti(strFromU8(raw), mosse))
    }

    // Le immagini ancorate ai disegni stanno in xl/media: ExcelJS di solito
    // le tiene, ma se ne mancasse una il disegno resterebbe monco.
    for (const k of Object.keys(zo)) if (/^xl\/media\//.test(k) && !zs[k]) zs[k] = zo[k]

    const fogliOrig = mappaFogli(zo)
    const fogliNuovi = mappaFogli(zs)

    for (const [nome, pathOrig] of fogliOrig) {
      const pathNuovo = fogliNuovi.get(nome)
      if (!pathNuovo || !zs[pathNuovo] || !zo[pathOrig]) continue

      // Il foglio originale puntava a un disegno?
      const xmlOrig = strFromU8(zo[pathOrig])
      const rifOrig = xmlOrig.match(/<drawing\b[^>]*r:id="([^"]+)"[^>]*\/?>/)
      if (!rifOrig) continue
      const relsOrig = zo[relsDi(pathOrig)]
      if (!relsOrig) continue
      const relOrig = [...strFromU8(relsOrig).matchAll(/<Relationship\b[^>]*>/g)].find(
        (m) => m[0].includes(`Id="${rifOrig[1]}"`),
      )
      if (!relOrig) continue
      const targetRel = relOrig[0].match(/\bTarget="([^"]+)"/)?.[1]
      const tipoRel = relOrig[0].match(/\bType="([^"]+)"/)?.[1]
      if (!targetRel || !tipoRel) continue
      // il disegno deve esistere davvero nel pacchetto salvato
      if (!zs[risolvi(pathOrig, targetRel)]) continue

      // 1) relazione nel foglio salvato, con un Id che non collida
      const pathRelsNuovo = relsDi(pathNuovo)
      let relsNuovo = zs[pathRelsNuovo]
        ? strFromU8(zs[pathRelsNuovo])
        : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
      const usati = [...relsNuovo.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]))
      const nuovoId = `rId${(usati.length ? Math.max(...usati) : 0) + 1}`
      relsNuovo = relsNuovo.replace(
        '</Relationships>',
        `<Relationship Id="${nuovoId}" Type="${tipoRel}" Target="${targetRel}"/></Relationships>`,
      )
      zs[pathRelsNuovo] = strToU8(relsNuovo)

      // 2) riferimento <drawing> dentro il foglio. Sta in fondo, dopo
      //    margini e impostazioni di stampa: metterlo prima romperebbe
      //    l'ordine che lo schema impone.
      let xmlNuovo = strFromU8(zs[pathNuovo])
      if (!/<drawing\b/.test(xmlNuovo)) {
        xmlNuovo = xmlNuovo.replace(/<\/worksheet>\s*$/, `<drawing r:id="${nuovoId}"/></worksheet>`)
        zs[pathNuovo] = strToU8(xmlNuovo)
      }
    }

    // 3) dichiarazioni di tipo: senza queste Excel non apre le parti nuove
    const ctPath = '[Content_Types].xml'
    if (zs[ctPath]) {
      let ct = strFromU8(zs[ctPath])
      const ctOrig = zo[ctPath] ? strFromU8(zo[ctPath]) : ''
      // Default per le estensioni (es. .xml già c'è, ma .png/.emf no)
      for (const m of ctOrig.matchAll(/<Default\b[^>]*>/g)) {
        const ext = m[0].match(/Extension="([^"]+)"/)?.[1]
        if (ext && !new RegExp(`<Default[^>]*Extension="${ext}"`).test(ct)) {
          ct = ct.replace('</Types>', `${m[0]}</Types>`)
        }
      }
      // Override per ogni parte rimessa
      for (const m of ctOrig.matchAll(/<Override\b[^>]*>/g)) {
        const part = m[0].match(/PartName="([^"]+)"/)?.[1]
        if (!part) continue
        const senzaSlash = part.replace(/^\//, '')
        if (!DA_SALVARE.test(senzaSlash)) continue
        if (!ct.includes(`PartName="${part}"`)) ct = ct.replace('</Types>', `${m[0]}</Types>`)
      }
      zs[ctPath] = strToU8(ct)
    }

    return zipSync(zs, { level: 6 })
  } catch (e) {
    console.warn('Grafici non conservati nel salvataggio:', e)
    return salvato
  }
}

export { localOf }
