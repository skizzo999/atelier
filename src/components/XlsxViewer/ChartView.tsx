import { memo } from 'react'
import type { ChartInfo } from '../../lib/xlsxCharts'
import { useScuro, luminanza } from '../../lib/tema'

// Disegno di un grafico del file (sola lettura), in SVG. Copre i tipi che si
// incontrano davvero nei fogli di lavoro: barre (verticali e orizzontali),
// linee, aree, torta e dispersione.

// Colori di riserva quando il file non li dichiara: la palette dell'app.
const FALLBACK = ['#2563eb', '#38bdf8', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#64748b', '#14b8a6']

// Assi, reticolo e testo seguono il tema: sono variabili CSS, valide anche
// dentro gli attributi SVG. I colori delle SERIE no — quelli li dichiara il
// file e vanno rispettati com'erano.
const AXIS = 'var(--ch-asse)'
const GRID = 'var(--ch-reticolo)'
const INK = 'var(--ch-inchiostro)'

// Etichetta numerica leggibile (niente code di decimali inutili).
const fmt = (n: number): string => {
  const a = Math.abs(n)
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (a >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

// Memoizzato: la griglia si ridisegna a ogni evento di scorrimento e senza
// questo l'SVG del grafico verrebbe ricostruito ogni volta — con qualche
// centinaio di elementi si vedono gli scatti. I dati del grafico cambiano
// solo quando cambiano le celle, non quando si scorre.
export const ChartView = memo(function ChartView({
  chart,
  width,
  height,
}: {
  chart: ChartInfo
  width: number
  height: number
}) {
  const scuro = useScuro()
  const W = Math.max(160, width)
  const H = Math.max(120, height)
  // Colore di una serie: quello del file. Col tema scuro, però, una serie
  // quasi nera sparirebbe sul riquadro scuro: in quel caso si ripiega sulla
  // palette dell'app, che resta leggibile e distingue le serie fra loro.
  const colorOf = (i: number) => {
    const riserva = FALLBACK[i % FALLBACK.length]
    const dal = chart.series[i]?.color
    if (!dal) return riserva
    return scuro && luminanza(dal) < 0.3 ? riserva : dal
  }

  const titleH = chart.title ? 22 : 6
  const legendH = chart.series.length > 1 ? 18 : 0

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', fontFamily: '"Segoe UI", system-ui, sans-serif' }}>
      <rect x={0} y={0} width={W} height={H} fill="var(--ch-carta)" stroke="var(--ch-bordo)" rx={4} />
      {chart.title && (
        <text x={W / 2} y={15} textAnchor="middle" fontSize={12} fontWeight={600} fill={INK}>
          {chart.title}
        </text>
      )}

      {chart.type === 'pie' ? (
        <Pie chart={chart} W={W} H={H} top={titleH} colorOf={colorOf} />
      ) : (
        <Cartesian chart={chart} W={W} H={H} top={titleH} bottom={legendH} colorOf={colorOf} />
      )}

      {/* Legenda (solo con più serie) */}
      {legendH > 0 &&
        chart.series.map((s, i) => {
          const per = Math.min(120, (W - 16) / chart.series.length)
          const x = 8 + i * per
          return (
            <g key={i}>
              <rect x={x} y={H - 13} width={9} height={9} fill={colorOf(i)} rx={2} />
              <text x={x + 13} y={H - 5} fontSize={10} fill={INK}>
                {s.name.length > 14 ? `${s.name.slice(0, 13)}…` : s.name}
              </text>
            </g>
          )
        })}
    </svg>
  )
})

// Barre / linee / aree / dispersione: assi, griglia orizzontale, serie.
function Cartesian({
  chart,
  W,
  H,
  top,
  bottom,
  colorOf,
}: {
  chart: ChartInfo
  W: number
  H: number
  top: number
  bottom: number
  colorOf: (i: number) => string
}) {
  const padL = 38
  const padR = 10
  const padB = 20 + bottom
  const x0 = padL
  const y0 = top + 4
  const w = Math.max(10, W - padL - padR)
  const h = Math.max(10, H - top - padB - 4)

  // Serie lunghissime (un titolo di borsa ha migliaia di giorni) su pochi
  // pixel: più punti che pixel non si vedono, ma il tracciato diventa un
  // attributo da decine di kB da ridisegnare a ogni fotogramma. Si tiene un
  // punto per pixel, tenendo di ogni intervallo il MINIMO e il MASSIMO: così
  // nessun picco sparisce e la scala verticale resta quella vera. Stessi
  // indici per tutte le serie, che restano allineate fra loro.
  const nOrig = Math.max(...chart.series.map((s) => s.values.length), chart.categories.length)
  const maxPunti = Math.max(64, Math.round(W - 48))
  const tenuti = ((): number[] | null => {
    if (nOrig <= maxPunti) return null
    const rif = chart.series.reduce((a, b) => (b.values.length > a.values.length ? b : a)).values
    const gruppi = Math.floor(maxPunti / 2)
    const passo = nOrig / gruppi
    const idx: number[] = []
    for (let g = 0; g < gruppi; g++) {
      const a = Math.floor(g * passo)
      const b = Math.min(nOrig - 1, Math.floor((g + 1) * passo) - 1)
      if (b < a) continue
      let iMin = a
      let iMax = a
      for (let i = a; i <= b; i++) {
        if ((rif[i] ?? 0) < (rif[iMin] ?? 0)) iMin = i
        if ((rif[i] ?? 0) > (rif[iMax] ?? 0)) iMax = i
      }
      const lo = Math.min(iMin, iMax)
      const hi = Math.max(iMin, iMax)
      idx.push(lo)
      if (hi !== lo) idx.push(hi)
    }
    return idx
  })()
  const scegli = <T,>(arr: T[]): T[] => (tenuti ? tenuti.map((i) => arr[i]).filter((v) => v !== undefined) : arr)
  if (tenuti) {
    chart = {
      ...chart,
      categories: scegli(chart.categories),
      series: chart.series.map((s) => ({ ...s, values: scegli(s.values) })),
    }
  }

  const all = chart.series.flatMap((s) => s.values)
  const rawMax = Math.max(0, ...all)
  const rawMin = Math.min(0, ...all)
  const max = rawMax === rawMin ? rawMax + 1 : rawMax
  const min = rawMin
  const yOf = (v: number) => y0 + h - ((v - min) / (max - min)) * h
  const n = Math.max(1, chart.categories.length)
  const horizontal = chart.type === 'barH'

  // Tacche: 4 intervalli, sempre leggibili.
  const ticks = Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4)

  return (
    <g>
      {/* griglia + valori dell'asse */}
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={x0} y1={yOf(t)} x2={x0 + w} y2={yOf(t)} stroke={GRID} strokeWidth={1} />
          <text x={x0 - 4} y={yOf(t) + 3} textAnchor="end" fontSize={9} fill={AXIS}>
            {fmt(t)}
          </text>
        </g>
      ))}
      <line x1={x0} y1={y0} x2={x0} y2={y0 + h} stroke={AXIS} strokeWidth={1} />
      <line x1={x0} y1={yOf(Math.max(0, min))} x2={x0 + w} y2={yOf(Math.max(0, min))} stroke={AXIS} strokeWidth={1} />

      {/* etichette delle categorie (diradate se sono tante) */}
      {chart.categories.map((c, i) => {
        const step = Math.ceil(n / Math.max(1, Math.floor(w / 44)))
        if (i % step !== 0) return null
        const cx = x0 + (w / n) * (i + 0.5)
        return (
          <text key={i} x={cx} y={y0 + h + 12} textAnchor="middle" fontSize={9} fill={AXIS}>
            {c.length > 8 ? `${c.slice(0, 7)}…` : c}
          </text>
        )
      })}

      {/* serie */}
      {chart.series.map((s, si) => {
        const color = colorOf(si)
        if (chart.type === 'bar' || horizontal) {
          const groupW = w / n
          const barW = Math.max(2, (groupW * 0.72) / chart.series.length)
          return (
            <g key={si}>
              {s.values.map((v, i) => {
                const cx = x0 + groupW * i + groupW * 0.14 + si * barW
                const top2 = yOf(Math.max(v, 0))
                const bh = Math.abs(yOf(v) - yOf(0))
                return <rect key={i} x={cx} y={top2} width={barW} height={Math.max(1, bh)} fill={color} rx={1} />
              })}
            </g>
          )
        }
        const pts = s.values.map((v, i) => `${x0 + (w / n) * (i + 0.5)},${yOf(v)}`)
        if (chart.type === 'area') {
          const base = yOf(Math.max(0, min))
          return (
            <polygon
              key={si}
              points={`${x0 + w / n / 2},${base} ${pts.join(' ')} ${x0 + (w / n) * (s.values.length - 0.5)},${base}`}
              fill={color}
              fillOpacity={0.25}
              stroke={color}
              strokeWidth={1.5}
            />
          )
        }
        if (chart.type === 'scatter') {
          return (
            <g key={si}>
              {s.values.map((v, i) => (
                <circle key={i} cx={x0 + (w / n) * (i + 0.5)} cy={yOf(v)} r={2.5} fill={color} />
              ))}
            </g>
          )
        }
        return (
          <g key={si}>
            <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
            {s.values.length <= 30 &&
              s.values.map((v, i) => <circle key={i} cx={x0 + (w / n) * (i + 0.5)} cy={yOf(v)} r={2.5} fill={color} />)}
          </g>
        )
      })}
    </g>
  )
}

// Torta: una fetta per categoria (usa la prima serie, come Excel).
function Pie({
  chart,
  W,
  H,
  top,
  colorOf,
}: {
  chart: ChartInfo
  W: number
  H: number
  top: number
  colorOf: (i: number) => string
}) {
  const values = chart.series[0]?.values ?? []
  const total = values.reduce((a, b) => a + Math.abs(b), 0)
  const cx = W / 2
  const cy = top + (H - top) / 2
  const r = Math.max(10, Math.min(W, H - top) / 2 - 26)
  if (!total) return null
  let angle = -Math.PI / 2
  return (
    <g>
      {values.map((v, i) => {
        const slice = (Math.abs(v) / total) * Math.PI * 2
        const x1 = cx + r * Math.cos(angle)
        const y1 = cy + r * Math.sin(angle)
        angle += slice
        const x2 = cx + r * Math.cos(angle)
        const y2 = cy + r * Math.sin(angle)
        const mid = angle - slice / 2
        const pct = Math.round((Math.abs(v) / total) * 100)
        // Fetta unica (100%): il path degenererebbe, meglio un cerchio.
        const d =
          values.length === 1
            ? ''
            : `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${slice > Math.PI ? 1 : 0} 1 ${x2} ${y2} Z`
        return (
          <g key={i}>
            {d ? (
              <path d={d} fill={colorOf(0) && chart.series.length > 1 ? colorOf(i) : FALLBACK[i % FALLBACK.length]} stroke="var(--ch-carta)" strokeWidth={1} />
            ) : (
              <circle cx={cx} cy={cy} r={r} fill={FALLBACK[0]} />
            )}
            {pct >= 6 && (
              <text
                x={cx + r * 0.68 * Math.cos(mid)}
                y={cy + r * 0.68 * Math.sin(mid) + 3}
                textAnchor="middle"
                fontSize={9}
                fill="#fff"
                fontWeight={600}
              >
                {pct}%
              </text>
            )}
          </g>
        )
      })}
      {/* etichette delle categorie attorno alla torta */}
      {values.length <= 8 &&
        (() => {
          let a = -Math.PI / 2
          return values.map((v, i) => {
            const slice = (Math.abs(v) / total) * Math.PI * 2
            const mid = a + slice / 2
            a += slice
            const lx = cx + (r + 12) * Math.cos(mid)
            const ly = cy + (r + 12) * Math.sin(mid) + 3
            const cat = chart.categories[i] ?? ''
            if (!cat) return null
            return (
              <text
                key={i}
                x={lx}
                y={ly}
                textAnchor={Math.cos(mid) > 0.1 ? 'start' : Math.cos(mid) < -0.1 ? 'end' : 'middle'}
                fontSize={9}
                fill={INK}
              >
                {cat.length > 10 ? `${cat.slice(0, 9)}…` : cat}
              </text>
            )
          })
        })()}
    </g>
  )
}
